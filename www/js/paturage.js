// Calendrier de pâturage — données (collections Logisol lgs_paturage_periodes
// et lgs_paturage_exceptions ; règles : joker lgs_ de firestore-logisol.rules).
// Les calculs sont dans paturage-calc.js ; ce module ne fait que lire et
// écrire, hors ligne d'abord (ecrire(), cf. ecriture-locale.js).
import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from '../vendor/firebase/firebase-firestore.js';
import { ecrire } from './ecriture-locale.js';
import { planEntree } from './paturage-calc.js';

const COL_PERIODES = collection(db, 'lgs_paturage_periodes');
const COL_EXCEPTIONS = collection(db, 'lgs_paturage_exceptions');

let periodes = [];
let exceptions = [];
const ecouteurs = new Set();
const prevenir = () => ecouteurs.forEach((cb) => cb());

export function getPeriodes() { return periodes; }
export function getExceptions() { return exceptions; }
export function onPaturageChange(cb) { ecouteurs.add(cb); return () => ecouteurs.delete(cb); }

let abonne = false;
export function watchPaturage() {
  if (abonne) return;
  abonne = true;
  onSnapshot(COL_PERIODES, (snap) => { periodes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); prevenir(); });
  onSnapshot(COL_EXCEPTIONS, (snap) => { exceptions = snap.docs.map((d) => ({ id: d.id, ...d.data() })); prevenir(); });
}

/**
 * Fait entrer un lot sur une parcelle à partir d'une date (cf. planEntree) :
 * la période précédente du lot est close automatiquement.
 */
export async function entrerLot({ lotId, parcelleId, date, heures, dansLaJournee = false }) {
  const plan = planEntree({ periodes, lotId, parcelleId, date, heures, dansLaJournee });
  const taches = [];
  plan.supprimer.forEach((id) => {
    const ref = doc(COL_PERIODES, id);
    taches.push(ecrire(ref, deleteDoc(ref), 'Pâturage', `période remplacée ${id}`));
  });
  plan.modifier.forEach(({ id, champs }) => {
    const ref = doc(COL_PERIODES, id);
    taches.push(ecrire(ref, updateDoc(ref, { ...champs, majLe: serverTimestamp() }), 'Pâturage', `période ${id}`));
  });
  if (plan.creer) {
    const ref = doc(COL_PERIODES);
    taches.push(ecrire(ref, setDoc(ref, { ...plan.creer, creeLe: serverTimestamp(), majLe: serverTimestamp() }), 'Pâturage',
      `entrée ${lotId} sur ${parcelleId} le ${date}`));
  }
  await Promise.all(taches);
  return plan;
}

/** Applique un plan de planSuppression / planArret (paturage-calc.js). */
export async function appliquerPlanPaturage(plan, libelle) {
  const taches = [];
  plan.supprimer.forEach((id) => {
    const ref = doc(COL_PERIODES, id);
    taches.push(ecrire(ref, deleteDoc(ref), 'Pâturage', `${libelle} : période ${id} supprimée`));
  });
  plan.modifier.forEach(({ id, champs }) => {
    const ref = doc(COL_PERIODES, id);
    taches.push(ecrire(ref, updateDoc(ref, { ...champs, majLe: serverTimestamp() }), 'Pâturage', `${libelle} : période ${id}`));
  });
  await Promise.all(taches);
}

const idException = (lotId, date) => `${lotId}_${date}`;

/** Exception du jour pour un lot : « Pas de sortie » ou « Horaire différent », avec un motif. */
export async function noterException({ lotId, date, type, motif, heures = null }) {
  const ref = doc(COL_EXCEPTIONS, idException(lotId, date));
  await ecrire(ref, setDoc(ref, {
    lotId, date, type, motif,
    heureDebut: type === 'HORAIRE' && heures ? heures.debut : null,
    heureFin: type === 'HORAIRE' && heures ? heures.fin : null,
    majLe: serverTimestamp()
  }, { merge: true }), 'Pâturage', `exception ${lotId} ${date}`);
}

/** Météo relevée après coup, jamais bloquante (cf. meteo.js). */
export async function rattacherMeteo(lotId, date, meteo) {
  if (!meteo) return;
  const ref = doc(COL_EXCEPTIONS, idException(lotId, date));
  await ecrire(ref, setDoc(ref, { meteo }, { merge: true }), 'Pâturage', `météo ${date}`);
}

export async function retirerException(lotId, date) {
  const ref = doc(COL_EXCEPTIONS, idException(lotId, date));
  await ecrire(ref, deleteDoc(ref), 'Pâturage', `exception retirée ${lotId} ${date}`);
}
