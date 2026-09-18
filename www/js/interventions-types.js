// Types d'intervention (collection Firestore "interventions_types") : liste
// prédéfinie, complétable librement par l'exploitant — même principe que
// cultures_config, un DOCUMENT par type.
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL = collection(db, 'interventions_types');

// "champs" déclare ce que le formulaire affiche pour ce type. Une note n'a ni
// produit ni matériel ni durée : lui présenter ces champs vides à chaque fois
// serait du bruit. Les types personnalisés créés depuis l'appli reçoivent le
// jeu complet.
const COMPLET = ['produit', 'materiel', 'duree', 'meteo'];

export const TYPE_NOTE = 'Note';

const TYPES_PAR_DEFAUT = [
  { nom: 'Note',          icone: '📝', couleur: '#79765f', champs: [] },
  { nom: 'Semis',         icone: '🌱', couleur: '#5b8c5a', champs: COMPLET },
  { nom: 'Épandage',      icone: '💩', couleur: '#8a6d5c', champs: COMPLET },
  { nom: 'Fertilisation', icone: '🧪', couleur: '#c98a3e', champs: COMPLET },
  { nom: 'Traitement',    icone: '⚗️', couleur: '#a8557a', champs: COMPLET },
  { nom: 'Fauche',        icone: '🚜', couleur: '#4f9c5f', champs: COMPLET },
  { nom: 'Fanage',        icone: '☀️', couleur: '#e0a326', champs: COMPLET },
  { nom: 'Andainage',     icone: '🌾', couleur: '#d4a53f', champs: COMPLET },
  { nom: 'Pressage',      icone: '🧻', couleur: '#b98b2f', champs: COMPLET },
  { nom: 'Récolte',       icone: '🌾', couleur: '#c98a3e', champs: COMPLET },
  { nom: 'Pâturage',      icone: '🐑', couleur: '#3f6b3a', champs: ['duree', 'meteo'] },
  { nom: 'Épierrage',     icone: '🪨', couleur: '#79765f', champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Labour',        icone: '🔵', couleur: '#6b5344', champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Travail du sol',icone: '⛏️', couleur: '#8a6d5c', champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Roulage',       icone: '🛞', couleur: '#79765f', champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Irrigation',    icone: '💧', couleur: '#3f7fa8', champs: ['duree', 'meteo'] },
  { nom: 'Observation',   icone: '👁️', couleur: '#79765f', champs: ['meteo'] },
  { nom: 'Autre',         icone: '🔧', couleur: '#9a988f', champs: COMPLET }
];

let courants = [];
const listeners = new Set();

export function getTypes() {
  return courants;
}

export function getTypeById(id) {
  return courants.find((t) => t.id === id) || null;
}

export function onTypesChange(cb) {
  listeners.add(cb);
  cb(courants);
  return () => listeners.delete(cb);
}

// Un type affiche un champ si sa configuration le déclare. Les types créés
// avant l'ajout de "champs" (ou importés à la main) reçoivent le jeu complet
// plutôt que rien : mieux vaut un champ inutile qu'un champ manquant.
export function typeAffiche(type, champ) {
  if (!type) return true;
  if (!Array.isArray(type.champs)) return true;
  return type.champs.includes(champ);
}

export function estNote(type) {
  return !!type && type.nom === TYPE_NOTE;
}

export async function ensureSeeded() {
  const snap = await getDocs(COL);
  if (!snap.empty) return;
  for (const t of TYPES_PAR_DEFAUT) {
    await addDoc(COL, t);
  }
}

export function watchTypes() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ordre(a) - ordre(b) || String(a.nom).localeCompare(String(b.nom), 'fr'));
    listeners.forEach((cb) => cb(courants));
  });
}

// "Note" en tête (c'est la saisie la plus fréquente au champ), puis l'ordre de
// la liste par défaut, puis les types personnalisés à la fin.
function ordre(t) {
  if (t.nom === TYPE_NOTE) return -1;
  const i = TYPES_PAR_DEFAUT.findIndex((d) => d.nom === t.nom);
  return i === -1 ? 999 : i;
}

export async function addType(nom, icone, couleur) {
  const ref = await addDoc(COL, {
    nom,
    icone: icone || '🔧',
    couleur: couleur || '#9a988f',
    champs: COMPLET
  });
  return ref.id;
}
