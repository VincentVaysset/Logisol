// Stades physiologiques des brebis (collection Firestore "stades_config").
//
// La liste suit l'ordre réel de l'année sur l'exploitation. Chaque stade
// porte sa RATION JOURNALIÈRE PAR BREBIS, décomposée en COMPOSANTS : un
// fourrage de la ferme, une céréale de la ferme, ou un aliment du commerce
// nommé à la main — chacun avec sa propre dose kg/j/tête. C'est la somme des
// composants, multipliée par l'effectif du lot, qui donne le besoin
// journalier tiré sur les stocks (un par composant, chacun sur son propre
// stock ou, pour le commerce, sans limite de stock puisqu'il est acheté au
// besoin). Les rations sont amorcées à des valeurs de départ puis
// ajustables depuis l'appli — elles varient d'une année et d'un troupeau à
// l'autre, les figer dans le code obligerait à repasser par un build pour
// les corriger.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, getDocs, onSnapshot
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'stades_config');

// "ordre" fige la succession dans l'année : c'est l'axe du tableau croisé, et
// il ne doit pas dépendre de l'ordre d'écriture dans Firestore.
// Chaque stade par défaut démarre avec un seul composant "fourrage" : c'est
// la situation la plus courante, et Vincent ajoute une céréale ou un aliment
// du commerce depuis l'appli le jour où il en a besoin.
const STADES_PAR_DEFAUT = [
  { ordre: 1, nom: 'Début gestation',   couleur: '#8fae7a', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 1.2 }], precision: '' },
  { ordre: 2, nom: 'Milieu gestation',  couleur: '#7ba05b', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 1.4 }], precision: '' },
  { ordre: 3, nom: 'Fin gestation',     couleur: '#5b8c5a', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 2 }],   precision: '' },
  { ordre: 4, nom: 'Début allaitement', couleur: '#c98a3e', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 2.5 }], precision: '15 premiers jours après agnelage' },
  { ordre: 5, nom: 'Fin allaitement',   couleur: '#d4a53f', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 2.5 }], precision: '15 derniers jours — agneaux gardés 1 mois au total' },
  { ordre: 6, nom: 'Début traite',      couleur: '#3f7fa8', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 2.5 }], precision: 'chevauche la fin d\'allaitement, jusqu\'à la mise à l\'herbe (3 premiers mois)' },
  { ordre: 7, nom: 'Pâture',            couleur: '#4f9c5f', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 0.5 }], precision: '15 mars – 15 mai' },
  { ordre: 8, nom: 'Fin de traite',     couleur: '#6b8fa8', composants: [{ id: 'd1', origine: 'fourrage', doseKgParBrebis: 1.5 }], precision: 'jusqu\'à fin juillet' }
].map((s) => ({ ...s, rationKgParBrebis: totalRation(s.composants) }));

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

// Composants d'un stade, avec repli sur l'ancien champ scalaire
// rationKgParBrebis pour les documents écrits avant l'introduction des
// rations multi-ingrédients (aucune migration nécessaire).
export function composantsDuStade(stade) {
  if (!stade) return [];
  if (Array.isArray(stade.composants) && stade.composants.length) return stade.composants;
  const n = Number(stade.rationKgParBrebis) || 0;
  return n > 0 ? [{ id: 'legacy', origine: 'fourrage', doseKgParBrebis: n }] : [];
}

export function totalRation(composants) {
  return Math.round((composants || []).reduce((n, c) => n + (Number(c.doseKgParBrebis) || 0), 0) * 100) / 100;
}

// Remplace la liste des composants d'un stade. rationKgParBrebis reste écrit
// en plus, comme total dérivé : c'est lui que lisent encore les affichages
// rapides (fiche lot, tableau croisé) sans avoir à resommer les composants.
export async function setComposants(stadeId, composants) {
  // Une dose à 0 ou un aliment du commerce encore sans nom ne sont PAS
  // filtrés : c'est l'état transitoire d'un ingrédient qu'on vient d'ajouter
  // et qu'on va compléter dans la foulée. Les filtrer ici ferait disparaître
  // la ligne avant même d'avoir pu la remplir.
  const propres = (composants || []).map((c) => ({
    id: c.id || idComposant(),
    origine: c.origine === 'commerce' ? 'commerce' : (c.origine === 'cereale' ? 'cereale' : 'fourrage'),
    nom: c.origine === 'commerce' ? String(c.nom || '').trim() : null,
    doseKgParBrebis: Math.max(0, Math.round((Number(c.doseKgParBrebis) || 0) * 1000) / 1000)
  }));
  if (!propres.length) throw new Error('La ration doit garder au moins un composant.');
  return updateDoc(doc(db, 'stades_config', stadeId), {
    composants: propres,
    rationKgParBrebis: totalRation(propres)
  });
}

function idComposant() {
  return Math.random().toString(36).slice(2, 9);
}
