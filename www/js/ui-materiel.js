// Parc matériel (sous-onglet Matériel de Bâtiments, maquette bâtiments v2) :
// catégories repliables, une ligne par machine avec le bouton rapide
// « Graissé », et la fiche dépliée dans la ligne (compteur d'heures saisi à
// la main, derniers entretiens, + Entretien, photos et factures). Le
// formulaire « Modifier » (nom, marque, catégorie, largeur, conseillé pour,
// CUMA / entreprise, note) reste celui d'avant.
//
// AUCUN déclenchement automatique ni alerte : « il y a X j » et les heures
// écoulées sont des informations, en gris neutre. L'exploitant juge.
import {
  getMateriels, getMaterielById, createMateriel, updateMateriel,
  deleteMateriel, resume, CATEGORIES_MATERIEL, categorieMateriel,
  TYPES_ENTRETIEN, labelEntretien, enregistrerEntretien, entretiensDe, supprimerEntretien,
  libellesAutres, ilYa, avecCompteur, mettreAJourCompteur,
  ecouterPieces, ajouterPiece, supprimerPiece
} from './materiel.js';
import { getTypes, onTypesChange, estMasque, cibleDe } from './interventions-types.js';
import { messagePermission } from './diagnostic-regles.js';
import { compresserPhoto } from './photo.js';
import { aujourdhui } from './implantations.js';
import { toastSucces, toastErreur, toastAction } from './toast.js';

const panel = document.getElementById('materiel-panel');
const form = document.getElementById('mat-form');
const el = {};
['title', 'nom', 'marque', 'categorie', 'largeur', 'actions', 'cuma',
 'note', 'save', 'cancel', 'delete',
 'error-banner', 'error-text', 'error-close'
].forEach((k) => { el[k] = document.getElementById('mat-' + k); });

el.categorie.innerHTML = CATEGORIES_MATERIEL
  .map((c) => `<option value="${c.value}">${c.icone} ${escapeHtml(c.label)}</option>`).join('');

// « Conseillé pour » est peuplé depuis les types d'activité réels : quand
// l'exploitant crée une action sur mesure, elle devient aussitôt rattachable
// à un outil, sans rien à recoder.
let actionsChoisies = [];
onTypesChange(() => peuplerActions(actionsChoisies));

function peuplerActions(valeurs) {
  actionsChoisies = Array.isArray(valeurs) ? valeurs.slice() : [];
  const noms = getTypes()
    .filter((t) => !estMasque(t) && cibleDe(t) !== 'BERGERIE')
    .map((t) => String(t.nom));
  // Une action supprimée du référentiel reste proposée tant qu'un matériel la
  // porte : sinon, enregistrer la fiche effacerait silencieusement le lien.
  actionsChoisies.forEach((a) => { if (noms.indexOf(a) === -1) noms.push(a); });
  el.actions.innerHTML = noms
    .map((n) => `<option value="${escapeAttr(n)}"${actionsChoisies.indexOf(n) !== -1 ? ' selected' : ''}>${escapeHtml(n)}</option>`)
    .join('');
}

function lireActions() {
  return Array.from(el.actions.selectedOptions).map((o) => o.value);
}

const listeEl = document.getElementById('materiels-liste');

let editId = null;

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { el['error-text'].textContent = m; el['error-banner'].hidden = false; }
function hideError() { el['error-banner'].hidden = true; }
el['error-close'].addEventListener('click', hideError);

export function initMateriel() {
  document.getElementById('btn-new-materiel').addEventListener('click', openCreate);
  el.cancel.addEventListener('click', fermer);
  form.addEventListener('submit', enregistrer);
  el.delete.addEventListener('click', supprimer);
}

export function openCreate() {
  editId = null;
  panel.hidden = false;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  el.title.textContent = 'Nouveau matériel';
  el.delete.hidden = true;
  el.nom.value = ''; el.marque.value = ''; el.largeur.value = '';
  el.categorie.value = 'AUTRE';
  el.cuma.checked = false;
  peuplerActions([]);
  el.note.value = '';
  log('fiche matériel ouverte (création)');
}

export function openEditMateriel(m) {
  if (!m) return;
  editId = m.id;
  panel.hidden = false;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  el.title.textContent = m.nom || 'Matériel';
  el.delete.hidden = false;
  el.nom.value = m.nom || '';
  el.marque.value = m.marque || '';
  el.categorie.value = m.categorie || 'AUTRE';
  el.cuma.checked = !!m.cuma;
  peuplerActions(Array.isArray(m.actions) ? m.actions : []);
  el.largeur.value = m.largeurTravailMetres != null ? m.largeurTravailMetres : '';
  el.note.value = m.noteEntretien || '';
}

