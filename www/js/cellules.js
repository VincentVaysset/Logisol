// Cellules à grain (collection Firestore "cellules_grain") : les silos.
//
// quantiteActuelleTonnes est DÉRIVÉE du journal des mouvements, jamais saisie
// directement. Motif : un niveau stocké que l'on peut modifier à la main d'un
// côté et par un mouvement de l'autre finit toujours par diverger, et rien
// n'indique alors laquelle des deux valeurs est la bonne. Ici le journal fait
// foi ; le champ du document n'est qu'un cache réécrit à chaque mouvement,
// pour que la valeur reste lisible depuis la console Firebase.
// Une correction de re-comptage passe par un mouvement d'inventaire — ainsi
// l'écart apparaît dans l'historique au lieu d'être effacé.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'lgs_cellules_grain');

/**
 * @typedef {object} CelluleGrain
 * @property {string} id
 * @property {string} batimentId
 * @property {string} nom                       ex: "Silo 1"
 * @property {number} capaciteMaxTonnes
 * @property {'GRAIN'|'FOURRAGE'} [contenu]     grain, ou fourrage séché en grange
 * @property {import('./batiments.js').TypeGrain|import('./batiments.js').TypeFourrage} [typeGrainActuel]
 * @property {number} quantiteActuelleTonnes    dérivée des mouvements
 */

// Une cellule est un contenant qui se compte EN TONNES. Deux usages réels sur
// l'exploitation : le silo à grain, et la cellule de séchage en grange où le
// foin rentre en vrac à la remorque. Même mécanique de niveau, seul le
// contenu diffère — d'où ce champ plutôt qu'un second type de contenant, qui
// aurait dupliqué tout le journal des mouvements.
export const CONTENUS_CELLULE = [
  { value: 'GRAIN',    label: 'Grain (silo)' },
  { value: 'FOURRAGE', label: 'Fourrage (séchage en grange)' }
];

export function contenuDe(c) { return (c && c.contenu) || 'GRAIN'; }
export function estCelluleGrain(c) { return contenuDe(c) === 'GRAIN'; }
export function estCelluleFourrage(c) { return contenuDe(c) === 'FOURRAGE'; }

// Mot court accolé au nom d'une cellule partout où les deux sortes
// apparaissent dans la même liste. Sans lui, « Cellule 1 » et « Cellule 2 »
// ne disent pas si on y met de l'orge ou du foin.
export function motContenu(c) { return estCelluleFourrage(c) ? 'séchage' : 'grain'; }
export function iconeContenu(c) { return estCelluleFourrage(c) ? '🌿' : '🌾'; }

let courantes = [];
const listeners = new Set();

export function getCellules() { return courantes; }
export function getCelluleById(id) { return courantes.find((c) => c.id === id) || null; }
export function cellulesDuBatiment(batimentId, liste = courantes) {
  return liste.filter((c) => c.batimentId === batimentId);
}
export function onCellulesChange(cb) { listeners.add(cb); cb(courantes); return () => listeners.delete(cb); }

export function watchCellules() {
  return onSnapshot(COL, (snap) => {
    courantes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true }));
    listeners.forEach((cb) => cb(courantes));
  });
}

// Taux de remplissage, borné à 100 % pour l'affichage mais la valeur brute
// reste accessible : un dépassement de capacité doit se voir, pas se cacher.
export function tauxRemplissage(cellule, quantite) {
  const q = quantite != null ? quantite : Number(cellule.quantiteActuelleTonnes) || 0;
  const max = Number(cellule.capaciteMaxTonnes) || 0;
  if (max <= 0) return null;
  // Entier : la jauge donne déjà la précision visuelle, et « 50,6 % » à côté
  // de « 40 % » dans la même liste se lit moins bien que deux entiers.
  return Math.round((q / max) * 100);
}

function nettoyer(data) {
  const max = Number(data.capaciteMaxTonnes);
  return {
    batimentId: data.batimentId || null,
    nom: String(data.nom || '').trim(),
    capaciteMaxTonnes: isFinite(max) && max > 0 ? max : 0,
    contenu: data.contenu === 'FOURRAGE' ? 'FOURRAGE' : 'GRAIN',
    typeGrainActuel: data.typeGrainActuel || null
  };
}

export async function createCellule(data) {
  const c = nettoyer(data);
  if (!c.nom) throw new Error('Donne un nom à la cellule.');
  if (!c.batimentId) throw new Error('La cellule doit appartenir à un bâtiment.');
  if (!c.capaciteMaxTonnes) throw new Error('Indique la capacité maximale en tonnes.');
  return addDoc(COL, {
    ...c,
    quantiteActuelleTonnes: 0,   // toute quantité de départ passe par un
                                 // mouvement d'inventaire initial
    creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateCellule(id, data) {
  const c = nettoyer(data);
  if (!c.nom) throw new Error('Donne un nom à la cellule.');
  return updateDoc(doc(db, 'lgs_cellules_grain', id), { ...c, majLe: serverTimestamp() });
}

// Écrit le niveau recalculé depuis le journal. Appelé par mouvements.js, et
// par personne d'autre.
export async function setQuantite(id, tonnes, typeGrainActuel) {
  const maj = { quantiteActuelleTonnes: Math.round((Number(tonnes) || 0) * 1000) / 1000, majLe: serverTimestamp() };
  if (typeGrainActuel !== undefined) maj.typeGrainActuel = typeGrainActuel;
  return updateDoc(doc(db, 'lgs_cellules_grain', id), maj);
}

export async function deleteCellule(id) {
  return deleteDoc(doc(db, 'lgs_cellules_grain', id));
}
