// Parc matériel (collection Firestore "lgs_materiel").
//
// Suivi volontairement minimal : ce qui sert vraiment au quotidien, c'est
// savoir quel outil a fait quel chantier, sa largeur de travail, et depuis
// combien de temps il n'a pas reçu tel ou tel entretien (graissage,
// vidange, soufflage, niveaux/pression, nettoyage — cf. TYPES_ENTRETIEN et
// le journal lgs_materiel_entretien plus bas). Tout le reste (heures
// moteur, factures, pièces) serait de la saisie que personne ne tient à jour.
//
// Le parc réel de l'exploitation est amorcé au premier lancement
// (PARC_PAR_DEFAUT), mais reste ENTIÈREMENT à la main de l'exploitant :
// chaque matériel est modifiable, supprimable, et de nouveaux peuvent être
// ajoutés. Un matériel supprimé ne revient jamais — voir ensureSeeded().
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  onSnapshot, serverTimestamp, query, where
} from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui } from './implantations.js';
import { ecrire } from './ecriture-locale.js';

const COL = collection(db, 'lgs_materiel');

// Journal des opérations d'entretien (collection "lgs_materiel_entretien",
// déjà couverte par le joker lgs_.* des règles Firestore — rien à publier).
// Remplace le simple bouton "graissé aujourd'hui" (un seul champ, un seul
// type d'action) par un vrai journal, sur le même principe que le journal
// de mouvements de stock : chaque opération est un document daté, jamais
// réécrit — "annuler" supprime le document plutôt que de deviner une valeur
// précédente.
const COL_ENTRETIEN = collection(db, 'lgs_materiel_entretien');

// « Niveaux / Pression » et « Nettoyage » restent : des entrées existent
// peut-être déjà. « Autre » porte un libellé libre, reproposé ensuite comme
// un type à part (cf. libellesAutres) : les types personnalisés, sans
// collection de plus.
export const TYPES_ENTRETIEN = [
  { value: 'GRAISSAGE',  label: 'Graissage',                       icone: '🛢️' },
  { value: 'VIDANGE',    label: 'Vidange',                         icone: '🔧' },
  { value: 'FILTRES',    label: 'Filtres',                         icone: '🧽' },
  { value: 'SOUFFLAGE',  label: 'Soufflage filtres / radiateurs',  icone: '💨' },
  { value: 'NIVEAUX',    label: 'Niveaux / Pression',              icone: '📏' },
  { value: 'NETTOYAGE',  label: 'Nettoyage / Lavage',              icone: '🧼' },
  { value: 'AUTRE',      label: 'Autre',                           icone: '🛠️' }
];

/** Libellé d'un type, ou d'une entrée du journal (« Autre » : son libellé). */
export function labelEntretien(typeOuEntree) {
  if (typeOuEntree && typeof typeOuEntree === 'object') {
    if (typeOuEntree.type === 'AUTRE' && typeOuEntree.libelle) return typeOuEntree.libelle;
    return labelEntretien(typeOuEntree.type);
  }
  const t = TYPES_ENTRETIEN.find((x) => x.value === typeOuEntree);
  return t ? t.label : typeOuEntree;
}

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
 * @property {string} [dateDernierGraissage]   "AAAA-MM-JJ" — hérité, non
 *   réédité par la fiche (cf. dernierEntretien/annulerDernierEntretien)
 * @property {string} [noteEntretien]
 * @property {boolean} [cuma]                  CUMA / entreprise : ni bouton
 *   Graissé ni suivi d'entretien
 * @property {number} [compteurHeures]         dernier relevé du compteur, saisi
 *   à la main (jamais calculé depuis la durée des activités, gardée telle
 *   quelle pour une automatisation future)
 * @property {string} [compteurDate]           "AAAA-MM-JJ" de ce relevé
 * @property {Object<string,number>} [intervallesHeures]  EXTENSION PRÉVUE,
 *   non utilisée : intervalle d'heures facultatif par type d'entretien
 *   (clé = TYPES_ENTRETIEN.value). Absent par défaut, jamais affiché, aucun
 *   seuil ni alerte construit dessus ; un champ facultatif d'un document
 *   Firestore s'ajoute sans migration.
 */

