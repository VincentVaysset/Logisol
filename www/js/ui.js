// Fiche parcelle (création / édition) : nom, vocation (fixe), culture en place
// avec sa DATE DE SEMIS (si vocation culture/prairie — voir implantations.js,
// une culture est une période, pas une année civile), surface, couleur, notes.
// Suppression avec confirmation obligatoire.
import { VOCATIONS, estVocationCulture } from './vocation.js';
import { getCultures, onCulturesChange, addCulture } from './cultures-config.js';
import {
  setImplantation, cloturerImplantation, deleteImplantation, historiqueParcelle,
  aujourdhui, dureeLisible
} from './implantations.js';
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
const inputDateSemis = document.getElementById('fiche-datesemis');
const dureeInfo = document.getElementById('fiche-duree-info');
const numeroBadge = document.getElementById('fiche-numero');
const surfaceBadge = document.getElementById('fiche-surface-badge');
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

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

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
// Implantation actuellement en place sur la parcelle éditée (ou null). Sert à
// savoir s'il faut créer une nouvelle implantation (culture changée, ou semis
// à une autre date) ou simplement corriger celle qui existe.
let implantationCourante = null;

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

export function openCreate({ geometry, surfaceHa, croise }) {
  // LA FICHE EST AFFICHÉE EN PREMIER, avant tout remplissage.
  // Auparavant, panel.hidden = false était la DERNIÈRE instruction : la
  // moindre erreur en amont (liste de cultures non chargée, champ absent...)
  // laissait le tracé fermé à l'écran sans qu'aucune fenêtre ne s'ouvre —
  // exactement le cul-de-sac constaté sur la tablette. Désormais la fenêtre
  // s'ouvre quoi qu'il arrive, et si le remplissage échoue le motif s'affiche
  // dedans, dans son bandeau rouge, au lieu de disparaître dans le vide.
  mode = 'create';
  editingId = null;
  pendingGeometry = geometry;
  saveToken++;
  panel.hidden = false;
  hideFicheError();
  resetSaveButton();
  log('fiche "Nouvelle parcelle" affichée');

  try {
    titleEl.textContent = 'Nouvelle parcelle';
    numeroBadge.hidden = true;   // pas encore de numéro sur une parcelle qui n'existe pas
    btnDelete.hidden = true;
    inputNom.value = '';
    inputSurface.value = (typeof surfaceHa === 'number' && isFinite(surfaceHa)) ? surfaceHa : '';
    inputCouleur.value = '#3c7a4e';
    inputNotes.value = '';
    selectVocation.value = 'culture';
    cultureWrap.hidden = false;
    newCultureWrap.hidden = true;
    implantationCourante = null;
    inputDateSemis.value = aujourdhui();
    dureeInfo.hidden = true;
    populateCultureSelect(getCultures(), ''); // pas de culture présélectionnée -> "à renseigner"
    majSurfaceBadge();
    if (!geometry) {
      showFicheError("Le contour n'a pas pu être lu : annule et retrace la parcelle.");
    } else if (croise || !surfaceHa) {
      showFicheError(
        'Attention : le contour se croise, la surface calculée (' + (surfaceHa || 0) +
        ' ha) est probablement fausse. Corrige-la à la main, ou annule et retrace la parcelle.'
      );
    }
    inputNom.focus();
  } catch (err) {
    const message = (err && err.message) || String(err);
    showFicheError('Impossible de préparer le formulaire : ' + message);
    log('Erreur openCreate : ' + message);
  }
}

