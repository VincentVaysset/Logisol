// Stades physiologiques des brebis (collection Firestore "stades_config").
//
// La liste suit l'ordre réel de l'année sur l'exploitation, et chaque stade
// porte SA RATION JOURNALIÈRE PAR BREBIS : c'est elle qui, multipliée par
// l'effectif du lot, donne le besoin journalier tiré sur les stocks.
// Les rations sont amorcées à des valeurs de départ puis ajustables depuis
// l'appli — elles varient d'une année et d'un troupeau à l'autre, les figer
// dans le code obligerait à repasser par un build pour les corriger.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, getDocs, onSnapshot
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'stades_config');

// "ordre" fige la succession dans l'année : c'est l'axe du tableau croisé, et
// il ne doit pas dépendre de l'ordre d'écriture dans Firestore.
const STADES_PAR_DEFAUT = [
  { ordre: 1, nom: 'Début gestation',   couleur: '#8fae7a', rationKgParBrebis: 1.2, precision: '' },
  { ordre: 2, nom: 'Milieu gestation',  couleur: '#7ba05b', rationKgParBrebis: 1.4, precision: '' },
  { ordre: 3, nom: 'Fin gestation',     couleur: '#5b8c5a', rationKgParBrebis: 2,   precision: '' },
  { ordre: 4, nom: 'Début allaitement', couleur: '#c98a3e', rationKgParBrebis: 2.5, precision: '15 premiers jours après agnelage' },
  { ordre: 5, nom: 'Fin allaitement',   couleur: '#d4a53f', rationKgParBrebis: 2.5, precision: '15 derniers jours — agneaux gardés 1 mois au total' },
  { ordre: 6, nom: 'Début traite',      couleur: '#3f7fa8', rationKgParBrebis: 2.5, precision: 'chevauche la fin d\'allaitement, jusqu\'à la mise à l\'herbe (3 premiers mois)' },
  { ordre: 7, nom: 'Pâture',            couleur: '#4f9c5f', rationKgParBrebis: 0.5, precision: '15 mars – 15 mai' },
  { ordre: 8, nom: 'Fin de traite',     couleur: '#6b8fa8', rationKgParBrebis: 1.5, precision: 'jusqu\'à fin juillet' }
];

let courants = [];
const listeners = new Set();

export function getStades() {
  return courants;
}

export function getStadeById(id) {
  return courants.find((s) => s.id === id) || null;
}

export function onStadesChange(cb) {
  listeners.add(cb);
  cb(courants);
  return () => listeners.delete(cb);
}

export async function ensureSeeded() {
  const snap = await getDocs(COL);
  if (!snap.empty) return;
  for (const s of STADES_PAR_DEFAUT) await addDoc(COL, s);
}

export function watchStades() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.ordre || 99) - (b.ordre || 99));
    listeners.forEach((cb) => cb(courants));
  });
}

export async function setRation(stadeId, rationKgParBrebis) {
  const n = Number(rationKgParBrebis);
  if (!isFinite(n) || n < 0) throw new Error('Ration invalide.');
  return updateDoc(doc(db, 'stades_config', stadeId), { rationKgParBrebis: n });
}