// Engins à moteur : les seuls dont la fiche propose un compteur d'heures.
const CATEGORIES_COMPTEUR = ['TRACTEUR', 'MANUTENTION'];
export function avecCompteur(m) { return !!m && !m.cuma && CATEGORIES_COMPTEUR.includes(m.categorie); }

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
export function resume(m) {
  const bouts = [];
  if (m.marque) bouts.push(m.marque);
  if (m.largeurTravailMetres) bouts.push(m.largeurTravailMetres + ' m');
  return bouts.join(' · ');
}

// dateDernierGraissage n'est PLUS géré ici : la fiche ne l'édite plus
// directement (remplacée par le journal d'entretien, cf. plus bas), et le
// réécrire à chaque sauvegarde de la fiche (nom, marque, catégorie...)
// effacerait silencieusement l'historique hérité à la première modification
// venue. Seuls enregistrerEntretien()/annulerDernierEntretien() y touchent
// désormais (ce dernier pour son repli de rétrocompatibilité uniquement).
function nettoyer(data) {
  const l = Number(data.largeurTravailMetres);
  return {
    nom: String(data.nom || '').trim(),
    marque: String(data.marque || '').trim(),
    categorie: data.categorie || 'AUTRE',
    largeurTravailMetres: isFinite(l) && l > 0 ? l : null,
    actions: Array.isArray(data.actions) ? data.actions.map(String) : [],
    noteEntretien: String(data.noteEntretien || '').trim(),
    cuma: !!data.cuma
  };
}

export async function createMateriel(data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  const ref = doc(COL);
  await ecrire(ref, setDoc(ref, {
    ...m, creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  }), 'Matériel');
  return ref;
}

export async function updateMateriel(id, data) {
  const m = nettoyer(data);
  if (!m.nom) throw new Error('Donne un nom au matériel.');
  const ref = doc(db, 'lgs_materiel', id);
  await ecrire(ref, updateDoc(ref, { ...m, majLe: serverTimestamp() }), 'Matériel');
}

export async function deleteMateriel(id) {
  const ref = doc(db, 'lgs_materiel', id);
  await ecrire(ref, deleteDoc(ref), 'Matériel');
}

// --- Journal d'entretien -----------------------------------------------------
let entretiensCourants = [];
const entretienListeners = new Set();

export function getEntretiens() { return entretiensCourants; }
export function onEntretiensChange(cb) { entretienListeners.add(cb); cb(entretiensCourants); return () => entretienListeners.delete(cb); }

export function watchEntretiens() {
  return onSnapshot(COL_ENTRETIEN, (snap) => {
    entretiensCourants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    entretienListeners.forEach((cb) => cb(entretiensCourants));
  });
}

function nombreOuNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * Enregistre une opération d'entretien. N'attend que la file locale (cf.
 * ecriture-locale.js) : hors réseau, le bouton Graissé répond tout de suite
 * au lieu de rester bloqué jusqu'au retour de la couverture.
 * @param {{date?, cout?, libelle?, compteurHeures?}} [opts]
 * @returns {Promise<string>} id de l'entrée créée (pour l'annuler)
 */
