// Liste des cultures (collection Firestore "cultures_config", un DOCUMENT
// par culture — remplace l'ancien "parcelles_config/typesUsage" qui était
// un doc unique avec un tableau). Chaque culture a son propre id Firestore,
// référencé par assolements.cultureId.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, deleteDoc, getDocs, onSnapshot, setDoc, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'cultures_config');

// Palette par nuances : chaque espèce de prairie garde SA couleur propre
// (vue détaillée de la carte). Pour la vue regroupée (cf.
// vocation.js/FAMILLE_COULEUR), deux familles distinctes plutôt qu'une seule
// 'prairie' : une Prairie Permanente (non retournée, sans compteur d'âge) ne
// se gère pas comme une Prairie Temporaire (semée, retournée au bout de
// quelques années, compteur d'âge 0/1/2...) — les confondre masquerait la
// vraie question d'assolement (combien de PT à ressemer cette année ?). Les
// céréales partagent une seule teinte ambre : leur distinction utile se fait
// par le nom, pas par la couleur.
// 'Colza' (oléagineux) reste le colza grain semé au printemps, récolté l'été
// suivant — sans lien avec 'Colza fourrager' (dérobée), semé en été/automne
// pour être détruit au printemps avant la culture suivante. Même nom de
// plante, deux usages agronomiques différents : deux cultures distinctes,
// jamais une seule qu'on retagguerait au gré des saisons (une exploitation
// qui ferait les deux la même année aurait besoin des deux en même temps).
const DEFAULT_CULTURES = [
  { nom: 'RG Trèfle',              couleur: '#059669', famille: 'prairie_temporaire' },  // vert émeraude
  { nom: 'Luzerne',                couleur: '#10b981', famille: 'prairie_temporaire' },  // vert jade / anis
  { nom: 'Prairie permanente',     couleur: '#65a30d', famille: 'prairie_permanente' },  // vert olive
  { nom: 'Fétuque / Trèfle',       couleur: '#047857', famille: 'prairie_temporaire' },  // vert sapin
  { nom: 'Blé tendre',             couleur: '#d97706', famille: 'cereale' },  // jaune ambre
  { nom: 'Orge',                   couleur: '#d97706', famille: 'cereale' },
  { nom: 'Colza',                  couleur: '#a8b83f', famille: 'oleagineux' },
  { nom: 'Colza fourrager',        couleur: '#8b5cf6', famille: 'derobee' },  // violet dérobée
  { nom: 'Autre',                  couleur: '#9a988f', famille: 'autre' }
];

let currentCultures = []; // [{id, nom, couleur, famille}]
const listeners = new Set();

export function getCultures() {
  return currentCultures;
}

export function onCulturesChange(cb) {
  listeners.add(cb);
  cb(currentCultures);
  return () => listeners.delete(cb);
}

export function getCultureById(id) {
  return currentCultures.find((c) => c.id === id) || null;
}

// Seede les 6 cultures par défaut si la collection est vide (premier lancement).
export async function ensureSeeded() {
  const snap = await getDocs(COL);
  if (snap.empty) {
    for (const c of DEFAULT_CULTURES) {
      await addDoc(COL, c);
    }
  }
}

export function watchCultures() {
  return onSnapshot(COL, (snap) => {
    currentCultures = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listeners.forEach((cb) => cb(currentCultures));
  });
}

export async function addCulture(nom, couleur, famille) {
  const ref = await addDoc(COL, { nom, couleur, famille: famille || 'autre' });
  return ref.id;
}

// Renomme une culture existante — écran Paramètres / Référentiel Cultures.
// Ne touche ni sa couleur ni sa famille : seul le libellé change, les
// implantations qui la référencent (par id, jamais par nom) suivent
// automatiquement, sans ré-écriture ailleurs.
export async function renameCulture(id, nom) {
  const propre = String(nom || '').trim();
  if (!id || !propre) throw new Error('Donne un nom à la culture.');
  await setDoc(doc(db, 'cultures_config', id), { nom: propre, majLe: serverTimestamp() }, { merge: true });
}

// Suppression définitive — réservée à l'écran Paramètres / Référentiel
// Cultures, qui vérifie AVANT d'appeler ceci qu'aucune implantation
// n'y fait référence (cf. ui-parametres.js) : supprimer une culture encore
// utilisée transformerait silencieusement son libellé en "À renseigner"
// partout où elle apparaît (carte, liste, assolement).
export async function deleteCulture(id) {
  if (!id) return;
  await deleteDoc(doc(db, 'cultures_config', id));
}

// Reclasse une culture existante (PP/PT/Céréale/Dérobée/...) depuis la fiche
// parcelle — ex. une prairie migrée automatiquement en PT qui est en fait une
// PP, ou une culture historique jamais classée finement. N'écrit rien si la
// famille n'a pas changé.
export async function updateCultureFamille(id, famille) {
  if (!id || !famille) return;
  await setDoc(doc(db, 'cultures_config', id), { famille, majLe: serverTimestamp() }, { merge: true });
}

// Reprise des cultures créées avant la distinction PP/PT : toute culture
// encore sur l'ancienne famille générique 'prairie' est reclassée d'après
// son nom (permanente/naturelle -> PP, sinon -> PT, l'écrasante majorité des
// cas réels). Idempotent — une fois reclassée, une culture ne porte plus
// 'prairie' et n'est plus retouchée aux passages suivants.
export async function migrerFamillesPrairie() {
  let repris = 0;
  const snap = await getDocs(COL);
  for (const d of snap.docs) {
    const c = { id: d.id, ...d.data() };
    if (c.famille !== 'prairie') continue;
    const permanente = /permanente|naturelle/i.test(c.nom || '');
    await setDoc(
      doc(db, 'cultures_config', c.id),
      { famille: permanente ? 'prairie_permanente' : 'prairie_temporaire', majLe: serverTimestamp() },
      { merge: true }
    );
    repris++;
  }
  return repris;
}

// Ajoute "Colza fourrager" (dérobée) s'il n'existe pas déjà — pour une base
// déjà seedée avant l'ajout de cette culture (ensureSeeded ne seede que sur
// collection vide). Idempotent par nom : relancer ne crée pas de doublon.
export async function ensureColzaFourrager() {
  const snap = await getDocs(COL);
  const cible = 'colza fourrager';
  if (snap.docs.some((d) => String(d.data().nom || '').trim().toLowerCase() === cible)) return false;
  await addDoc(COL, { nom: 'Colza fourrager', couleur: '#8b5cf6', famille: 'derobee' });
  return true;
}
