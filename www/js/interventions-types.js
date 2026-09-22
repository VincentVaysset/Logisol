// Types d'intervention (collection Firestore "interventions_types") : liste
// prédéfinie, complétable librement — un DOCUMENT par type.
//
// Chaque type porte trois métadonnées qui pilotent le tunnel de saisie :
//   categorie — regroupement affiché à l'étape 1 ;
//   cible     — sur quoi l'activité porte (parcelle, bergerie, ou les deux),
//               ce qui filtre la liste dès que la cible est choisie ;
//   flux      — ce que l'étape 3 doit demander : rien, une entrée en stock
//               (fauche, moisson), ou une distribution (source + destination).
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, getDocs, onSnapshot
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'interventions_types');

const COMPLET = ['produit', 'materiel', 'duree', 'meteo'];

export const TYPE_NOTE = 'Note';

export const CATEGORIES = [
  { value: 'SOL',      label: 'Pâturage & sol',        icone: '🌱' },
  { value: 'APPORTS',  label: 'Traitements & apports', icone: '🧪' },
  { value: 'TROUPEAU', label: 'Troupeau / élevage',    icone: '🐑' },
  { value: 'AUTRE',    label: 'Divers',                icone: '📝' }
];

/** @typedef {'ENTREE_STOCK'|'DISTRIBUTION'|null} FluxType */
/** @typedef {'PARCELLE'|'BERGERIE'|'LES_DEUX'} CibleType */