export async function enregistrerEntretien(materielId, type, opts = {}) {
  if (!materielId) throw new Error('Matériel manquant.');
  if (!TYPES_ENTRETIEN.some((t) => t.value === type)) throw new Error("Type d'entretien inconnu.");
  const o = typeof opts === 'string' ? { date: opts } : (opts || {});
  const libelle = String(o.libelle || '').trim();
  if (type === 'AUTRE' && !libelle) throw new Error("Donne un nom à cet entretien (type « Autre »).");
  const date = o.date || aujourdhui();
  const compteurHeures = nombreOuNull(o.compteurHeures);
  const ref = doc(COL_ENTRETIEN);
  await ecrire(ref, setDoc(ref, {
    materielId, type, date,
    libelle: type === 'AUTRE' ? libelle : null,
    cout: nombreOuNull(o.cout),
    compteurHeures,
    creeLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  }), 'Entretien');
  // Un compteur noté à l'entretien est aussi le dernier relevé de l'engin,
  // sauf s'il existe déjà un relevé plus récent.
  const m = getMaterielById(materielId);
  if (compteurHeures != null && m && (!m.compteurDate || date >= m.compteurDate)) {
    await mettreAJourCompteur(materielId, compteurHeures, date);
  }
  return ref.id;
}

/** Relevé du compteur d'heures (saisi à la main, information seulement). */
export async function mettreAJourCompteur(materielId, heures, date = aujourdhui()) {
  const h = nombreOuNull(heures);
  if (h == null) throw new Error('Compteur invalide.');
  const ref = doc(db, 'lgs_materiel', materielId);
  await ecrire(ref, updateDoc(ref, { compteurHeures: h, compteurDate: date, majLe: serverTimestamp() }), 'Compteur');
}

/**
 * Entrées d'entretien d'un matériel, la plus récente d'abord ; l'ancien champ
 * dateDernierGraissage y figure comme un Graissage (source 'legacy').
 */
export function entretiensDe(materielId, liste = entretiensCourants) {
  const m = getMaterielById(materielId);
  const res = liste.filter((e) => e.materielId === materielId).map((e) => ({ ...e, source: 'journal' }));
  if (m && m.dateDernierGraissage) res.push({ id: null, type: 'GRAISSAGE', date: m.dateDernierGraissage, source: 'legacy' });
  return res.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : msDe(b.creeLe) - msDe(a.creeLe)));
}

function msDe(ts) { return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0; }

/** Supprime une entrée (journal) ou efface l'ancien repère hérité. */
export async function supprimerEntretien(entree, materielId) {
  if (entree.source === 'legacy') {
    const ref = doc(db, 'lgs_materiel', materielId);
    return ecrire(ref, updateDoc(ref, { dateDernierGraissage: null, majLe: serverTimestamp() }), 'Entretien');
  }
  const ref = doc(db, 'lgs_materiel_entretien', entree.id);
  return ecrire(ref, deleteDoc(ref), 'Entretien');
}

/** Libellés « Autre » déjà utilisés, reproposés comme types personnalisés. */
export function libellesAutres(liste = entretiensCourants) {
  const vus = new Map();
  liste.filter((e) => e.type === 'AUTRE' && e.libelle).forEach((e) => {
    const k = e.libelle.trim().toLowerCase();
    if (!vus.has(k)) vus.set(k, e.libelle.trim());
  });
  return Array.from(vus.values()).sort((a, b) => a.localeCompare(b, 'fr'));
}

/** « aujourd'hui », « hier », « il y a 12 j » : information, jamais une alerte. */
export function ilYa(date, refDate = aujourdhui()) {
  if (!date) return '';
  const j = Math.round((Date.parse(refDate + 'T12:00:00') - Date.parse(date + 'T12:00:00')) / 86400000);
  if (!isFinite(j)) return '';
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  return `il y a ${j} j`;
}

// --- Photos et factures (collection lgs_materiel_pieces) ----------------------
// Une photo par document (compressée sous 600 Ko par photo.js) : la limite
// de 1 Mio par document Firestore interdit d'en ranger plusieurs dans la
// fiche du matériel. Une facture se photographie, pas de PDF.
const COL_PIECES = collection(db, 'lgs_materiel_pieces');

/** Écoute les photos d'un matériel (seulement quand sa fiche est ouverte). */
export function ecouterPieces(materielId, cb) {
  return onSnapshot(query(COL_PIECES, where('materielId', '==', materielId)), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
  }, () => cb([]));
}

