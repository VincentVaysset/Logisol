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

let mode = null; // 'create' | 'edit'
let editingId = null;
let pendingGeometry = null;

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    let typeUsage = selectType.value;
    if (typeUsage === '__new__') {
      const nom = inputNewTypeNom.value.trim();
      if (!nom) {
        alert('Le nom du nouveau type est requis.');
        return;
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
    closePanel();
  } catch (err) {
    alert("Erreur d'enregistrement : " + err.message);
  } finally {
    submitBtn.disabled = false;
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
