// Lots d'animaux (collection "lots_animaux") et historique des prélèvements
// sur les stocks (collection "prelevements").
//
// POURQUOI UN HISTORIQUE PLUTÔT QU'UN SIMPLE CHAMP « stock utilisé »
// Le choix du stock est manuel et change en cours de saison (« cette semaine
// on tape dans la 2ᵉ coupe »). Si le lot ne portait qu'un champ écrasable, le
// jour où Vincent bascule du stock A vers le stock B, tout ce que le lot a
// déjà consommé sur A disparaîtrait du calcul : le stock A paraîtrait intact
// et le stock B aurait l'air de nourrir le troupeau depuis toujours. Chaque
// affectation est donc une PÉRIODE — même principe que les implantations.
//
// Chaque période fige la ration et l'effectif du moment. Un lot qui change de
// stade ou dont on corrige l'effectif ne doit pas réécrire rétroactivement ce
// qui a déjà été consommé : ce qui est mangé est mangé.
//
// Convention de dates : "debut" est inclus, "fin" est EXCLUE. Le jour où l'on
// bascule d'un stock à l'autre compte donc pour le nouveau, jamais deux fois.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { aujourdhui } from './implantations.js';

const COL_LOTS = collection(db, 'lots_animaux');
const COL_PREL = collection(db, 'prelevements');

let lots = [];
let prelevements = [];
const listenersLots = new Set();
const listenersPrel = new Set();

export function getLots() { return lots; }
export function getPrelevements() { return prelevements; }

export function onLotsChange(cb) { listenersLots.add(cb); cb(lots); return () => listenersLots.delete(cb); }
export function onPrelevementsChange(cb) { listenersPrel.add(cb); cb(prelevements); return () => listenersPrel.delete(cb); }

export function watchLots() {
  return onSnapshot(COL_LOTS, (snap) => {
    lots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listenersLots.forEach((cb) => cb(lots));
  });
}

export function watchPrelevements() {
  return onSnapshot(COL_PREL, (snap) => {
    prelevements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listenersPrel.forEach((cb) => cb(prelevements));
  });
}

export function prelevementEnCours(lotId, liste = prelevements) {
  return liste.find((p) => p.lotId === lotId && !p.fin) || null;
}

export function historiqueLot(lotId, liste = prelevements) {
  return liste
    .filter((p) => p.lotId === lotId)
    .sort((a, b) => (a.debut < b.debut ? 1 : -1));
}

// Nombre de jours effectivement nourris par une période, à une date donnée.
// fin exclue ; une période ouverte court jusqu'à aujourd'hui inclus.
export function joursNourris(prel, date = aujourdhui()) {
  if (!prel || !prel.debut) return 0;
  const finExclue = prel.fin ? prel.fin : lendemain(date);
  const j = Math.round(
    (Date.parse(finExclue + 'T12:00:00') - Date.parse(prel.debut + 'T12:00:00')) / 86400000
  );
  return Math.max(0, isFinite(j) ? j : 0);
}

export function tonnesConsommees(prel, date = aujourdhui()) {
  const kg = (Number(prel.rationKgParBrebis) || 0) * (Number(prel.nbBrebis) || 0) * joursNourris(prel, date);
  return Math.round((kg / 1000) * 1000) / 1000;
}

export function besoinJournalierKg(prel) {
  return (Number(prel.rationKgParBrebis) || 0) * (Number(prel.nbBrebis) || 0);
}

