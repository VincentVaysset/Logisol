// Vue Troupeau : lots d'animaux, fiche lot (identité + section "Ration
// distribuée", cf. ui-rations.js) et rendu des sous-vues Ration actuelle /
// Historique & bilan (le contenu propre à Prévisionnel et au bilan vit dans
// ui-rations.js, rattaché ici via renderTroupeauRations()). Ce fichier ne
// calcule plus ce qu'un lot consomme réellement, ça vient exclusivement des
// distributions (cf. totauxDistribution/lotsSansDistribution).
//
// L'ancien système par stade (périodes de prélèvement, table croisée
// stades × stocks, "Rations par stade") a été retiré de l'UI (refactor
// Prévisionnel/Distribué) : rien n'écrivait plus dedans depuis l'existence
// des distributions, et il faisait doublon. La collection Firestore
// "prelevements" n'est PAS supprimée pour autant (lots.js garde ses
// fonctions de lecture/écriture, inutilisées ici mais intactes) — seule
// l'UI qui l'affichait/l'alimentait a disparu.
import { getLots, createLot, updateLot, deleteLot } from './lots.js';
import {
  ouvrirSectionRationsLot, fermerSectionRationsLot,
  initTroupeauRations, renderTroupeauRations,
  totauxDistribution, lotsSansDistribution, resumeComposants
} from './ui-rations.js';
import { affectationEnCours, composantsAffectation } from './affectations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import { getBatiments, accepteLots } from './batiments.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('lot-panel');
const form = document.getElementById('lot-form');
const titleEl = document.getElementById('lot-title');
const inputNom = document.getElementById('lot-nom');
const inputNb = document.getElementById('lot-nb');
const selectBatiment = document.getElementById('lot-batiment');
const inputNotes = document.getElementById('lot-notes');
const btnSave = document.getElementById('lot-save');
const btnDelete = document.getElementById('lot-delete');
const errorBanner = document.getElementById('lot-error-banner');
const errorText = document.getElementById('lot-error-text');

const alerteEl = document.getElementById('troupeau-alerte');
const totauxEl = document.getElementById('troupeau-totaux');
const lotsEl = document.getElementById('troupeau-lots');
const sousVuesEl = document.getElementById('troupeau-sous-vues');
const vuePrevisionnelEl = document.getElementById('troupeau-previsionnel');
const vueActuelleEl = document.getElementById('troupeau-actuel');
const vueHistoriqueEl = document.getElementById('troupeau-historique');

// « Ration actuelle » : tuiles, alerte, cartes de lots. « Historique &
// bilan » : sous-vue purement en lecture (ui-rations.js), aucune saisie ne
// lui est propre.
let sousVueTroupeau = 'actuel';

let mode = null;
let editingId = null;
let editingLot = null;
let saveToken = 0;

class ErreurDeSaisie extends Error {}

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
document.getElementById('lot-error-close').addEventListener('click', hideError);

export function initAlimentation() {
  document.getElementById('btn-new-lot').addEventListener('click', () => openCreate());
  document.getElementById('lot-cancel').addEventListener('click', fermer);
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
  sousVuesEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.addEventListener('click', () => {
      sousVueTroupeau = b.dataset.sousvue;
      afficherSousVue();
    });
  });
  initTroupeauRations();
}

function afficherSousVue() {
  vuePrevisionnelEl.hidden = sousVueTroupeau !== 'previsionnel';
  vueActuelleEl.hidden = sousVueTroupeau !== 'actuel';
  vueHistoriqueEl.hidden = sousVueTroupeau !== 'historique';
  sousVuesEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.sousvue === sousVueTroupeau);
  });
}

// Seuls les bâtiments qui hébergent des animaux sont proposés : rattacher un
// lot à un silo n'aurait aucun sens.
function peuplerBatiments(valeur) {
  const dispo = getBatiments().filter(accepteLots);
  selectBatiment.innerHTML =
    '<option value="">— Aucune bergerie —</option>' +
    dispo.map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.nom)}</option>`).join('');
  if (valeur && dispo.some((b) => b.id === valeur)) selectBatiment.value = valeur;
}

// --- Formulaire du lot (identité seulement) --------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  inputNom.value = '';
  inputNb.value = '';
  inputNotes.value = '';
}

export function openCreate() {
  mode = 'create';
  editingId = null;
  editingLot = null;
  panel.hidden = false;
  reinitialiser();
  log('formulaire lot ouvert (création)');
  try {
    titleEl.textContent = 'Nouveau lot';
    btnDelete.hidden = true;
    peuplerBatiments('');
    fermerSectionRationsLot(); // la ration distribuée n'a de sens qu'une fois le lot créé
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + ((err && err.message) || err));
  }
}

export function openEditLot(lot) {
  mode = 'edit';
  editingId = lot.id;
  editingLot = lot;
  panel.hidden = false;
  reinitialiser();
  try {
    titleEl.textContent = 'Modifier — ' + (lot.nom || 'lot');
    btnDelete.hidden = false;
    inputNom.value = lot.nom || '';
    inputNb.value = lot.nbBrebis != null ? lot.nbBrebis : '';
    peuplerBatiments(lot.batimentId || '');
    ouvrirSectionRationsLot(lot);
  } catch (err) {
    showError('Impossible de charger ce lot : ' + ((err && err.message) || err));
  }
}

function fermer() {
  panel.hidden = true;
  mode = null;
  editingId = null;
  editingLot = null;
  fermerSectionRationsLot();
}

async function enregistrer(e) {
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
  }, 8000);
  try {
    const nom = inputNom.value.trim();
    const nbBrebis = inputNb.value;
    const batimentId = selectBatiment.value || null;
    const notes = inputNotes.value;

    if (!nom) throw new ErreurDeSaisie('Donne un nom au lot.');
    const n = Number(nbBrebis);
    if (!isFinite(n) || n <= 0) throw new ErreurDeSaisie('Le nombre de brebis doit être supérieur à 0.');

    if (mode === 'create') {
      const lotId = await createLot({ nom, nbBrebis: n, batimentId, notes });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) {
        log('lot créé — prêt pour la distribution');
        toastSucces('Lot créé.');
        openEditLot({ id: lotId, nom, nbBrebis: n, batimentId, notes });
      }
    } else {
      await updateLot(editingId, { nom, nbBrebis: n, batimentId, notes });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) { log('lot mis à jour'); toastSucces('Lot enregistré.'); fermer(); }
    }
  } catch (err) {
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      const msg = err instanceof ErreurDeSaisie
        ? err.message
        : `Erreur d'enregistrement : ${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`;
      showError(msg);
      toastErreur(`Échec de l'enregistrement du lot : ${msg}`);
    }
  } finally {
    fini = true;
    if (monToken === saveToken) { btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; }
  }
}

