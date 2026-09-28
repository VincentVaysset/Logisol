// Rations distribuées (réel, par lot) + plan de campagne prévisionnel +
// bilan — intégrés aux sous-onglets EXISTANTS de la vue Troupeau
// (ui-alimentation.js, non touché dans sa logique de fiche/rendu propre) :
// « Prévisionnel », « Ration actuelle », « Historique & bilan ». Aucun
// nouvel onglet, aucune ressaisie d'aliment — tout composant se choisit
// dans la liste Stocks (catégories fusionnées, mêmes clés que partout
// ailleurs dans l'appli).
import {
  onPoidsBottesChange, poidsBotteStock, setPoidsBotteStock
} from './poids-bottes.js';
import {
  affectationsLot, historiqueAffectations, affectationEnCours,
  distribuerRation, supprimerAffectation, tonnesComposant, composantsAffectation,
  precedenteFermeePar, rouvrirAffectation
} from './affectations.js';
import { bilanParAliment, prevuCampagneParAliment } from './rations-calc.js';
import {
  getPlan, onPlanChange, ajouterLignePlan, supprimerLignePlan, campagneCourante
} from './plan-campagne.js';
import { getLots } from './lots.js';
import { getStades, onStadesChange } from './stades.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import { toastSucces, toastErreur } from './toast.js';

class ErreurDeSaisie extends Error {}

let categories = [];       // catégories fusionnées (mêmes que Stocks/Troupeau)
let lotCourant = null;     // lot dont la fiche est ouverte (fourni par ui-alimentation.js)
let openEditLotFn = null;  // câblé par ui-alimentation.js pour éviter un import circulaire au chargement

export function setCategoriesRations(list) { categories = list || []; }
export function setOuvrirFicheLot(fn) { openEditLotFn = fn; }

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }

// --- Sélecteur de stock, partagé entre le plan prévisionnel et la ration
// distribuée d'un lot : toujours la même liste, jamais une ressaisie. -------
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

function ligneComposant(c = {}) {
  return `<div class="ration-composant-ligne">
    <select class="rc-stock">
      <option value="">— Choisir un aliment —</option>
      ${optionsStock(c.stockCle)}
    </select>
    <input type="number" class="rc-dose" step="0.01" min="0" inputmode="decimal" placeholder="kg/j" value="${c.kgParAnimalJour != null ? c.kgParAnimalJour : ''}">
    <span class="rc-unite">kg/j</span>
    <button type="button" class="rc-suppr" aria-label="Retirer ce composant">✕</button>
  </div>`;
}

function cablerLigneComposant(ligne) {
  ligne.querySelector('.rc-suppr').addEventListener('click', () => ligne.remove());
}

function ajouterLigneVide(container) {
  container.insertAdjacentHTML('beforeend', ligneComposant());
  cablerLigneComposant(container.lastElementChild);
}

function remplirComposants(container, composants) {
  container.innerHTML = '';
  (composants && composants.length ? composants : [{}]).forEach((c) => {
    container.insertAdjacentHTML('beforeend', ligneComposant(c));
    cablerLigneComposant(container.lastElementChild);
  });
}

function lireComposantsDe(container) {
  return Array.from(container.querySelectorAll('.ration-composant-ligne')).map((ligne) => {
    const select = ligne.querySelector('.rc-stock');
    const cat = categories.find((c) => c.cle === select.value);
    return {
      stockCle: select.value,
      stockLabel: cat ? cat.label : select.value,
      kgParAnimalJour: Number(ligne.querySelector('.rc-dose').value) || 0
    };
  }).filter((c) => c.stockCle && c.kgParAnimalJour > 0);
}

function resumeComposants(composants) {
  return composants.length
    ? composants.map((c) => `${escapeHtml(c.stockLabel)} : ${c.kgParAnimalJour} kg/j`).join(' · ')
    : '🌱 Pâturage (aucun aliment de stock)';
}

