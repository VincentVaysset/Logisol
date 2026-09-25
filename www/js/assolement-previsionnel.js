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
  collection, doc, setDoc, getDocs, onSnapshot, serverTimestamp
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
  { value: 'FETUQUE',        label: 'Fétuque / Trèfle' },
  { value: 'PN',             label: 'Prairie naturelle' },
  { value: 'SEMIS_PRAIRIE',  label: 'Semis de prairies' },
  { value: 'AUTRE',          label: 'Autre' }
];

// Regroupement « vue macro / PAC » : deux familles de prairie, pas une —
// Prairie Permanente (PN, jamais retournée, pas de compteur d'âge) et
// Prairie Temporaire (luzerne, RG trèfle, fétuque/trèfle, semis de l'année :
// semées, retournées au bout de quelques années, compteur d'âge 0/1/2...).
// Les confondre masquerait la vraie question d'assolement (combien de PT à
// ressemer cette année ?) — cf. ui-assolement.js, bascule Détaillée/Regroupée.
export const GROUPE_DE_FAMILLE = {
  PN: 'PRAIRIE_PERMANENTE',
  LUZERNE: 'PRAIRIE_TEMPORAIRE', PRAIRIE_COURTE: 'PRAIRIE_TEMPORAIRE',
  FETUQUE: 'PRAIRIE_TEMPORAIRE', SEMIS_PRAIRIE: 'PRAIRIE_TEMPORAIRE',
  CEREALES: 'CEREALE', AUTRE: 'AUTRE'
};
export const LABEL_GROUPE = {
  PRAIRIE_PERMANENTE: 'Prairie permanente',
  PRAIRIE_TEMPORAIRE: 'Prairie temporaire',
  CEREALE: 'Céréales',
  AUTRE: 'Autre'
};

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
// Pas de RGT0 : contrairement à la luzerne (implantation lente, ne compte
// pas l'année du semis), un RG trèfle est récolté/pâturé dès sa première
// année — l'année de semis EST déjà "RG trèfle 1", jamais une année 0.
const rgt = (n) => ({
  code: 'RGT' + n, label: 'RG trèfle ' + n,
  famille: 'PRAIRIE_COURTE',
  fourrage: 'RG trèfle', suivante: n < 3 ? 'RGT' + (n + 1) : null
});
const cer = (code, label, grain, suivante = null) =>
  ({ code, label, famille: 'CEREALES', grain, suivante });

export const CULTURES_PREV = [
  luz(0), luz(1), luz(2), luz(3), luz(4), luz(5),
  rgt(1), rgt(2), rgt(3),
  // Auto-reproductrice comme la PN : une fétuque/trèfle ne se compte pas par
  // âge sur ce dossier, contrairement au RG trèfle.
  { code: 'FET', label: 'Fétuque/Trèfle', famille: 'FETUQUE', fourrage: 'Fétuque trèfle', suivante: 'FET' },
  { code: 'PN', label: 'PN', famille: 'PN', fourrage: 'Prairie naturelle', suivante: 'PN' },
  cer('BLE1', 'Blé 1', 'BLE'), cer('BLE2', 'Blé 2', 'BLE'),
  cer('ORGE1', 'Orge 1', 'ORGE'), cer('ORGE2', 'Orge 2', 'ORGE'),
  cer('TRITICALE1', 'Triticale 1', 'TRITICALE'), cer('TRITICALE2', 'Triticale 2', 'TRITICALE'),
  // Un seul créneau pour l'instant, mais le libellé indexe quand même à 1 :
  // une annuelle n'a jamais d'année 0 (règle métier), même quand elle ne
  // tourne pas encore avec un « 2 ». Le code Firestore ne change pas — un
  // renommage casserait les campagnes déjà saisies.
  cer('AVOINE', 'Avoine 1', 'AVOINE'), cer('METEIL', 'Méteil 1', 'METEIL'),
  { code: 'AUTRE', label: 'Autre', famille: 'AUTRE' }
];

