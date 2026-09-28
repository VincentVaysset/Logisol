// Affectation d'une ration (recette, cf. rations.js) à un lot d'animaux.
//
// Système NOUVEAU, VOLONTAIREMENT PARALLÈLE à lots.js/planifierPeriode (le
// plan de périodes par STADE physiologique, non touché) : les deux peuvent
// coexister sur un même lot sans se marcher dessus, parce qu'aucun des deux
// n'écrit jamais dans le journal des mouvements de stock — ce sont deux
// estimations dérivées, jamais un décrément réel (cf. rations-calc.js).
//
// Stockage : lot.affectations[] directement sur le document du lot (choix du
// schéma demandé), pas une collection séparée comme prelevements — chaque
// entrée fige un INSTANTANÉ des composants de la ration au moment de
// l'affectation (snapshot) ET l'effectif du lot à ce moment (nbBrebis) :
// modifier la ration plus tard, ou corriger l'effectif du lot, ne doit
// jamais réécrire rétroactivement ce qui a déjà été consommé — même principe
// que lots.js/planifierPeriode.
//
// Convention de dates identique au reste de l'appli : dateDebut est incluse,
// dateFin est EXCLUE. Affecter une nouvelle ration ferme automatiquement
// l'affectation encore ouverte du lot à la nouvelle date de début.
import { db } from './firebase-config.js';
import { doc, updateDoc, serverTimestamp } from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui } from './implantations.js';

export function affectationsLot(lot) {
  return Array.isArray(lot && lot.affectations) ? lot.affectations : [];
}

export function affectationEnCours(lot, date = aujourdhui()) {
  const actives = affectationsLot(lot).filter((a) => a.dateDebut <= date && (!a.dateFin || a.dateFin > date));
  actives.sort((a, b) => (a.dateDebut < b.dateDebut ? 1 : -1));
  return actives[0] || null;
}

export function historiqueAffectations(lot) {
  return affectationsLot(lot).slice().sort((a, b) => (a.dateDebut < b.dateDebut ? 1 : a.dateDebut > b.dateDebut ? -1 : 0));
}

// Jours effectivement couverts par une affectation jusqu'à une date donnée —
// même calcul que lots.js/joursNourris (fin exclue, plafonnée à aujourd'hui).
export function joursAffectation(aff, date = aujourdhui()) {
  if (!aff || !aff.dateDebut) return 0;
  const plafond = lendemain(date);
  const finExclue = aff.dateFin && aff.dateFin < plafond ? aff.dateFin : plafond;
  const j = Math.round(
    (Date.parse(finExclue + 'T12:00:00') - Date.parse(aff.dateDebut + 'T12:00:00')) / 86400000
  );
  return Math.max(0, isFinite(j) ? j : 0);
}

function lendemain(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function besoinJournalierAffectation(aff) {
  const nb = Number(aff && aff.nbBrebis) || 0;
  return (aff && Array.isArray(aff.snapshot) ? aff.snapshot : []).reduce(
    (n, c) => n + nb * (Number(c.kgParAnimalJour) || 0), 0
  );
}

// Tonnes consommées par UN composant d'une affectation, jusqu'à une date.
export function tonnesComposant(aff, composant, date = aujourdhui()) {
  const nb = Number(aff && aff.nbBrebis) || 0;
  const kg = nb * (Number(composant.kgParAnimalJour) || 0) * joursAffectation(aff, date);
  return Math.round((kg / 1000) * 1000) / 1000;
}

function idAffectation() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Affecte une ration à un lot à partir de dateDebut (dateFin optionnelle —
 * plan connu à l'avance ou affectation encore ouverte). Ferme d'abord
 * l'affectation encore ouverte du lot, si elle existe, à cette même date.
 * @param {{id:string, nbBrebis:number}} lot
 * @param {{id:string, nom:string, composants:Array}} ration
 * @param {{dateDebut:string, dateFin?:string|null}} p
 */
export async function affecterRation(lot, ration, { dateDebut, dateFin = null }) {
  if (!lot || !lot.id) throw new Error('Lot introuvable.');
  if (!ration || !Array.isArray(ration.composants) || !ration.composants.length) {
    throw new Error('Choisis une ration.');
  }
  const debut = dateDebut || aujourdhui();
  if (dateFin && dateFin <= debut) throw new Error('La date de fin doit être postérieure à la date de début.');

  const actuelles = affectationsLot(lot).map((a) => {
    if (!a.dateFin || a.dateFin > debut) {
      if (a.dateDebut >= debut) return null; // remplacée avant même d'avoir commencé
      return { ...a, dateFin: debut };
    }
    return a;
  }).filter(Boolean);

  const nouvelle = {
    id: idAffectation(),
    rationId: ration.id,
    rationNom: ration.nom,
    // Instantané délibéré : la ration peut changer plus tard sans toucher à
    // ce qui a déjà été consommé sous cette affectation.
    snapshot: ration.composants.map((c) => ({
      stockCle: c.stockCle, stockLabel: c.stockLabel, kgParAnimalJour: Number(c.kgParAnimalJour) || 0
    })),
    nbBrebis: Number(lot.nbBrebis) || 0,
    dateDebut: debut,
    dateFin: dateFin || null,
    creeLe: new Date().toISOString()
  };

  const affectations = actuelles.concat([nouvelle]);
  await updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
  return nouvelle;
}

export async function supprimerAffectation(lot, affectationId) {
  const affectations = affectationsLot(lot).filter((a) => a.id !== affectationId);
  return updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
}

// Clôt une affectation encore ouverte à une date donnée (arrêt anticipé, sans
// en ouvrir une nouvelle) — symétrique de lots.js/cloturerPrelevement.
export async function cloturerAffectation(lot, affectationId, dateFin = aujourdhui()) {
  const affectations = affectationsLot(lot).map((a) => (a.id === affectationId ? { ...a, dateFin } : a));
  return updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
}
