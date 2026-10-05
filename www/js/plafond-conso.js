// Plafonnement de la consommation sur les vraies données (plafond-calc.js
// pour le calcul pur) : stock hors rations jour par jour, d'après le journal
// des mouvements et le stock de départ des clôtures — le même que l'onglet
// Stocks (clotures-stock.js/stockAuSoir), consommation exceptée.
//
// Résultat mis en cache tant que journal, lots, contenants et clôtures n'ont
// pas changé : chaque calcul de tonnes consommées le consulte
// (affectations.js/tonnesComposant), il doit rester quasi gratuit.
import { getMouvements } from './mouvements.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';
import { getLots } from './lots.js';
import { getClotures } from './verrou-campagne.js';
import { stockDisponibleCanonique } from './fourrages.js';
import { bornesCampagneStock } from './campagne-stock.js';
import { aujourdhui } from './implantations.js';
import { simulerConsommation, premierManque, manquesAggraves } from './plafond-calc.js';

function lendemain(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Simulation sur un jeu de lots donné (lots réels, ou modifiés pour contrôle). */
export function simuler(lots, jusquA = aujourdhui()) {
  const mouvs = getMouvements(), cels = getCellules(), emps = getEmplacements();
  const clots = getClotures()
    .filter((c) => Array.isArray(c.lignes) && c.lignes.length)
    .map((c) => ({ id: c.id, fin: bornesCampagneStock(c.id).fin, snap: new Map(c.lignes.map((l) => [l.cle, Number(l.tonnes) || 0])) }));
  // Journal SANS consommation (aucun lot) au soir d'une date.
  const memo = new Map();
  const J = (d) => {
    if (!memo.has(d)) memo.set(d, new Map(stockDisponibleCanonique(mouvs, cels, emps, [], d).map((g) => [g.cle, g.tonnes])));
    return memo.get(d);
  };
  const baseAu = (d) => {
    const dep = clots.filter((c) => c.fin < d).sort((a, b) => (a.fin < b.fin ? 1 : -1))[0];
    if (!dep) return { stock: J(d), ancre: null };
    const stock = new Map(dep.snap);
    J(d).forEach((t, k) => stock.set(k, (stock.get(k) || 0) + t));
    J(dep.fin).forEach((t, k) => stock.set(k, (stock.get(k) || 0) - t));
    return { stock, ancre: dep.id };
  };
  const datesBase = [...new Set(mouvs.map((m) => m.date).filter(Boolean).concat(clots.map((c) => lendemain(c.fin))))];
  return simulerConsommation({ lots, baseAu, datesBase, jusquA });
}

let cache = null;
let enCours = false;

/** Simulation des lots réels, jusqu'à aujourd'hui (en cache). */
export function simulationCourante() {
  const cle = [getMouvements(), getLots(), getCellules(), getEmplacements(), getClotures(), aujourdhui()];
  if (cache && cache.cle.every((v, i) => v === cle[i])) return cache.res;
  if (enCours) return null;
  enCours = true;
  try { cache = { cle, res: simuler(getLots(), cle[5]) }; }
  finally { enCours = false; }
  return cache.res;
}

/** Fournisseur de affectations.js/setFournisseurPlafonds. */
export function plafondsCourants() {
  const r = simulationCourante();
  return r ? r.manques : null;
}

/**
 * Aliments épuisés d'un lot : pour chaque ration (en cours ou passée) et
 * chaque aliment, le premier jour où il a manqué.
 * @returns {Array<{aff, composant, date}>}
 */
export function epuisementsDuLot(lot, affectations) {
  const r = simulationCourante();
  if (!r) return [];
  const demain = lendemain(aujourdhui());
  const res = [];
  (affectations || lot.affectations || []).forEach((aff) => {
    const fin = aff.dateFin && aff.dateFin < demain ? aff.dateFin : demain;
    (aff.composants || []).forEach((c) => {
      const date = premierManque(r.manques, c.stockCle, aff.dateDebut, fin);
      if (date) res.push({ aff, composant: c, date });
    });
  });
  return res.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Contrôle d'une saisie / modification de ration : les aliments dont le
 * manque s'aggraverait avec ces lots modifiés, et à partir de quand.
 * @returns {Array<{cle, date}>}
 */
export function controlerRations(lotsModifies) {
  const avant = simulationCourante();
  if (!avant) return [];
  return manquesAggraves(avant, simuler(lotsModifies));
}
