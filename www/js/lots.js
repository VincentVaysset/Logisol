// Lots d'animaux (collection "lots_animaux") et journal des prélèvements sur
// les stocks (collection "prelevements").
//
// POURQUOI UN HISTORIQUE PLUTÔT QU'UN SIMPLE CHAMP « stock utilisé »
// Le choix du stock est manuel et change en cours de saison (« cette semaine
// on tape dans la 2ᵉ coupe »). Si le lot ne portait qu'un champ écrasable, le
// jour où Vincent bascule du stock A vers le stock B, tout ce que le lot a
// déjà consommé sur A disparaîtrait du calcul. Chaque affectation est donc
// une PÉRIODE — même principe que les implantations.
//
// UNE PÉRIODE, PLUSIEURS LIGNES
// Une ration peut mêler un fourrage de la ferme, une céréale de la ferme et
// un aliment du commerce (cf. stades.js/composantsDuStade). Une « période »
// (stade + début + fin + effectif) se traduit donc en UNE ligne de
// prélèvement PAR COMPOSANT actif, toutes reliées par un même groupeId — pour
// pouvoir les afficher, les modifier et les supprimer ensemble sans casser
// l'agrégation par catégorie de stock (chaque ligne garde sa propre
// categorieCle, exactement comme avant).
//
// PLAN DE CAMPAGNE = PÉRIODES DATÉES À L'AVANCE
// Une période peut être créée avec sa date de fin déjà connue (« Fin
// gestation du 15/09 au 14/10 ») avant même d'avoir commencé : c'est le plan
// de campagne d'un lot. Comme joursNourris()/tonnesConsommees() calculent
// déjà à partir des dates réelles, une période future ne compte pour rien
// tant que sa date de début n'est pas atteinte, et se met à compter seule le
// jour venu — aucune tâche de fond n'est nécessaire.
//
// Chaque période fige la ration et l'effectif du moment. Un lot qui change de
// stade ou dont on corrige l'effectif ne doit pas réécrire rétroactivement ce
// qui a déjà été consommé : ce qui est mangé est mangé.
//
// Convention de dates : "debut" est inclus, "fin" est EXCLUE. Le jour où l'on
// bascule d'un stock à l'autre compte donc pour le nouveau, jamais deux fois.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui } from './implantations.js';
import { cleCommerce } from './stocks.js';
import { composantsDuStade } from './stades.js';

const COL_LOTS = collection(db, 'lots_animaux');
const COL_PREL = collection(db, 'prelevements');

let lots = [];
let prelevements = [];
const listenersLots = new Set();
const listenersPrel = new Set();

export function getLots() { return lots; }
export function getPrelevements() { return prelevements; }

export function onLotsChange(cb) { listenersLots.add(cb); cb(lots); return () => listenersLots.delete(cb); }
export function onPrelevementsChange(cb) { listenersPrel.add(cb); cb(prelevements); return () => listenersPrel.delete(cb); }

export function watchLots() {
  return onSnapshot(COL_LOTS, (snap) => {
    lots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listenersLots.forEach((cb) => cb(lots));
  });
}

export function watchPrelevements() {
  return onSnapshot(COL_PREL, (snap) => {
    prelevements = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    listenersPrel.forEach((cb) => cb(prelevements));
  });
}

// Une période est ACTIVE à une date donnée si elle a commencé et n'est pas
// encore finie — que sa fin soit connue à l'avance (plan de campagne) ou
// encore ouverte. Remplace l'ancien raccourci "!p.fin" : une période
// planifiée à l'avance avec ses deux bornes connues doit compter comme
// active pendant sa fenêtre, pas seulement les périodes encore ouvertes.
export function estActive(p, date = aujourdhui()) {
  return !!p && !!p.debut && p.debut <= date && (!p.fin || p.fin > date);
}

// Toutes les lignes de prélèvement actives d'un lot à une date donnée — une
// par composant de sa période en cours (fourrage, céréale, commerce...).
export function prelevementsActifs(lotId, liste = prelevements, date = aujourdhui()) {
  return liste.filter((p) => p.lotId === lotId && estActive(p, date));
}

// Compat : une seule ligne active (la plus récemment démarrée), pour les
// appels qui ne raisonnent pas encore en plusieurs composants.
export function prelevementEnCours(lotId, liste = prelevements, date = aujourdhui()) {
  const actifs = prelevementsActifs(lotId, liste, date).sort((a, b) => (a.debut < b.debut ? 1 : -1));
  return actifs[0] || null;
}

// Le stade réellement en vigueur aujourd'hui pour un lot, déduit du journal
// plutôt que d'un champ à tenir soi-même à jour : une période plus tôt
// planifiée qui vient de démarrer ne doit rien avoir à "activer" à la main.
export function stadeActifId(lotId, liste = prelevements, date = aujourdhui()) {
  const p = prelevementEnCours(lotId, liste, date);
  return p ? p.stadeId : null;
}

export function historiqueLot(lotId, liste = prelevements) {
  return liste
    .filter((p) => p.lotId === lotId)
    .sort((a, b) => (a.debut < b.debut ? 1 : -1));
}