async function supprimer() {
  if (!editingId) return;
  if (!confirm('Supprimer ce lot ? Cette action est irréversible.')) return;
  btnDelete.disabled = true;
  try {
    await deleteLot(editingId);
    toastSucces('Lot supprimé.');
    fermer();
  } catch (err) {
    const msg = 'Erreur de suppression : ' + ((err && err.message) || err);
    showError(msg);
    toastErreur(msg);
  } finally {
    btnDelete.disabled = false;
  }
}

// --- Vue ------------------------------------------------------------------
export function renderVue() {
  // Sans ration distribuée ACTUELLEMENT (affectations.js) — seule source
  // pour savoir ce qu'un lot mange, cf. les tuiles ci-dessous (totauxDistribution).
  const orphelins = lotsSansDistribution();
  if (orphelins.length) {
    alerteEl.innerHTML =
      `⚠️ ${orphelins.length} lot${orphelins.length > 1 ? 's' : ''} sans ration distribuée : ` +
      escapeHtml(orphelins.map((l) => l.nom).join(', ')) +
      ' — leur consommation n\'est comptée nulle part.';
    alerteEl.hidden = false;
  } else {
    alerteEl.hidden = true;
  }

  // Seule source de ces trois chiffres : les distributions (rations-calc.js/
  // totauxDistribution, cf. ui-rations.js) — jamais un autre calcul.
  const totDistrib = totauxDistribution();
  const totalBrebis = getLots().reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0);
  totauxEl.innerHTML = [
    tuile('Brebis', totalBrebis, '', 'brebis'),
    tuile('Besoin / jour', Math.round(totDistrib.besoinJourKg), ' kg', 'besoin'),
    tuile('Stock restant', formatTonnes(totDistrib.disponibleT), ' t', 'restant'),
    tuile('Déjà consommé', formatTonnes(totDistrib.consommeT), ' t', 'consomme')
  ].join('');

  renderLots();
  renderTroupeauRations();
  afficherSousVue();
}

// La liste des lots de "Ration actuelle" montre la distribution RÉELLE en
// cours (affectations.js) — c'est la seule source pour savoir ce qu'un lot
// mange, cf. les tuiles ci-dessus (totauxDistribution) et l'alerte
// (lotsSansDistribution).
function renderLots() {
  const lots = getLots();
  if (!lots.length) {
    lotsEl.innerHTML = '<p class="list-empty">Aucun lot. Utilise « ➕ Lot » pour en créer un.</p>';
    return;
  }
  lotsEl.innerHTML = lots
    .map((lot) => {
      const aff = affectationEnCours(lot);
      const composants = aff ? composantsAffectation(aff) : [];
      const sousLigne = aff ? 'depuis le ' + dateLisible(aff.dateDebut) : 'Aucune ration distribuée';
      return `
      <div class="lot-card" data-id="${escapeAttr(lot.id)}">
        <div class="lot-card-body">
          <div class="lot-card-nom">${escapeHtml(lot.nom || 'Lot')} <span class="lot-card-nb">${lot.nbBrebis} brebis</span></div>
          <div class="lot-card-sub">${escapeHtml(sousLigne)}</div>
          <div class="lot-card-stock">${aff ? resumeComposants(composants) : '<span class="sans-stock">aucune ration distribuée</span>'}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-mini bouton-changer-ration" data-id="${escapeAttr(lot.id)}">🔄 Changer</button>
      </div>`;
    })
    .join('');
  lotsEl.querySelectorAll('.lot-card').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.bouton-changer-ration')) return;
      const lot = getLots().find((l) => l.id === el.dataset.id);
      if (lot) openEditLot(lot);
    });
  });
  lotsEl.querySelectorAll('.bouton-changer-ration').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const lot = getLots().find((l) => l.id === btn.dataset.id);
      if (lot) openEditLot(lot);
    });
  });
}

function tuile(nom, val, unite, cls) {
  return `<div class="tuile tuile-${cls}"><div class="tuile-val">${val}<small>${unite || ''}</small></div><div class="tuile-nom">${nom}</div></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