// ============================================================================
// Prévisionnel
// ============================================================================
const previsionnelSection = document.getElementById('troupeau-previsionnel');
const campagneLabelEl = document.getElementById('previsionnel-campagne-label');
const prevuEl = document.getElementById('previsionnel-prevu');
const planListeEl = document.getElementById('previsionnel-liste');
const selectStadePlan = document.getElementById('previsionnel-stade');
const inputEffectifPlan = document.getElementById('previsionnel-effectif');
const inputDebutPlan = document.getElementById('previsionnel-debut');
const inputFinPlan = document.getElementById('previsionnel-fin');
const composantsPlanEl = document.getElementById('previsionnel-composants');
const btnComposantPlan = document.getElementById('previsionnel-composant-ajouter');
const erreurPlanEl = document.getElementById('previsionnel-erreur');
const btnAjouterPlan = document.getElementById('previsionnel-ajouter');

function peuplerStadesPlan(stades) {
  const valeur = selectStadePlan.value;
  selectStadePlan.innerHTML = stades.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.nom)}</option>`).join('');
  if (valeur && stades.some((s) => s.id === valeur)) selectStadePlan.value = valeur;
}

async function surAjouterLignePlan() {
  erreurPlanEl.hidden = true;
  btnAjouterPlan.disabled = true;
  try {
    const stade = getStades().find((s) => s.id === selectStadePlan.value);
    const ligne = {
      stadeId: stade ? stade.id : null,
      stadeNom: stade ? stade.nom : '',
      effectifPrevu: inputEffectifPlan.value,
      dateDebut: inputDebutPlan.value,
      dateFin: inputFinPlan.value,
      composants: lireComposantsDe(composantsPlanEl)
    };
    await ajouterLignePlan(campagneCourante(), ligne);
    log('ligne de plan ajoutée');
    toastSucces('Ligne ajoutée au plan.');
    inputEffectifPlan.value = '';
    inputDebutPlan.value = '';
    inputFinPlan.value = '';
    remplirComposants(composantsPlanEl, []);
  } catch (err) {
    const msg = (err && err.message) || err;
    erreurPlanEl.textContent = msg;
    erreurPlanEl.hidden = false;
    toastErreur('Ligne non ajoutée : ' + msg);
  } finally {
    btnAjouterPlan.disabled = false;
  }
}

function renderPrevisionnel() {
  const campagne = campagneCourante();
  campagneLabelEl.textContent = campagne;
  const plan = getPlan();

  const prevu = prevuCampagneParAliment(plan);
  prevuEl.innerHTML = prevu.length
    ? prevu.map((p) => `<div class="cat-card">
        <div class="cat-card-nom">${escapeHtml(p.label)}</div>
        <div class="cat-card-tonnes">${formatTonnes(p.tonnes)} t</div>
      </div>`).join('')
    : '<p class="list-empty">Aucune ligne de plan pour l\'instant.</p>';

  const lignes = (plan.stades || []).slice().sort((a, b) => (a.dateDebut < b.dateDebut ? -1 : 1));
  planListeEl.innerHTML = lignes.length
    ? lignes.map((l) => `<div class="apercu-activite">
        <div class="apercu-activite-corps">
          <span class="apercu-activite-nom">${escapeHtml(l.stadeNom || 'Stade non défini')} — ${l.effectifPrevu || 0} brebis</span>
          <span class="apercu-activite-date">${escapeHtml(dateLisible(l.dateDebut))} → ${escapeHtml(dateLisible(l.dateFin))}</span>
          <span class="apercu-activite-detail">${resumeComposants(l.composants || [])}</span>
        </div>
        <button type="button" class="btn-icone-suppr" data-ligne="${escapeAttr(l.id)}" aria-label="Supprimer cette ligne">✕</button>
      </div>`).join('')
    : '<p class="list-empty">Aucune ligne planifiée.</p>';

  planListeEl.querySelectorAll('[data-ligne]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette ligne du plan ?')) return;
      try { await supprimerLignePlan(campagne, btn.dataset.ligne); }
      catch (err) { toastErreur('Suppression impossible : ' + ((err && err.message) || err)); }
    });
  });
}

// ============================================================================
// Ration actuelle : distribution en cours par lot
// ============================================================================
const distribActuellesEl = document.getElementById('troupeau-distributions-actuelles');

function renderDistributionsActuelles() {
  if (!distribActuellesEl) return;
  const lots = getLots();
  distribActuellesEl.innerHTML = lots.length
    ? lots.map((lot) => {
        const aff = affectationEnCours(lot);
        const composants = aff ? composantsAffectation(aff) : [];
        return `<div class="lot-card" data-id="${escapeAttr(lot.id)}">
          <div class="lot-card-body">
            <div class="lot-card-nom">${escapeHtml(lot.nom || 'Lot')} <span class="lot-card-nb">${lot.nbBrebis} brebis</span></div>
            <div class="lot-card-sub">${aff ? escapeHtml('depuis le ' + dateLisible(aff.dateDebut)) : 'Aucune ration distribuée'}</div>
            <div class="lot-card-stock">${aff ? resumeComposants(composants) : ''}</div>
          </div>
          <button type="button" class="btn btn-secondary btn-mini bouton-changer-ration" data-id="${escapeAttr(lot.id)}">🔄 Changer</button>
        </div>`;
      }).join('')
    : '<p class="list-empty">Aucun lot. Utilise « ➕ Lot » pour en créer un.</p>';

  distribActuellesEl.querySelectorAll('.bouton-changer-ration').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const lot = getLots().find((l) => l.id === btn.dataset.id);
      if (lot && openEditLotFn) openEditLotFn(lot);
    });
  });
}

// ============================================================================
// Historique & bilan
// ============================================================================
const distribJournalEl = document.getElementById('troupeau-distributions-journal');
const bilanEl = document.getElementById('troupeau-bilan');

function renderDistributionsJournal() {
  if (!distribJournalEl) return;
  const toutes = [];
  getLots().forEach((lot) => {
    historiqueAffectations(lot).forEach((a) => toutes.push({ lot, a }));
  });
  toutes.sort((x, y) => (x.a.dateDebut < y.a.dateDebut ? 1 : x.a.dateDebut > y.a.dateDebut ? -1 : 0));

  distribJournalEl.innerHTML = toutes.length
    ? toutes.map(({ lot, a }) => {
        const actif = !a.dateFin || a.dateFin > aujourdhui();
        const badge = a.dateFin
          ? `${dateLisible(a.dateDebut)} au ${dateLisible(a.dateFin)}`
          : `En cours (depuis le ${dateLisible(a.dateDebut)})`;
        const composants = composantsAffectation(a);
        return `<div class="periode-card">
          <div class="periode-entete">
            <div>
              <span class="periode-badge ${actif ? 'periode-badge-encours' : ''}">${escapeHtml(badge)}</span>
              <h3 class="periode-titre">${escapeHtml(lot.nom || 'Lot')} — ${a.nbBrebis || 0} brebis</h3>
            </div>
          </div>
          <p class="periode-sub">${resumeComposants(composants)}</p>
        </div>`;
      }).join('')
    : '<p class="list-empty">Aucune ration distribuée pour l\'instant.</p>';
}

const poidsBottesEl = document.getElementById('troupeau-poids-bottes');

// Poids moyen calculé si aucun réglage manuel n'existe encore : moyenne des
// entrées déjà comptées pour cet aliment (tonnes/bottes de la catégorie),
// jamais utilisée pour le calcul du tonnage lui-même.
function poidsBotteEffectif(cle) {
  const cat = categories.find((c) => c.cle === cle);
  const moyenneCalculee = cat && cat.nbBottes > 0 ? Math.round((cat.tonnes * 1000) / cat.nbBottes) : 0;
  return poidsBotteStock(cle) || moyenneCalculee;
}

function renderBilan() {
  if (!bilanEl) return;
  const bilan = bilanParAliment(categories, getLots(), getPlan());
  if (!bilan.length) {
    bilanEl.innerHTML = '<p class="list-empty">Aucun aliment prévu, distribué ou en stock pour l\'instant.</p>';
    if (poidsBottesEl) poidsBottesEl.innerHTML = '';
    return;
  }
  bilanEl.innerHTML = `<table class="tableau">
    <thead><tr>
      <th>Aliment</th><th>Prévu</th><th>Consommé</th><th>Reste prévu</th><th>Stock dispo</th><th>À acheter</th>
    </tr></thead>
    <tbody>
      ${bilan.map((b) => {
        const poids = poidsBotteEffectif(b.cle);
        const bottes = poids > 0 ? Math.round((b.stockDispo * 1000) / poids) : null;
        return `<tr class="bilan-ligne bilan-${b.statut}">
          <td>${escapeHtml(b.label)}${b.depassement ? ' <span class="bilan-badge">Dépassement</span>' : ''}</td>
          <td>${formatTonnes(b.prevu)} t</td>
          <td>${formatTonnes(b.consomme)} t</td>
          <td>${formatTonnes(b.restePrevu)} t</td>
          <td>${formatTonnes(b.stockDispo)} t${bottes != null ? ` <small>(~${bottes} bottes)</small>` : ''}</td>
          <td>${b.aAcheter > 0 ? formatTonnes(b.aAcheter) + ' t' : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  if (poidsBottesEl) {
    const fourrages = bilan.filter((b) => categories.some((c) => c.cle === b.cle && c.nbBottes > 0));
    poidsBottesEl.innerHTML = fourrages.length
      ? fourrages.map((b) => `<span class="poids-botte-reglage">
          ${escapeHtml(b.label)} : <input type="number" class="poids-botte-input" data-cle="${escapeAttr(b.cle)}" step="1" min="0" value="${poidsBotteEffectif(b.cle) || ''}"> kg/botte
        </span>`).join('')
      : '';
    poidsBottesEl.querySelectorAll('.poids-botte-input').forEach((input) => {
      input.addEventListener('change', async () => {
        try { await setPoidsBotteStock(input.dataset.cle, input.value); renderBilan(); }
        catch (err) { toastErreur('Poids/botte non enregistré : ' + ((err && err.message) || err)); }
      });
    });
  }
}

// Rendu partagé de l'alerte « achat à prévoir » — appelé depuis Troupeau ET
// l'onglet Stocks (ui-stocks.js), sur le même bilan (rations-calc.js), jamais
// recalculé deux fois séparément.
export function renderAchatPrevoir(cible) {
  if (!cible) return;
  const aAcheter = bilanParAliment(categories, getLots(), getPlan()).filter((b) => b.aAcheter > 0);
  if (!aAcheter.length) {
    cible.hidden = true;
    cible.innerHTML = '';
    return;
  }
  cible.hidden = false;
  cible.innerHTML = `<div class="alerte">
    ⚠️ Achat à prévoir (campagne ${escapeHtml(campagneCourante())}) :
    ${aAcheter.map((b) => `${escapeHtml(b.label)} — ${formatTonnes(b.aAcheter)} t`).join(' · ')}
  </div>`;
}

// ============================================================================
// Fiche lot : section « Ration distribuée » (composée à la volée)
// ============================================================================
const lotSection = document.getElementById('lot-rations-section');
const lotListeEl = document.getElementById('lot-r-liste');
const lotComposantsEl = document.getElementById('lot-r-composants');
const btnComposantLot = document.getElementById('lot-r-composant-ajouter');
const lotDebut = document.getElementById('lot-r-debut');
const lotFin = document.getElementById('lot-r-fin');
const lotErreur = document.getElementById('lot-r-erreur');
const btnChangerRation = document.getElementById('lot-r-affecter');

export function ouvrirSectionRationsLot(lot) {
  lotCourant = lot;
  lotSection.hidden = false;
  hideErreurLot();
  const aff = affectationEnCours(lot);
  remplirComposants(lotComposantsEl, aff ? composantsAffectation(aff) : []);
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
        const composants = composantsAffectation(a);
        const conso = composants.length
          ? composants.map((c) => `${escapeHtml(c.stockLabel)} : ${formatTonnes(tonnesComposant(a, c))} t consommées`).join(' · ')
          : '🌱 Pâturage';
        return `<div class="apercu-activite">
          <div class="apercu-activite-corps">
            <span class="apercu-activite-nom">${a.nbBrebis || 0} brebis</span>
            <span class="apercu-activite-date">${escapeHtml(dates)}</span>
            <span class="apercu-activite-detail">${conso}</span>
          </div>
          <button type="button" class="btn-icone-suppr" data-affectation="${escapeAttr(a.id)}" aria-label="Supprimer cette distribution">✕</button>
        </div>`;
      }).join('')
    : '<p class="list-empty">Aucune ration distribuée à ce lot.</p>';

  lotListeEl.querySelectorAll('[data-affectation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette distribution ? Cette action est irréversible.')) return;
      const id = btn.dataset.affectation;
      const supprimee = affectationsLot(lot).find((a) => a.id === id);
      // La distribution qu'elle avait refermée ne se rouvre jamais toute
      // seule — c'est un choix qu'on propose, pas un automatisme.
      const precedente = precedenteFermeePar(lot, supprimee);
      try {
        await supprimerAffectation(lot, id);
        let lotMaj = { ...lot, affectations: affectationsLot(lot).filter((a) => a.id !== id) };
        if (precedente && confirm(`Rouvrir la distribution précédente (${resumeComposants(composantsAffectation(precedente))}) ?`)) {
          await rouvrirAffectation(lot, precedente.id);
          lotMaj = { ...lotMaj, affectations: affectationsLot(lotMaj).map((a) => (a.id === precedente.id ? { ...a, dateFin: null } : a)) };
        }
        renderAffectationsLot(lotMaj);
      } catch (err) {
        showErreurLot('Suppression impossible : ' + ((err && err.message) || err));
      }
    });
  });
}

async function surChangerRation() {
  hideErreurLot();
  if (!lotCourant) return;
  btnChangerRation.disabled = true;
  try {
    const composants = lireComposantsDe(lotComposantsEl);
    const dateDebut = lotDebut.value || aujourdhui();
    const dateFin = lotFin.value || null;
    const resultat = await distribuerRation(lotCourant, { composants, dateDebut, dateFin });
    lotCourant = { ...lotCourant, affectations: affectationsLot(lotCourant).filter((a) => a.id !== resultat.id).concat([resultat]) };
    log('ration distribuée au lot');
    toastSucces(composants.length ? 'Ration distribuée.' : 'Pâturage enregistré.');
    lotDebut.value = aujourdhui();
    lotFin.value = '';
    remplirComposants(lotComposantsEl, []);
    renderAffectationsLot(lotCourant);
  } catch (err) {
    const msg = err instanceof ErreurDeSaisie ? err.message : `Erreur d'enregistrement : ${(err && err.message) || err}`;
    showErreurLot(msg);
    toastErreur(`Échec de la distribution : ${msg}`);
  } finally {
    btnChangerRation.disabled = false;
  }
}

// ============================================================================
// Init + rendu global
// ============================================================================
export function initTroupeauRations() {
  onStadesChange(peuplerStadesPlan);
  ajouterLigneVide(composantsPlanEl);
  btnComposantPlan.addEventListener('click', () => ajouterLigneVide(composantsPlanEl));
  btnAjouterPlan.addEventListener('click', surAjouterLignePlan);
  // Le plan alimente aussi le bilan (sous-vue Historique) : un changement de
  // plan doit se refléter là même si on n'est pas en train de regarder la
  // sous-vue Prévisionnel.
  onPlanChange(() => renderTroupeauRations());

  ajouterLigneVide(lotComposantsEl);
  btnComposantLot.addEventListener('click', () => ajouterLigneVide(lotComposantsEl));
  btnChangerRation.addEventListener('click', surChangerRation);

  onPoidsBottesChange(() => { if (!bilanEl.closest('#troupeau-historique').hidden) renderBilan(); });
}

// Appelé depuis ui-alimentation.js/renderVue() à chaque recalcul global, pour
// que les trois sous-vues restent à jour quelle que soit celle affichée —
// même principe que le reste de la vue Troupeau (non touché).
export function renderTroupeauRations() {
  renderPrevisionnel();
  renderDistributionsActuelles();
  renderDistributionsJournal();
  renderBilan();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
