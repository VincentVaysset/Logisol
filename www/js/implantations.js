// Implantations : quelle culture est en place sur quelle parcelle, et DEPUIS
// QUAND (collection Firestore "implantations").
//
// POURQUOI CETTE COLLECTION REMPLACE "assolements"
// L'ancien modèle stockait une culture par parcelle et par ANNÉE CALENDAIRE
// (clé "{parcelleId}_2026"). Ça ne colle pas au terrain :
//   * un ray-grass ou une céréale sont semés à l'automne et récoltés l'année
//     SUIVANTE : l'implantation chevauche deux années civiles ;
//   * une luzerne est semée en avril-juin et reste en place 4 à 5 ans : une
//     seule implantation couvre plusieurs années ;
//   * une inter-culture (colza par exemple) peut s'intercaler entre les deux,
//     sur quelques mois seulement.
// Une implantation est donc une PÉRIODE, pas une case dans un calendrier :
//
//   { parcelleId, cultureId, dateSemis: "2025-10-12", dateFin: null }
//
// dateFin === null signifie "toujours en place". Tout le reste — la culture en
// cours, sa durée d'implantation, l'assolement d'une année donnée — se déduit
// de ces périodes, sans rien stocker en double. Conformément à la demande,
// seul le RÉEL est enregistré : il n'y a pas de notion de prévu.
//
// Les dates sont des chaînes "AAAA-MM-JJ" : comparables et triables telles
// quelles, et insensibles au fuseau horaire (contrairement à un Date ou un
// Timestamp, qui peut basculer d'un jour selon l'heure d'enregistrement).
import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL_NAME = 'implantations';
const COL = collection(db, COL_NAME);
const ANCIENNE_COL = collection(db, 'assolements');

let courantes = [];
const listeners = new Set();

export function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Id déterministe : une parcelle ne peut pas recevoir deux semis le même jour.
// Réenregistrer la même implantation la met à jour au lieu de la dupliquer.
function implantationId(parcelleId, dateSemis) {
  return `${parcelleId}_${dateSemis}`;
}

export function getImplantations() {
  return courantes;
}

export function onImplantationsChange(cb) {
  listeners.add(cb);
  cb(courantes);
  return () => listeners.delete(cb);
}

export function watchImplantations() {
  return onSnapshot(COL, (snap) => {
    courantes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(courantes));
  });
}

// Implantation en place sur une parcelle à une date donnée (aujourd'hui par
// défaut) : celle dont la période encadre la date. S'il y en a plusieurs
// (saisie qui se chevauche), on garde la plus récemment semée.
export function implantationEnCours(parcelleId, date = aujourdhui(), liste = courantes) {
  const candidates = liste.filter(
    (i) =>
      i.parcelleId === parcelleId &&
      i.dateSemis &&
      i.dateSemis <= date &&
      (!i.dateFin || i.dateFin >= date)
  );
  if (!candidates.length) return null;
  return candidates.sort((a, b) => (a.dateSemis < b.dateSemis ? 1 : -1))[0];
}

// Durée d'implantation en jours, depuis le semis jusqu'à la date du jour
// (ou jusqu'à dateFin si la culture est terminée).
export function dureeEnJours(implantation, date = aujourdhui()) {
  if (!implantation || !implantation.dateSemis) return null;
  const fin = implantation.dateFin && implantation.dateFin < date ? implantation.dateFin : date;
  const ms = Date.parse(fin + 'T12:00:00') - Date.parse(implantation.dateSemis + 'T12:00:00');
  if (!isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

// "3 ans et 2 mois", "7 mois", "12 jours" — lisible d'un coup d'œil au champ.
export function dureeLisible(implantation, date = aujourdhui()) {
  const jours = dureeEnJours(implantation, date);
  if (jours === null) return '';
  if (jours < 31) return jours <= 1 ? `${jours} jour` : `${jours} jours`;
  const moisTotal = Math.floor(jours / 30.44);
  if (moisTotal < 12) return `${moisTotal} mois`;
  const ans = Math.floor(moisTotal / 12);
  const mois = moisTotal % 12;
  const partAns = ans === 1 ? '1 an' : `${ans} ans`;
  return mois ? `${partAns} et ${mois} mois` : partAns;
}

// Toutes les implantations d'une parcelle, de la plus récente à la plus ancienne.
export function historiqueParcelle(parcelleId, liste = courantes) {
  return liste
    .filter((i) => i.parcelleId === parcelleId)
    .sort((a, b) => (a.dateSemis < b.dateSemis ? 1 : -1));
}

// Enregistre une implantation. Si "cloturerPrecedente" est vrai, l'implantation
// encore ouverte sur cette parcelle est fermée la veille du nouveau semis —
// c'est le cas normal d'une rotation (on retourne pour ressemer).
export async function setImplantation({ parcelleId, cultureId, dateSemis, dateFin = null, notes = '' }, { cloturerPrecedente = true } = {}) {
  if (!parcelleId || !cultureId || !dateSemis) {
    throw new Error('Parcelle, culture et date de semis sont obligatoires.');
  }
  if (dateFin && dateFin < dateSemis) {
    throw new Error('La date de fin ne peut pas précéder la date de semis.');
  }

  if (cloturerPrecedente) {
    const precedente = implantationEnCours(parcelleId, dateSemis);
    if (precedente && precedente.dateSemis !== dateSemis && !precedente.dateFin) {
      await setDoc(
        doc(db, COL_NAME, precedente.id),
        { dateFin: veille(dateSemis) },
        { merge: true }
      );
    }
  }

  const id = implantationId(parcelleId, dateSemis);
  await setDoc(
    doc(db, COL_NAME, id),
    { parcelleId, cultureId, dateSemis, dateFin, notes, majLe: serverTimestamp() },
    { merge: true }
  );
  return id;
}

export async function cloturerImplantation(id, dateFin) {
  await setDoc(doc(db, COL_NAME, id), { dateFin, majLe: serverTimestamp() }, { merge: true });
}

export async function deleteImplantation(id) {
  await deleteDoc(doc(db, COL_NAME, id)).catch(() => {});
}

function veille(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Reprise des anciens assolements (une culture par année civile) sous forme
// d'implantations : la date de semis n'était pas connue, on prend le 1er
// janvier de la campagne. Idempotent — l'id d'implantation est déterministe et
// chaque assolement repris est marqué, donc relancer la migration ne crée ni
// doublon ni écrasement.
export async function migrerAnciensAssolements() {
  let reprises = 0;
  const snap = await getDocs(ANCIENNE_COL).catch(() => null);
  if (!snap) return 0;
  for (const d of snap.docs) {
    const a = d.data();
    if (a.migre || !a.parcelleId || !a.cultureId || !a.campagneId) continue;
    const dateSemis = `${a.campagneId}-01-01`;
    await setDoc(
      doc(db, COL_NAME, implantationId(a.parcelleId, dateSemis)),
      {
        parcelleId: a.parcelleId,
        cultureId: a.cultureId,
        dateSemis,
        dateFin: null,
        notes: a.notes || '',
        repriseDeAssolement: d.id,
        majLe: serverTimestamp()
      },
      { merge: true }
    );
    await setDoc(doc(db, 'assolements', d.id), { migre: true }, { merge: true });
    reprises++;
  }
  return reprises;
}
