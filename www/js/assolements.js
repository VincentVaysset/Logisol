// Historique culture/campagne (collection Firestore "assolements") : un doc
// par (parcelle, campagne), id déterministe "{parcelleId}_{campagneId}" pour
// que la mise à jour / suppression soit directe (pas besoin de requête).
import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL_NAME = 'assolements';

// Campagne agricole = année calendaire en cours, pas de sélecteur pour l'instant.
export function getCampagneActuelle() {
  return new Date().getFullYear().toString();
}

function assolementId(parcelleId, campagneId) {
  return `${parcelleId}_${campagneId}`;
}

export function watchAssolements(campagneId, onChange) {
  return onSnapshot(collection(db, COL_NAME), (snap) => {
    const list = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.campagneId === campagneId) list.push({ id: d.id, ...data });
    });
    onChange(list);
  });
}

// Crée ou met à jour l'assolement de la campagne en cours pour une parcelle.
// Préserve creeLe si l'assolement existait déjà (upsert propre).
export async function setAssolement(parcelleId, campagneId, cultureId) {
  const ref = doc(db, COL_NAME, assolementId(parcelleId, campagneId));
  const existing = await getDoc(ref);
  const data = { parcelleId, campagneId, cultureId, dateSemis: null, notes: '' };
  if (!existing.exists()) {
    data.creeLe = serverTimestamp();
  }
  await setDoc(ref, data, { merge: true });
}

// Supprime l'assolement de la campagne en cours pour une parcelle, s'il existe
// (vocation basculée vers bâtiment/bois/autre).
export async function deleteAssolement(parcelleId, campagneId) {
  const ref = doc(db, COL_NAME, assolementId(parcelleId, campagneId));
  await deleteDoc(ref).catch(() => {}); // no-op si déjà absent
}
