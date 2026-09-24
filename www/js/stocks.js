// Stocks récoltés (collection Firestore "stocks").
//
// Un document = UNE RÉCOLTE SUR UNE PARCELLE, saisie en une fois en fin de
// récolte. Le tonnage n'est jamais saisi directement pour le foin en botte et
// la paille : il se déduit des quantités réellement comptées au champ
// (nombre de bottes × poids d'une botte), parce que c'est ce que Vincent a
// sous les yeux à ce moment-là. Le total exploitation est ensuite une simple
// somme de ces récoltes, agrégée par catégorie.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'stocks');

export const CATEGORIES = [
  { value: 'foin', label: 'Foin' },
  { value: 'cereale', label: 'Céréales' },
  { value: 'paille', label: 'Paille' }
];

// Deux modes de conservation du foin, à ne surtout pas confondre : ils ne se
// saisissent pas pareil et ne se consomment pas pareil.
export const CONSERVATIONS = [
  { value: 'botte', label: 'En botte' },
  { value: 'grange', label: 'Séché en grange' }
];

export const COUPES = [
  { value: 1, label: '1ʳᵉ coupe' },
  { value: 2, label: '2ᵉ coupe' },
  { value: 3, label: '3ᵉ coupe' },
  { value: 4, label: '4ᵉ coupe' }
];

export function labelCoupe(n) {
  const c = COUPES.find((x) => x.value === Number(n));
  return c ? c.label : 'coupe ?';
}

// Libellés alignés sur le vocabulaire des cultures du RPG TelePAC, pour que
// le type de fourrage déduit d'une parcelle importée tombe sur un nom déjà
// proposé ici plutôt que d'en créer un double à l'orthographe près.
// La liste n'est qu'une aide à la saisie : le champ reste libre.
export const FOURRAGES = [
  'Prairie permanente', 'Prairie temporaire', 'Luzerne', 'Trèfle violet',
  'Ray-grass anglais (RGA)', 'Ray-grass italien (RGI)', 'Dactyle', 'Fétuque',
  'RG trèfle', 'Sainfoin', 'Mélange prairial', 'Prairie naturelle'
];

let courants = [];
const listeners = new Set();

export function getStocks() {
  return courants;
}

export function onStocksChange(cb) {
  listeners.add(cb);
  cb(courants);
  return () => listeners.delete(cb);
}

export function watchStocks() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    listeners.forEach((cb) => cb(courants));
  });
}

// --- Tonnage -------------------------------------------------------------
// Calculé à la saisie ET stocké : le tonnage est ce qu'on additionne partout
// (synthèse, autonomie du troupeau), et le recalculer à chaque affichage
// exposerait à des divergences si la formule évolue. Il reste dérivé des
// quantités comptées, jamais saisi à la main pour les bottes et la grange.
export function calculerTonnes(s) {
  if (s.categorie === 'foin' && s.conservation === 'grange') {
    const n = Number(s.nbRemorques) || 0;
    const kg = Number(s.kgMSParRemorque) || 0;
    return arrondi3(n * kg / 1000);
  }
  if (s.categorie === 'cereale') {
    return arrondi3(Number(s.tonnesSaisies) || 0);
  }
  // foin en botte et paille : même principe
  const n = Number(s.nbBottes) || 0;
  const kg = Number(s.poidsBotteKg) || 0;
  return arrondi3(n * kg / 1000);
}

function arrondi3(v) {
  return Math.round(v * 1000) / 1000;
}

// --- Catégories de stock --------------------------------------------------
// C'est la clé qui relie les stocks à l'alimentation : un lot d'animaux puise
// sur UNE catégorie précise (« 1ʳᵉ coupe de luzerne séchée en grange »), pas
// sur « du foin » en général.
export function categorieCle(s) {
  if (s.categorie === 'foin') return cleFoin(s.conservation, s.coupe, s.fourrage);
  if (s.categorie === 'cereale') return cleCereale(s.espece);
  return 'paille|botte';
}

export function categorieLabel(s) {
  if (s.categorie === 'foin') return labelFoin(s.conservation, s.coupe, s.fourrage);
  if (s.categorie === 'cereale') return labelCereale(s.espece);
  return 'Paille';
}

// --- Identité d'un lot de fourrage, PARTAGÉE -------------------------------
// Ces quatre fonctions sont le seul endroit où se décide ce qui fait qu'un
// fourrage est « le même ». Elles servent aux récoltes saisies à la main dans
// cet onglet ET aux entrées de stock créées par le tunnel d'activité : une
// 1ʳᵉ coupe de luzerne en botte est la même chose quelle que soit la porte
// d'entrée, et doit donc tomber dans la même colonne et la même ration.
export function cleFoin(conservation, coupe, fourrage) {
  return ['foin', conservation || 'botte', 'c' + (Number(coupe) || 0), slug(fourrage || '')].join('|');
}
export function labelFoin(conservation, coupe, fourrage) {
  const cons = (CONSERVATIONS.find((c) => c.value === conservation) || {}).label || '';
  return `Foin ${fourrage || '?'} — ${labelCoupe(coupe)} — ${cons.toLowerCase()}`;
}
export function cleCereale(espece) {
  return ['cereale', slug(espece || '')].join('|');
}
export function labelCereale(espece) {
  return `Céréale — ${espece || '?'}`;
}

