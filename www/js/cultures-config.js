// Liste des cultures (collection Firestore "cultures_config", un DOCUMENT
// par culture — remplace l'ancien "parcelles_config/typesUsage" qui était
// un doc unique avec un tableau). Chaque culture a son propre id Firestore,
// référencé par assolements.cultureId.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, getDocs, onSnapshot
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'cultures_config');

// Palette par nuances : chaque espèce de prairie garde SA couleur propre
// (vue détaillée de la carte), toutes rattachées à la même famille 'prairie'
// pour la vue regroupée (cf. vocation.js/FAMILLE_COULEUR, qui fixe alors
// #059669 — même émeraude que le reste du design system). Les céréales
// partagent une seule teinte ambre : leur distinction utile se fait par le
// nom, pas par la couleur.
const DEFAULT_CULTURES = [
  { nom: 'RG Trèfle',              couleur: '#059669', famille: 'prairie' },  // vert émeraude
  { nom: 'Luzerne',                couleur: '#10b981', famille: 'prairie' },  // vert jade / anis
  { nom: 'Prairie permanente',     couleur: '#65a30d', famille: 'prairie' },  // vert olive
  { nom: 'Fétuque / Trèfle',       couleur: '#047857', famille: 'prairie' },  // vert sapin
  { nom: 'Blé tendre',             couleur: '#d97706', famille: 'cereale' },  // jaune ambre
  { nom: 'Orge',                   couleur: '#d97706', famille: 'cereale' },
  { nom: 'Colza',                  couleur: '#a8b83f', famille: 'oleagineux' },
  { nom: 'Autre',                  couleur: '#9a988f', famille: 'autre' }
];

let currentCultures = []; // [{id, nom, couleur, famille}]
const listeners = new Set();

export function getCultures() {
  return currentCultures;
}

export function onCulturesChange(cb) {
  listeners.add(cb);
  cb(currentCultures);
  return () => listeners.delete(cb);
}

export function getCultureById(id) {
  return currentCultures.find((c) => c.id === id) || null;
}

// Seede les 6 cultures par défaut si la collection est vide (premier lancement).
export async function ensureSeeded() {
  const snap = await getDocs(COL);
  if (snap.empty) {
    for (const c of DEFAULT_CULTURES) {
      await addDoc(COL, c);
    }
  }
}

export function watchCultures() {
  return onSnapshot(COL, (snap) => {
    currentCultures = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(currentCultures));
  });
}

export async function addCulture(nom, couleur, famille) {
  const ref = await addDoc(COL, { nom, couleur, famille: famille || 'autre' });
  return ref.id;
}
