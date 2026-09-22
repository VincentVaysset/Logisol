// Bâtiments de l'exploitation (collection Firestore "batiments") : bergeries,
// silos à grain, hangars à fourrage, ou bâtiments mixtes.
//
// NOTE SUR LE TYPAGE
// Le schéma reçu était écrit en TypeScript. Logisol est, depuis sa
// conception, du HTML/CSS/JS pur sans bundler ni étape de build : introduire
// TypeScript imposerait une compilation avant chaque `cap sync`, donc un
// maillon de plus entre une correction et l'APK sur la tablette. Les mêmes
// contrats sont donc exprimés en JSDoc — mêmes noms de champs, mêmes valeurs
// d'énumération, vérifiés par l'éditeur, sans rien ajouter à la chaîne de
// build.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL = collection(db, 'batiments');

/** @typedef {'BERGERIE'|'STOCKAGE_GRAIN'|'STOCKAGE_FOURRAGE'|'MIXTE'} TypeBatiment */
/** @typedef {'ORGE'|'TRITICALE'|'MAIS'|'ALIMENT_COMPLET'|'AUTRE'} TypeGrain */
/** @typedef {'FOIN'|'ENRUBANNAGE'|'PAILLE'|'SILAGE'|'AUTRE'} TypeFourrage */

/**
 * @typedef {object} Batiment
 * @property {string} id
 * @property {string} nom
 * @property {TypeBatiment} type
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {string} [remarques]
 */

export const TYPES_BATIMENT = [
  { value: 'BERGERIE',           label: 'Bergerie',            icone: '🐑', couleur: '#8a6d5c' },
  { value: 'STOCKAGE_GRAIN',     label: 'Stockage grain',      icone: '🌾', couleur: '#c98a3e' },
  { value: 'STOCKAGE_FOURRAGE',  label: 'Stockage fourrage',   icone: '🧻', couleur: '#5b8c5a' },
  { value: 'MIXTE',              label: 'Mixte',               icone: '🏚️', couleur: '#79765f' }
];

export const TYPES_GRAIN = [
  { value: 'ORGE',            label: 'Orge' },
  { value: 'TRITICALE',       label: 'Triticale' },
  { value: 'MAIS',            label: 'Maïs' },
  { value: 'ALIMENT_COMPLET', label: 'Aliment complet' },
  { value: 'AUTRE',           label: 'Autre' }
];

export const TYPES_FOURRAGE = [
  { value: 'FOIN',         label: 'Foin' },
  { value: 'ENRUBANNAGE',  label: 'Enrubannage' },
  { value: 'PAILLE',       label: 'Paille' },
  { value: 'SILAGE',       label: 'Ensilage' },
  { value: 'AUTRE',        label: 'Autre' }
];

export function typeBatiment(value) {
  return TYPES_BATIMENT.find((t) => t.value === value) || TYPES_BATIMENT[3];
}
export function labelGrain(value) {
  const t = TYPES_GRAIN.find((x) => x.value === value);
  return t ? t.label : '—';
}
export function labelFourrage(value) {
  const t = TYPES_FOURRAGE.find((x) => x.value === value);
  return t ? t.label : '—';
}

// Un bâtiment de stockage grain (ou mixte) peut porter des cellules ;
// un bâtiment fourrage (ou mixte) des emplacements ; une bergerie des lots.
// C'est ce qui pilote l'affichage : ne pas proposer « ajouter une cellule »
// sur une bergerie évite des contenants orphelins et illisibles.
export function accepteCellules(b) {
  return b && (b.type === 'STOCKAGE_GRAIN' || b.type === 'MIXTE');
}
export function accepteFourrage(b) {
  return b && (b.type === 'STOCKAGE_FOURRAGE' || b.type === 'MIXTE');
}
export function accepteLots(b) {
  return b && (b.type === 'BERGERIE' || b.type === 'MIXTE');
}

let courants = [];
const listeners = new Set();

export function getBatiments() { return courants; }
export function getBatimentById(id) { return courants.find((b) => b.id === id) || null; }
export function onBatimentsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchBatiments() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    listeners.forEach((cb) => cb(courants));
  });
}

function nettoyer(data) {
  const b = {
    nom: String(data.nom || '').trim(),
    type: data.type || 'MIXTE',
    remarques: data.remarques || ''
  };
  // latitude/longitude sont optionnelles : un bâtiment non pointé sur la
  // carte reste parfaitement utilisable pour le stockage.
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  b.latitude = isFinite(lat) && Math.abs(lat) <= 90 && data.latitude !== '' && data.latitude != null ? lat : null;
  b.longitude = isFinite(lon) && Math.abs(lon) <= 180 && data.longitude !== '' && data.longitude != null ? lon : null;
  return b;
}

export async function createBatiment(data) {
  const b = nettoyer(data);
  if (!b.nom) throw new Error('Donne un nom au bâtiment.');
  return addDoc(COL, { ...b, creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null });
}

export async function updateBatiment(id, data) {
  const b = nettoyer(data);
  if (!b.nom) throw new Error('Donne un nom au bâtiment.');
  return updateDoc(doc(db, 'batiments', id), { ...b, majLe: serverTimestamp() });
}

export async function deleteBatiment(id) {
  return deleteDoc(doc(db, 'batiments', id));
}