// Un aliment du commerce n'est pas une récolte : pas de coupe, pas de
// parcelle, juste un nom donné par Vincent. La clé sert uniquement à
// regrouper ses propres consommations dans le tableau croisé et le bilan —
// jamais à le confondre avec un fourrage ou une céréale de la ferme.
export function cleCommerce(nom) {
  return ['commerce', slug(nom || '')].join('|');
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Agrège les récoltes par catégorie — c'est la synthèse au niveau de
 * l'exploitation demandée, construite à partir des saisies parcelle par
 * parcelle.
 * @returns {Array<{cle, label, categorie, conservation, coupe, fourrage, espece,
 *                  tonnes, nbRecoltes, nbBottes, surfaceHa, lignes}>}
 */
export function agregerParCategorie(stocks = courants) {
  const parCle = new Map();
  stocks.forEach((s) => {
    const cle = categorieCle(s);
    if (!parCle.has(cle)) {
      parCle.set(cle, {
        cle,
        label: categorieLabel(s),
        categorie: s.categorie,
        conservation: s.conservation || null,
        coupe: s.coupe || null,
        fourrage: s.fourrage || null,
        espece: s.espece || null,
        tonnes: 0,
        nbRecoltes: 0,
        nbBottes: 0,
        nbRemorques: 0,
        surfaceHa: 0,
        lignes: []
      });
    }
    const g = parCle.get(cle);
    g.tonnes = arrondi3(g.tonnes + (Number(s.tonnes) || 0));
    g.nbRecoltes++;
    g.nbBottes += Number(s.nbBottes) || 0;
    g.nbRemorques += Number(s.nbRemorques) || 0;
    g.surfaceHa = Math.round((g.surfaceHa + (Number(s.surfaceHa) || 0)) * 100) / 100;
    g.lignes.push(s);
  });
  return Array.from(parCle.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

// Totaux par grande famille, pour l'en-tête de la vue Stocks.
export function totauxParFamille(stocks = courants) {
  const t = { foin: 0, cereale: 0, paille: 0 };
  stocks.forEach((s) => {
    t[s.categorie] = arrondi3((t[s.categorie] || 0) + (Number(s.tonnes) || 0));
  });
  return t;
}

// Foin uniquement : croisement coupe × type de fourrage explicitement demandé.
export function croiseCoupeFourrage(stocks = courants) {
  const fourrages = [];
  const grille = new Map(); // "coupe|fourrage" -> tonnes
  stocks
    .filter((s) => s.categorie === 'foin')
    .forEach((s) => {
      const f = s.fourrage || '?';
      if (!fourrages.includes(f)) fourrages.push(f);
      const k = `${s.coupe || 0}|${f}`;
      grille.set(k, arrondi3((grille.get(k) || 0) + (Number(s.tonnes) || 0)));
    });
  fourrages.sort((a, b) => a.localeCompare(b, 'fr'));
  return { fourrages, valeur: (coupe, fourrage) => grille.get(`${coupe}|${fourrage}`) || 0 };
}

// --- Écriture -------------------------------------------------------------
function nettoyer(data) {
  const s = {
    categorie: data.categorie,
    conservation: data.categorie === 'foin' ? data.conservation : (data.categorie === 'paille' ? 'botte' : null),
    parcelleId: data.parcelleId || null,
    parcelleNom: data.parcelleNom || '',      // copie figée : la synthèse reste
                                              // lisible si la parcelle est
                                              // renommée ou supprimée
    date: data.date,
    coupe: data.categorie === 'foin' ? Number(data.coupe) || null : null,
    fourrage: data.categorie === 'foin' ? (data.fourrage || '') : null,
    espece: data.categorie === 'cereale' ? (data.espece || '') : null,
    nbBottes: nombreOuNull(data.nbBottes),
    poidsBotteKg: nombreOuNull(data.poidsBotteKg),
    nbRemorques: nombreOuNull(data.nbRemorques),
    kgMSParRemorque: nombreOuNull(data.kgMSParRemorque),
    surfaceHa: nombreOuNull(data.surfaceHa),
    tonnesSaisies: nombreOuNull(data.tonnesSaisies),
    notes: data.notes || ''
  };
  s.tonnes = calculerTonnes(s);
  s.categorieCle = categorieCle(s);
  s.categorieLabel = categorieLabel(s);
  return s;
}

function nombreOuNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export async function createStock(data) {
  if (!data.date) throw new Error('La date de récolte est obligatoire.');
  return addDoc(COL, {
    ...nettoyer(data),
    creeLe: serverTimestamp(),
    majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateStock(id, data) {
  return updateDoc(doc(db, 'stocks', id), { ...nettoyer(data), majLe: serverTimestamp() });
}

export async function deleteStock(id) {
  return deleteDoc(doc(db, 'stocks', id));
}
