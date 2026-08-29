// Liste modulable des types d'usage (pâture / fauche / culture par défaut),
// stockée dans Firestore (collection "parcelles_config", doc "typesUsage")
// pour rester synchronisée entre appareils. Collection propre à Logisol.
import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CONFIG_DOC = doc(db, 'parcelles_config', 'typesUsage');

const DEFAULT_TYPES = [
  { nom: 'Pâture', couleur: '#5a9968' },
  { nom: 'Fauche', couleur: '#e0a326' },
  { nom: 'Culture', couleur: '#3c7a4e' }
];

let currentTypes = DEFAULT_TYPES;
const listeners = new Set();

export function getTypes() {
  return currentTypes;
}

export function onTypesChange(cb) {
  listeners.add(cb);
  cb(currentTypes);
  return () => listeners.delete(cb);
}

export async function ensureSeeded() {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    await setDoc(CONFIG_DOC, { types: DEFAULT_TYPES });
  }
}

export function watchTypes() {
  return onSnapshot(CONFIG_DOC, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    currentTypes = (data && Array.isArray(data.types) && data.types.length)
      ? data.types
      : DEFAULT_TYPES;
    listeners.forEach((cb) => cb(currentTypes));
  });
}

export async function addOrUpdateType(nom, couleur) {
  const types = currentTypes.filter((t) => t.nom !== nom);
  types.push({ nom, couleur });
  await setDoc(CONFIG_DOC, { types });
}

export async function removeType(nom) {
  const types = currentTypes.filter((t) => t.nom !== nom);
  await setDoc(CONFIG_DOC, { types });
}

export function colorForType(nom) {
  const t = currentTypes.find((t) => t.nom === nom);
  return t ? t.couleur : '#888888';
}
