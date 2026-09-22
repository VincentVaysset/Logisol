// Emplacements de fourrage (collection Firestore "emplacements_fourrage") :
// travées de hangar, aires de stockage.
//
// L'unité de stock est LA BOTTE, pas la tonne — c'est ce qui se compte
// réellement dans un hangar. Le tonnage s'en déduit.
//
// poidsMoyenBotteKg : il a été établi que le poids d'une botte varie à chaque
// récolte et ne doit pas avoir de valeur fixe par défaut. Ce champ n'est donc
// PAS une constante saisie à la main : c'est la MOYENNE PONDÉRÉE des poids
// réellement saisis sur les entrées de cet emplacement, recalculée à chaque
// mouvement (voir mouvements.js). Elle ne sert qu'à convertir en tonnes le
// stock présent ; chaque entrée garde, elle, le poids exact de ses bottes.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL = collection(db, 'emplacements_fourrage');

/**
 * @typedef {object} EmplacementFourrage
 * @property {string} id
 * @property {string} batimentId
 * @property {string} nom                  ex: "Hangar Sud - Travée 1"
 * @property {import('./batiments.js').TypeFourrage} typeFourrage
 * @property {number} nbBottesActuel       dérivé des mouvements
 * @property {number} poidsMoyenBotteKg    moyenne pondérée des entrées
 */

let courants = [];
const listeners = new Set();

export function getEmplacements() { return courants; }
export function getEmplacementById(id) { return courants.find((e) => e.id === id) || null; }
export function emplacementsDuBatiment(batimentId, liste = courants) {
  return liste.filter((e) => e.batimentId === batimentId);
}
export function onEmplacementsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchEmplacements() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true }));
    listeners.forEach((cb) => cb(courants));
  });
}

export function tonnes(emplacement, nbBottes) {
  const n = nbBottes != null ? nbBottes : Number(emplacement.nbBottesActuel) || 0;
  const kg = Number(emplacement.poidsMoyenBotteKg) || 0;
  return Math.round((n * kg) / 1000 * 1000) / 1000;
}

function nettoyer(data) {
  return {
    batimentId: data.batimentId || null,
    nom: String(data.nom || '').trim(),
    typeFourrage: data.typeFourrage || 'FOIN'
  };
}

export async function createEmplacement(data) {
  const e = nettoyer(data);
  if (!e.nom) throw new Error("Donne un nom à l'emplacement.");
  if (!e.batimentId) throw new Error("L'emplacement doit appartenir à un bâtiment.");
  return addDoc(COL, {
    ...e,
    nbBottesActuel: 0,
    poidsMoyenBotteKg: 0,
    creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateEmplacement(id, data) {
  const e = nettoyer(data);
  if (!e.nom) throw new Error("Donne un nom à l'emplacement.");
  return updateDoc(doc(db, 'emplacements_fourrage', id), { ...e, majLe: serverTimestamp() });
}

// Écrit le niveau et la moyenne recalculés depuis le journal. Appelé par
// mouvements.js uniquement.
export async function setNiveau(id, nbBottes, poidsMoyenBotteKg) {
  return updateDoc(doc(db, 'emplacements_fourrage', id), {
    nbBottesActuel: Math.round(Number(nbBottes) || 0),
    poidsMoyenBotteKg: Math.round((Number(poidsMoyenBotteKg) || 0) * 10) / 10,
    majLe: serverTimestamp()
  });
}

export async function deleteEmplacement(id) {
  return deleteDoc(doc(db, 'emplacements_fourrage', id));
}
