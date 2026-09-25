// CRUD Firestore pour la collection "parcelles" — propre à Logisol,
// indépendante des collections d'Ovilog.
//
// C'est ICI, et nulle part ailleurs, que la géométrie change de forme :
// l'appli manipule du GeoJSON standard, Firestore stocke une forme sans
// tableaux imbriqués (voir geometrie.js pour le détail et la raison).
//
// Champ optionnel "releveGps" (préparation RTK, cf. gps.js/releveGpsDepuisFix) :
// { accuracy, fixType, horodatage }, un objet plat — déjà compatible
// Firestore sans rien à adapter ici, createParcelle/updateParcelle le
// laissent simplement passer via "...reste". Absent sur toute parcelle
// dessinée à la main comme aujourd'hui ; à renseigner par un futur écran de
// relevé de contour au GPS/RTK (pas encore construit).
import { db, auth } from './firebase-config.js';
import { geoJsonVersFirestore, firestoreVersGeoJson } from './geometrie.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'parcelles');

// Doc Firestore -> objet parcelle tel que le reste de l'appli l'attend
// (avec "coordonnees" en GeoJSON).
function versParcelle(id, data) {
  const { contour, ...reste } = data;
  const parcelle = { id, ...reste };
  if (contour) {
    parcelle.coordonnees = firestoreVersGeoJson(contour);
  }
  return parcelle;
}

// Objet parcelle -> doc Firestore (géométrie convertie, "coordonnees" retiré
// pour ne jamais tenter d'écrire des tableaux imbriqués).
function versDocument(data) {
  const { coordonnees, ...reste } = data;
  const sortie = { ...reste };
  if (coordonnees) {
    const contour = geoJsonVersFirestore(coordonnees);
    if (!contour) {
      throw new Error("Contour de parcelle illisible : il n'a pas pu être préparé pour l'enregistrement.");
    }
    sortie.contour = contour;
  }
  return sortie;
}

export function watchParcelles(onChange) {
  return onSnapshot(COL, (snap) => {
    const list = [];
    snap.forEach((d) => list.push(versParcelle(d.id, d.data())));
    onChange(list);
  });
}

export async function createParcelle(data) {
  return addDoc(COL, {
    ...versDocument(data),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateParcelle(id, data) {
  return updateDoc(doc(db, 'parcelles', id), {
    ...versDocument(data),
    updatedAt: serverTimestamp()
  });
}

export async function deleteParcelle(id) {
  return deleteDoc(doc(db, 'parcelles', id));
}