function fermer() { panel.hidden = true; editId = null; }

async function enregistrer(e) {
  e.preventDefault();
  hideError();
  el.save.disabled = true; el.save.textContent = 'Enregistrement...';
  try {
    const data = {
      nom: el.nom.value,
      marque: el.marque.value,
      categorie: el.categorie.value,
      actions: lireActions(),
      largeurTravailMetres: el.largeur.value,
      noteEntretien: el.note.value,
      cuma: el.cuma.checked
    };
    if (editId) await updateMateriel(editId, data);
    else await createMateriel(data);
    fermer();
    log('matériel enregistré');
    toastSucces('Matériel enregistré.');
  } catch (err) {
    const msg = messagePermission(err, 'lgs_materiel');
    showError(msg);
    toastErreur(`Échec de l'enregistrement du matériel : ${msg}`);
  } finally {
    el.save.disabled = false; el.save.textContent = 'Enregistrer';
  }
}

async function supprimer() {
  if (!editId) return;
  if (!confirm('Supprimer ce matériel ? Les activités qui le mentionnent garderont son nom.')) return;
  el.delete.disabled = true;
  try { await deleteMateriel(editId); fermer(); toastSucces('Matériel supprimé.'); }
  catch (err) { const msg = (err && err.message) || err; showError(msg); toastErreur(`Échec de la suppression : ${msg}`); }
  finally { el.delete.disabled = false; }
}

// --- Liste ---------------------------------------------------------------
const categoriesFermees = new Set();
const fichesOuvertes = new Set();
let formEntretien = null;          // { id, type, libelle, date, cout, compteur } : saisie en cours
let compteurEdite = null;          // { id, valeur }
const pieces = new Map();          // materielId -> [{id, dataUrl, date}]
const abonnementsPieces = new Map();

