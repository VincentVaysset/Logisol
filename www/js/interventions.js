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
} from "../vendor/firebase/firebase-firestore.js";

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
    // cibleType : les parcelleIds désignent des parcelles OU des bergeries
    // selon ce champ. Un seul tableau plutôt que deux évite d'avoir à traiter
    // partout le cas « les deux sont remplis ».
    cibleType: data.cibleType || 'PARCELLE',
    // 'TERMINE' par défaut : au champ, on saisit ce qu'on vient de faire.
    statut: data.statut === 'A_FAIRE' ? 'A_FAIRE' : 'TERMINE',
    // Mouvement de stock engendré par cette activité, s'il y en a un.
    mouvementId: data.mouvementId || null,
    // INTENTION de mouvement, conservée même quand aucun mouvement n'existe.
    //
    // Une activité « À faire » ne doit rien bouger dans les stocks, mais ce
    // qu'on a prévu (58 t vers le Silo 1) doit être retrouvé tel quel le jour
    // où on la passe à « Terminé ». Sans ce champ, tout ce qui avait été saisi
    // à l'étape 3 était perdu à la réouverture : c'est l'activité qui porte
    // l'intention, le mouvement n'en est que la conséquence sur le stock.
    flux: data.flux || null,
    produit: data.produit || '',
    quantite: data.quantite === '' || data.quantite == null ? null : Number(data.quantite),
    unite: data.unite || '',
    materiel: data.materiel || '',
    materielId: data.materielId || null,
    materielNom: data.materielNom || '',
    dureeHeures: data.dureeHeures === '' || data.dureeHeures == null ? null : Number(data.dureeHeures),
    meteo: data.meteo || null,                         // objet plat, cf. meteo.js
    photo: data.photo || null,                         // data URL JPEG compressée
    // Étiquette de semence : photo distincte de la photo de chantier, gardée
    // comme pièce justificative en cas de contrôle Bio.
    photoEtiquette: data.photoEtiquette || null,
    // En-tête commun à toutes les interventions.
    campagneId: data.campagneId ? String(data.campagneId) : null,
    chauffeur: String(data.chauffeur || '').trim(),
    // Ce que l'activité a fait à la culture en place, et de quoi le défaire
    // si elle est supprimée : sans cette trace, effacer un labour saisi par
    // erreur laisserait l'assolement détruit pour toujours.
    effetCulture: nettoyerEffetCulture(data.effetCulture),
    // Saisie propre au groupe d'activité (bottes, bennes, remorques, dose...).
    // Un sous-objet plutôt qu'une douzaine de champs à plat : les clés
    // dépendent du type, et les étaler rendrait chaque document illisible.
    saisie: nettoyerSaisie(data.saisie),
    notes: data.notes || ''
  };
}

// Firestore refuse `undefined` et les tableaux imbriqués : on ne garde que
// des nombres, des chaînes, et un tableau d'objets plats pour le mélange.
function nettoyerSaisie(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const nombre = (k) => {
    const v = s[k];
    if (v === '' || v == null) return;
    const n = Number(v);
    if (isFinite(n)) out[k] = n;
  };
  const texte = (k) => {
    const v = String(s[k] == null ? '' : s[k]).trim();
    if (v) out[k] = v;
  };
  ['doseKgHa', 'surfaceHa', 'nbBottes', 'poidsBotteKg', 'nbRemorques',
   'tonnesParRemorque', 'nbBennes', 'tonnageBenne', 'poidsSpecifique',
   'nbEpandeurs', 'tonnageEpandeur', 'doseTonnesHa', 'numeroCoupe'].forEach(nombre);
  ['semence', 'typeFourrage', 'cultureId'].forEach(texte);
  if (Array.isArray(s.melange)) {
    const m = s.melange
      .map((x) => ({ nom: String((x && x.nom) || '').trim(), pourcentage: Number((x && x.pourcentage) || 0) }))
      .filter((x) => x.nom || x.pourcentage > 0);
    if (m.length) out.melange = m;
  }
  return Object.keys(out).length ? out : null;
}

function nettoyerEffetCulture(e) {
  if (!e || typeof e !== 'object') return null;
  const cloturees = Array.isArray(e.cloturees)
    ? e.cloturees
        .map((c) => ({ id: String((c && c.id) || ''), finPrecedente: (c && c.finPrecedente) || null }))
        .filter((c) => c.id)
    : [];
  const creees = Array.isArray(e.creees) ? e.creees.map(String).filter(Boolean) : [];
  if (!cloturees.length && !creees.length) return null;
  return { cloturees, creees };
}

/** Total calculé d'une saisie de récolte, dans l'unité du contenant visé. */
export function quantiteDeSaisie(formulaire, s) {
  if (!s) return null;
  const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
  if (formulaire === 'PRESSAGE') return n(s.nbBottes) || null;
  if (formulaire === 'SECHAGE')  return arrondi3(n(s.nbRemorques) * n(s.tonnesParRemorque)) || null;
  if (formulaire === 'MOISSON')  return arrondi3(n(s.nbBennes) * n(s.tonnageBenne)) || null;
  if (formulaire === 'FUMIER')   return arrondi3(n(s.nbEpandeurs) * n(s.tonnageEpandeur)) || null;
  return null;
}

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

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
