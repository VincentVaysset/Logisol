// Diagnostic des règles Firestore.
//
// Il n'existe AUCUN moyen, depuis l'appli, de créer une collection ou de
// modifier des règles : une collection Firestore n'a pas d'existence propre
// (elle apparaît avec son premier document), et les règles ne se déploient
// qu'avec des identifiants d'administration, que l'appli n'a pas — et ne doit
// pas avoir, puisque les déployer écraserait celles d'Ovilog.
//
// Ce qui EST faisable, et que fait ce module : transformer un
// « permission-denied » muet en message qui dit exactement quelle collection
// est refusée et quoi coller. C'est le seul automatisme honnête ici.
import { db } from './firebase-config.js';
import { collection, getDocs, limit, query } from "../vendor/firebase/firebase-firestore.js";

// Toutes les collections dont l'appli a besoin. Ajouter un module = ajouter
// son nom ici, et le diagnostic le couvre.
const REQUISES = [
  // Collections historiques, autorisées nommément dans les règles.
  'parcelles', 'cultures_config', 'implantations',
  'interventions', 'interventions_types',
  'stocks', 'stades_config', 'lots_animaux', 'prelevements',
  // Collections préfixées, couvertes d'avance par le joker des règles.
  'lgs_batiments', 'lgs_cellules_grain', 'lgs_emplacements_fourrage',
  'lgs_mouvements_stock', 'lgs_materiel', 'lgs_assolement_previsionnel'
];

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }

/**
 * Message d'erreur nommant la collection refusée.
 *
 * Un « permission-denied » brut ne dit pas SUR QUOI il porte : face à une
 * fiche bâtiment qui refuse d'enregistrer, impossible de savoir s'il s'agit
 * du bâtiment, d'une cellule ou d'un mouvement. On nomme donc la collection
 * et on rappelle l'action à faire.
 * @param {*} err
 * @param {string} collection
 */
export function messagePermission(err, collection) {
  const code = err && err.code ? err.code : '';
  if (code !== 'permission-denied') {
    return `${code ? code + ' — ' : ''}${(err && err.message) || err}`;
  }
  return `Firestore refuse la collection « ${collection} ». Les règles publiées ne la couvrent pas : ` +
         `colle le fichier firestore-logisol.rules (celui-là, PAS firestore.rules) À L'INTÉRIEUR du bloc ` +
         `match /databases/{database}/documents { … } existant, puis publie. Les règles s'appliquent ` +
         `aussitôt : il suffit ensuite de retaper Enregistrer, ta saisie est conservée.`;
}

/**
 * Teste l'accès en lecture à chaque collection et renvoie celles qui sont
 * refusées. Une seule lecture d'un document par collection : négligeable au
 * démarrage, et servie par le cache hors-ligne aux lancements suivants.
 * @returns {Promise<string[]>} noms des collections refusées
 */
export async function collectionsRefusees() {
  const refusees = [];
  for (const nom of REQUISES) {
    try {
      await getDocs(query(collection(db, nom), limit(1)));
    } catch (err) {
      // On ne retient QUE le refus de permission : hors-ligne, une lecture
      // peut échouer pour une tout autre raison, et annoncer un problème de
      // règles à un éleveur au fond d'un vallon serait un contresens.
      if (err && err.code === 'permission-denied') refusees.push(nom);
    }
  }
  return refusees;
}

/**
 * Vérifie au démarrage et affiche un message actionnable si besoin.
 * @param {(msg:string, collections:string[]) => void} onProbleme
 */
export async function verifierRegles(onProbleme) {
  try {
    const refusees = await collectionsRefusees();
    if (!refusees.length) {
      log('Règles Firestore : toutes les collections sont accessibles');
      return [];
    }
    log('Règles Firestore : ' + refusees.length + ' collection(s) refusée(s) — ' + refusees.join(', '));
    if (onProbleme) {
      onProbleme(
        `Firestore refuse ${refusees.length} collection${refusees.length > 1 ? 's' : ''} : ` +
        refusees.join(', ') +
        '. Colle firestore-logisol.rules (5 lignes, PAS le fichier firestore.rules) à l\'intérieur du ' +
        'bloc match /databases/{database}/documents existant, à côté des règles d\'Ovilog, puis publie.',
        refusees
      );
    }
    return refusees;
  } catch (err) {
    log('Diagnostic des règles impossible : ' + ((err && err.message) || err));
    return [];
  }
}
