// Fiche parcelle (création / édition) : nom, vocation (fixe), culture de la
// campagne en cours (si vocation culture/prairie, via assolements), surface,
// couleur, notes. Suppression avec confirmation obligatoire.
import { VOCATIONS, estVocationCulture } from './vocation.js';
import { getCultures, onCulturesChange, addCulture } from './cultures-config.js';
import { getCampagneActuelle, setAssolement, deleteAssolement } from './assolements.js';
import { createParcelle, updateParcelle, deleteParcelle } from './parcelles.js';
import { discardDrawnLayer, cancelDrawing } from './draw.js';

const panel = document.getElementById('fiche-panel');
const form = document.getElementById('fiche-form');
const titleEl = document.getElementById('fiche-title');
const selectVocation = document.getElementById('fiche-vocation');
const cultureWrap = document.getElementById('fiche-culture-wrap');
const selectCulture = document.getElementById('fiche-culture');
const newCultureWrap = document.getElementById('fiche-newculture-wrap');
const inputNewCultureNom = document.getElementById('fiche-newculture-nom');
const inputNewCultureCouleur = document.getElementById('fiche-newculture-couleur');
const inputNewCultureFamille = document.getElementById('fiche-newculture-famille');
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

// --- Vocation (liste fixe, jamais configurable) ---
selectVocation.innerHTML = VOCATIONS
  .map((v) => `<option value="${v.value}">${escapeHtml(v.label)}</option>`)
  .join('');

selectVocation.addEventListener('change', () => {
  cultureWrap.hidden = !estVocationCulture(selectVocation.value);
});

// --- Culture (liste modulable, via cultures_config) ---
onCulturesChange(populateCultureSelect);

function populateCultureSelect(cultures, keepValue) {
  const current = keepValue !== undefined ? keepValue : selectCulture.value;
  selectCulture.innerHTML =
    '<option value="">— Choisir une culture —</option>' +
    cultures.map((c) => `<option value="${c.id}">${escapeHtml(c.nom)}</option>`).join('') +
    '<option value="__new__">+ Culture</option>';
  if (current && cultures.some((c) => c.id === current)) selectCulture.value = current;
}

selectCulture.addEventListener('change', () => {
  newCultureWrap.hidden = selectCulture.value !== '__new__';
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
  inputCouleur.value = '#3c7a4e';
  inputNotes.value = '';
  selectVocation.value = 'culture';
  cultureWrap.hidden = false;
  newCultureWrap.hidden = true;
  populateCultureSelect(getCultures(), ''); // pas de culture présélectionnée -> "à renseigner"
  panel.hidden = false;
  inputNom.focus();
}

// currentCultureId : id de la culture assolée cette campagne pour cette
// parcelle, ou null si aucune (calculé par main.js depuis assolements.js).
export function openEdit(parcelle, currentCultureId) {
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
  inputCouleur.value = parcelle.couleur || '#3c7a4e';
  inputNotes.value = parcelle.notes || '';
  const vocation = parcelle.vocation || 'autre'; // vieux docs de test non migrés
  selectVocation.value = vocation;
  cultureWrap.hidden = !estVocationCulture(vocation);
  newCultureWrap.hidden = true;
  populateCultureSelect(getCultures(), currentCultureId || '');
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
    const vocation = selectVocation.value;
    let cultureId = null;

    if (estVocationCulture(vocation)) {
      if (selectCulture.value === '__new__') {
        const nom = inputNewCultureNom.value.trim();
        if (!nom) {
          throw new Error('Le nom de la nouvelle culture est requis.');
        }
        const couleur = inputNewCultureCouleur.value || '#9a988f';
        const famille = inputNewCultureFamille.value || 'autre';
        cultureId = await addCulture(nom, couleur, famille);
      } else if (selectCulture.value) {
        cultureId = selectCulture.value;
      }
      // sinon : placeholder "— Choisir une culture —" -> cultureId reste null
      // (la parcelle apparaîtra en gris "à renseigner" sur la carte).
    }

    const data = {
      nom: inputNom.value.trim() || 'Parcelle sans nom',
      vocation,
      surfaceHa: parseFloat(inputSurface.value) || 0,
      couleur: inputCouleur.value,
      notes: inputNotes.value,
      coordonnees: pendingGeometry
    };

    let parcelleId = editingId;
    if (mode === 'create') {
      const ref = await createParcelle(data);
      parcelleId = ref.id;
    } else if (mode === 'edit' && editingId) {
      await updateParcelle(editingId, data);
    }

    const campagneId = getCampagneActuelle();
    if (estVocationCulture(vocation) && cultureId) {
      await setAssolement(parcelleId, campagneId, cultureId);
    } else {
      // vocation non-culture, ou culture non renseignée -> pas d'assolement
      // cette campagne (et on retire celui qui existait déjà, le cas échéant).
      await deleteAssolement(parcelleId, campagneId);
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
    await deleteAssolement(editingId, getCampagneActuelle());
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
