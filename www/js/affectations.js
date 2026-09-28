// Ration distribuée à un lot d'animaux (le "réel", par opposition au plan de
// campagne prévisionnel — cf. plan-campagne.js).
//
// Système ADDITIF à lots.js/planifierPeriode (le plan de périodes par STADE
// physiologique, non touché) : les deux peuvent coexister sur un même lot
// sans se marcher dessus, parce qu'aucun des deux n'écrit jamais dans le
// journal des mouvements de stock — ce sont des estimations dérivées,
// jamais un décrément réel (cf. rations-calc.js).
//
// Stockage : lot.affectations[] directement sur le document du lot, pas une
// collection séparée comme prelevements — chaque entrée fige un INSTANTANÉ
// des composants ET l'effectif du lot au moment de la distribution : changer
// l'effectif du lot plus tard ne doit jamais réécrire rétroactivement ce qui
// a déjà été consommé — même principe que lots.js/planifierPeriode.
//
// Les composants sont embarqués DIRECTEMENT (aliment = référence à un stock
// existant, jamais ressaisi) : pas de recette nommée à part, une nouvelle
// ration se compose à la volée à chaque changement. Une liste de composants
// VIDE est valide : c'est le pâturage (ou une réduction totale), pas une
// erreur de saisie.
//
// Convention de dates identique au reste de l'appli : dateDebut est incluse,
// dateFin est EXCLUE. Distribuer une nouvelle ration ferme automatiquement
// la distribution encore ouverte du lot à la nouvelle date de début.
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

// Jours effectivement couverts par une distribution jusqu'à une date donnée —
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

// "snapshot" est l'ancien nom du champ (première version de cette fonctionnalité,
// où une distribution référençait une recette nommée) — lu en repli pour ne
// pas perdre une distribution déjà enregistrée sous ce nom.
export function composantsAffectation(aff) {
  if (!aff) return [];
  if (Array.isArray(aff.composants)) return aff.composants;
  if (Array.isArray(aff.snapshot)) return aff.snapshot;
  return [];
}

export function besoinJournalierAffectation(aff) {
  const nb = Number(aff && aff.nbBrebis) || 0;
  return composantsAffectation(aff).reduce((n, c) => n + nb * (Number(c.kgParAnimalJour) || 0), 0);
}

// Tonnes consommées par UN composant d'une distribution, jusqu'à une date.
export function tonnesComposant(aff, composant, date = aujourdhui()) {
  const nb = Number(aff && aff.nbBrebis) || 0;
  const kg = nb * (Number(composant.kgParAnimalJour) || 0) * joursAffectation(aff, date);
  return Math.round((kg / 1000) * 1000) / 1000;
}

function idAffectation() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Distribue une ration à un lot à partir de dateDebut (dateFin optionnelle —
 * encore ouverte). Ferme d'abord la distribution encore ouverte du lot, si
 * elle existe, à cette même date. composants peut être VIDE (pâturage).
 * @param {{id:string, nbBrebis:number}} lot
 * @param {{composants:Array<{stockCle,stockLabel,kgParAnimalJour}>, dateDebut:string, dateFin?:string|null}} p
 */
export async function distribuerRation(lot, { composants = [], dateDebut, dateFin = null }) {
  if (!lot || !lot.id) throw new Error('Lot introuvable.');
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
    // Instantané délibéré : un aliment peut changer d'identité ailleurs sans
    // toucher à ce qui a déjà été consommé sous cette distribution.
    composants: (composants || [])
      .filter((c) => c.stockCle && Number(c.kgParAnimalJour) > 0)
      .map((c) => ({ stockCle: c.stockCle, stockLabel: c.stockLabel, kgParAnimalJour: Number(c.kgParAnimalJour) || 0 })),
    nbBrebis: Number(lot.nbBrebis) || 0,
    dateDebut: debut,
    dateFin: dateFin || null,
    creeLe: new Date().toISOString()
  };

  const affectations = actuelles.concat([nouvelle]);
  await updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
  return nouvelle;
}

// La distribution que "affectation" a fermée en démarrant (sa dateDebut est
// la dateFin de la précédente) — celle-là même que supprimerAffectation() ne
// rouvre jamais toute seule (cf. en-tête de fichier).
export function precedenteFermeePar(lot, affectation) {
  if (!affectation) return null;
  return affectationsLot(lot).find((a) => a.id !== affectation.id && a.dateFin === affectation.dateDebut) || null;
}

export async function supprimerAffectation(lot, affectationId) {
  const affectations = affectationsLot(lot).filter((a) => a.id !== affectationId);
  return updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
}

// Rouvre une distribution refermée (dateFin remise à null) — jamais fait
// automatiquement : c'est un choix explicite proposé après suppression de la
// distribution qui l'avait fermée (cf. ui-rations.js).
export async function rouvrirAffectation(lot, affectationId) {
  const affectations = affectationsLot(lot).map((a) => (a.id === affectationId ? { ...a, dateFin: null } : a));
  return updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
}

// Clôt une distribution encore ouverte à une date donnée (arrêt anticipé,
// sans en ouvrir une nouvelle) — symétrique de lots.js/cloturerPrelevement.
export async function cloturerAffectation(lot, affectationId, dateFin = aujourdhui()) {
  const affectations = affectationsLot(lot).map((a) => (a.id === affectationId ? { ...a, dateFin } : a));
  return updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
}
