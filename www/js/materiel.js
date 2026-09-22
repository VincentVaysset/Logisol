// Parc matériel (collection Firestore "lgs_materiel").
//
// Suivi volontairement minimal : ce qui sert vraiment au quotidien, c'est
// savoir quel outil a fait quel chantier, sa largeur de travail, et depuis
// combien de temps il n'a pas été graissé. Tout le reste (heures moteur,
// factures, pièces) serait de la saisie que personne ne tient à jour.
//
// Le parc réel de l'exploitation est amorcé au premier lancement
// (PARC_PAR_DEFAUT), mais reste ENTIÈREMENT à la main de l'exploitant :
// chaque matériel est modifiable, supprimable, et de nouveaux peuvent être
// ajoutés. Un matériel supprimé ne revient jamais — voir ensureSeeded().
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui } from './implantations.js';

const COL = collection(db, 'lgs_materiel');

// Le marqueur d'amorçage vit dans la collection du matériel plutôt que dans
// une collection dédiée : une collection de plus, c'est une règle Firestore
// de plus à publier, donc un « permission-denied » de plus à diagnostiquer.
// Il est filtré de toutes les listes par son id.
const ID_MARQUEUR = '_seed';

/**
 * @typedef {object} Materiel
 * @property {string} id
 * @property {string} nom
 * @property {string} [marque]
 * @property {string} [categorie]
 * @property {number} [largeurTravailMetres]
 * @property {string[]} [actions]              noms des types d'activité conseillés
 * @property {string} [dateDernierGraissage]   "AAAA-MM-JJ"
 * @property {string} [noteEntretien]
 */

export const CATEGORIES_MATERIEL = [
  { value: 'MANUTENTION',      label: 'Manutention',             icone: '🏗️' },
  { value: 'TRACTEUR',         label: 'Tracteurs',               icone: '🚜' },
  { value: 'SOL_SEMIS',        label: 'Travail du sol / Semis',  icone: '🌱' },
  { value: 'FOURRAGE_RECOLTE', label: 'Fourrage / Récolte',      icone: '🌾' },
  { value: 'EPANDAGE',         label: 'Épandage',                icone: '💩' },
  { value: 'AUTRE',            label: 'Autre',                   icone: '🛠️' }
];

export function categorieMateriel(value) {
  return CATEGORIES_MATERIEL.find((c) => c.value === value) || CATEGORIES_MATERIEL[5];
}

