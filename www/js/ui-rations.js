// Rations distribuées (réel, par lot) + plan de campagne prévisionnel +
// bilan — intégrés aux sous-onglets EXISTANTS de la vue Troupeau
// (ui-alimentation.js, non touché dans sa logique de fiche/rendu propre) :
// « Prévisionnel », « Ration actuelle », « Historique & bilan ». Aucun
// nouvel onglet, aucune ressaisie d'aliment — tout composant se choisit
// dans la liste Stocks (catégories fusionnées, mêmes clés que partout
// ailleurs dans l'appli).
import {
  affectationsLot, historiqueAffectations, affectationEnCours,
  distribuerRation, supprimerAffectation, tonnesComposant, composantsAffectation,
  precedenteFermeePar, rouvrirAffectation
} from './affectations.js';
import {
  besoinJournalierParStock,
  consommationParStock, couverturePrevisionnelle, bilanParLot
} from './rations-calc.js';
import {
  getPlan, onPlanChange, ajouterLignePlan, supprimerLignePlan, campagneCourante
} from './plan-campagne.js';
import { openEditLot } from './ui-alimentation.js';
import { getLots } from './lots.js';
import { getStades, onStadesChange } from './stades.js';
import { aujourdhui } from './implantations.js';
import { getCampagneStockChoisie, onCampagneStockChange } from './campagne-stock.js';
import { stockAuSoir } from './clotures-stock.js';
import { dateLisible } from './accueil.js';
import { formatTonnes, metaParCle } from './ui-stocks.js';
import { bilanParTypeAnimaux, estAchete } from './groupes-stock.js';
import { toastSucces, toastErreur } from './toast.js';
import { entreesCampagneParCategorie } from './fourrages.js';
import { getMouvements, updateMouvement, deleteMouvement } from './mouvements.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';

class ErreurDeSaisie extends Error {}

let categories = [];       // catégories fusionnées (mêmes que Stocks/Troupeau)
let lotCourant = null;     // lot dont la fiche est ouverte (fourni par ui-alimentation.js)

export function setCategoriesRations(list) { categories = list || []; }

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }

