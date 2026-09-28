// Rations (recettes) : collection Firestore "lgs_rations" — préfixe lgs_
// requis (CLAUDE.md), déjà couvert par le joker lgs_.* des règles, rien à
// publier.
//
// Une ration est une RECETTE NOMMÉE, réutilisable, indépendante du stade
// physiologique (contrairement à stades.js/composantsDuStade, qui reste une
// ration PAR STADE, système séparé et non touché ici — cf. affectations.js
// pour la coexistence des deux). Chaque composant référence un stock
// EXISTANT par sa clé (categorieCle des catégories fusionnées de l'onglet
// Stocks, ou la clé "commerce|..." d'un achat sans contenant suivi comme un
// concentré) — jamais une ressaisie du nom : modifier un stock ailleurs ne
// casse rien ici, et une ration ne peut pas dériver de ce qui existe.
//
// Modifier une ration ne doit JAMAIS changer le passé : c'est pourquoi
// affecter une ration à un lot (cf. affectations.js) en prend un INSTANTANÉ
// (snapshot des composants au moment de l'affectation) plutôt que de garder
// une simple référence à rationId — exactement le même principe que
// stades.js/planifierPeriode, qui fige rationKgParBrebis sur chaque période.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, setDoc, getDoc, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'lgs_rations');

let courantes = [];
const listeners = new Set();

export function getRations() { return courantes; }
export function getRationById(id) { return courantes.find((r) => r.id === id) || null; }
export function onRationsChange(cb) { listeners.add(cb); cb(courantes); return () => listeners.delete(cb); }

export function watchRations() {
  return onSnapshot(COL, (snap) => {
    courantes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    listeners.forEach((cb) => cb(courantes));
  });
}

export function totalRation(composants) {
  return Math.round((composants || []).reduce((n, c) => n + (Number(c.kgParAnimalJour) || 0), 0) * 1000) / 1000;
}

function nettoyerComposants(composants) {
  const propres = (composants || [])
    .map((c) => ({
      id: c.id || idComposant(),
      stockCle: String(c.stockCle || '').trim(),
      stockLabel: String(c.stockLabel || '').trim(),
      kgParAnimalJour: Math.max(0, Math.round((Number(c.kgParAnimalJour) || 0) * 1000) / 1000)
    }))
    .filter((c) => c.stockCle && c.kgParAnimalJour > 0);
  if (!propres.length) throw new Error('La ration doit avoir au moins un composant avec un stock choisi et une dose.');
  return propres;
}

export async function createRation({ nom, composants }) {
  if (!nom || !nom.trim()) throw new Error('Donne un nom à la ration.');
  const propres = nettoyerComposants(composants);
  const ref = await addDoc(COL, {
    nom: nom.trim(),
    composants: propres,
    creeLe: serverTimestamp(),
    majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
  return ref.id;
}

export async function updateRation(id, { nom, composants }) {
  if (!nom || !nom.trim()) throw new Error('Donne un nom à la ration.');
  const propres = nettoyerComposants(composants);
  return updateDoc(doc(db, 'lgs_rations', id), {
    nom: nom.trim(),
    composants: propres,
    majLe: serverTimestamp()
  });
}

export async function deleteRation(id) {
  return deleteDoc(doc(db, 'lgs_rations', id));
}

function idComposant() {
  return Math.random().toString(36).slice(2, 9);
}

// --- Poids moyen de botte, paramétrable par stock ---------------------------
// Un stock en bottes n'a pas de poids fixe (chaque récolte a le sien,
// cf. mouvements.js/poidsBotteKg) : cette valeur n'est qu'un poids moyen de
// CONVENANCE, réglable, pour afficher "X bottes restantes" à partir d'un
// tonnage net déjà calculé — jamais utilisé pour calculer le tonnage
// lui-même (qui reste toujours dérivé du journal réel). Un seul document,
// plutôt qu'une collection : c'est un petit réglage global, pas un historique.
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
  if (!cle) throw new Error('Stock manquant.');
  const p = Number(poidsKg);
  const snap = await getDoc(REF_POIDS_BOTTES);
  const actuel = snap.exists() ? (snap.data() || {}) : {};
  const maj = { ...actuel, [cle]: isFinite(p) && p > 0 ? p : null };
  if (maj[cle] == null) delete maj[cle];
  return setDoc(REF_POIDS_BOTTES, maj);
}
