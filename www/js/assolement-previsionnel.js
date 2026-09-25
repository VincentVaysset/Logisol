// Assolement prévisionnel (collection Firestore "lgs_assolement_previsionnel").
//
// POURQUOI UNE COLLECTION À PART DES IMPLANTATIONS
// Les implantations (implantations.js) disent ce qui POUSSE — du réel daté,
// semis et fin. Le prévisionnel dit ce qu'on PRÉVOIT, campagne par campagne,
// dans le vocabulaire du dossier UNOTEC : « Luz 3 », « RG trèfle 2 »,
// « Blé 1 ». Mélanger les deux ferait passer un plan pour un fait, et un aléa
// (une luzerne retournée plus tôt que prévu) obligerait à réécrire
// l'historique. Le tableau montre donc le prévu, et rappelle à côté ce qui
// est réellement en place pour que les écarts se voient.
//
// Un document = une parcelle × une campagne, id déterministe
// "{parcelleId}_{campagne}" : ressaisir une case la met à jour au lieu de la
// dupliquer. Préfixe lgs_ : couvert par la règle Firestore générique, rien à
// publier.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, setDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const NOM_COL = 'lgs_assolement_previsionnel';
const COL = collection(db, NOM_COL);

// --- Référentiel des cultures, avec leur âge ------------------------------
// L'âge fait partie de la culture dans le dossier : une luzerne de 1ʳᵉ année
// ne se conduit pas comme une luzerne de 5ᵉ année (rendement, retournement
// en vue). « 0 » désigne l'année du semis.

export const FAMILLES = [
  { value: 'CEREALES',       label: 'Céréales' },
  { value: 'LUZERNE',        label: 'Luzerne' },
  { value: 'PRAIRIE_COURTE', label: 'Prairie courte durée' },
  { value: 'PN',             label: 'Prairie naturelle' },
  { value: 'SEMIS_PRAIRIE',  label: 'Semis de prairies' },
  { value: 'AUTRE',          label: 'Autre' }
];

/**
 * @typedef {object} CulturePrev
 * @property {string} code
 * @property {string} label
 * @property {string} famille
 * @property {string} [fourrage]  type de fourrage récolté (lien vers les récoltes)
 * @property {string} [grain]     code grain (lien vers la moisson)
 * @property {string} [suivante]  code de l'année suivante si rien ne change
 */
const luz = (n) => ({
  code: 'LUZ' + n, label: 'Luz ' + n, famille: n === 0 ? 'SEMIS_PRAIRIE' : 'LUZERNE',
  fourrage: 'Luzerne', suivante: n < 5 ? 'LUZ' + (n + 1) : null
});
const rgt = (n) => ({
  code: 'RGT' + n, label: n === 0 ? 'RG 0' : 'RG trèfle ' + n,
  famille: n === 0 ? 'SEMIS_PRAIRIE' : 'PRAIRIE_COURTE',
  fourrage: 'RG trèfle', suivante: n < 3 ? 'RGT' + (n + 1) : null
});
const cer = (code, label, grain, suivante = null) =>
  ({ code, label, famille: 'CEREALES', grain, suivante });

export const CULTURES_PREV = [
  luz(0), luz(1), luz(2), luz(3), luz(4), luz(5),
  rgt(0), rgt(1), rgt(2), rgt(3),
  { code: 'PN', label: 'PN', famille: 'PN', fourrage: 'Prairie naturelle', suivante: 'PN' },
  cer('BLE1', 'Blé 1', 'BLE'), cer('BLE2', 'Blé 2', 'BLE'),
  cer('ORGE1', 'Orge 1', 'ORGE'), cer('ORGE2', 'Orge 2', 'ORGE'),
  cer('TRITICALE1', 'Triticale 1', 'TRITICALE'), cer('TRITICALE2', 'Triticale 2', 'TRITICALE'),
  cer('AVOINE', 'Avoine', 'AVOINE'), cer('METEIL', 'Méteil', 'METEIL'),
  { code: 'AUTRE', label: 'Autre', famille: 'AUTRE' }
];

export function culturePrev(code) {
  return CULTURES_PREV.find((c) => c.code === code) || null;
}

// --- Lecture ----------------------------------------------------------------
let courants = [];
const listeners = new Set();

export function getPrevisions() { return courants; }
export function onPrevisionsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchPrevisions() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(courants));
  });
}

export function prevision(parcelleId, campagne, liste = courants) {
  return liste.find((p) => p.parcelleId === parcelleId && String(p.campagne) === String(campagne)) || null;
}

export function campagneCourante() {
  return String(new Date().getFullYear());
}

/**
 * Proposition logique pour l'année suivante : une luzerne vieillit d'un an,
 * un RG trèfle aussi, une PN reste une PN. Une céréale n'a pas de suite
 * évidente — c'est un choix d'assolement, pas une déduction.
 */
export function suiteNaturelle(code) {
  const c = culturePrev(code);
  return c && c.suivante ? c.suivante : null;
}

// --- Écriture ---------------------------------------------------------------
function nombreOuNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * Met à jour UNE case de la prévision d'une parcelle pour une campagne.
 * Écriture partielle (merge) : modifier la chaux ne touche pas à la culture.
 */
export async function setPrevision(parcelleId, campagne, champs) {
  if (!parcelleId || !campagne) throw new Error('Parcelle et campagne obligatoires.');
  const maj = { parcelleId, campagne: String(campagne), majLe: serverTimestamp(),
                majPar: auth.currentUser ? auth.currentUser.uid : null };
  if ('cultureCode' in champs) maj.cultureCode = champs.cultureCode || null;
  // Dose par hectare, comme la chaux : le tonnage à épandre se déduit de la
  // surface plutôt que d'être saisi à part, et ne diverge donc jamais d'elle.
  if ('fumierTHa' in champs) maj.fumierTHa = nombreOuNull(champs.fumierTHa);
  if ('chauxTHa' in champs) maj.chauxTHa = nombreOuNull(champs.chauxTHa);
  return setDoc(doc(db, NOM_COL, `${parcelleId}_${campagne}`), maj, { merge: true });
}

// --- Synthèse par famille ---------------------------------------------------
/**
 * Surfaces par famille et par culture pour une campagne.
 * @param {Array<{id:string, surfaceHa:number}>} parcelles
 * @returns {{parCode:Map<string,number>, parFamille:Map<string,number>,
 *            nonRenseigne:number, total:number}}
 */
export function syntheseSurfaces(parcelles, campagne, liste = courants) {
  const parCode = new Map();
  const parFamille = new Map();
  let nonRenseigne = 0;
  let total = 0;
  parcelles.forEach((p) => {
    const ha = Number(p.surfaceHa) || 0;
    total += ha;
    const prev = prevision(p.id, campagne, liste);
    const c = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    if (!c) { nonRenseigne += ha; return; }
    parCode.set(c.code, (parCode.get(c.code) || 0) + ha);
    parFamille.set(c.famille, (parFamille.get(c.famille) || 0) + ha);
  });
  const r = (v) => Math.round(v * 100) / 100;
  parCode.forEach((v, k) => parCode.set(k, r(v)));
  parFamille.forEach((v, k) => parFamille.set(k, r(v)));
  return { parCode, parFamille, nonRenseigne: r(nonRenseigne), total: r(total) };
}