export function culturePrev(code) {
  return CULTURES_PREV.find((c) => c.code === code) || null;
}

// Indice d'âge/semis porté par le CODE lui-même (LUZ0 -> 0, RGT2 -> 2,
// BLE1 -> 1). PAS de règle uniforme "prairie = 0, annuelle = 1" : chaque
// espèce démarre à l'indice où elle est réellement récoltée/pâturée pour la
// première fois — 0 pour la luzerne (implantation lente, l'année de semis
// ne compte pas), 1 pour le RG trèfle (récolté dès sa première année, comme
// une céréale) et pour les céréales/annuelles. null pour les codes sans
// indice (PN, Fétuque/Trèfle, Autre : pérennes non comptées par âge sur ce
// dossier).
export function indiceCulture(code) {
  const c = culturePrev(code);
  if (!c) return null;
  const m = String(c.code).match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Indice de la toute première année, par famille — PAS le même chiffre pour
// toutes : la luzerne démarre à 0 (implantation lente, l'année de semis ne
// "produit" rien), le RG trèfle et les céréales/annuelles démarrent à 1
// (récoltés/pâturés dès leur première année). Absente de cette table = pas
// de notion d'âge (PN, Fétuque/Trèfle, Autre : pérennes non comptées).
const PREMIERE_ANNEE_PAR_FAMILLE = {
  SEMIS_PRAIRIE: 0,   // LUZ0 uniquement (les LUZ1-5 sont en famille LUZERNE)
  PRAIRIE_COURTE: 1,  // RGT1 (RGT2/3 ne matchent pas, indice > 1)
  CEREALES: 1
};

// Vrai pour un semis/implantation de l'année — la ligne à surveiller (jeune
// culture tout juste semée) : Luz 0 pour la luzerne, RG trèfle 1 pour les
// prairies temporaires à récolte immédiate, Blé 1 / Orge 1 / Triticale 1
// pour les céréales numérotées. Un code de céréale SANS indice numérique
// (Avoine, Méteil : un seul créneau pour l'instant, cf. CULTURES_PREV) est
// par construction toujours cette première (et seule) année.
export function estSemisDeLAnnee(code) {
  const c = culturePrev(code);
  if (!c) return false;
  const seuil = PREMIERE_ANNEE_PAR_FAMILLE[c.famille];
  if (seuil === undefined) return false;
  const indice = indiceCulture(code);
  return indice === null ? true : indice === seuil;
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

// Reprise des cases "RGT0" saisies avant la correction de la règle d'âge du
// RG trèfle (il n'a jamais d'année 0, contrairement à la luzerne — cf.
// CULTURES_PREV) : reclassées en "RGT1", la première année réelle. Idempotent
// — une fois reclassée, une case ne porte plus RGT0 et n'est plus retouchée.
export async function migrerRGT0() {
  let repris = 0;
  const snap = await getDocs(COL);
  for (const d of snap.docs) {
    if (d.data().cultureCode !== 'RGT0') continue;
    await setDoc(doc(db, NOM_COL, d.id), { cultureCode: 'RGT1', majLe: serverTimestamp() }, { merge: true });
    repris++;
  }
  return repris;
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
  const parGroupe = new Map();
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
    const groupe = GROUPE_DE_FAMILLE[c.famille] || 'AUTRE';
    parGroupe.set(groupe, (parGroupe.get(groupe) || 0) + ha);
  });
  const r = (v) => Math.round(v * 100) / 100;
  parCode.forEach((v, k) => parCode.set(k, r(v)));
  parFamille.forEach((v, k) => parFamille.set(k, r(v)));
  parGroupe.forEach((v, k) => parGroupe.set(k, r(v)));
  return { parCode, parFamille, parGroupe, nonRenseigne: r(nonRenseigne), total: r(total) };
}
