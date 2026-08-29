// CRUD Firestore pour la collection "parcelles" — propre à Logisol,
// indépendante des collections d'Ovilog.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL = collection(db, 'parcelles');

export function watchParcelles(onChange) {
  return onSnapshot(COL, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    onChange(list);
  });
}

export async function createParcelle(data) {
  return addDoc(COL, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateParcelle(id, data) {
  return updateDoc(doc(db, 'parcelles', id), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function deleteParcelle(id) {
  return deleteDoc(doc(db, 'parcelles', id));
}