function heures(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR'); }
function dateCourte(iso) { return iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : ''; }

function sousTitre(m, entrees) {
  const bouts = [];
  if (Array.isArray(m.actions) && m.actions.length) bouts.push(m.actions.join(', '));
  if (!m.cuma) {
    const dernier = entrees[0];
    bouts.push(dernier ? `${labelEntretien(dernier)} ${ilYa(dernier.date)}` : (bouts.length ? 'aucun entretien noté' : 'Aucun entretien noté'));
  }
  return bouts.join(' · ');
}

function ligneMachine(m) {
  const entrees = m.cuma ? [] : entretiensDe(m.id);
  const ouvert = fichesOuvertes.has(m.id);
  const droite = m.cuma
    ? '<span class="mat-cuma">CUMA / entreprise</span>'
    : `<button type="button" class="mat-graisser" data-graisser="${escapeAttr(m.id)}"
              title="Enregistrer un graissage à la date du jour"><span class="mat-graisser-pastille">🛢️ Graissé</span></button>`;
  return `<div class="mat-machine${ouvert ? ' is-open' : ''}" data-id="${escapeAttr(m.id)}">
    <div class="mat-ligne" data-ouvrir="${escapeAttr(m.id)}">
      <div class="mat-body">
        <div class="mat-nom">${escapeHtml(m.nom || 'Matériel')}</div>
        <div class="mat-sub">${escapeHtml(sousTitre(m, entrees))}</div>
      </div>
      ${droite}
    </div>
    ${ouvert ? fiche(m, entrees) : ''}
  </div>`;
}

function ligneEntretien(m, e) {
  const bouts = [labelEntretien(e)];
  if (e.cout != null) bouts.push(`${Number(e.cout).toLocaleString('fr-FR')} €`);
  if (e.compteurHeures != null) {
    const ecart = m.compteurHeures != null ? Math.round(m.compteurHeures - e.compteurHeures) : null;
    bouts.push(`${heures(e.compteurHeures)} h${ecart != null && ecart >= 0 ? `, il y a ${heures(ecart)} h` : ''}`);
  }
  return `<div class="mat-entretien">
    <span>${escapeHtml(bouts.join(' · '))}</span>
    <span class="mat-entretien-droite">${escapeHtml(dateCourte(e.date))}
      <button type="button" class="mat-suppr" data-suppr-entretien="${escapeAttr(e.id || 'legacy')}" aria-label="Supprimer cet entretien">✕</button></span>
  </div>`;
}

function formulaireEntretien(m) {
  const f = formEntretien;
  const perso = libellesAutres();
  const options = TYPES_ENTRETIEN.filter((t) => t.value !== 'AUTRE')
    .map((t) => `<option value="${t.value}"${f.type === t.value ? ' selected' : ''}>${t.icone} ${escapeHtml(t.label)}</option>`)
    .concat(perso.map((l) => `<option value="AUTRE:${escapeAttr(l)}"${f.type === 'AUTRE:' + l ? ' selected' : ''}>🛠️ ${escapeHtml(l)}</option>`))
    .concat([`<option value="AUTRE"${f.type === 'AUTRE' ? ' selected' : ''}>🛠️ Autre…</option>`]).join('');
  return `<div class="mat-form-entretien">
    <label>Type</label>
    <select id="mat-ent-type" data-champ="type">${options}</select>
    ${f.type === 'AUTRE' ? `<label>Nom de l'entretien</label><input type="text" id="mat-ent-libelle" data-champ="libelle" value="${escapeAttr(f.libelle)}" placeholder="ex : Courroie, Pneus">` : ''}
    <div class="mat-form-grille">
      <div><label>Date</label><input type="date" id="mat-ent-date" data-champ="date" value="${escapeAttr(f.date)}"></div>
      <div><label>Coût (€, facultatif)</label><input type="number" id="mat-ent-cout" data-champ="cout" min="0" step="1" inputmode="decimal" value="${escapeAttr(f.cout)}"></div>
      ${avecCompteur(m) ? `<div><label>Compteur (h, facultatif)</label><input type="number" id="mat-ent-compteur" data-champ="compteur" min="0" step="1" inputmode="decimal" value="${escapeAttr(f.compteur)}"></div>` : ''}
    </div>
    <div class="mat-form-actions">
      <button type="button" class="stk-btn-sombre" data-ent-enregistrer>Enregistrer</button>
      <button type="button" class="stk-lien-gris" data-ent-annuler>Annuler</button>
    </div>
  </div>`;
}

function fiche(m, entrees) {
  const infos = [resume(m), m.noteEntretien].filter(Boolean);
  const blocInfos = infos.length ? `<p class="mat-fiche-infos">${infos.map(escapeHtml).join('<br>')}</p>` : '';
  const modifier = `<button type="button" class="stk-lien-gris" data-modifier-materiel="${escapeAttr(m.id)}">Modifier</button>`;
  if (m.cuma) {
    return `<div class="mat-fiche">${blocInfos}<p class="mat-fiche-infos">CUMA / entreprise : pas de suivi d'entretien.</p>
      <div class="mat-fiche-pied"><span></span>${modifier}</div></div>`;
  }
  let compteur = '';
  if (avecCompteur(m)) {
    compteur = compteurEdite && compteurEdite.id === m.id
      ? `<div class="mat-compteur"><span class="mat-fiche-label">Compteur (h)</span>
          <span class="mat-compteur-saisie"><input type="number" id="mat-compteur-valeur" min="0" step="1" inputmode="decimal" value="${escapeAttr(compteurEdite.valeur)}">
          <button type="button" class="stk-btn-sombre" data-compteur-ok>OK</button>
          <button type="button" class="stk-lien-gris" data-compteur-annuler>Annuler</button></span></div>`
      : `<div class="mat-compteur"><span class="mat-fiche-label">Compteur</span>
          <span>${m.compteurHeures != null ? `<strong>${heures(m.compteurHeures)} h</strong> <span class="mat-gris">relevé le ${escapeHtml(dateCourte(m.compteurDate))}</span>` : '<span class="mat-gris">non renseigné</span>'}
          <button type="button" class="stk-lien" data-compteur-maj>Mettre à jour le compteur</button></span></div>`;
  }
  const liste = entrees.length
    ? entrees.slice(0, 12).map((e) => ligneEntretien(m, e)).join('')
    : '<p class="mat-gris mat-aucun">Aucun entretien noté.</p>';
  const photos = pieces.get(m.id) || [];
  return `<div class="mat-fiche">
    ${blocInfos}
    ${compteur}
    <div class="mat-fiche-label">Derniers entretiens</div>
    ${liste}
    ${formEntretien && formEntretien.id === m.id ? formulaireEntretien(m) : ''}
    <div class="mat-fiche-label">Photos et factures</div>
    <div class="mat-photos">
      ${photos.map((p) => `<button type="button" class="mat-photo" data-photo="${escapeAttr(p.id)}"><img src="${escapeAttr(p.dataUrl)}" alt="Photo du ${escapeAttr(dateCourte(p.date))}"></button>`).join('')}
      <label class="mat-photo-ajout">📷 Ajouter<input type="file" accept="image/*" data-ajout-photo="${escapeAttr(m.id)}" hidden></label>
    </div>
    <div class="mat-fiche-pied">
      ${formEntretien && formEntretien.id === m.id ? '<span></span>' : `<button type="button" class="stk-lien" data-plus-entretien="${escapeAttr(m.id)}">+ Entretien</button>`}
      ${modifier}
    </div>
  </div>`;
}

export function renderMateriels() {
  const liste = getMateriels();
  // Fiches fermées ou matériel supprimé : on se désabonne de leurs photos.
  abonnementsPieces.forEach((unsub, id) => {
    if (!fichesOuvertes.has(id) || !getMaterielById(id)) { unsub(); abonnementsPieces.delete(id); pieces.delete(id); }
  });
  if (!liste.length) {
    listeEl.innerHTML = '<p class="stk-note">Aucun matériel. Utilise « ➕ Matériel » pour commencer.</p>';
    return;
  }
  const actif = document.activeElement && listeEl.contains(document.activeElement) ? document.activeElement.id : null;
  const parCat = new Map();
  liste.forEach((m) => {
    const cat = categorieMateriel(m.categorie);
    if (!parCat.has(cat.value)) parCat.set(cat.value, { cat, machines: [] });
    parCat.get(cat.value).machines.push(m);
  });
  listeEl.innerHTML = Array.from(parCat.values()).map(({ cat, machines }) => `
    <details class="stk-groupe mat-categorie" data-categorie="${cat.value}"${categoriesFermees.has(cat.value) ? '' : ' open'}>
      <summary><div class="stk-groupe-tete"><span class="stk-groupe-nom">${cat.icone} ${escapeHtml(cat.label)} <small>(${machines.length})</small></span>
        <span class="stk-chev">▼</span></div></summary>
      ${machines.map(ligneMachine).join('')}
    </details>`).join('');
  cabler();
  fichesOuvertes.forEach((id) => {
    if (!abonnementsPieces.has(id) && getMaterielById(id)) {
      abonnementsPieces.set(id, ecouterPieces(id, (l) => { pieces.set(id, l); renderMateriels(); }));
    }
  });
  if (actif) { const n = document.getElementById(actif); if (n) n.focus(); }
}

function cabler() {
  listeEl.querySelectorAll('details.mat-categorie').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) categoriesFermees.delete(d.dataset.categorie); else categoriesFermees.add(d.dataset.categorie);
  }));
  listeEl.querySelectorAll('[data-ouvrir]').forEach((n) => n.addEventListener('click', (ev) => {
    if (ev.target.closest('.mat-graisser')) return;
    const id = n.dataset.ouvrir;
    if (fichesOuvertes.has(id)) fichesOuvertes.delete(id); else fichesOuvertes.add(id);
    renderMateriels();
  }));
  listeEl.querySelectorAll('[data-graisser]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    graisser(b);
  }));
  listeEl.querySelectorAll('[data-modifier-materiel]').forEach((b) => b.addEventListener('click', () => openEditMateriel(getMaterielById(b.dataset.modifierMateriel))));
  listeEl.querySelectorAll('[data-plus-entretien]').forEach((b) => b.addEventListener('click', () => {
    const m = getMaterielById(b.dataset.plusEntretien);
    formEntretien = { id: m.id, type: 'GRAISSAGE', libelle: '', date: aujourdhui(), cout: '', compteur: m.compteurHeures != null ? String(m.compteurHeures) : '' };
    renderMateriels();
  }));
  listeEl.querySelectorAll('.mat-form-entretien [data-champ]').forEach((c) => {
    const maj = () => {
      formEntretien[c.dataset.champ] = c.value;
      if (c.dataset.champ === 'type') renderMateriels();
    };
    c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', maj);
  });
  const btnEnr = listeEl.querySelector('[data-ent-enregistrer]');
  if (btnEnr) btnEnr.addEventListener('click', () => enregistrerFormEntretien(btnEnr));
  const btnAnn = listeEl.querySelector('[data-ent-annuler]');
  if (btnAnn) btnAnn.addEventListener('click', () => { formEntretien = null; renderMateriels(); });
  listeEl.querySelectorAll('[data-suppr-entretien]').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('.mat-machine').dataset.id;
    const e = entretiensDe(id).find((x) => (x.id || 'legacy') === b.dataset.supprEntretien);
    if (!e || !confirm(`Supprimer « ${labelEntretien(e)} » du ${dateCourte(e.date)} ?`)) return;
    supprimerEntretien(e, id).then(() => toastSucces('Entretien supprimé.'))
      .catch((err) => toastErreur('Suppression impossible : ' + ((err && err.message) || err)));
  }));
  listeEl.querySelectorAll('[data-compteur-maj]').forEach((b) => b.addEventListener('click', () => {
    const m = getMaterielById(b.closest('.mat-machine').dataset.id);
    compteurEdite = { id: m.id, valeur: m.compteurHeures != null ? String(m.compteurHeures) : '' };
    renderMateriels();
    const champ = document.getElementById('mat-compteur-valeur');
    if (champ) { champ.focus(); champ.select(); }
  }));
  const champCompteur = document.getElementById('mat-compteur-valeur');
  if (champCompteur) champCompteur.addEventListener('input', () => { compteurEdite.valeur = champCompteur.value; });
  const okCompteur = listeEl.querySelector('[data-compteur-ok]');
  if (okCompteur) okCompteur.addEventListener('click', async () => {
    okCompteur.disabled = true;
    try {
      await mettreAJourCompteur(compteurEdite.id, compteurEdite.valeur);
      compteurEdite = null;
      toastSucces('Compteur mis à jour.');
      renderMateriels();
    } catch (err) { toastErreur((err && err.message) || String(err)); okCompteur.disabled = false; }
  });
  const annCompteur = listeEl.querySelector('[data-compteur-annuler]');
  if (annCompteur) annCompteur.addEventListener('click', () => { compteurEdite = null; renderMateriels(); });
  listeEl.querySelectorAll('[data-ajout-photo]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const dataUrl = await compresserPhoto(f);
      await ajouterPiece(input.dataset.ajoutPhoto, dataUrl);
      toastSucces('Photo ajoutée.');
    } catch (err) { toastErreur('Photo non enregistrée : ' + ((err && err.message) || err)); }
  }));
  listeEl.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('.mat-machine').dataset.id;
    const p = (pieces.get(id) || []).find((x) => x.id === b.dataset.photo);
    if (p) afficherPhoto(p);
  }));
}

// 1 tap = un Graissage daté du jour, confirmé, annulable tant que le message
// est affiché (l'annulation supprime exactement l'entrée créée).
async function graisser(b) {
  const m = getMaterielById(b.dataset.graisser);
  b.disabled = true;
  try {
    const id = await enregistrerEntretien(b.dataset.graisser, 'GRAISSAGE');
    log('graissage enregistré');
    toastAction(`Graissage enregistré${m ? ' — ' + m.nom : ''}.`, 'Annuler', () => {
      supprimerEntretien({ id, source: 'journal' }, b.dataset.graisser)
        .then(() => toastSucces('Graissage annulé.'))
        .catch((err) => toastErreur('Annulation impossible : ' + ((err && err.message) || err)));
    });
  } catch (err) {
    const msg = (err && err.message) || err;
    toastErreur('Graissage non enregistré : ' + msg);
  } finally { b.disabled = false; }
}

async function enregistrerFormEntretien(btn) {
  const f = formEntretien;
  const autre = f.type === 'AUTRE' || f.type.startsWith('AUTRE:');
  btn.disabled = true;
  try {
    await enregistrerEntretien(f.id, autre ? 'AUTRE' : f.type, {
      date: f.date || aujourdhui(),
      cout: f.cout,
      libelle: f.type.startsWith('AUTRE:') ? f.type.slice(6) : f.libelle,
      compteurHeures: f.compteur
    });
    formEntretien = null;
    toastSucces('Entretien enregistré.');
    renderMateriels();
  } catch (err) {
    toastErreur('Entretien non enregistré : ' + ((err && err.message) || err));
    btn.disabled = false;
  }
}

function afficherPhoto(p) {
  const o = document.createElement('div');
  o.className = 'mat-photo-plein';
  o.innerHTML = `<img src="${escapeAttr(p.dataUrl)}" alt="">
    <div class="mat-photo-plein-pied"><span>Photo du ${escapeHtml(dateCourte(p.date))}</span>
      <button type="button" class="stk-suppr" data-suppr>Supprimer</button>
      <button type="button" class="stk-btn-clair" data-fermer>Fermer</button></div>`;
  o.querySelector('[data-fermer]').addEventListener('click', () => o.remove());
  o.querySelector('[data-suppr]').addEventListener('click', () => {
    if (!confirm('Supprimer cette photo ?')) return;
    supprimerPiece(p.id).then(() => { o.remove(); toastSucces('Photo supprimée.'); })
      .catch((err) => toastErreur('Suppression impossible : ' + ((err && err.message) || err)));
  });
  document.body.appendChild(o);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
