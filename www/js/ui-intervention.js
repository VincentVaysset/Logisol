// Formulaire d'intervention : création et modification.
// Les champs affichés dépendent du type choisi (une note n'a ni produit, ni
// matériel, ni durée — cf. interventions-types.js).
import {
  getTypes, getTypeById, onTypesChange, addType, typeAffiche, TYPE_NOTE
} from './interventions-types.js';
import { createIntervention, updateIntervention, deleteIntervention } from './interventions.js';
import { releverMeteo, resumeMeteo } from './meteo.js';
import { compresserPhoto, tailleLisible } from './photo.js';
import { aujourdhui } from './implantations.js';

const panel = document.getElementById('intervention-panel');
const form = document.getElementById('itv-form');
const titleEl = document.getElementById('itv-title');
const inputDate = document.getElementById('itv-date');
const selectType = document.getElementById('itv-type');
const newTypeWrap = document.getElementById('itv-newtype-wrap');
const inputNewTypeNom = document.getElementById('itv-newtype-nom');
const inputNewTypeIcone = document.getElementById('itv-newtype-icone');
const inputNewTypeCouleur = document.getElementById('itv-newtype-couleur');
const listeParcelles = document.getElementById('itv-parcelles');
const pickCount = document.getElementById('itv-pick-count');
const champProduit = document.getElementById('itv-champ-produit');
const champMateriel = document.getElementById('itv-champ-materiel');
const champDuree = document.getElementById('itv-champ-duree');
const champMeteo = document.getElementById('itv-champ-meteo');
const inputProduit = document.getElementById('itv-produit');
const inputQuantite = document.getElementById('itv-quantite');
const selectUnite = document.getElementById('itv-unite');
const inputMateriel = document.getElementById('itv-materiel');
const inputDuree = document.getElementById('itv-duree');
const meteoText = document.getElementById('itv-meteo-text');
const btnMeteo = document.getElementById('itv-meteo-refresh');
const btnPhoto = document.getElementById('itv-photo-btn');
const btnPhotoClear = document.getElementById('itv-photo-clear');
const inputPhoto = document.getElementById('itv-photo-input');
const photoPreview = document.getElementById('itv-photo-preview');
const photoInfo = document.getElementById('itv-photo-info');
const inputNotes = document.getElementById('itv-notes');
const btnSave = document.getElementById('itv-save');
const btnCancel = document.getElementById('itv-cancel');
const btnDelete = document.getElementById('itv-delete');
const errorBanner = document.getElementById('itv-error-banner');
const errorText = document.getElementById('itv-error-text');
const errorClose = document.getElementById('itv-error-close');

let mode = null;          // 'create' | 'edit'
let editingId = null;
let meteoCourante = null;
let photoCourante = null;
let parcellesDisponibles = [];   // [{id, nom, surfaceHa}]
let selection = new Set();
let saveToken = 0;

// Distingue « tu as oublié de remplir un champ » de « le serveur a refusé ».
class ErreurDeSaisie extends Error {}

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
errorClose.addEventListener('click', hideError);

// La liste des parcelles est tenue à jour par main.js : le formulaire ne parle
// pas à Firestore lui-même.
export function setParcellesDisponibles(list) {
  parcellesDisponibles = list.map((p) => ({
    id: p.id,
    nom: p.nom || 'Sans nom',
    surfaceHa: p.surfaceHa,
    couleur: p._couleur
  }));
  if (!panel.hidden) renderParcelles();
}

onTypesChange(() => { if (!panel.hidden) { const v = selectType.value; peuplerTypes(v); appliquerType(); } });

function peuplerTypes(valeurCourante) {
  const types = getTypes();
  selectType.innerHTML =
    types.map((t) => `<option value="${t.id}">${escapeHtml((t.icone || '') + ' ' + t.nom)}</option>`).join('') +
    '<option value="__new__">+ Nouveau type</option>';
  if (valeurCourante && types.some((t) => t.id === valeurCourante)) {
    selectType.value = valeurCourante;
  } else if (types.length) {
    selectType.value = types[0].id;
  }
}

