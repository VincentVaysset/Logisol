// Parc matériel (collection Firestore "lgs_materiel").
//
// Suivi volontairement minimal : ce qui sert vraiment au quotidien, c'est
// savoir quel outil a fait quel chantier, sa largeur de travail, et depuis
// combien de temps il n'a pas été graissé. Tout le reste (heures moteur,
// factures, pièces) serait de la saisie que personne ne tient à jour.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui } from './implantations.js';

const COL = collection(db, 'lgs_materiel');

/**
 * @typedef {object} Materiel
 * @property {string} id
 * @property {string} nom
 * @property {string} [marque]
 * @property {number} [largeurTravailMetres]
 * @property {string} [dateDernierGraissage]   "AAAA-MM-JJ"
 * @property {string} [noteEntretien]
 */

let courants = [];
const listeners = new Set();

export function getMateriels() { return courants; }
export function getMaterielById(id) { return courants.find((m) => m.id === id) || null; }
export function onMaterielsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchMateriels() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true }));
    listeners.forEach((cb) => cb(courants));
  });
}

/** Jours écoulés depuis le dernier graissage, ou null si jamais renseigné. */
export function joursDepuisGraissage(m, date = aujourdhui()) {
  if (!m || !m.dateDernierGraissage) return null;
  const j = Math.round(
    (Date.parse(date + 'T12:00:00') - Date.parse(m.dateDernierGraissage + 'T12:00:00')) / 86400000
  );
  return isFinite(j) ? Math.max(0, j) : null;
}

// Formulation en clair. Aucun seuil d'alerte n'est inventé : la fréquence de
// graissage dépend de l'outil et de l'usage, et une couleur d'alarme posée au
// hasard finirait ignorée. On affiche le fait, l'exploitant juge.
export function graissageLisible(m, date = aujourdhui()) {
  const j = joursDepuisGraissage(m, date);
  if (j === null) return 'jamais renseigné';
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 31) return `il y a ${j} jours`;
  const mois = Math.floor(j / 30.44);
  if (mois < 12) return `il y a ${mois} mois`;
  const ans = Math.floor(mois / 12);
  return ans === 1 ? 'il y a plus d\'un an' : `il y a plus de ${ans} ans`;
}

export function resume(m) {
  const bouts = [];
  if (m.marque) bouts.push(m.marque);
  if (m.largeurTravailMetres) bouts.push(m.largeurTravailMetres + ' m');
  return bouts.join(' · ');
}

function nettoyer(data) {
  const l = Number(data.largeurTravailMetres);
  return {
    nom: String(data.nom || '').trim(),
    marque: String(data.marque || '').trim(),
    largeurTravailMetres: isFinite(l) && l > 0 ? l : null,
    dateDernierGraissage: data.dateDernierGraissage || null,
    noteEntretien: String(data.noteEntretien || '').trim()
  };
}

export async function createMateriel(data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  return addDoc(COL, {
    ...m, creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateMateriel(id, data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  return updateDoc(doc(db, 'lgs_materiel', id), { ...m, majLe: serverTimestamp() });
}

/** Action rapide : « graissé aujourd'hui », en un seul geste. */
export async function validerGraissage(id, date) {
  return updateDoc(doc(db, 'lgs_materiel', id), {
    dateDernierGraissage: date || aujourdhui(),
    majLe: serverTimestamp()
  });
}

export async function deleteMateriel(id) {
  return deleteDoc(doc(db, 'lgs_materiel', id));
}
