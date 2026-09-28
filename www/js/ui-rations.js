// Vue Rations : recettes nommées (composants = stocks existants, jamais
// ressaisis), affectation à un lot depuis sa fiche (onglet Troupeau), et
// l'alerte « achat à prévoir » partagée avec l'onglet Stocks (une seule
// fonction de rendu, appelée depuis les deux — aucun doublon de saisie ni de
// calcul, cf. rations-calc.js).
import {
  getRations, getRationById, onRationsChange,
  createRation, updateRation, deleteRation, totalRation,
  onPoidsBottesChange, poidsBotteStock, setPoidsBotteStock
} from './rations.js';
import {
  affectationsLot, historiqueAffectations,
  affecterRation, supprimerAffectation, tonnesComposant
} from './affectations.js';
import { projectionAchat, stockDisponibleParItem, finCampagne } from './rations-calc.js';
import { getLots } from './lots.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('ration-panel');
const form = document.getElementById('ration-form');
const titleEl = document.getElementById('ration-title');
const inputNom = document.getElementById('ration-nom');
const composantsEl = document.getElementById('ration-composants');
const btnAjouterComposant = document.getElementById('ration-composant-ajouter');
const btnSave = document.getElementById('ration-save');
const btnDelete = document.getElementById('ration-delete');
const errorBanner = document.getElementById('ration-error-banner');
const errorText = document.getElementById('ration-error-text');

const listeEl = document.getElementById('rations-liste');
const achatPrevoirEl = document.getElementById('rations-achat-prevoir');
const disponibleEl = document.getElementById('rations-disponible');

// Zone d'affectation dans la fiche lot (ui-alimentation.js gère le reste de
// la fiche ; on y greffe cette section, sans toucher à son code).
const lotSection = document.getElementById('lot-rations-section');
const lotListeEl = document.getElementById('lot-r-liste');
const lotSelect = document.getElementById('lot-r-select');
const lotInfo = document.getElementById('lot-r-info');
const lotDebut = document.getElementById('lot-r-debut');
const lotFin = document.getElementById('lot-r-fin');
const lotErreur = document.getElementById('lot-r-erreur');
const btnAffecter = document.getElementById('lot-r-affecter');

class ErreurDeSaisie extends Error {}

let editingId = null;
let categories = [];       // catégories fusionnées (mêmes que Stocks/Troupeau)
let lotCourant = null;     // lot dont la fiche est ouverte (fourni par ui-alimentation.js)
let horizonPersonnalise = null;

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
document.getElementById('ration-error-close').addEventListener('click', hideError);

export function setCategoriesRations(list) { categories = list || []; }

const horizonInput = document.getElementById('rations-horizon');

export function initRations() {
  horizonInput.value = finCampagne();
  horizonInput.addEventListener('change', () => {
    horizonPersonnalise = horizonInput.value || null;
    renderVue();
  });
  document.getElementById('btn-new-ration').addEventListener('click', openCreate);
  document.getElementById('ration-cancel').addEventListener('click', fermer);
  btnAjouterComposant.addEventListener('click', () => {
    composantsEl.insertAdjacentHTML('beforeend', ligneComposant());
    cablerLigneComposant(composantsEl.lastElementChild);
  });
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
  onRationsChange(() => { renderListe(); if (lotCourant) peuplerSelectRation(); });

  btnAffecter.addEventListener('click', surAffecter);
}

