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

// Poids/botte effectif pour un aliment : le réglage manuel s'il existe,
// sinon la moyenne des entrées déjà comptées (tonnes/bottes des récoltes) —
// seule source PARTAGÉE (Stocks ET Troupeau), pour ne jamais recalculer deux
// fois deux chiffres différents. `categories` est la sortie de
// fourrages.fusionnerCategories() (gross entries, seule porteuse de
// nbBottes) ; le tonnage utilisé pour un compte de bottes affiché doit lui
// TOUJOURS venir du stock net, jamais d'ici (cf. en-tête de fichier).
export function poidsBotteEffectif(categories, cle) {
  const cat = (categories || []).find((c) => c.cle === cle);
  const moyenneCalculee = cat && cat.nbBottes > 0 ? Math.round((cat.tonnes * 1000) / cat.nbBottes) : 0;
  return poidsBotteStock(cle) || moyenneCalculee;
}