// Parc réel de l'exploitation. « actions » porte les noms des types
// d'activité pour lesquels l'outil est proposé en tête de liste : c'est la
// seule donnée qui relie le parc au tunnel de saisie, et elle est éditable
// depuis la fiche matériel.
export const PARC_PAR_DEFAUT = [
  { nom: 'Télescopique Agri JCB',              marque: 'JCB',       categorie: 'MANUTENTION',      actions: [] },

  { nom: 'Case Puma 165',                      marque: 'Case IH',   categorie: 'TRACTEUR',         actions: [] },
  { nom: 'Case Maxxum 130',                    marque: 'Case IH',   categorie: 'TRACTEUR',         actions: [] },

  { nom: 'Charrue Kubota 5 socs réversibles',  marque: 'Kubota',    categorie: 'SOL_SEMIS',        actions: ['Labour'] },
  { nom: 'Déchaumeur 3m',                      marque: '',          categorie: 'SOL_SEMIS',        largeurTravailMetres: 3,    actions: ['Déchaumage'] },
  { nom: 'Vibroculteur Kubota 7m',             marque: 'Kubota',    categorie: 'SOL_SEMIS',        largeurTravailMetres: 7,    actions: ['Vibroculteur'] },
  { nom: 'Tasse avant 3m',                     marque: '',          categorie: 'SOL_SEMIS',        largeurTravailMetres: 3,    actions: ['Semis (semoir + tasse-avant)', 'Roulage'] },
  { nom: 'Semoir Kubota soufflerie 3m',        marque: 'Kubota',    categorie: 'SOL_SEMIS',        largeurTravailMetres: 3,    actions: ['Semis (semoir + tasse-avant)'] },
  { nom: 'Broyeuse de pierres Bugnot (CUMA)',  marque: 'Bugnot',    categorie: 'SOL_SEMIS',        actions: ['Broyage pierres (casseuse)'] },
  { nom: 'Aligneuse de pierres',               marque: '',          categorie: 'SOL_SEMIS',        actions: ['Alignement pierres'] },
  { nom: 'Rouleau 6m30',                       marque: '',          categorie: 'SOL_SEMIS',        largeurTravailMetres: 6.3,  actions: ['Roulage'] },

  { nom: 'Pirouette Pottinger 10m',            marque: 'Pottinger', categorie: 'FOURRAGE_RECOLTE', largeurTravailMetres: 10,   actions: ['Pirouette / Fanage'] },
  { nom: 'Andaineur Pottinger',                marque: 'Pottinger', categorie: 'FOURRAGE_RECOLTE', actions: ['Andainage'] },
  { nom: 'Autochargeuse Pottinger',            marque: 'Pottinger', categorie: 'FOURRAGE_RECOLTE', actions: ['Séchage en grange'] },
  { nom: 'Presse (Entreprise)',                marque: '',          categorie: 'FOURRAGE_RECOLTE', actions: ['Pressage (bottes)'] },
  { nom: 'Moisson (Entreprise)',               marque: '',          categorie: 'FOURRAGE_RECOLTE', actions: ['Moisson'] },

  { nom: 'Épandeur Deguillaume (2006)',        marque: 'Deguillaume', categorie: 'EPANDAGE',       actions: ['Épandage fumier'] }
];

let courants = [];
const listeners = new Set();

export function getMateriels() { return courants; }
export function getMaterielById(id) { return courants.find((m) => m.id === id) || null; }
export function onMaterielsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchMateriels() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .filter((d) => d.id !== ID_MARQUEUR)
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ordreCategorie(a) - ordreCategorie(b)
        || String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true }));
    listeners.forEach((cb) => cb(courants));
  });
}

function ordreCategorie(m) {
  const i = CATEGORIES_MATERIEL.findIndex((c) => c.value === m.categorie);
  return i === -1 ? CATEGORIES_MATERIEL.length : i;
}

/**
 * Amorce le parc par défaut. Idempotent, et surtout NON DESTRUCTIF :
 *  - un matériel déjà présent (même nom) n'est jamais réécrit, sauf pour
 *    compléter sa catégorie et ses actions conseillées s'il n'en a pas ;
 *  - un matériel du parc par défaut que l'exploitant a SUPPRIMÉ ne
 *    réapparaît pas : le marqueur retient ce qui a déjà été semé une fois,
 *    sans quoi chaque lancement rendrait la suppression impossible.
 */
export async function ensureSeeded() {
  const [snap, marqueurSnap] = await Promise.all([
    getDocs(COL),
    getDoc(doc(db, 'lgs_materiel', ID_MARQUEUR))
  ]);

  const dejaSemes = new Set(
    marqueurSnap.exists() && Array.isArray(marqueurSnap.data().noms) ? marqueurSnap.data().noms : []
  );
  const presents = new Map();
  snap.docs.forEach((d) => {
    if (d.id === ID_MARQUEUR) return;
    presents.set(String(d.data().nom || '').trim().toLowerCase(), { id: d.id, ...d.data() });
  });

  for (const m of PARC_PAR_DEFAUT) {
    const existant = presents.get(m.nom.toLowerCase());
    if (existant) {
      // Complément seulement : le nom, la marque et la largeur appartiennent
      // à l'exploitant dès lors qu'il a ouvert la fiche.
      const maj = {};
      if (!existant.categorie) maj.categorie = m.categorie;
      if (!Array.isArray(existant.actions)) maj.actions = m.actions || [];
      if (Object.keys(maj).length) await setDoc(doc(db, 'lgs_materiel', existant.id), maj, { merge: true });
      continue;
    }
    if (dejaSemes.has(m.nom)) continue;   // supprimé volontairement : on respecte
    await addDoc(COL, {
      nom: m.nom,
      marque: m.marque || '',
      categorie: m.categorie,
      largeurTravailMetres: m.largeurTravailMetres != null ? m.largeurTravailMetres : null,
      actions: m.actions || [],
      dateDernierGraissage: null,
      noteEntretien: '',
      creeLe: serverTimestamp(), majLe: serverTimestamp(),
      creePar: auth.currentUser ? auth.currentUser.uid : null
    });
  }

  const noms = PARC_PAR_DEFAUT.map((m) => m.nom);
  if (noms.some((n) => !dejaSemes.has(n))) {
    await setDoc(doc(db, 'lgs_materiel', ID_MARQUEUR), { noms }, { merge: true });
  }
}