export async function ajouterPiece(materielId, dataUrl, libelle = '') {
  const ref = doc(COL_PIECES);
  await ecrire(ref, setDoc(ref, {
    materielId, dataUrl, libelle: String(libelle || '').trim(), date: aujourdhui(),
    creeLe: serverTimestamp(), creePar: auth.currentUser ? auth.currentUser.uid : null
  }), 'Photo');
  return ref.id;
}

export async function supprimerPiece(id) {
  const ref = doc(db, 'lgs_materiel_pieces', id);
  return ecrire(ref, deleteDoc(ref), 'Photo');
}

/**
 * Dernière opération d'entretien d'un matériel, TOUS types confondus.
 * Rétrocompatibilité : l'ancien champ dateDernierGraissage (une seule valeur,
 * jamais horodatée, posée par l'ancien bouton "graissé aujourd'hui") est
 * traité comme une opération GRAISSAGE historique tant qu'aucune entrée plus
 * récente n'existe dans le journal — sans ça, toute donnée déjà enregistrée
 * avant ce journal deviendrait invisible/inannulable.
 */
export function dernierEntretien(materielId, liste = entretiensCourants) {
  const m = getMaterielById(materielId);
  const candidats = liste
    .filter((e) => e.materielId === materielId)
    .map((e) => ({ ...e, source: 'journal' }));
  if (m && m.dateDernierGraissage) {
    candidats.push({ type: 'GRAISSAGE', date: m.dateDernierGraissage, source: 'legacy' });
  }
  if (!candidats.length) return null;
  // À date égale, le journal prime sur l'ancien champ (une vraie opération
  // datée l'emporte sur un simple repère hérité).
  return candidats.reduce((meilleur, c) => (
    !meilleur || c.date > meilleur.date || (c.date === meilleur.date && meilleur.source === 'legacy')
      ? c : meilleur
  ), null);
}

/** Dernière date pour un type précis (détail par type sur la fiche). */
export function dernierEntretienDeType(materielId, type, liste = entretiensCourants) {
  const m = getMaterielById(materielId);
  const dates = liste
    .filter((e) => e.materielId === materielId && e.type === type)
    .map((e) => e.date);
  if (type === 'GRAISSAGE' && m && m.dateDernierGraissage) dates.push(m.dateDernierGraissage);
  if (!dates.length) return null;
  return dates.reduce((a, b) => (b > a ? b : a));
}

/**
 * Annule la dernière opération d'entretien enregistrée (tous types) : décrite
 * ci-dessus par dernierEntretien(). Un repère hérité (source 'legacy') n'a
 * pas de document à supprimer — on le remet simplement à vide sur la fiche.
 */
export async function annulerDernierEntretien(materielId) {
  const dernier = dernierEntretien(materielId);
  if (!dernier) throw new Error('Aucune opération à annuler.');
  if (dernier.source === 'legacy') {
    return updateDoc(doc(db, 'lgs_materiel', materielId), { dateDernierGraissage: null, majLe: serverTimestamp() });
  }
  return deleteDoc(doc(db, 'lgs_materiel_entretien', dernier.id));
}

// Formulation en clair. Aucun seuil d'alerte n'est inventé : la fréquence
// d'entretien dépend de l'outil et de l'usage, et une couleur d'alarme
// posée au hasard finirait ignorée. On affiche le fait, l'exploitant juge.
/** Formulation en clair d'une date "AAAA-MM-JJ" quelconque. */
export function dateLisible(date, refDate = aujourdhui()) {
  if (!date) return 'jamais renseigné';
  const j = Math.round((Date.parse(refDate + 'T12:00:00') - Date.parse(date + 'T12:00:00')) / 86400000);
  if (!isFinite(j)) return 'jamais renseigné';
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 31) return `il y a ${j} jours`;
  const mois = Math.floor(j / 30.44);
  if (mois < 12) return `il y a ${mois} mois`;
  const ans = Math.floor(mois / 12);
  return ans === 1 ? "il y a plus d'un an" : `il y a plus de ${ans} ans`;
}