// implantation : implantation en cours sur cette parcelle ({cultureId,
// dateSemis, ...}) ou null, calculée par main.js depuis implantations.js.
export function openEdit(parcelle, implantation) {
  mode = 'edit';
  editingId = parcelle.id;
  pendingGeometry = parcelle.coordonnees;
  saveToken++;
  hideFicheError();
  resetSaveButton();
  titleEl.textContent = parcelle.nom || 'Parcelle';
  // Numéro éventuellement posé depuis l'assolement prévisionnel
  // (ui-assolement.js) : purement informatif ici, ce n'est pas ce
  // formulaire qui le modifie.
  numeroBadge.hidden = !parcelle.numero;
  numeroBadge.textContent = parcelle.numero ? '#' + parcelle.numero : '';
  btnDelete.hidden = false;
  inputNom.value = parcelle.nom || '';
  inputSurface.value = parcelle.surfaceHa != null ? parcelle.surfaceHa : '';
  inputCouleur.value = parcelle.couleur || '#3c7a4e';
  inputNotes.value = parcelle.notes || '';
  const vocation = parcelle.vocation || 'autre'; // vieux docs de test non migrés
  selectVocation.value = vocation;
  cultureWrap.hidden = !estVocationCulture(vocation);
  newCultureWrap.hidden = true;
  implantationCourante = implantation || null;
  inputDateSemis.value = implantation && implantation.dateSemis ? implantation.dateSemis : '';
  majDureeInfo();
  populateCultureSelect(getCultures(), (implantation && implantation.cultureId) || '');
  majSurfaceBadge();
  panel.hidden = false;
}

// Rappel visuel de la durée d'implantation : c'est l'information que Vincent
// regarde en premier sur une luzerne (« ça fait combien d'années ? »).
function majDureeInfo() {
  if (!inputDateSemis.value) {
    dureeInfo.hidden = true;
    return;
  }
  const texte = dureeLisible({ dateSemis: inputDateSemis.value, dateFin: null });
  dureeInfo.textContent = texte ? 'En place depuis ' + texte + '.' : '';
  dureeInfo.hidden = !texte;
}
inputDateSemis.addEventListener('change', majDureeInfo);

// Badge de surface à côté du titre : suit le champ en direct, y compris
// pendant qu'on corrige une surface calculée automatiquement à tort (cf.
// l'avertissement de contour croisé dans openCreate).
function majSurfaceBadge() {
  const v = Number(inputSurface.value);
  surfaceBadge.hidden = !(isFinite(v) && v > 0);
  if (!surfaceBadge.hidden) surfaceBadge.textContent = arrondiHa(v) + ' ha';
}
inputSurface.addEventListener('input', majSurfaceBadge);
function arrondiHa(v) { return Math.round(v * 100) / 100; }

function closePanel() {
  panel.hidden = true;
  if (mode === 'create') discardDrawnLayer();
  mode = null;
  editingId = null;
  pendingGeometry = null;
  implantationCourante = null;
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

    // --- Implantation ---
    // Trois cas, volontairement distincts :
    //   * culture renseignée, et rien en place OU semis/culture différents
    //     -> nouvelle implantation, l'ancienne étant clôturée la veille (la
    //        rotation est un fait daté, pas un remplacement de valeur) ;
    //   * culture renseignée identique à ce qui est en place -> simple mise à
    //     jour, sans créer de doublon ;
    //   * vocation non-culture ou culture vidée -> on CLÔTURE ce qui est en
    //     place au lieu de le supprimer : l'historique de la parcelle doit
    //     rester intact.
    if (estVocationCulture(vocation) && cultureId) {
      const dateSemis = inputDateSemis.value || aujourdhui();
      const inchangee =
        implantationCourante &&
        implantationCourante.cultureId === cultureId &&
        implantationCourante.dateSemis === dateSemis;
      await setImplantation(
        { parcelleId, cultureId, dateSemis, dateFin: null },
        { cloturerPrecedente: !inchangee }
      );
    } else if (implantationCourante && !implantationCourante.dateFin) {
      await cloturerImplantation(implantationCourante.id, aujourdhui());
    }

    settled = true;
    clearTimeout(timeoutId);
    if (myToken === saveToken) {
      log(mode === 'create'
        ? 'parcelle créée — tu peux en dessiner une autre'
        : 'parcelle enregistrée');
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
    // Les implantations de la parcelle partent avec elle : sans ça, elles
    // resteraient en base à référencer une parcelle inexistante.
    const aSupprimer = historiqueParcelle(editingId);
    await deleteParcelle(editingId);
    for (const impl of aSupprimer) {
      await deleteImplantation(impl.id);
    }
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