/**
 * Sépare le parc en « conseillé pour cette action » et « le reste ».
 * La suggestion ne filtre RIEN : on peut toujours choisir n'importe quel
 * outil, un chantier sort souvent de l'usage prévu.
 */
export function materielsPourAction(nomType, liste = courants) {
  const n = String(nomType || '');
  const conseille = (m) => !!n && Array.isArray(m.actions) && m.actions.includes(n);
  return {
    conseilles: liste.filter(conseille),
    autres: liste.filter((m) => !conseille(m))
  };
}

/** Jours écoulés depuis le dernier graissage, ou null si jamais renseigné. */
export function joursDepuisGraissage(m, date = aujourdhui()) {
  if (!m || !m.dateDernierGraissage) return null;
  const j = Math.round(
    (Date.parse(date + 'T12:00:00') - Date.parse(m.dateDernierGraissage + 'T12:00:00')) / 86400000
  );
  return isFinite(j) ? Math.max(0, j) : null;
}

// Formulation en clair. Aucun seuil d'alerte n'est inventé : la fréquence de
// graissage dépend de l'outil et de l'usage, et une couleur d'alarme posée au
// hasard finirait ignorée. On affiche le fait, l'exploitant juge.
export function graissageLisible(m, date = aujourdhui()) {
  const j = joursDepuisGraissage(m, date);
  if (j === null) return 'jamais renseigné';
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 31) return `il y a ${j} jours`;
  const mois = Math.floor(j / 30.44);
  if (mois < 12) return `il y a ${mois} mois`;
  const ans = Math.floor(mois / 12);
  return ans === 1 ? 'il y a plus d\'un an' : `il y a plus de ${ans} ans`;
}

export function resume(m) {
  const bouts = [];
  if (m.marque) bouts.push(m.marque);
  if (m.largeurTravailMetres) bouts.push(m.largeurTravailMetres + ' m');
  return bouts.join(' · ');
}

function nettoyer(data) {
  const l = Number(data.largeurTravailMetres);
  return {
    nom: String(data.nom || '').trim(),
    marque: String(data.marque || '').trim(),
    categorie: data.categorie || 'AUTRE',
    largeurTravailMetres: isFinite(l) && l > 0 ? l : null,
    actions: Array.isArray(data.actions) ? data.actions.map(String) : [],
    dateDernierGraissage: data.dateDernierGraissage || null,
    noteEntretien: String(data.noteEntretien || '').trim()
  };
}

export async function createMateriel(data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  return addDoc(COL, {
    ...m, creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
}

export async function updateMateriel(id, data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  return updateDoc(doc(db, 'lgs_materiel', id), { ...m, majLe: serverTimestamp() });
}

/** Action rapide : « graissé aujourd'hui », en un seul geste. */
export async function validerGraissage(id, date) {
  return updateDoc(doc(db, 'lgs_materiel', id), {
    dateDernierGraissage: date || aujourdhui(),
    majLe: serverTimestamp()
  });
}

export async function deleteMateriel(id) {
  return deleteDoc(doc(db, 'lgs_materiel', id));
}
