// PS (poids spécifique) par défaut, mémorisé par espèce de céréale — un
// document unique (collection "lgs_config", déjà couverte par le joker
// lgs_.* des règles Firestore, aucun déploiement de règles nécessaire).
//
// Sert uniquement à PRÉ-REMPLIR le champ PS à la prochaine moisson de la
// même espèce ; la valeur reste modifiable à chaque saisie (cf.
// ui-intervention.js) — ce n'est qu'une commodité, jamais une source de
// vérité que la saisie ne pourrait pas corriger.
import { db } from './firebase-config.js';
import { doc, setDoc, onSnapshot, serverTimestamp } from '../vendor/firebase/firebase-firestore.js';
import { ecrire } from './ecriture-locale.js';

const REF = doc(db, 'lgs_config', 'psDefauts');

let courants = {};
const listeners = new Set();

export function getPsDefauts() { return courants; }
export function onPsDefautsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchPsDefauts() {
  return onSnapshot(REF, (snap) => {
    courants = (snap.exists() && snap.data().valeurs) || {};
    listeners.forEach((cb) => cb(courants));
  });
}

/** PS par défaut (t/m³) mémorisé pour cette espèce, ou null si aucun. */
export function psDefautDe(typeAliment) {
  return typeAliment && courants[typeAliment] != null ? courants[typeAliment] : null;
}

/** Mémorise le PS (t/m³, déjà normalisé) pour la prochaine saisie de cette
 * espèce. Appelé après l'enregistrement d'une moisson, jamais bloquant pour
 * elle : un échec ici ne doit pas empêcher l'activité d'être sauvegardée. */
export async function setPsDefaut(typeAliment, psTonnesM3) {
  if (!typeAliment || psTonnesM3 == null) return;
  await ecrire(REF, setDoc(REF, { valeurs: { ...courants, [typeAliment]: psTonnesM3 }, majLe: serverTimestamp() }, { merge: true }), 'PS par défaut');
}
