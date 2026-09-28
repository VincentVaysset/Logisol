// Moteur de calcul du module Rations : consommation dérivée des distributions
// réelles (jamais un décrément écrit), total prévu du plan de campagne, et
// le bilan qui confronte les deux — cf. affectations.js et plan-campagne.js
// pour le pourquoi d'un calcul purement dérivé, jamais stocké, à l'image de
// niveauContenant() côté mouvements de stock.
import { aujourdhui } from './implantations.js';
import { historiqueAffectations, affectationEnCours, tonnesComposant, composantsAffectation } from './affectations.js';
import { joursLignePlan } from './plan-campagne.js';

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

/** Consommation cumulée à ce jour, par aliment — tous lots, toutes distributions. */
export function consommationParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => {
      composantsAffectation(aff).forEach((c) => {
        if (!c.stockCle) return;
        if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
        const g = parCle.get(c.stockCle);
        g.tonnes = arrondi3(g.tonnes + tonnesComposant(aff, c, date));
      });
    });
  });
  return Array.from(parCle.values());
}

/** Besoin journalier COURANT, par aliment — seulement les distributions actives aujourd'hui. */
export function besoinJournalierParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    const aff = affectationEnCours(lot, date);
    if (!aff) return;
    const nb = Number(aff.nbBrebis) || 0;
    composantsAffectation(aff).forEach((c) => {
      if (!c.stockCle) return;
      if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, kgParJour: 0 });
      parCle.get(c.stockCle).kgParJour += nb * (Number(c.kgParAnimalJour) || 0);
    });
  });
  return Array.from(parCle.values());
}

/**
 * Total prévu par aliment sur tout le plan de campagne : Σ lignes
 * [ effectifPrevu × kgParAnimalJour × nbJours planifiés ].
 * @param {{stades: Array}} plan  sortie de plan-campagne.getPlan()
 */
export function prevuCampagneParAliment(plan) {
  const parCle = new Map();
  ((plan && plan.stades) || []).forEach((ligne) => {
    const jours = joursLignePlan(ligne);
    const effectif = Number(ligne.effectifPrevu) || 0;
    (ligne.composants || []).forEach((c) => {
      if (!c.stockCle) return;
      if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
      const kg = effectif * (Number(c.kgParAnimalJour) || 0) * jours;
      const g = parCle.get(c.stockCle);
      g.tonnes = arrondi3(g.tonnes + kg / 1000);
    });
  });
  return Array.from(parCle.values());
}

// Marge de confort sous laquelle une couverture positive passe en orange
// plutôt qu'en vert (partagée par couverturePrevisionnelle et bilanParAliment
// ci-dessous) : moins de 15 % d'avance sur le besoin, c'est "juste" plutôt
// que confortable. Valeur de convenance, pas une règle métier communiquée
// par l'exploitant — ajustable si besoin.
const MARGE_JUSTE = 0.15;

/**
 * Tableau de couverture du Prévisionnel : Aliment | Stock (entrées campagne)
 * | Besoin prévu | Solde | À acheter — LE SEUL endroit de l'appli où "à
 * acheter" existe. Ne lit JAMAIS les distributions ni la consommation
 * réelle : uniquement le plan (besoin prévu, total sur toute la campagne) et
 * les entrées de stock (fourrages.js/entreesCampagneParCategorie) — Prévu et
 * Distribué ne se lisent jamais l'un l'autre (CLAUDE.md).
 * @param {Array<{cle,label,tonnes}>} entreesCampagne  fourrages.js/entreesCampagneParCategorie
 * @param {{stades: Array}} plan  sortie de plan-campagne.getPlan()
 */
export function couverturePrevisionnelle(entreesCampagne, plan) {
  const besoin = new Map(prevuCampagneParAliment(plan).map((p) => [p.cle, p]));
  const stock = new Map((entreesCampagne || []).map((s) => [s.cle, s]));
  const cles = new Set([...besoin.keys(), ...stock.keys()]);

  return Array.from(cles).map((cle) => {
    const b = besoin.get(cle);
    const s = stock.get(cle);
    const stockT = s ? s.tonnes : 0;
    const besoinT = b ? b.tonnes : 0;
    const solde = arrondi3(stockT - besoinT);
    const aAcheter = Math.max(0, arrondi3(besoinT - stockT));

    let statut = 'vert';
    if (solde < 0) statut = 'rouge';
    else if (besoinT > 0 && solde / besoinT < MARGE_JUSTE) statut = 'orange';

    return {
      cle, label: (b && b.label) || (s && s.label) || cle,
      stock: stockT, besoin: besoinT, solde, aAcheter, statut
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr'));
}

/**
 * Stock disponible par aliment : entrées (récoltes + achats, catégories
 * fusionnées de l'onglet Stocks) moins consommation calculée depuis les
 * distributions — jamais un décrément écrit sur le stock lui-même.
 * @param {Array} categories  sortie de fourrages.fusionnerCategories()
 */
export function stockDisponibleParItem(categories, lots, date = aujourdhui()) {
  const parCle = new Map();
  (categories || []).forEach((c) => {
    parCle.set(c.cle, { cle: c.cle, label: c.label, entrees: Number(c.tonnes) || 0, consomme: 0 });
  });
  consommationParStock(lots, date).forEach((c) => {
    if (!parCle.has(c.cle)) parCle.set(c.cle, { cle: c.cle, label: c.label, entrees: 0, consomme: 0 });
    parCle.get(c.cle).consomme = c.tonnes;
  });
  return Array.from(parCle.values()).map((c) => ({ ...c, disponible: arrondi3(c.entrees - c.consomme) }));
}

/**
 * Tableau de bilan par aliment : Prévu campagne | Consommé | Reste prévu |
 * Stock dispo | À acheter, avec code couleur et badge dépassement.
 * @param {Array} categories  sortie de fourrages.fusionnerCategories()
 * @param {Array} lots
 * @param {{stades: Array}} plan  sortie de plan-campagne.getPlan()
 */
export function bilanParAliment(categories, lots, plan, date = aujourdhui()) {
  const prevu = new Map(prevuCampagneParAliment(plan).map((p) => [p.cle, p]));
  const dispo = stockDisponibleParItem(categories, lots, date);

  const parCle = new Map();
  prevu.forEach((p, cle) => parCle.set(cle, { cle, label: p.label, prevu: p.tonnes, entrees: 0, consomme: 0 }));
  dispo.forEach((d) => {
    if (!parCle.has(d.cle)) parCle.set(d.cle, { cle: d.cle, label: d.label, prevu: 0, entrees: 0, consomme: 0 });
    const g = parCle.get(d.cle);
    g.entrees = d.entrees;
    g.consomme = d.consomme;
    if (!g.label) g.label = d.label;
  });

  return Array.from(parCle.values())
    .map((g) => {
      const restePrevu = Math.max(0, arrondi3(g.prevu - g.consomme));
      const stockDispo = arrondi3(g.entrees - g.consomme);
      const aAcheter = Math.max(0, arrondi3(g.prevu - g.entrees));
      const depassement = g.prevu > 0 && g.consomme > g.prevu;

      let statut = 'vert';
      if (stockDispo < 0 || aAcheter > 0) statut = 'rouge';
      else if (restePrevu > 0) {
        const marge = (stockDispo - restePrevu) / restePrevu;
        if (marge < MARGE_JUSTE) statut = 'orange';
      }

      return {
        cle: g.cle, label: g.label,
        prevu: g.prevu, consomme: g.consomme, restePrevu,
        stockDispo, aAcheter, depassement, statut
      };
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr'));
}
