// Parc matériel : liste dans l'onglet Bâtiments, fiche, et l'action rapide
// « graissé aujourd'hui ».
import {
  getMateriels, getMaterielById, createMateriel, updateMateriel,
  validerGraissage, deleteMateriel, graissageLisible, joursDepuisGraissage, resume
} from './materiel.js';
import { aujourdhui } from './implantations.js';

const panel = document.getElementById('materiel-panel');
const form = document.getElementById('mat-form');
const el = {};
['title', 'nom', 'marque', 'largeur', 'graissage', 'graissage-info',
 'graissage-aujourdhui', 'note', 'save', 'cancel', 'delete',
 'error-banner', 'error-text', 'error-close'
].forEach((k) => { el[k] = document.getElementById('mat-' + k); });

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
      largeurTravailMetres: el.largeur.value,
      dateDernierGraissage: el.graissage.value || null,
      noteEntretien: el.note.value
    };
    if (editId) await updateMateriel(editId, data);
    else await createMateriel(data);
    fermer();
    log('matériel enregistré');
  } catch (err) {
    const code = err && err.code ? `${err.code} — ` : '';
    showError(`${code}${(err && err.message) || err}`);
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
  listeEl.innerHTML = liste.map((m) => {
    const j = joursDepuisGraissage(m);
    return `<div class="mat-card" data-id="${escapeAttr(m.id)}">
      <span class="mat-icone">🛠️</span>
      <div class="mat-body">
        <div class="mat-nom">${escapeHtml(m.nom || 'Matériel')}</div>
        <div class="mat-sub">${escapeHtml(resume(m)) || '—'}</div>
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