// Regroupe les lignes de prélèvement d'un lot par période (un groupeId = une
// période plan​ifiée, une ligne par composant de la ration de ce moment-là).
// Les prélèvements écrits avant l'introduction des groupes n'ont pas de
// groupeId : chacun forme alors son propre groupe, comme avant.
export function periodesLot(lotId, liste = prelevements) {
  const parGroupe = new Map();
  historiqueLot(lotId, liste).forEach((p) => {
    const gid = p.groupeId || p.id;
    if (!parGroupe.has(gid)) {
      parGroupe.set(gid, {
        groupeId: gid, stadeId: p.stadeId, stadeNom: p.stadeNom,
        debut: p.debut, fin: p.fin, nbBrebis: p.nbBrebis, lignes: []
      });
    }
    parGroupe.get(gid).lignes.push(p);
  });
  return Array.from(parGroupe.values()).sort((a, b) => (a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : 0));
}

// Nombre de jours effectivement nourris par une période jusqu'à une date
// donnée. fin exclue ; une période ouverte court jusqu'à aujourd'hui inclus ;
// une période dont la fin est déjà connue mais pas encore atteinte, ou qui
// n'a pas encore commencé, ne compte que ce qui est réellement écoulé.
export function joursNourris(prel, date = aujourdhui()) {
  if (!prel || !prel.debut) return 0;
  const plafond = lendemain(date);
  const finExclue = prel.fin && prel.fin < plafond ? prel.fin : plafond;
  const j = Math.round(
    (Date.parse(finExclue + 'T12:00:00') - Date.parse(prel.debut + 'T12:00:00')) / 86400000
  );
  return Math.max(0, isFinite(j) ? j : 0);
}

export function tonnesConsommees(prel, date = aujourdhui()) {
  const kg = (Number(prel.rationKgParBrebis) || 0) * (Number(prel.nbBrebis) || 0) * joursNourris(prel, date);
  return Math.round((kg / 1000) * 1000) / 1000;
}

export function besoinJournalierKg(prel) {
  return (Number(prel.rationKgParBrebis) || 0) * (Number(prel.nbBrebis) || 0);
}

