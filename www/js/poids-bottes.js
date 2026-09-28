// Poids moyen de botte, paramétrable par aliment (collection lgs_config).
//
// Un stock en bottes n'a pas de poids fixe (chaque récolte a le sien,
// cf. mouvements.js/poidsBotteKg) : cette valeur n'est qu'un poids moyen de
// CONVENANCE, réglable, pour afficher "X bottes restantes" à partir d'un
// tonnage net déjà calculé — jamais utilisé pour calculer le tonnage
// lui-même (qui reste toujours dérivé du journal réel). Un seul document,
// plutôt qu'une collection : c'est un petit réglage global, pas un
// historique. Préfixe lgs_ requis (CLAUDE.md), déjà couvert par le joker
// lgs_.* des règles, rien à publier.
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc, getDoc } from "../vendor/firebase/firebase-firestore.js";

const REF_POIDS_BOTTES = doc(db, 'lgs_config', 'poidsBottesStock');

let poidsBottes = {};
const listenersPoids = new Set();

export function getPoidsBottes() { return poidsBottes; }
export function poidsBotteStock(cle) { return Number(poidsBottes[cle]) || 0; }
export function onPoidsBottesChange(cb) { listenersPoids.add(cb); cb(poidsBottes); return () => listenersPoids.delete(cb); }

export function watchPoidsBottes() {
  return onSnapshot(REF_POIDS_BOTTES, (snap) => {
    poidsBottes = snap.exists() ? (snap.data() || {}) : {};
    listenersPoids.forEach((cb) => cb(poidsBottes));
  });
}

export async function setPoidsBotteStock(cle, poidsKg) {
  if (!cle) throw new Error('Aliment manquant.');
  const p = Number(poidsKg);
  const snap = await getDoc(REF_POIDS_BOTTES);
  const actuel = snap.exists() ? (snap.data() || {}) : {};
  const maj = { ...actuel, [cle]: isFinite(p) && p > 0 ? p : null };
  if (maj[cle] == null) delete maj[cle];
  return setDoc(REF_POIDS_BOTTES, maj);
}
