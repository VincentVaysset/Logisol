// Mélanges de semis enregistrés (lgs_melanges) : nom + composition en %,
// saisis une fois puis proposés à chaque Semis (ui-intervention.js) et gérés
// dans Paramètres > Mélanges de semis (ui-melanges.js). Le semis garde sa
// propre copie (saisie.semence + saisie.melange) : modifier un mélange plus
// tard ne réécrit jamais l'historique.
import { db } from './firebase-config.js';
import { collection, doc, deleteDoc, onSnapshot, setDoc, serverTimestamp } from '../vendor/firebase/firebase-firestore.js';
import { ecrire } from './ecriture-locale.js';

const COL = collection(db, 'lgs_melanges');
let courants = [];
const ecouteurs = new Set();
let abonne = false;

export const nettoyerComposition = (liste) => (Array.isArray(liste) ? liste : [])
  .map((x) => ({ nom: String((x && x.nom) || '').trim(), pourcentage: Number((x && x.pourcentage) || 0) }))
  .filter((x) => x.nom || x.pourcentage > 0);
const cle = (nom) => String(nom || '').trim().toLowerCase();

export function getMelanges() { return courants; }
export function trouverMelange(nom) { return courants.find((m) => cle(m.nom) === cle(nom)) || null; }
export function onMelangesChange(cb) { ecouteurs.add(cb); cb(courants); return () => ecouteurs.delete(cb); }

export function watchMelanges() {
  if (abonne) return;
  abonne = true;
  onSnapshot(COL, (snap) => {
    courants = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr', { numeric: true }));
    ecouteurs.forEach((cb) => cb(courants));
  });
}

/** Crée, ou met à jour le mélange du même nom (ou celui d'id donné). */
export async function enregistrerMelange({ id = null, nom, composants }) {
  const propre = String(nom || '').trim();
  if (!propre) throw new Error('Donne un nom au mélange.');
  const comp = nettoyerComposition(composants);
  if (!comp.length) throw new Error('Ajoute au moins un composant.');
  const existant = id ? courants.find((m) => m.id === id) : trouverMelange(propre);
  if (id && trouverMelange(propre) && trouverMelange(propre).id !== id) throw new Error(`Un mélange « ${propre} » existe déjà.`);
  const ref = existant ? doc(COL, existant.id) : doc(COL);
  await ecrire(ref, setDoc(ref, { nom: propre, composants: comp, majLe: serverTimestamp() }, { merge: true }), 'Mélange', propre);
  return ref.id;
}

export async function supprimerMelange(id) {
  const ref = doc(COL, id);
  await ecrire(ref, deleteDoc(ref), 'Mélange', `suppression ${id}`);
}

/** « RGI 60 % · TV 40 % » */
export function texteComposition(comp) {
  return nettoyerComposition(comp).map((x) => `${x.nom}${x.pourcentage ? ` ${x.pourcentage} %` : ''}`).join(' · ');
}