function typeChoisi() {
  return selectType.value === '__new__' ? null : getTypeById(selectType.value);
}

// Affiche uniquement les champs pertinents pour le type choisi. Un type en
// cours de création (« + Nouveau type ») reçoit le jeu complet.
function appliquerType() {
  const creation = selectType.value === '__new__';
  newTypeWrap.hidden = !creation;
  const t = typeChoisi();
  const montre = (champ) => (creation ? true : typeAffiche(t, champ));
  champProduit.hidden = !montre('produit');
  champMateriel.hidden = !montre('materiel');
  champDuree.hidden = !montre('duree');
  const meteoEtaitMasquee = champMeteo.hidden;
  champMeteo.hidden = !montre('meteo');

  // Le formulaire s'ouvre sur « Note », qui n'a pas de météo : aucun relevé
  // n'est lancé. Passer ensuite à un type qui en demande (Épandage, Fauche...)
  // doit déclencher le relevé, sinon le champ resterait vide alors que la
  // demande est explicitement « récupérée automatiquement, pas de saisie
  // manuelle ».
  if (meteoEtaitMasquee && !champMeteo.hidden && !meteoCourante && mode === 'create') {
    relever(true);
  }
}

selectType.addEventListener('change', appliquerType);

function renderParcelles() {
  if (!parcellesDisponibles.length) {
    listeParcelles.innerHTML = '<p class="list-empty">Aucune parcelle enregistrée.</p>';
    majCompteur();
    return;
  }
  listeParcelles.innerHTML = parcellesDisponibles
    .map(
      (p) => `
      <label class="parcelle-pick${selection.has(p.id) ? ' is-picked' : ''}" data-id="${escapeAttr(p.id)}">
        <input type="checkbox" ${selection.has(p.id) ? 'checked' : ''} data-id="${escapeAttr(p.id)}">
        <span class="parcelle-pick-swatch" style="background:${escapeAttr(p.couleur || '#c4c0b0')}"></span>
        <span class="parcelle-pick-nom">${escapeHtml(p.nom)}</span>
        <span class="parcelle-pick-surface">${p.surfaceHa != null ? p.surfaceHa + ' ha' : ''}</span>
      </label>`
    )
    .join('');
  listeParcelles.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selection.add(cb.dataset.id);
      else selection.delete(cb.dataset.id);
      cb.closest('.parcelle-pick').classList.toggle('is-picked', cb.checked);
      majCompteur();
    });
  });
  majCompteur();
}

function majCompteur() {
  const n = selection.size;
  pickCount.textContent = n <= 1 ? `${n} parcelle` : `${n} parcelles`;
}

document.getElementById('itv-pick-all').addEventListener('click', () => {
  parcellesDisponibles.forEach((p) => selection.add(p.id));
  renderParcelles();
});
document.getElementById('itv-pick-none').addEventListener('click', () => {
  selection.clear();
  renderParcelles();
});

// --- Météo ---------------------------------------------------------------
function afficherMeteo() {
  meteoText.textContent = meteoCourante ? resumeMeteo(meteoCourante) : '—';
}

async function relever(automatique) {
  if (!inputDate.value) return;
  meteoText.textContent = 'Relevé en cours...';
  try {
    meteoCourante = await releverMeteo(inputDate.value);
    afficherMeteo();
    log('météo relevée : ' + resumeMeteo(meteoCourante));
  } catch (err) {
    meteoCourante = null;
    // Jamais bloquant : la saisie doit pouvoir être enregistrée sans météo.
    meteoText.textContent = 'Indisponible (' + (err && err.message ? err.message : err) + ')';
    if (!automatique) log('météo indisponible : ' + (err && err.message ? err.message : err));
  }
}