function lendemain(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Écriture -------------------------------------------------------------
// stadeId n'est plus saisi ici : c'est un CACHE du stade réellement actif,
// entretenu par planifierPeriode()/synchroniserStadeCache() à partir du
// journal des périodes — même principe que le niveau d'un contenant, dérivé
// des mouvements plutôt que saisi. On le garde néanmoins en écriture pour ne
// pas casser un lot legacy créé avant l'introduction des périodes groupées.
export async function createLot({ nom, nbBrebis, stadeId = null, batimentId = null, notes = '' }) {
  if (!nom || !nom.trim()) throw new Error('Donne un nom au lot.');
  const n = Number(nbBrebis);
  if (!isFinite(n) || n <= 0) throw new Error('Le nombre de brebis doit être supérieur à 0.');
  const ref = await addDoc(COL_LOTS, {
    // batimentId rattache le lot à sa bergerie — c'est le « LotBergerie » du
    // schéma reçu, fusionné avec les lots existants plutôt que dupliqué : un
    // second modèle de lot aurait fait cohabiter deux effectifs concurrents
    // pour les mêmes brebis, l'un nourri par les rations, l'autre non.
    nom: nom.trim(), nbBrebis: n, stadeId, batimentId, notes,
    creeLe: serverTimestamp(), majLe: serverTimestamp()
  });
  return ref.id;
}

export async function updateLot(id, { nom, nbBrebis, batimentId = null, notes = '' }) {
  const n = Number(nbBrebis);
  if (!isFinite(n) || n <= 0) throw new Error('Le nombre de brebis doit être supérieur à 0.');
  return updateDoc(doc(db, 'lots_animaux', id), {
    nom: String(nom || '').trim(), nbBrebis: n, batimentId, notes,
    majLe: serverTimestamp()
  });
}

export async function deleteLot(id) {
  // Les prélèvements du lot partent avec lui : sans ça, ils continueraient à
  // amputer les stocks au nom d'un lot qui n'existe plus.
  const aSupprimer = prelevements.filter((p) => p.lotId === id);
  await deleteDoc(doc(db, 'lots_animaux', id));
  for (const p of aSupprimer) {
    await deleteDoc(doc(db, 'prelevements', p.id)).catch(() => {});
  }
}

/**
 * Planifie une période pour un lot : un stade, une fenêtre de dates (fin
 * facultative — plan de campagne connu à l'avance ou période encore
 * ouverte), un effectif, et pour chaque composant « ferme » de la ration du
 * stade le stock choisi (les composants « commerce » n'ont pas besoin de
 * stock : achetés au besoin, cf. stocks.cleCommerce).
 *
 * Fait d'abord place nette à partir de la date de début, sur TOUTES les
 * lignes existantes du lot (tous composants confondus) — même logique
 * qu'avant l'introduction des périodes groupées :
 *   * une ligne qui COMMENCE à/après la date n'a plus lieu d'être ;
 *   * une ligne qui l'ENJAMBE est tronquée à cette date (fin exclue).
 * Antidater plus loin aurait fait se chevaucher deux périodes et compté deux
 * fois les mêmes journées sur deux stocks différents.
 *
 * @param {{id:string, nom:string}} lot
 * @param {object} p
 * @param {object} p.stade            stade physiologique (avec ses composants)
 * @param {number} p.nbBrebis         effectif de cette période
 * @param {string} p.debut
 * @param {string|null} [p.fin]       null = période ouverte
 * @param {Object<string,{cle:string,label:string}>} [p.stocksParComposant]
 *        stock choisi par composant.id, pour les composants ferme uniquement
 * @returns {Promise<{groupeId:string, ids:string[]}|null>}
 */
export async function planifierPeriode(lot, { stade, nbBrebis, debut, fin = null, stocksParComposant = {} }) {
  const date = debut || aujourdhui();
  if (fin && fin <= date) throw new Error('La date de fin doit être postérieure à la date de début.');

  for (const p of historiqueLot(lot.id)) {
    if (p.debut >= date) {
      await deleteDoc(doc(db, 'prelevements', p.id)).catch(() => {});
    } else if (!p.fin || p.fin > date) {
      await updateDoc(doc(db, 'prelevements', p.id), { fin: date, majLe: serverTimestamp() });
    }
  }

  if (!stade) { await synchroniserStadeCache([lot], prelevements); return null; }

  const composants = composantsDuStade(stade);
  const n = Number(nbBrebis != null ? nbBrebis : lot.nbBrebis) || 0;
  const groupeId = idGroupe();
  const ids = [];
  for (const comp of composants) {
    const estCommerce = comp.origine === 'commerce';
    const choix = stocksParComposant ? stocksParComposant[comp.id] : null;
    const categorieCle = estCommerce ? cleCommerce(comp.nom) : (choix ? choix.cle : null);
    // Un composant ferme sans stock choisi n'ouvre aucune ligne : sa
    // consommation ne serait rattachée à rien de vérifiable. Il réapparaîtra
    // simplement comme composant "non affecté" à la prochaine ouverture du lot.
    if (!categorieCle) continue;
    const categorieLabel = estCommerce ? comp.nom : (choix ? choix.label : '');
    const ref = await addDoc(COL_PREL, {
      lotId: lot.id,
      lotNom: lot.nom,
      groupeId,
      composantId: comp.id,
      composantOrigine: comp.origine,
      categorieCle,
      categorieLabel: categorieLabel || '',
      stadeId: stade.id,
      stadeNom: stade.nom,
      // Instantané délibéré : ce qui a déjà été consommé ne doit pas bouger si
      // la ration du stade est modifiée plus tard.
      rationKgParBrebis: Number(comp.doseKgParBrebis) || 0,
      nbBrebis: n,
      debut: date,
      fin: fin || null,
      creeLe: serverTimestamp(),
      majLe: serverTimestamp()
    });
    ids.push(ref.id);
  }

  // Le cache stadeId du lot ne bouge que si cette période est déjà (ou déjà
  // depuis peu) en vigueur aujourd'hui — une période future reste sans effet
  // sur l'affichage tant que sa date de début n'est pas atteinte.
  if (date <= aujourdhui()) {
    await updateDoc(doc(db, 'lots_animaux', lot.id), { stadeId: stade.id, majLe: serverTimestamp() }).catch(() => {});
  }

  return { groupeId, ids };
}

// Supprime toutes les lignes d'une période (un composant = une ligne),
// identifiées par leur groupeId commun — l'unité de suppression vue par
// l'utilisateur reste "une période", jamais une ligne isolée.
export async function supprimerPeriode(groupeId, liste = prelevements) {
  const lignes = liste.filter((p) => (p.groupeId || p.id) === groupeId);
  for (const p of lignes) await deleteDoc(doc(db, 'prelevements', p.id)).catch(() => {});
}

// Recale le cache stadeId de chaque lot sur ce que le journal dit être actif
// aujourd'hui — appelé à chaque rendu de la vue Troupeau, pour qu'une période
// planifiée à l'avance dont la date de début vient d'être atteinte se
// reflète sans action manuelle, exactement comme un niveau de stock se
// recalcule seul après un mouvement.
export async function synchroniserStadeCache(lotsAVerifier, liste = prelevements) {
  for (const lot of lotsAVerifier) {
    const actif = stadeActifId(lot.id, liste);
    if (actif && actif !== lot.stadeId) {
      await updateDoc(doc(db, 'lots_animaux', lot.id), { stadeId: actif, majLe: serverTimestamp() }).catch(() => {});
    }
  }
}

function idGroupe() {
  return Math.random().toString(36).slice(2, 10);
}

export async function cloturerPrelevement(id, fin) {
  return setDoc(doc(db, 'prelevements', id), { fin: fin || aujourdhui(), majLe: serverTimestamp() }, { merge: true });
}

export async function deletePrelevement(id) {
  return deleteDoc(doc(db, 'prelevements', id)).catch(() => {});
}