// --- Sélecteur de stock, partagé fiche ration + fiche lot ------------------
function optionsStock(valeurChoisie) {
  const parFamille = new Map();
  categories.forEach((c) => {
    const famille = c.categorie === 'cereale' ? 'Céréales' : c.categorie === 'commerce' ? 'Achats (sans silo)' : 'Foin / fourrage';
    if (!parFamille.has(famille)) parFamille.set(famille, []);
    parFamille.get(famille).push(c);
  });
  const ordre = ['Foin / fourrage', 'Céréales', 'Achats (sans silo)'];
  return ordre
    .filter((f) => parFamille.has(f))
    .map((f) => {
      const lignes = parFamille.get(f).slice().sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      return `<optgroup label="${escapeAttr(f)}">${lignes.map((o) =>
        `<option value="${escapeAttr(o.cle)}" ${o.cle === valeurChoisie ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
      ).join('')}</optgroup>`;
    }).join('');
}

// --- Fiche Ration -----------------------------------------------------------
function ligneComposant(c = {}) {
  return `<div class="ration-composant-ligne" data-id="${escapeAttr(c.id || '')}">
    <select class="rc-stock">
      <option value="">— Choisir un stock —</option>
      ${optionsStock(c.stockCle)}
    </select>
    <input type="number" class="rc-dose" step="0.01" min="0" inputmode="decimal" value="${c.kgParAnimalJour != null ? c.kgParAnimalJour : ''}">
    <span class="rc-unite">kg/j</span>
    <button type="button" class="rc-suppr" aria-label="Retirer ce composant">✕</button>
  </div>`;
}

function cablerLigneComposant(ligne) {
  ligne.querySelector('.rc-suppr').addEventListener('click', () => ligne.remove());
}

function lireComposants() {
  return Array.from(composantsEl.querySelectorAll('.ration-composant-ligne')).map((ligne) => {
    const select = ligne.querySelector('.rc-stock');
    const cat = categories.find((c) => c.cle === select.value);
    return {
      stockCle: select.value,
      stockLabel: cat ? cat.label : select.value,
      kgParAnimalJour: Number(ligne.querySelector('.rc-dose').value) || 0
    };
  }).filter((c) => c.stockCle && c.kgParAnimalJour > 0);
}

function reinitialiser() {
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  inputNom.value = '';
  composantsEl.innerHTML = '';
}

export function openCreate() {
  editingId = null;
  panel.hidden = false;
  reinitialiser();
  titleEl.textContent = 'Nouvelle ration';
  btnDelete.hidden = true;
  composantsEl.insertAdjacentHTML('beforeend', ligneComposant());
  cablerLigneComposant(composantsEl.lastElementChild);
  log('formulaire ration ouvert (création)');
}

export function openEditRation(ration) {
  editingId = ration.id;
  panel.hidden = false;
  reinitialiser();
  titleEl.textContent = 'Modifier — ' + (ration.nom || 'ration');
  btnDelete.hidden = false;
  inputNom.value = ration.nom || '';
  (ration.composants || []).forEach((c) => {
    composantsEl.insertAdjacentHTML('beforeend', ligneComposant(c));
    cablerLigneComposant(composantsEl.lastElementChild);
  });
  if (!composantsEl.children.length) {
    composantsEl.insertAdjacentHTML('beforeend', ligneComposant());
    cablerLigneComposant(composantsEl.lastElementChild);
  }
}

function fermer() { panel.hidden = true; editingId = null; }

async function enregistrer(e) {
  e.preventDefault();
  hideError();
  btnSave.disabled = true;
  btnSave.textContent = 'Enregistrement...';
  try {
    const nom = inputNom.value.trim();
    const composants = lireComposants();
    if (!nom) throw new ErreurDeSaisie('Donne un nom à la ration.');
    if (!composants.length) throw new ErreurDeSaisie('Ajoute au moins un composant avec un stock et une dose.');
    if (editingId) await updateRation(editingId, { nom, composants });
    else await createRation({ nom, composants });
    log('ration enregistrée');
    toastSucces('Ration enregistrée.');
    fermer();
  } catch (err) {
    const msg = err instanceof ErreurDeSaisie ? err.message : `Erreur d'enregistrement : ${(err && err.message) || err}`;
    showError(msg);
    toastErreur(`Échec de l'enregistrement de la ration : ${msg}`);
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Enregistrer';
  }
}

async function supprimer() {
  if (!editingId) return;
  if (!confirm('Supprimer cette ration ? Les affectations déjà faites gardent leur instantané et ne sont pas modifiées.')) return;
  btnDelete.disabled = true;
  try { await deleteRation(editingId); toastSucces('Ration supprimée.'); fermer(); }
  catch (err) { const msg = (err && err.message) || err; showError(msg); toastErreur(`Échec de la suppression : ${msg}`); }
  finally { btnDelete.disabled = false; }
}

// --- Liste des rations + alerte achat à prévoir -----------------------------
export function renderVue() {
  renderListe();
  renderDisponible();
  renderAchatPrevoir(achatPrevoirEl);
}

