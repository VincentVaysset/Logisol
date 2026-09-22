// Parc matériel : liste dans l'onglet Bâtiments, fiche, et l'action rapide
// « graissé aujourd'hui ».
import {
  getMateriels, getMaterielById, createMateriel, updateMateriel,
  validerGraissage, deleteMateriel, graissageLisible, resume,
  CATEGORIES_MATERIEL, categorieMateriel
} from './materiel.js';
import { getTypes, onTypesChange, estMasque, cibleDe } from './interventions-types.js';
import { aujourdhui } from './implantations.js';
import { messagePermission } from './diagnostic-regles.js';

const panel = document.getElementById('materiel-panel');
const form = document.getElementById('mat-form');
const el = {};
['title', 'nom', 'marque', 'categorie', 'largeur', 'actions', 'graissage', 'graissage-info',
 'graissage-aujourdhui', 'note', 'save', 'cancel', 'delete',
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
  el.graissage.addEventListener('change', majInfoGraissage);
  el['graissage-aujourdhui'].addEventListener('click', () => {
    el.graissage.value = aujourdhui();
    majInfoGraissage();
  });
  form.addEventListener('submit', enregistrer);
  el.delete.addEventListener('click', supprimer);
}

function majInfoGraissage() {
  el['graissage-info'].textContent = graissageLisible({ dateDernierGraissage: el.graissage.value });
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
  el.graissage.value = ''; el.note.value = '';
  majInfoGraissage();
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
  el.graissage.value = m.dateDernierGraissage || '';
  el.note.value = m.noteEntretien || '';
  majInfoGraissage();
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
      dateDernierGraissage: el.graissage.value || null,
      noteEntretien: el.note.value
    };
    if (editId) await updateMateriel(editId, data);
    else await createMateriel(data);
    fermer();
    log('matériel enregistré');
  } catch (err) {
    showError(messagePermission(err, 'lgs_materiel'));
  } finally {
    el.save.disabled = false; el.save.textContent = 'Enregistrer';
  }
}

async function supprimer() {
  if (!editId) return;
  if (!confirm('Supprimer ce matériel ? Les activités qui le mentionnent garderont son nom.')) return;
  el.delete.disabled = true;
  try { await deleteMateriel(editId); fermer(); }
  catch (err) { showError((err && err.message) || err); }
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
        <div class="mat-graissage">🛢️ Graissage ${escapeHtml(graissageLisible(m))}</div>
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
        await validerGraissage(b.dataset.id);
        log('graissage enregistré');
      } catch (err) {
        alert('Graissage non enregistré : ' + ((err && err.message) || err));
      } finally { b.disabled = false; }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
