// Journal d'interventions (collection Firestore "interventions").
//
// Une intervention porte sur UNE OU PLUSIEURS parcelles : un épandage couvre
// souvent tout un secteur, et le ressaisir parcelle par parcelle serait à la
// fois pénible et faux (la durée et la quantité concernent le chantier
// entier). Le champ parcelleIds est donc toujours un tableau, même pour une
// seule parcelle — un tableau de chaînes, ce que Firestore accepte sans
// réserve (contrairement aux tableaux imbriqués, cf. geometrie.js).
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL = collection(db, 'interventions');

// Tri du plus récent au plus ancien, toutes parcelles mélangées : c'est le fil
// d'activité de l'écran d'accueil. À date égale, la saisie la plus récente
// passe devant.
function parDateDecroissante(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = msDe(a.creeLe);
  const tb = msDe(b.creeLe);
  return tb - ta;
}

function msDe(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

export function watchInterventions(onChange) {
  return onSnapshot(COL, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort(parDateDecroissante);
    onChange(list);
  });
}

function nettoyer(data) {
  return {
    date: data.date,                                   // "AAAA-MM-JJ"
    typeId: data.typeId || null,
    typeNom: data.typeNom || '',                       // copie figée : le fil
                                                       // reste lisible même si
                                                       // le type est renommé
    parcelleIds: Array.isArray(data.parcelleIds) ? data.parcelleIds.slice() : [],
    produit: data.produit || '',
    quantite: data.quantite === '' || data.quantite == null ? null : Number(data.quantite),
    unite: data.unite || '',
    materiel: data.materiel || '',
    dureeHeures: data.dureeHeures === '' || data.dureeHeures == null ? null : Number(data.dureeHeures),
    meteo: data.meteo || null,                         // objet plat, cf. meteo.js
    photo: data.photo || null,                         // data URL JPEG compressée
    notes: data.notes || ''
  };
}

export async function createIntervention(data) {
  if (!data.date) throw new Error('La date est obligatoire.');
  return addDoc(COL, {
    ...nettoyer(data),
    creeLe: serverTimestamp(),
    majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateIntervention(id, data) {
  return updateDoc(doc(db, 'interventions', id), {
    ...nettoyer(data),
    majLe: serverTimestamp()
  });
}

export async function deleteIntervention(id) {
  return deleteDoc(doc(db, 'interventions', id));
}
