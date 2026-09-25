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
} from "../vendor/firebase/firebase-firestore.js";

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
  // Comparaison stricte mais forcée en chaîne : un id de parcelle est
  // toujours une chaîne côté Firestore, mais un appelant qui l'aurait fait
  // transiter par un attribut DOM ou un paramètre numérique ne doit jamais
  // silencieusement échouer à retrouver l'implantation en cours.
  const cible = String(parcelleId);
  const candidates = liste.filter(
    (i) =>
      String(i.parcelleId) === cible &&
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
  const cible = String(parcelleId);
  return liste
    .filter((i) => String(i.parcelleId) === cible)
    .sort((a, b) => (a.dateSemis < b.dateSemis ? 1 : -1));
}

// À quelle campagne appartient un semis, d'après sa seule date — jamais
// demandé à l'exploitant : convention agricole standard, un semis d'automne
// (août à décembre) fait la campagne de l'année SUIVANTE (il pousse pour la
// récolte/pâture de l'an prochain), le reste de l'année fait celle en cours.
// C'est ce qui distingue, sans aucune case à remplir, un RG trèfle semé en
// septembre 2026 (campagne 2027) d'un blé semé en mars 2026 (campagne 2026).
export function campagneDeSemis(dateSemis) {
  const m = String(dateSemis || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const annee = Number(m[1]);
  const mois = Number(m[2]);
  return String(mois >= 8 ? annee + 1 : annee);
}

// Enregistre une implantation. Si "cloturerPrecedente" est vrai, l'implantation
// encore ouverte sur cette parcelle est fermée la veille du nouveau semis —
// c'est le cas normal d'une rotation (on retourne pour ressemer). La campagne
// (campagneVisee) est déduite automatiquement de dateSemis : c'est ce qui
// permet à l'assolement prévisionnel de rattacher un semis d'automne à la
// bonne case sans jamais faire deviner une année à l'exploitant
// (cf. ui-assolement.js/cultureReelle).
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
    { parcelleId, cultureId, dateSemis, dateFin, notes, campagneVisee: campagneDeSemis(dateSemis), majLe: serverTimestamp() },
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

// Reprise des implantations qu'une activité DETRUIT (Moisson, Déchaumage,
// Labour, Vibroculteur) aurait dû clôturer mais n'a jamais fermées — le cas
// vécu par la parcelle "Celies" : son type d'intervention portait, au
// moment de la saisie, un nom légèrement différent du type par défaut (ex.
// une casse ou un espace différents) et n'avait donc pas encore
// effetCulture: 'DETRUIT' (cf. interventions-types.js/ensureSeeded, corrigé
// pour reconnaître ces doublons). La correction du type ne rouvre pas le
// passé tout seul : les activités DÉJÀ enregistrées avant ce correctif
// n'ont jamais appelé cloturerImplantation. Cette reprise le fait a
// posteriori, à la date exacte de l'activité qui aurait dû le faire.
// Idempotente : une implantation déjà fermée (par cette reprise, par une
// activité plus récente, ou manuellement) n'est plus jamais retouchée.
export async function migrerImplantationsNonCloturees() {
  const [snapImpl, snapItv, snapTypes] = await Promise.all([
    getDocs(COL).catch(() => null),
    getDocs(collection(db, 'interventions')).catch(() => null),
    getDocs(collection(db, 'interventions_types')).catch(() => null)
  ]);
  if (!snapImpl || !snapItv || !snapTypes) return 0;

  const typesDetruit = new Set(
    snapTypes.docs.filter((d) => d.data().effetCulture === 'DETRUIT').map((d) => d.id)
  );
  // Les interventions déjà closes par le premier passage de cette boucle
  // doivent compter pour les suivantes (même parcelle, plusieurs activités
  // DETRUIT successives) : liste locale, mise à jour au fil de l'eau plutôt
  // que rechargée depuis Firestore à chaque itération.
  let implantationsLocales = snapImpl.docs.map((d) => ({ id: d.id, ...d.data() }));
  const enCoursLocal = (parcelleId, date) => {
    const cible = String(parcelleId);
    const candidats = implantationsLocales.filter(
      (i) => String(i.parcelleId) === cible && i.dateSemis && i.dateSemis <= date && !i.dateFin
    );
    if (!candidats.length) return null;
    return candidats.sort((a, b) => (a.dateSemis < b.dateSemis ? 1 : -1))[0];
  };

  // Traitées de la plus ancienne à la plus récente : c'est la PREMIÈRE
  // activité DETRUIT qui doit clôturer une implantation encore ouverte, pas
  // la dernière — sinon une série (déchaumage puis labour, par exemple)
  // fermerait l'implantation trop tard.
  const detruitTriees = snapItv.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((itv) => itv.cibleType === 'PARCELLE' && itv.statut === 'TERMINE' &&
      itv.date && typesDetruit.has(itv.typeId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let corrigees = 0;
  for (const itv of detruitTriees) {
    for (const parcelleId of itv.parcelleIds || []) {
      const impl = enCoursLocal(parcelleId, itv.date);
      if (!impl) continue;
      await cloturerImplantation(impl.id, itv.date);
      impl.dateFin = itv.date; // reflété localement pour les itérations suivantes
      corrigees++;
    }
  }
  return corrigees;
}