onPoidsBottesChange(() => { if (!document.getElementById('rations-view').hidden) renderDisponible(); });

function renderListe() {
  const rations = getRations();
  listeEl.innerHTML = rations.length
    ? rations.map((r) => `
      <div class="cat-card" data-id="${escapeAttr(r.id)}" style="cursor:pointer">
        <div class="cat-card-nom">${escapeHtml(r.nom)}</div>
        <div class="cat-card-detail">${(r.composants || []).map((c) => `${escapeHtml(c.stockLabel)} : ${c.kgParAnimalJour} kg/j`).join(' · ')}</div>
        <div class="cat-card-tonnes">${totalRation(r.composants)} kg/j</div>
      </div>`).join('')
    : '<p class="list-empty">Aucune ration. Utilise « ➕ Ration » pour composer une première recette.</p>';
  listeEl.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const r = getRationById(el.dataset.id);
      if (r) openEditRation(r);
    });
  });
}

// Rendu partagé de l'alerte « achat à prévoir » — appelé depuis l'onglet
// Rations ET l'onglet Stocks (ui-stocks.js), sur le même calcul
// (rations-calc.js/projectionAchat), jamais recalculé deux fois séparément.
export function renderAchatPrevoir(cible) {
  if (!cible) return;
  const horizon = horizonPersonnalise || finCampagne();
  const manques = projectionAchat(categories, getLots(), { horizon });
  if (!manques.length) {
    cible.hidden = true;
    cible.innerHTML = '';
    return;
  }
  cible.hidden = false;
  cible.innerHTML = `<div class="alerte">
    ⚠️ Achat à prévoir d'ici le ${escapeHtml(dateLisible(horizon))} :
    ${manques.map((m) => `${escapeHtml(m.label)} — ${formatTonnes(m.manqueTonnes)} t`).join(' · ')}
  </div>`;
}

// Disponible par aliment, avec poids/botte réglable pour l'estimation en
// bottes — jamais utilisé pour calculer le tonnage lui-même (toujours dérivé
// du journal réel), seulement pour cette conversion d'affichage.
function renderDisponible() {
  if (!disponibleEl) return;
  const items = stockDisponibleParItem(categories, getLots());
  if (!items.length) {
    disponibleEl.innerHTML = '<p class="list-empty">Aucun stock ni consommation enregistrés pour l\'instant.</p>';
    return;
  }
  disponibleEl.innerHTML = items
    .sort((a, b) => b.disponible - a.disponible)
    .map((it) => {
      const cat = categories.find((c) => c.cle === it.cle);
      const moyenneCalculee = cat && cat.nbBottes > 0 ? Math.round((cat.tonnes * 1000) / cat.nbBottes) : 0;
      const poids = poidsBotteStock(it.cle) || moyenneCalculee;
      const bottes = poids > 0 ? Math.round((it.disponible * 1000) / poids) : null;
      return `<div class="cat-card">
        <div class="cat-card-nom">${escapeHtml(it.label)}</div>
        <div class="cat-card-detail">
          entrées ${formatTonnes(it.entrees)} t · consommé ${formatTonnes(it.consomme)} t
          ${bottes != null ? ` · ~${bottes} bottes` : ''}
          <span class="poids-botte-reglage">
            poids/botte <input type="number" class="poids-botte-input" data-cle="${escapeAttr(it.cle)}" step="1" min="0" value="${poids || ''}" placeholder="${moyenneCalculee || ''}"> kg
          </span>
        </div>
        <div class="cat-card-tonnes ${it.disponible < 0 ? 'urgent' : ''}">${formatTonnes(it.disponible)} t</div>
      </div>`;
    }).join('');
  disponibleEl.querySelectorAll('.poids-botte-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try { await setPoidsBotteStock(input.dataset.cle, input.value); }
      catch (err) { toastErreur('Poids/botte non enregistré : ' + ((err && err.message) || err)); }
    });
  });
}

// --- Section « Ration appliquée » de la fiche lot ---------------------------
function peuplerSelectRation() {
  const rations = getRations();
  lotSelect.innerHTML = rations.length
    ? rations.map((r) => `<option value="${escapeAttr(r.id)}">${escapeHtml(r.nom)} (${totalRation(r.composants)} kg/j)</option>`).join('')
    : '<option value="">— Aucune ration créée —</option>';
  majInfoRation();
}