btnMeteo.addEventListener('click', () => relever(false));
inputDate.addEventListener('change', () => {
  // La météo dépend de la date : un relevé fait pour un autre jour est faux.
  // On l'invalide ET on en refait un tout de suite — se contenter de l'effacer
  // laissait le champ vide en silence dès qu'on corrigeait la date après coup
  // (saisie du soir pour un chantier de la veille, cas très courant), alors
  // que la demande est justement « récupérée automatiquement ».
  if (meteoCourante && meteoCourante.date === inputDate.value) return;
  meteoCourante = null;
  afficherMeteo();
  if (!champMeteo.hidden && inputDate.value) relever(true);
});

// --- Photo ---------------------------------------------------------------
btnPhoto.addEventListener('click', () => inputPhoto.click());
btnPhotoClear.addEventListener('click', () => setPhoto(null));

inputPhoto.addEventListener('change', async () => {
  const fichier = inputPhoto.files[0];
  inputPhoto.value = '';
  if (!fichier) return;
  photoInfo.textContent = 'Compression...';
  try {
    setPhoto(await compresserPhoto(fichier));
  } catch (err) {
    setPhoto(null);
    showError('Photo : ' + (err && err.message ? err.message : err));
  }
});

function setPhoto(dataUrl) {
  photoCourante = dataUrl;
  photoPreview.hidden = !dataUrl;
  btnPhotoClear.hidden = !dataUrl;
  photoPreview.src = dataUrl || '';
  photoInfo.textContent = dataUrl ? tailleLisible(dataUrl) : '';
}

// --- Ouverture -----------------------------------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  meteoCourante = null;
  setPhoto(null);
  selection = new Set();
  inputProduit.value = '';
  inputQuantite.value = '';
  selectUnite.value = '';
  inputMateriel.value = '';
  inputDuree.value = '';
  inputNotes.value = '';
  inputNewTypeNom.value = '';
  afficherMeteo();
}

/**
 * @param {object} opts
 * @param {string[]} [opts.parcelleIds] pré-sélection (depuis une parcelle)
 * @param {boolean}  [opts.note] ouvrir directement sur le type « Note »
 */
export function openCreateIntervention(opts = {}) {
  mode = 'create';
  editingId = null;
  panel.hidden = false;      // affiché AVANT tout remplissage : une erreur de
                             // préparation reste visible dans le panneau au
                             // lieu de laisser un écran muet.
  reinitialiser();
  log('formulaire intervention ouvert (création)');
  try {
    titleEl.textContent = opts.note ? 'Nouvelle note' : 'Nouvelle intervention';
    btnDelete.hidden = true;
    inputDate.value = aujourdhui();
    const types = getTypes();
    const typeNote = types.find((t) => t.nom === TYPE_NOTE);
    peuplerTypes(opts.note && typeNote ? typeNote.id : null);
    appliquerType();
    (opts.parcelleIds || []).forEach((id) => selection.add(id));
    renderParcelles();
    if (!champMeteo.hidden) relever(true);
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + (err && err.message ? err.message : err));
  }
}

export function openEditIntervention(itv) {
  mode = 'edit';
  editingId = itv.id;
  panel.hidden = false;
  reinitialiser();
  log('formulaire intervention ouvert (modification)');
  try {
    titleEl.textContent = itv.typeNom ? 'Modifier — ' + itv.typeNom : 'Modifier l\'intervention';
    btnDelete.hidden = false;
    inputDate.value = itv.date || aujourdhui();
    peuplerTypes(itv.typeId);
    appliquerType();
    (itv.parcelleIds || []).forEach((id) => selection.add(id));
    renderParcelles();
    inputProduit.value = itv.produit || '';
    inputQuantite.value = itv.quantite != null ? itv.quantite : '';
    selectUnite.value = itv.unite || '';
    inputMateriel.value = itv.materiel || '';
    inputDuree.value = itv.dureeHeures != null ? itv.dureeHeures : '';
    inputNotes.value = itv.notes || '';
    meteoCourante = itv.meteo || null;
    afficherMeteo();
    setPhoto(itv.photo || null);
  } catch (err) {
    showError('Impossible de charger cette intervention : ' + (err && err.message ? err.message : err));
  }
}