// Liste de référence. Les types déjà présents en base sont mis à jour sur
// place (mêmes documents, donc les interventions existantes gardent leur
// rattachement) ; les manquants sont ajoutés. Rien n'est jamais supprimé.
const TYPES_PAR_DEFAUT = [
  // --- Pâturage & sol ---
  { nom: 'Pâturage',              icone: '🐑', couleur: '#3f6b3a', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['duree', 'meteo'] },
  { nom: 'Roulage',               icone: '🛞', couleur: '#79765f', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Fauche / Enrubannage',  icone: '🚜', couleur: '#4f9c5f', categorie: 'SOL', cible: 'PARCELLE', flux: 'ENTREE_STOCK', champs: COMPLET },
  { nom: 'Moisson',               icone: '🌾', couleur: '#c98a3e', categorie: 'SOL', cible: 'PARCELLE', flux: 'ENTREE_STOCK', champs: COMPLET },
  { nom: 'Semis',                 icone: '🌱', couleur: '#5b8c5a', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Travail du sol',        icone: '⛏️', couleur: '#8a6d5c', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Labour',                icone: '🔵', couleur: '#6b5344', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Fanage',                icone: '☀️', couleur: '#e0a326', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Andainage',             icone: '🌾', couleur: '#d4a53f', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Pressage',              icone: '🧻', couleur: '#b98b2f', categorie: 'SOL', cible: 'PARCELLE', flux: 'ENTREE_STOCK', champs: COMPLET },
  { nom: 'Épierrage',             icone: '🪨', couleur: '#79765f', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['materiel', 'duree', 'meteo'] },
  { nom: 'Irrigation',            icone: '💧', couleur: '#3f7fa8', categorie: 'SOL', cible: 'PARCELLE', flux: null, champs: ['duree', 'meteo'] },

  // --- Traitements & apports ---
  { nom: 'Fertilisation',         icone: '🧪', couleur: '#c98a3e', categorie: 'APPORTS', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Épandage',              icone: '💩', couleur: '#8a6d5c', categorie: 'APPORTS', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Désherbage',            icone: '🌿', couleur: '#7ba05b', categorie: 'APPORTS', cible: 'PARCELLE', flux: null, champs: COMPLET },
  { nom: 'Traitement',            icone: '⚗️', couleur: '#a8557a', categorie: 'APPORTS', cible: 'PARCELLE', flux: null, champs: COMPLET },

  // --- Troupeau / élevage ---
  { nom: 'Distribution alimentation', icone: '🥣', couleur: '#5b8c5a', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: 'DISTRIBUTION', champs: ['duree'] },
  { nom: 'Allotement',            icone: '🔀', couleur: '#6b8fa8', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, champs: ['duree'] },
  { nom: 'Soin',                  icone: '💉', couleur: '#a8557a', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, champs: ['produit', 'duree'] },
  { nom: 'Traitement sanitaire',  icone: '🩺', couleur: '#b5546b', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, champs: ['produit', 'duree'] },

  // --- Divers ---
  { nom: 'Note',                  icone: '📝', couleur: '#79765f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, champs: [] },
  { nom: 'Observation',           icone: '👁️', couleur: '#79765f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, champs: ['meteo'] },
  { nom: 'Autre',                 icone: '🔧', couleur: '#9a988f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, champs: COMPLET }
];

// Types de la première version dont le libellé a été précisé. Le document est
// CONSERVÉ (même id) et seulement renommé : les interventions déjà saisies
// restent rattachées, et leur libellé figé garde de toute façon l'ancien nom
// dans le fil d'activités.
const RENOMMAGES = {
  'Fauche': 'Fauche / Enrubannage',
  'Récolte': 'Moisson'
};

let courants = [];
const listeners = new Set();

export function getTypes() { return courants; }
export function getTypeById(id) { return courants.find((t) => t.id === id) || null; }
export function onTypesChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function typeAffiche(type, champ) {
  if (!type) return true;
  if (!Array.isArray(type.champs)) return true;
  return type.champs.includes(champ);
}
export function estNote(type) { return !!type && type.nom === TYPE_NOTE; }

// Un type personnalisé créé avant l'existence des catégories n'en a pas :
// plutôt que de le faire disparaître du tunnel, on le range dans « Divers ».
export function categorieDe(type) {
  return (type && type.categorie) || 'AUTRE';
}
export function cibleDe(type) {
  return (type && type.cible) || 'LES_DEUX';
}
export function fluxDe(type) {
  return (type && type.flux) || null;
}

export function typesPourCible(cible, liste = courants) {
  return liste.filter((t) => {
    const c = cibleDe(t);
    return c === 'LES_DEUX' || c === cible;
  });
}

/**
 * Amorce et met à niveau la liste des types.
 * Idempotent : les documents existants sont retrouvés par leur nom (ancien ou
 * nouveau) et complétés, les manquants créés. Aucun type n'est supprimé, y
 * compris ceux créés à la main depuis l'appli.
 */
export async function ensureSeeded() {
  const snap = await getDocs(COL);
  const parNom = new Map();
  snap.docs.forEach((d) => parNom.set(String(d.data().nom || ''), { id: d.id, ...d.data() }));

  for (const t of TYPES_PAR_DEFAUT) {
    const ancienNom = Object.keys(RENOMMAGES).find((k) => RENOMMAGES[k] === t.nom);
    const existant = parNom.get(t.nom) || (ancienNom ? parNom.get(ancienNom) : null);
    if (existant) {
      // Mise à niveau : on n'écrase QUE les métadonnées de classement, pas la
      // couleur ni l'icône que l'exploitant aurait pu personnaliser.
      const maj = {};
      if (existant.nom !== t.nom) maj.nom = t.nom;
      if (existant.categorie !== t.categorie) maj.categorie = t.categorie;
      if (existant.cible !== t.cible) maj.cible = t.cible;
      if ((existant.flux || null) !== (t.flux || null)) maj.flux = t.flux;
      if (!Array.isArray(existant.champs)) maj.champs = t.champs;
      if (Object.keys(maj).length) await setDoc(doc(db, 'interventions_types', existant.id), maj, { merge: true });
    } else {
      await addDoc(COL, t);
    }
  }
}

export function watchTypes() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ordre(a) - ordre(b) || String(a.nom).localeCompare(String(b.nom), 'fr'));
    listeners.forEach((cb) => cb(courants));
  });
}

function ordre(t) {
  if (t.nom === TYPE_NOTE) return -1;
  const i = TYPES_PAR_DEFAUT.findIndex((d) => d.nom === t.nom);
  return i === -1 ? 999 : i;
}

export async function addType(nom, icone, couleur, extra = {}) {
  const ref = await addDoc(COL, {
    nom,
    icone: icone || '🔧',
    couleur: couleur || '#9a988f',
    categorie: extra.categorie || 'AUTRE',
    cible: extra.cible || 'LES_DEUX',
    flux: extra.flux || null,
    champs: COMPLET
  });
  return ref.id;
}
