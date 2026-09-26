// Parc matériel : liste dans l'onglet Bâtiments, fiche, et le module
// d'entretien (graissage, soufflage, vidange, niveaux/pression, nettoyage).
import {
  getMateriels, getMaterielById, createMateriel, updateMateriel,
  deleteMateriel, resume, CATEGORIES_MATERIEL, categorieMateriel,
  TYPES_ENTRETIEN, labelEntretien, enregistrerEntretien, annulerDernierEntretien,
  dernierEntretien, dateLisible, onEntretiensChange
} from './materiel.js';
import { getTypes, onTypesChange, estMasque, cibleDe } from './interventions-types.js';
import { messagePermission } from './diagnostic-regles.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('materiel-panel');
const form = document.getElementById('mat-form');
const el = {};
['title', 'nom', 'marque', 'categorie', 'largeur', 'actions',
 'entretien-bloc', 'entretien-resume', 'entretien-type', 'entretien-enregistrer', 'entretien-annuler',
 'note', 'save', 'cancel', 'delete',
 'error-banner', 'error-text', 'error-close'
].forEach((k) => { el[k] = document.getElementById('mat-' + k); });

el['entretien-type'].innerHTML = TYPES_ENTRETIEN
  .map((t) => `<option value="${t.value}">${t.icone} ${escapeHtml(t.label)}</option>`).join('');

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

  el['entretien-enregistrer'].addEventListener('click', async () => {
    if (!editId) return;
    const type = el['entretien-type'].value;
    el['entretien-enregistrer'].disabled = true;
    try {
      await enregistrerEntretien(editId, type);
      // Affichage optimiste : ne dépend pas du délai de retour de
      // l'écouteur Firestore (cf. onEntretiensChange ci-dessous, qui prendra
      // le relais dès que le journal aura vraiment reçu la mise à jour).
      el['entretien-resume'].textContent = `Dernière opération : ${labelEntretien(type)} — aujourd'hui`;
      el['entretien-annuler'].hidden = false;
      toastSucces(labelEntretien(type) + ' enregistré.');
    } catch (err) {
      const msg = (err && err.message) || err;
      toastErreur("Entretien non enregistré : " + msg);
    } finally {
      el['entretien-enregistrer'].disabled = false;
    }
  });
  el['entretien-annuler'].addEventListener('click', async () => {
    if (!editId) return;
    el['entretien-annuler'].disabled = true;
    try {
      await annulerDernierEntretien(editId);
      toastSucces('Dernière opération annulée.');
    } catch (err) {
      const msg = (err && err.message) || err;
      toastErreur("Annulation impossible : " + msg);
    } finally {
      el['entretien-annuler'].disabled = false;
    }
  });

  // Filet de sécurité contre le délai de propagation Firestore (cf.
  // affichage optimiste ci-dessus) : dès que le journal confirme vraiment
  // le changement, le résumé de la fiche ouverte se corrige tout seul.
  onEntretiensChange(() => { if (!panel.hidden && editId) majEntretienResume(); });
}

// Dernière opération TOUS types confondus (cf. materiel.js/dernierEntretien,
// qui tient aussi compte de l'ancien champ dateDernierGraissage pour ne
// perdre aucune donnée déjà saisie avant ce journal).
function majEntretienResume() {
  const dernier = editId ? dernierEntretien(editId) : null;
  el['entretien-resume'].textContent = dernier
    ? `Dernière opération : ${labelEntretien(dernier.type)} — ${dateLisible(dernier.date)}`
    : 'Aucune opération enregistrée.';
  el['entretien-annuler'].hidden = !dernier;
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
  peuplerActions([]);
  el.note.value = '';
  // Rien à entretenir avant que le matériel n'existe réellement (pas
  // d'id à rattacher au journal tant qu'il n'est pas enregistré).
  el['entretien-bloc'].hidden = true;
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
  peuplerActions(Array.isArray(m.actions) ? m.actions : []);
  el.largeur.value = m.largeurTravailMetres != null ? m.largeurTravailMetres : '';
  el.note.value = m.noteEntretien || '';
  el['entretien-bloc'].hidden = false;
  majEntretienResume();
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
      noteEntretien: el.note.value
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

// --- Liste -----------------------------------------------------------------
export function renderMateriels() {
  const liste = getMateriels();
  if (!liste.length) {
    listeEl.innerHTML = '<p class="list-empty">Aucun matériel. Utilise « ➕ Matériel » pour commencer.</p>';
    return;
  }
  let categorieAffichee = null;
  listeEl.innerHTML = liste.map((m) => {
    const cat = categorieMateriel(m.categorie);
    let entete = '';
    if (cat.value !== categorieAffichee) {
      categorieAffichee = cat.value;
      entete = `<div class="mat-groupe-titre">${cat.icone} ${escapeHtml(cat.label)}</div>`;
    }
    return entete + `<div class="mat-card" data-id="${escapeAttr(m.id)}">
      <span class="mat-icone">${cat.icone}</span>
      <div class="mat-body">
        <div class="mat-nom">${escapeHtml(m.nom || 'Matériel')}</div>
        <div class="mat-sub">${escapeHtml(resume(m)) || '—'}</div>
        ${Array.isArray(m.actions) && m.actions.length
          ? `<div class="mat-actions">Conseillé pour : ${escapeHtml(m.actions.join(', '))}</div>` : ''}
        ${(() => {
          const dernier = dernierEntretien(m.id);
          const texte = dernier
            ? `${labelEntretien(dernier.type)} ${escapeHtml(dateLisible(dernier.date))}`
            : 'Aucun entretien enregistré';
          return `<div class="mat-graissage">🛠️ ${texte}</div>`;
        })()}
        ${m.noteEntretien ? `<div class="mat-note">${escapeHtml(m.noteEntretien)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-secondary btn-mini mat-graisser" data-id="${escapeAttr(m.id)}"
              title="Enregistrer un graissage à la date du jour">🛢️ Graissé</button>
    </div>`;
  }).join('');

  listeEl.querySelectorAll('.mat-card').forEach((c) => {
    c.addEventListener('click', (ev) => {
      // Le bouton d'action rapide ne doit pas ouvrir la fiche au passage.
      if (ev.target.closest('.mat-graisser')) return;
      openEditMateriel(getMaterielById(c.dataset.id));
    });
  });
  listeEl.querySelectorAll('.mat-graisser').forEach((b) => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      try {
        await enregistrerEntretien(b.dataset.id, 'GRAISSAGE');
        log('graissage enregistré');
        toastSucces('Graissage enregistré.');
      } catch (err) {
        const msg = (err && err.message) || err;
        toastErreur('Graissage non enregistré : ' + msg);
      } finally { b.disabled = false; }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