function fermer() {
  panel.hidden = true;
  mode = null;
  editingId = null;
}

btnCancel.addEventListener('click', fermer);

const TIMEOUT_MS = 8000;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const monToken = ++saveToken;
  hideError();
  btnSave.disabled = true;
  btnSave.textContent = 'Enregistrement...';

  let fini = false;
  const minuteur = setTimeout(() => {
    if (!fini && monToken === saveToken) {
      showError('Aucune réponse du serveur après 8 s — vérifie ta connexion ou les règles Firestore.');
    }
  }, TIMEOUT_MS);

  try {
    if (!selection.size) {
      throw new ErreurDeSaisie('Choisis au moins une parcelle concernée.');
    }

    // TOUT est lu AVANT le moindre await.
    // Sinon : créer un type personnalisé déclenche un snapshot Firestore sur
    // interventions_types, donc onTypesChange, donc le repeuplement de la
    // liste — or "__new__" n'y existe pas, la sélection retombait sur le
    // premier type (« Note »), qui masque produit/matériel/durée/météo. Les
    // champs étaient alors relus MASQUÉS et la saisie partait vidée de sa
    // substance, sans le moindre message. Reproduit en test : un « Hersage »
    // enregistré perdait sa météo et son matériel.
    const creationType = selectType.value === '__new__';
    const saisie = {
      date: inputDate.value,
      parcelleIds: Array.from(selection),
      produit: champProduit.hidden ? '' : inputProduit.value.trim(),
      quantite: champProduit.hidden ? null : inputQuantite.value,
      unite: champProduit.hidden ? '' : selectUnite.value,
      materiel: champMateriel.hidden ? '' : inputMateriel.value.trim(),
      dureeHeures: champDuree.hidden ? null : inputDuree.value,
      meteo: champMeteo.hidden ? null : meteoCourante,
      photo: photoCourante,
      notes: inputNotes.value
    };
    const nouveauTypeNom = inputNewTypeNom.value.trim();
    const nouveauTypeIcone = inputNewTypeIcone.value.trim();
    const nouveauTypeCouleur = inputNewTypeCouleur.value;
    const typeExistant = creationType ? null : getTypeById(selectType.value);

    let typeId = selectType.value;
    let typeNom = typeExistant ? typeExistant.nom : '';
    if (creationType) {
      if (!nouveauTypeNom) throw new ErreurDeSaisie('Donne un nom au nouveau type d\'intervention.');
      typeId = await addType(nouveauTypeNom, nouveauTypeIcone, nouveauTypeCouleur);
      typeNom = nouveauTypeNom;
    }

    const data = { ...saisie, typeId, typeNom };

    if (mode === 'create') await createIntervention(data);
    else if (editingId) await updateIntervention(editingId, data);

    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      log('intervention enregistrée');
      fermer();
    }
  } catch (err) {
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      // Un champ mal rempli n'est pas une panne : l'annoncer comme une
      // « erreur d'enregistrement » ferait croire à un problème de serveur.
      if (err instanceof ErreurDeSaisie) {
        showError(err.message);
      } else {
        const code = err && err.code ? `${err.code} — ` : '';
        showError(`Erreur d'enregistrement : ${code}${(err && err.message) || err}`);
      }
    }
  } finally {
    fini = true;
    if (monToken === saveToken) {
      btnSave.disabled = false;
      btnSave.textContent = 'Enregistrer';
    }
  }
});

btnDelete.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Supprimer cette intervention ? Cette action est irréversible.')) return;
  btnDelete.disabled = true;
  try {
    await deleteIntervention(editingId);
    fermer();
  } catch (err) {
    showError('Erreur de suppression : ' + ((err && err.message) || err));
  } finally {
    btnDelete.disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