function lendemain(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Écriture -------------------------------------------------------------
export async function createLot({ nom, nbBrebis, stadeId, notes = '' }) {
  if (!nom || !nom.trim()) throw new Error('Donne un nom au lot.');
  const n = Number(nbBrebis);
  if (!isFinite(n) || n <= 0) throw new Error('Le nombre de brebis doit être supérieur à 0.');
  const ref = await addDoc(COL_LOTS, {
    nom: nom.trim(), nbBrebis: n, stadeId: stadeId || null, notes,
    creeLe: serverTimestamp(), majLe: serverTimestamp()
  });
  return ref.id;
}

export async function updateLot(id, { nom, nbBrebis, stadeId, notes = '' }) {
  const n = Number(nbBrebis);
  if (!isFinite(n) || n <= 0) throw new Error('Le nombre de brebis doit être supérieur à 0.');
  return updateDoc(doc(db, 'lots_animaux', id), {
    nom: String(nom || '').trim(), nbBrebis: n, stadeId: stadeId || null, notes,
    majLe: serverTimestamp()
  });
}

export async function deleteLot(id) {
  // Les prélèvements du lot partent avec lui : sans ça, ils continueraient à
  // amputer les stocks au nom d'un lot qui n'existe plus.
  const aSupprimer = prelevements.filter((p) => p.lotId === id);
  await deleteDoc(doc(db, 'lots_animaux', id));
  for (const p of aSupprimer) {
    await deleteDoc(doc(db, 'prelevements', p.id)).catch(() => {});
  }
}

/**
 * Affecte (ou réaffecte) un lot à une catégorie de stock à partir d'une date.
 * Clôture la période en cours à cette même date : le jour de bascule est
 * compté pour le nouveau stock, jamais pour les deux.
 *
 * Passer categorieCle à null arrête simplement le prélèvement (lot à l'herbe,
 * lot dissous) sans en ouvrir de nouveau.
 */
export async function affecterStock(lot, { categorieCle, categorieLabel, stade, debut }) {
  const date = debut || aujourdhui();
  const enCours = prelevementEnCours(lot.id);

  if (enCours) {
    const memeStock = enCours.categorieCle === categorieCle;
    const memeRation = Number(enCours.rationKgParBrebis) === Number(stade ? stade.rationKgParBrebis : 0);
    const memeEffectif = Number(enCours.nbBrebis) === Number(lot.nbBrebis);
    const memeDebut = enCours.debut === date;
    if (memeStock && memeRation && memeEffectif && memeDebut) return enCours.id; // rien n'a changé
  }

  // On fait place nette à partir de la date choisie, sur TOUTES les périodes
  // du lot et pas seulement celle en cours.
  //
  // Motif : la date de début est saisissable, donc antidatable (« en fait on a
  // basculé lundi dernier »). Se contenter de clôturer la période ouverte à
  // cette date produisait une période inversée — reproduit en test : une
  // période « 18 sept. → 15 sept. · 0 j » apparaissait dans l'historique. Et
  // antidater plus loin encore aurait fait se chevaucher deux périodes, donc
  // compté deux fois les mêmes journées sur deux stocks différents.
  //   * une période qui COMMENCE à/après la date n'a plus lieu d'être ;
  //   * une période qui l'ENJAMBE est tronquée à cette date (fin exclue).
  for (const p of historiqueLot(lot.id)) {
    if (p.debut >= date) {
      await deleteDoc(doc(db, 'prelevements', p.id)).catch(() => {});
    } else if (!p.fin || p.fin > date) {
      await updateDoc(doc(db, 'prelevements', p.id), { fin: date, majLe: serverTimestamp() });
    }
  }

  if (!categorieCle) return null;

  const ref = await addDoc(COL_PREL, {
    lotId: lot.id,
    lotNom: lot.nom,
    categorieCle,
    categorieLabel: categorieLabel || '',
    stadeId: stade ? stade.id : null,
    stadeNom: stade ? stade.nom : '',
    // Instantané délibéré : ce qui a déjà été consommé ne doit pas bouger si
    // la ration du stade ou l'effectif du lot est modifié plus tard.
    rationKgParBrebis: stade ? Number(stade.rationKgParBrebis) || 0 : 0,
    nbBrebis: Number(lot.nbBrebis) || 0,
    debut: date,
    fin: null,
    creeLe: serverTimestamp(),
    majLe: serverTimestamp()
  });
  return ref.id;
}

export async function cloturerPrelevement(id, fin) {
  return setDoc(doc(db, 'prelevements', id), { fin: fin || aujourdhui(), majLe: serverTimestamp() }, { merge: true });
}

export async function deletePrelevement(id) {
  return deleteDoc(doc(db, 'prelevements', id)).catch(() => {});
}
