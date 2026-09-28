// Moteur de calcul du module Rations : consommation dérivée des affectations
// (jamais un décrément écrit), stock disponible par item, et projection
// d'achat à un horizon — cf. affectations.js pour le pourquoi d'un calcul
// purement dérivé, jamais stocké, à l'image de niveauContenant() côté
// mouvements de stock.
import { aujourdhui, campagneDeSemis } from './implantations.js';
import { historiqueAffectations, affectationEnCours, tonnesComposant } from './affectations.js';

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

// Horizon par défaut : le 31 juillet de la campagne en cours (même
// convention que implantations.js/campagneDeSemis : un semis d'août à
// décembre appartient à la campagne suivante).
export function finCampagne(date = aujourdhui()) {
  const annee = campagneDeSemis(date) || String(new Date(date + 'T12:00:00').getFullYear());
  return `${annee}-07-31`;
}

/** Consommation cumulée à ce jour, par stock — tous lots, toutes affectations. */
export function consommationParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => {
      (aff.snapshot || []).forEach((c) => {
        if (!c.stockCle) return;
        if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
        const g = parCle.get(c.stockCle);
        g.tonnes = arrondi3(g.tonnes + tonnesComposant(aff, c, date));
      });
    });
  });
  return Array.from(parCle.values());
}

/** Besoin journalier COURANT, par stock — seulement les affectations actives aujourd'hui. */
export function besoinJournalierParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    const aff = affectationEnCours(lot, date);
    if (!aff) return;
    const nb = Number(aff.nbBrebis) || 0;
    (aff.snapshot || []).forEach((c) => {
      if (!c.stockCle) return;
      if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, kgParJour: 0 });
      parCle.get(c.stockCle).kgParJour += nb * (Number(c.kgParAnimalJour) || 0);
    });
  });
  return Array.from(parCle.values());
}

/**
 * Stock disponible par item : entrées (récoltes + achats, catégories
 * fusionnées de l'onglet Stocks) moins consommation calculée depuis les
 * affectations — jamais un décrément écrit sur le stock lui-même.
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
 * Projette la consommation jusqu'à un horizon (fin de campagne par défaut) :
 * si le besoin projeté dépasse le disponible, l'écart en tonnes est
 * l'« achat à prévoir » affiché sur les onglets Rations et Stocks.
 */
export function projectionAchat(categories, lots, { horizon = null, date = aujourdhui() } = {}) {
  const horizonDate = horizon || finCampagne(date);
  const joursRestants = Math.max(0, Math.round(
    (Date.parse(horizonDate + 'T12:00:00') - Date.parse(date + 'T12:00:00')) / 86400000
  ));
  const besoinParCle = new Map(besoinJournalierParStock(lots, date).map((b) => [b.cle, b]));
  return stockDisponibleParItem(categories, lots, date)
    .map((d) => {
      const kgParJour = besoinParCle.has(d.cle) ? besoinParCle.get(d.cle).kgParJour : 0;
      const consommeProjete = arrondi3(d.consomme + (kgParJour * joursRestants) / 1000);
      return {
        cle: d.cle, label: d.label, entrees: d.entrees, disponible: d.disponible,
        kgParJour, manqueTonnes: Math.max(0, arrondi3(consommeProjete - d.entrees))
      };
    })
    .filter((d) => d.manqueTonnes > 0)
    .sort((a, b) => b.manqueTonnes - a.manqueTonnes);
}