// --- Sélecteur de stock, partagé entre le plan prévisionnel et la ration
// distribuée d'un lot : toujours la même liste, jamais une ressaisie. -------
function optionsStock(valeurChoisie) {
  const parFamille = new Map();
  categories.forEach((c) => {
    const famille = c.categorie === 'cereale' ? 'Céréales' : c.categorie === 'commerce' ? 'Concentrés achetés' : 'Foin / fourrage';
    if (!parFamille.has(famille)) parFamille.set(famille, []);
    parFamille.get(famille).push(c);
  });
  const ordre = ['Foin / fourrage', 'Céréales', 'Concentrés achetés'];
  return ordre
    .filter((f) => parFamille.has(f))
    .map((f) => {
      const lignes = parFamille.get(f).slice().sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      return `<optgroup label="${escapeAttr(f)}">${lignes.map((o) =>
        `<option value="${escapeAttr(o.cle)}" ${o.cle === valeurChoisie ? 'selected' : ''}>${escapeHtml(o.label)}${o.categorie !== 'commerce' && estAchete(o.cle) ? ' · acheté' : ''}</option>`
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

export function resumeComposants(composants) {
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

  // Tableau de couverture : Stock (entrées campagne) vs Besoin prévu — LE
  // SEUL endroit avec "à acheter" (cf. rations-calc.js/couverturePrevisionnelle).
  // Ne lit jamais les distributions, uniquement le plan et les entrées de
  // stock (Prévu et Distribué ne se lisent jamais l'un l'autre, CLAUDE.md).
  const entrees = entreesCampagneParCategorie(getMouvements(), getCellules(), getEmplacements());
  const couverture = couverturePrevisionnelle(entrees, plan);
  prevuEl.innerHTML = couverture.length
    ? `<table class="tableau">
        <thead><tr>
          <th>Aliment</th><th>Stock</th><th>Besoin prévu</th><th>Solde</th><th>À acheter</th>
        </tr></thead>
        <tbody>
          ${couverture.map((c) => `<tr class="bilan-ligne bilan-${c.statut}">
            <td>${escapeHtml(c.label)}</td>
            <td>${formatTonnes(c.stock)} t</td>
            <td>${formatTonnes(c.besoin)} t</td>
            <td>${formatTonnes(c.solde)} t</td>
            <td>${c.aAcheter > 0 ? formatTonnes(c.aAcheter) + ' t' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
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
// Sorties alimentation manuelles (nettoyage) — cf. stockDisponibleCanonique()
// ============================================================================
// Ces mouvements SORTIE_ALIMENTATION, saisis avant l'existence des
// distributions, sont désormais TOUJOURS exclus du stock canonique (cf.
// fourrages.js) : les compter en plus d'une distribution ferait double
// emploi. Cette liste sert seulement à faire le ménage — rien n'est
// supprimé tant que Vincent ne clique pas lui-même sur "Supprimer".
const sortiesManuellesEl = document.getElementById('troupeau-sorties-manuelles');

export function renderSortiesManuelles() {
  if (!sortiesManuellesEl) return;
  const liste = getMouvements()
    .filter((m) => m.typeMouvement === 'SORTIE_ALIMENTATION')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!liste.length) {
    sortiesManuellesEl.innerHTML = '<p class="list-empty">Aucune sortie alimentation manuelle enregistrée.</p>';
    return;
  }
  sortiesManuellesEl.innerHTML = liste.map((m) => `
    <div class="periode-card" data-id="${escapeAttr(m.id)}">
      <div class="periode-entete">
        <div>
          <span class="periode-badge">${escapeHtml(dateLisible(m.date))}</span>
          <h3 class="periode-titre">${escapeHtml(m.categorieLabel || m.destinationNom || m.libelle || 'Sortie alimentation')}</h3>
        </div>
        <span class="periode-tonnage">${formatTonnes(m.quantite)} ${m.unite === 'bottes' ? 'bottes' : 't'}</span>
      </div>
      <p class="periode-sub">${m.excluCalcul ? '🚫 Exclue du calcul (déjà écartée)' : 'Déjà exclue du stock canonique — ne compte plus nulle part'}</p>
      <div class="fiche-actions" style="margin-top:8px">
        <button type="button" class="btn btn-secondary btn-mini sortie-manuelle-exclure" data-id="${escapeAttr(m.id)}">${m.excluCalcul ? '↩ Réinclure' : '🚫 Exclure du calcul'}</button>
        <button type="button" class="btn btn-danger btn-mini sortie-manuelle-supprimer" data-id="${escapeAttr(m.id)}">🗑️ Supprimer</button>
      </div>
    </div>`).join('');

  sortiesManuellesEl.querySelectorAll('.sortie-manuelle-exclure').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = getMouvements().find((x) => x.id === btn.dataset.id);
      if (!m) return;
      btn.disabled = true;
      try {
        await updateMouvement(m.id, { ...m, excluCalcul: !m.excluCalcul });
        toastSucces(m.excluCalcul ? 'Sortie réincluse.' : 'Sortie exclue du calcul.');
      } catch (err) {
        toastErreur('Modification impossible : ' + ((err && err.message) || err));
      } finally {
        btn.disabled = false;
      }
    });
  });
  sortiesManuellesEl.querySelectorAll('.sortie-manuelle-supprimer').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette sortie alimentation manuelle ? Cette action est irréversible.')) return;
      btn.disabled = true;
      try {
        await deleteMouvement(btn.dataset.id);
        toastSucces('Sortie supprimée.');
      } catch (err) {
        toastErreur('Suppression impossible : ' + ((err && err.message) || err));
        btn.disabled = false;
      }
    });
  });
}

// ============================================================================
// Historique & bilan
// ============================================================================
const bilanEl = document.getElementById('troupeau-bilan');

// Bilan campagne (maquette troupeau v2) : par groupe d'aliment, ventilé
// brebis / agnelles, totaux en tête — uniquement ce qui a été DISTRIBUÉ sur
// la campagne de l'en-tête (prorata au 31/08, rations-calc.js/bilanParLot),
// jamais le prévu ni un ajustement d'inventaire.
onCampagneStockChange(() => renderBilan());

function renderBilan() {
  if (!bilanEl) return;
  const parLot = bilanParLot(getLots(), getCampagneStockChoisie());
  const b = bilanParTypeAnimaux(parLot.map((bl) => ({ type: bl.type, items: bl.items })), metaParCle());
  if (!b.groupes.length) {
    bilanEl.innerHTML = '<p class="list-empty">Aucune ration distribuée sur cette campagne.</p>';
    return;
  }
  const barre = (id, pct) => `<div class="stk-jauge"><div class="stk-jauge-${id}" style="width:${pct}%"></div></div>`;
  bilanEl.innerHTML = `<div class="trp-totaux">
      <div class="trp-total"><span>Brebis</span><strong>${formatTonnes(b.totaux.brebis)} t</strong></div>
      <div class="trp-total"><span>Agnelles</span><strong>${formatTonnes(b.totaux.agnelles)} t</strong></div>
    </div>
    ${b.groupes.map((g) => `<div class="stk-carte trp-bilan-carte">
      <div class="stk-groupe-tete"><span class="stk-groupe-nom">${escapeHtml(g.nom)}</span><span class="stk-groupe-val">${formatTonnes(g.total)} t</span></div>
      <div class="trp-bilan-ligne"><div class="trp-bilan-tete"><span>Brebis</span><strong>${formatTonnes(g.brebis)} t</strong></div>${barre(g.id, g.pctBrebis)}</div>
      <div class="trp-bilan-ligne"><div class="trp-bilan-tete"><span>Agnelles</span><strong>${formatTonnes(g.agnelles)} t</strong></div>${barre(g.id, g.pctAgnelles)}</div>
      <div class="trp-bilan-aliments">${g.aliments.map((a) => `<div class="trp-bilan-aliment">
        <span>${escapeHtml(a.libelle)}</span>
        <span class="trp-bilan-aliment-val"><strong>${formatTonnes(a.total)} t</strong>
          <small>brebis ${formatTonnes(a.brebis)} · agnelles ${formatTonnes(a.agnelles)}</small></span></div>`).join('')}</div>
    </div>`).join('')}`;
}

// "Stock restant" appelle stockDisponibleCanonique() (fourrages.js) — LA
// même fonction que l'onglet Stocks, aucune autre source (cf. audit
// troupeau/stocks) ; "Déjà consommé" reste propre aux distributions
// (consommationParStock), un chiffre troupeau, pas un stock.
export function totauxDistribution() {
  const dispo = stockAuSoir(aujourdhui());
  const consomme = consommationParStock(getLots());
  const besoin = besoinJournalierParStock(getLots());
  return {
    disponibleT: dispo.reduce((n, d) => n + d.tonnes, 0),
    consommeT: consomme.reduce((n, c) => n + c.tonnes, 0),
    besoinJourKg: besoin.reduce((n, b) => n + b.kgParJour, 0)
  };
}

// Lots sans ration distribuée actuellement — remplace lotsSansStock()
// (alimentation.js, prélèvements) pour l'alerte de la sous-vue Ration
// actuelle, désormais basée sur les distributions.
export function lotsSansDistribution() {
  return getLots().filter((l) => !affectationEnCours(l));
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

}

// Appelé depuis ui-alimentation.js/renderVue() à chaque recalcul global, pour
// que les trois sous-vues restent à jour quelle que soit celle affichée —
// même principe que le reste de la vue Troupeau (non touché).
export function renderTroupeauRations() {
  renderPrevisionnel();
  renderSortiesManuelles();
  renderBilan();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
