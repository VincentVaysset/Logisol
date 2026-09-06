// Fiche parcelle (création / édition), gestion des types d'usage à la volée,
// suppression avec confirmation obligatoire.
import { getTypes, onTypesChange, addOrUpdateType, colorForType } from './types-usage.js';
import { createParcelle, updateParcelle, deleteParcelle } from './parcelles.js';
import { discardDrawnLayer, cancelDrawing } from './draw.js';

const panel = document.getElementById('fiche-panel');
const form = document.getElementById('fiche-form');
const titleEl = document.getElementById('fiche-title');
const selectType = document.getElementById('fiche-typeUsage');
const newTypeWrap = document.getElementById('fiche-newtype-wrap');
const inputNewTypeNom = document.getElementById('fiche-newtype-nom');
const inputNewTypeColor = document.getElementById('fiche-newtype-couleur');
const inputNom = document.getElementById('fiche-nom');
const inputSurface = document.getElementById('fiche-surface');
const inputCouleur = document.getElementById('fiche-couleur');
const inputNotes = document.getElementById('fiche-notes');
const btnDelete = document.getElementById('fiche-delete');
const btnCancel = document.getElementById('fiche-cancel');
const btnSave = document.getElementById('f-save');
const errorBanner = document.getElementById('fiche-error-banner');
const errorBannerText = document.getElementById('fiche-error-text');
const errorBannerClose = document.getElementById('fiche-error-close');

function showFicheError(message) {
  errorBannerText.textContent = message;
  errorBanner.hidden = false;
}
function hideFicheError() {
  errorBanner.hidden = true;
  errorBannerText.textContent = '';
}
errorBannerClose.addEventListener('click', hideFicheError);

let mode = null; // 'create' | 'edit'
let editingId = null;
let pendingGeometry = null;

// Jeton de session d'enregistrement : incrémenté à chaque nouvelle ouverture
// de fiche et à chaque nouvelle soumission. Une sauvegarde restée bloquée
// (cf. timeout 8s) qui finit par répondre bien après coup ne doit jamais
// agir sur une fiche différente ouverte entre-temps (fermer sa saisie en
// cours, réafficher une erreur qui ne la concerne pas...) — chaque résultat
// asynchrone vérifie donc qu'il correspond toujours au jeton courant avant
// de toucher à l'UI.
let saveToken = 0;

function resetSaveButton() {
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
}

onTypesChange(populateTypeSelect);

function populateTypeSelect(types) {
  const current = selectType.value;
  selectType.innerHTML = types
    .map((t) => `<option value="${escapeAttr(t.nom)}">${escapeHtml(t.nom)}</option>`)
    .join('') + '<option value="__new__">+ Ajouter un type…</option>';
  if (types.some((t) => t.nom === current)) selectType.value = current;
}

selectType.addEventListener('change', () => {
  newTypeWrap.hidden = selectType.value !== '__new__';
  if (selectType.value !== '__new__') {
    inputCouleur.value = colorForType(selectType.value) || inputCouleur.value;
  }
});

export function openCreate({ geometry, surfaceHa }) {
  mode = 'create';
  editingId = null;
  pendingGeometry = geometry;
  saveToken++;
  hideFicheError();
  resetSaveButton();
  titleEl.textContent = 'Nouvelle parcelle';
  btnDelete.hidden = true;
  inputNom.value = '';
  inputSurface.value = surfaceHa;
  inputNotes.value = '';
  newTypeWrap.hidden = true;
  populateTypeSelect(getTypes());
  const firstType = getTypes()[0];
  selectType.value = firstType ? firstType.nom : '__new__';
  inputCouleur.value = firstType ? firstType.couleur : '#3c7a4e';
  panel.hidden = false;
  inputNom.focus();
}

export function openEdit(parcelle) {
  mode = 'edit';
  editingId = parcelle.id;
  pendingGeometry = parcelle.coordonnees;
  saveToken++;
  hideFicheError();
  resetSaveButton();
  titleEl.textContent = parcelle.nom || 'Parcelle';
  btnDelete.hidden = false;
  inputNom.value = parcelle.nom || '';
  inputSurface.value = parcelle.surfaceHa != null ? parcelle.surfaceHa : '';
  inputNotes.value = parcelle.notes || '';
  newTypeWrap.hidden = true;
  populateTypeSelect(getTypes());
  selectType.value = parcelle.typeUsage || '';
  inputCouleur.value = parcelle.couleur || colorForType(parcelle.typeUsage) || '#3c7a4e';
  panel.hidden = false;
}

function closePanel() {
  panel.hidden = true;
  if (mode === 'create') discardDrawnLayer();
  mode = null;
  editingId = null;
  pendingGeometry = null;
}

btnCancel.addEventListener('click', () => {
  cancelDrawing();
  closePanel();
});

const SAVE_TIMEOUT_MS = 8000;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const myToken = ++saveToken; // invalide toute sauvegarde précédente encore en vol
  hideFicheError();
  btnSave.disabled = true;
  btnSave.textContent = 'Enregistrement...';

  // Le timeout n'annule pas l'opération en cours (Firestore n'offre pas
  // d'annulation propre côté client) : il se contente d'informer que ça
  // traîne. Si l'opération finit par aboutir (succès ou échec) après les
  // 8s, le bloc try/catch/finally ci-dessous reprend la main normalement
  // (réactive le bouton, ferme la fiche ou affiche l'erreur réelle) — sauf
  // si entre-temps une autre fiche a été ouverte (myToken périmé).
  let settled = false;
  const timeoutId = setTimeout(() => {
    if (!settled && myToken === saveToken) {
      showFicheError('Aucune réponse du serveur après 8s - vérifie ta connexion ou les règles Firestore');
    }
  }, SAVE_TIMEOUT_MS);

  try {
    let typeUsage = selectType.value;
    if (typeUsage === '__new__') {
      const nom = inputNewTypeNom.value.trim();
      if (!nom) {
        throw new Error('Le nom du nouveau type est requis.');
      }
      const couleur = inputNewTypeColor.value || '#888888';
      await addOrUpdateType(nom, couleur);
      typeUsage = nom;
    }

    const data = {
      nom: inputNom.value.trim() || 'Parcelle sans nom',
      typeUsage,
      surfaceHa: parseFloat(inputSurface.value) || 0,
      couleur: inputCouleur.value,
      notes: inputNotes.value,
      coordonnees: pendingGeometry
    };

    if (mode === 'create') {
      await createParcelle(data);
    } else if (mode === 'edit' && editingId) {
      await updateParcelle(editingId, data);
    }
    settled = true;
    clearTimeout(timeoutId);
    if (myToken === saveToken) {
      hideFicheError();
      closePanel();
    }
  } catch (err) {
    settled = true;
    clearTimeout(timeoutId);
    if (myToken === saveToken) {
      const code = err && err.code ? `${err.code} — ` : '';
      const message = (err && err.message) || String(err);
      showFicheError(`Erreur d'enregistrement : ${code}${message}`);
    }
  } finally {
    settled = true;
    if (myToken === saveToken) {
      resetSaveButton();
    }
  }
});

btnDelete.addEventListener('click', async () => {
  if (!editingId) return;
  const nom = inputNom.value || 'cette parcelle';
  if (!confirm(`Supprimer la parcelle « ${nom} » ? Cette action est irréversible.`)) {
    return;
  }
  btnDelete.disabled = true;
  try {
    await deleteParcelle(editingId);
    closePanel();
  } catch (err) {
    alert('Erreur de suppression : ' + err.message);
  } finally {
    btnDelete.disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
