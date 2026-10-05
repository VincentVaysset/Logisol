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
import { verifierDateModifiable } from './verrou-campagne.js';
import { ecrire } from './ecriture-locale.js';
import { joursEffectifs } from './plafond-calc.js';

// Consommation plafonnée au stock (plafond-calc.js / plafond-conso.js) :
// fourni par main.js, pour ne pas faire dépendre ce module du journal des
// stocks (dépendance circulaire). Sans fournisseur : consommation brute.
let fournisseurPlafonds = null;
export function setFournisseurPlafonds(fn) { fournisseurPlafonds = fn; }
function manquesCourants() {
  try { return fournisseurPlafonds ? fournisseurPlafonds() : null; } catch (_) { return null; }
}

// Rations : n'attendre que la file locale (hors réseau, « Changer la ration »
// restait sinon suspendu jusqu'au retour du réseau).
function ecrireAffectations(lot, affectations) {
  const ref = doc(db, 'lots_animaux', lot.id);
  return ecrire(ref, updateDoc(ref, { affectations, majLe: serverTimestamp() }), 'Ration');
}

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

function veille(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// À l'écran, la fin d'une ration est son DERNIER JOUR nourri (inclus) : c'est
// ce qu'on tape naturellement (« jusqu'au 30/09 »). En base, dateFin reste
// EXCLUE (le lendemain), convention de tout le calcul. Ces deux fonctions
// sont le seul passage entre les deux.
export function dernierJour(dateFinExclue) { return dateFinExclue ? veille(dateFinExclue) : null; }
export function finExclueDe(dernierJourInclus) { return dernierJourInclus ? lendemain(dernierJourInclus) : null; }

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

// Jours nourris d'un composant sur [debut, finExclue) : les jours où son
// aliment manquait ne comptent que pour la part réellement couverte.
function joursNourris(composant, debut, finExclue) {
  if (!debut || !finExclue || finExclue <= debut) return 0;
  const m = manquesCourants();
  if (m) return joursEffectifs(m, composant.stockCle, debut, finExclue);
  return Math.round((Date.parse(finExclue + 'T12:00:00') - Date.parse(debut + 'T12:00:00')) / 86400000);
}

// Tonnes consommées par UN composant d'une distribution, jusqu'à une date
// (plafonnées au stock disponible, cf. plafond-calc.js).
export function tonnesComposant(aff, composant, date = aujourdhui()) {
  if (!aff || !aff.dateDebut) return 0;
  const nb = Number(aff.nbBrebis) || 0;
  const plafond = lendemain(date);
  const fin = aff.dateFin && aff.dateFin < plafond ? aff.dateFin : plafond;
  const kg = nb * (Number(composant.kgParAnimalJour) || 0) * joursNourris(composant, aff.dateDebut, fin);
  return Math.round((kg / 1000) * 1000) / 1000;
}

// Même calcul, borné à une fenêtre de campagne Stocks/Troupeau (01/09-31/08,
// cf. campagne-stock.js) : une ration qui chevauche le 31/08 est coupée au
// prorata des jours tombant de chaque côté.
export function tonnesComposantFenetre(aff, composant, fenetre, date = aujourdhui()) {
  if (!aff || !aff.dateDebut || !fenetre) return 0;
  const nb = Number(aff.nbBrebis) || 0;
  // [debut, fin) ∩ [01/09, 31/08] ∩ jusqu'à date (même bornes que joursDansFenetre).
  const debut = aff.dateDebut > fenetre.debut ? aff.dateDebut : fenetre.debut;
  let fin = lendemain(fenetre.fin);
  if (date && lendemain(date) < fin) fin = lendemain(date);
  if (aff.dateFin && aff.dateFin < fin) fin = aff.dateFin;
  const kg = nb * (Number(composant.kgParAnimalJour) || 0) * joursNourris(composant, debut, fin);
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
/**
 * Rations du lot après une nouvelle distribution, SANS rien écrire (sert aussi
 * à contrôler le stock avant d'enregistrer) : ferme la distribution encore
 * ouverte à dateDebut, ajoute la nouvelle.
 */
export function affectationsApresDistribution(lot, { composants = [], dateDebut, dateFin = null }) {
  const debut = dateDebut || aujourdhui();
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
  return { affectations: actuelles.concat([nouvelle]), nouvelle };
}

export async function distribuerRation(lot, { composants = [], dateDebut, dateFin = null }) {
  if (!lot || !lot.id) throw new Error('Lot introuvable.');
  const debut = dateDebut || aujourdhui();
  if (dateFin && dateFin <= debut) throw new Error('La date de fin doit être postérieure à la date de début.');
  // Changer la ration modifie la consommation à partir de son début (et clôt
  // la précédente à cette date) : interdit dans une campagne clôturée.
  verifierDateModifiable(debut, 'les rations');
  const { affectations, nouvelle } = affectationsApresDistribution(lot, { composants, dateDebut: debut, dateFin });
  await ecrireAffectations(lot, affectations);
  return nouvelle;
}

/**
 * « Reporter » un aliment épuisé, SANS rien écrire : la ration d'origine se
 * termine le jour D où l'aliment a manqué ; une nouvelle ration démarre à D,
 * identique sauf l'aliment épuisé, remplacé (même kg/j par défaut).
 * @param {{stockCle, stockLabel, kgParAnimalJour}} remplacement
 */
export function affectationsApresReport(lot, affectationId, cleEpuisee, date, remplacement) {
  const aff = affectationsLot(lot).find((a) => a.id === affectationId);
  if (!aff) throw new Error('Ration introuvable.');
  if (!remplacement || !remplacement.stockCle || !(Number(remplacement.kgParAnimalJour) > 0)) {
    throw new Error("Choisis l'aliment de remplacement et sa dose.");
  }
  const composants = [];
  composantsAffectation(aff).forEach((c) => { if (c.stockCle !== cleEpuisee) composants.push({ ...c }); });
  const deja = composants.find((c) => c.stockCle === remplacement.stockCle);
  if (deja) deja.kgParAnimalJour = Math.round((Number(deja.kgParAnimalJour) + Number(remplacement.kgParAnimalJour)) * 1000) / 1000;
  else composants.push({ stockCle: remplacement.stockCle, stockLabel: remplacement.stockLabel, kgParAnimalJour: Number(remplacement.kgParAnimalJour) });
  if (date <= aff.dateDebut) {
    return affectationsLot(lot).map((a) => (a.id === aff.id ? { ...a, composants } : a));
  }
  const suite = { ...aff, id: idAffectation(), dateDebut: date, dateFin: aff.dateFin || null, composants,
    reportDe: aff.id, creeLe: new Date().toISOString() };
  delete suite.snapshot;
  return affectationsLot(lot).map((a) => (a.id === aff.id ? { ...a, dateFin: date } : a)).concat([suite]);
}

function jjmm(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }

/**
 * Rations du lot après modification d'une période (dates, composants), SANS
 * rien écrire. Refuse un chevauchement avec une autre période du même lot.
 * @param {{dateDebut:string, dateFin:string|null, composants:Array}} modif
 */
export function affectationsApresModification(lot, affectationId, { dateDebut, dateFin = null, composants = [] }) {
  const aff = affectationsLot(lot).find((a) => a.id === affectationId);
  if (!aff) throw new Error('Ration introuvable.');
  if (!dateDebut) throw new Error('La date de début est obligatoire.');
  if (dateFin && dateFin <= dateDebut) throw new Error('Le dernier jour ne peut pas précéder le premier.');
  const autre = affectationsLot(lot).find((a) => a.id !== aff.id &&
    a.dateDebut < (dateFin || '9999-12-31') && dateDebut < (a.dateFin || '9999-12-31'));
  if (autre) {
    throw new Error(`Chevauche la ration ${autre.dateFin ? `du ${jjmm(autre.dateDebut)} au ${jjmm(veille(autre.dateFin))}` : `ouverte depuis le ${jjmm(autre.dateDebut)}`} : deux rations d'un même lot ne peuvent pas se superposer.`);
  }
  const propres = (composants || [])
    .filter((c) => c.stockCle && Number(c.kgParAnimalJour) > 0)
    .map((c) => ({ stockCle: c.stockCle, stockLabel: c.stockLabel, kgParAnimalJour: Number(c.kgParAnimalJour) || 0 }));
  return affectationsLot(lot).map((a) => {
    if (a.id !== aff.id) return a;
    const m = { ...a, dateDebut, dateFin: dateFin || null, composants: propres, modifieLe: new Date().toISOString() };
    delete m.snapshot;
    return m;
  });
}

/** La période [debut, fin) contient-elle un 31/08 → 01/09 ? Renvoie l'année du 31/08, ou null. */
export function traverse31Aout(debut, finExclue) {
  if (!debut) return null;
  const an = Number(debut.slice(0, 4));
  for (let y = an; y <= an + 50; y++) {
    const pivot = `${y}-08-31`;
    if (pivot < debut) continue;
    // Le 31/08 est dans la période ET le 01/09 aussi (fin exclue > 01/09).
    if (!finExclue || finExclue > `${y}-09-01`) return y;
    return null;
  }
  return null;
}

/** Écrit un jeu de rations déjà calculé, après le verrou de campagne (date la plus ancienne touchée). */
export async function enregistrerAffectations(lot, affectations, dateTouchee) {
  if (dateTouchee) verifierDateModifiable(dateTouchee, 'les rations');
  return ecrireAffectations(lot, affectations);
}

export async function reporterComposant(lot, affectationId, cleEpuisee, date, remplacement) {
  verifierDateModifiable(date, 'les rations');
  return ecrireAffectations(lot, affectationsApresReport(lot, affectationId, cleEpuisee, date, remplacement));
}

// La distribution que "affectation" a fermée en démarrant (sa dateDebut est
// la dateFin de la précédente) — celle-là même que supprimerAffectation() ne
// rouvre jamais toute seule (cf. en-tête de fichier).
export function precedenteFermeePar(lot, affectation) {
  if (!affectation) return null;
  return affectationsLot(lot).find((a) => a.id !== affectation.id && a.dateFin === affectation.dateDebut) || null;
}

export async function supprimerAffectation(lot, affectationId) {
  const a = affectationsLot(lot).find((x) => x.id === affectationId);
  if (a) verifierDateModifiable(a.dateDebut, 'cette ration');
  const affectations = affectationsLot(lot).filter((a) => a.id !== affectationId);
  return ecrireAffectations(lot, affectations);
}

// Rouvre une distribution refermée (dateFin remise à null) — jamais fait
// automatiquement : c'est un choix explicite proposé après suppression de la
// distribution qui l'avait fermée (cf. ui-rations.js).
export async function rouvrirAffectation(lot, affectationId) {
  const a = affectationsLot(lot).find((x) => x.id === affectationId);
  if (a && a.dateFin) verifierDateModifiable(a.dateFin, 'cette ration');
  const affectations = affectationsLot(lot).map((a) => (a.id === affectationId ? { ...a, dateFin: null } : a));
  return ecrireAffectations(lot, affectations);
}

// Clôt une distribution encore ouverte à une date donnée (arrêt anticipé,
// sans en ouvrir une nouvelle) — symétrique de lots.js/cloturerPrelevement.
export async function cloturerAffectation(lot, affectationId, dateFin = aujourdhui()) {
  verifierDateModifiable(dateFin, 'cette ration');
  const affectations = affectationsLot(lot).map((a) => (a.id === affectationId ? { ...a, dateFin } : a));
  return ecrireAffectations(lot, affectations);
}