function majInfoRation() {
  const r = getRationById(lotSelect.value);
  lotInfo.textContent = r
    ? `${(r.composants || []).map((c) => `${c.stockLabel} : ${c.kgParAnimalJour} kg/j`).join(' · ')} — soit ${totalRation(r.composants)} kg/j/animal`
    : '';
}
lotSelect.addEventListener('change', majInfoRation);

// Appelé par ui-alimentation.js à l'ouverture/fermeture de la fiche lot —
// section volontairement indépendante du plan de périodes par stade
// (#lot-periodes-section), qui reste géré tel quel par ui-alimentation.js.
export function ouvrirSectionRationsLot(lot) {
  lotCourant = lot;
  lotSection.hidden = false;
  hideErreurLot();
  peuplerSelectRation();
  lotDebut.value = aujourdhui();
  lotFin.value = '';
  renderAffectationsLot(lot);
}

export function fermerSectionRationsLot() {
  lotCourant = null;
  lotSection.hidden = true;
}

function hideErreurLot() { lotErreur.hidden = true; }
function showErreurLot(m) { lotErreur.textContent = m; lotErreur.hidden = false; }

function renderAffectationsLot(lot) {
  const historique = historiqueAffectations(lot);
  lotListeEl.innerHTML = historique.length
    ? historique.map((a) => {
        const active = a.dateDebut <= aujourdhui() && (!a.dateFin || a.dateFin > aujourdhui());
        const dates = a.dateFin
          ? `${dateLisible(a.dateDebut)} → ${dateLisible(a.dateFin)}`
          : `depuis le ${dateLisible(a.dateDebut)}${active ? ' · en cours' : ''}`;
        const conso = (a.snapshot || [])
          .map((c) => `${escapeHtml(c.stockLabel)} : ${formatTonnes(tonnesComposant(a, c))} t consommées`)
          .join(' · ');
        return `<div class="apercu-activite">
          <div class="apercu-activite-corps">
            <span class="apercu-activite-nom">${escapeHtml(a.rationNom || 'Ration')} — ${a.nbBrebis || 0} brebis</span>
            <span class="apercu-activite-date">${escapeHtml(dates)}</span>
            <span class="apercu-activite-detail">${conso}</span>
          </div>
          <button type="button" class="btn-icone-suppr" data-affectation="${escapeAttr(a.id)}" aria-label="Supprimer cette affectation">✕</button>
        </div>`;
      }).join('')
    : '<p class="list-empty">Aucune ration affectée à ce lot.</p>';

  lotListeEl.querySelectorAll('[data-affectation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette affectation ? Cette action est irréversible.')) return;
      try {
        await supprimerAffectation(lot, btn.dataset.affectation);
        renderAffectationsLot({ ...lot, affectations: affectationsLot(lot).filter((a) => a.id !== btn.dataset.affectation) });
      } catch (err) {
        showErreurLot('Suppression impossible : ' + ((err && err.message) || err));
      }
    });
  });
}

async function surAffecter() {
  hideErreurLot();
  if (!lotCourant) return;
  btnAffecter.disabled = true;
  try {
    const ration = getRationById(lotSelect.value);
    if (!ration) throw new ErreurDeSaisie('Choisis une ration.');
    const dateDebut = lotDebut.value || aujourdhui();
    const dateFin = lotFin.value || null;
    const resultat = await affecterRation(lotCourant, ration, { dateDebut, dateFin });
    lotCourant = { ...lotCourant, affectations: affectationsLot(lotCourant).filter((a) => a.id !== resultat.id).concat([resultat]) };
    log('ration affectée au lot');
    toastSucces('Ration affectée.');
    lotDebut.value = aujourdhui();
    lotFin.value = '';
    renderAffectationsLot(lotCourant);
  } catch (err) {
    const msg = err instanceof ErreurDeSaisie ? err.message : `Erreur d'enregistrement : ${(err && err.message) || err}`;
    showErreurLot(msg);
    toastErreur(`Échec de l'affectation : ${msg}`);
  } finally {
    btnAffecter.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
