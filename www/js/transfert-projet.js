// Transfert vers le projet Firebase propre à Logisol (séparation d'Ovilog, étape 3).
//
// Copie À L'IDENTIQUE (même identifiant, même contenu) les collections de Logisol de
// l'ancien projet partagé (ovilog-15ef6, celui de l'appli en cours) vers le nouveau
// projet (logisol-1e61b), puis relit les deux côtés sur le serveur et compare chaque
// document exactement. L'ANCIEN PROJET N'EST QUE LU : aucune écriture, aucune suppression.
//
// Garde-fous :
// - liste FERMÉE de collections (COLLECTIONS_LOGISOL), jamais de découverte automatique
//   (impossible depuis une appli, et voulu) : le bilan rappelle de comparer avec la console ;
// - mot de passe du nouveau projet : lu une fois pour la connexion, jamais conservé,
//   jamais écrit dans un journal ni dans le bilan ; session du nouveau projet en mémoire
//   seulement, fermée à la fin (réussite, écart ou erreur) ;
// - avant de copier : en ligne, et toutes les saisies hors réseau envoyées à l'ancien serveur ;
// - quota gratuit : au plus QUOTA_ECRITURES_JOUR écritures par jour, reprise le lendemain
//   collection par collection ;
// - verdict global : « TOUT IDENTIQUE » ou « ÉCART : … » ; la bascule (étape 4) n'est
//   permise qu'avec « TOUT IDENTIQUE » et la liste des collections vérifiée dans la console.
import { initializeApp, deleteApp } from '../vendor/firebase/firebase-app.js';
import {
  initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut, connectAuthEmulator
} from '../vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, memoryLocalCache, connectFirestoreEmulator, collection, doc,
  getDocsFromServer, writeBatch, waitForPendingWrites, terminate,
  Timestamp, GeoPoint, Bytes, DocumentReference
} from '../vendor/firebase/firebase-firestore.js';
import { CONFIG_NOUVEAU_PROJET, NOM_NOUVEAU_PROJET, EMULATEUR_TRANSFERT } from './transfert-config.js';

export const NOM_ANCIEN_PROJET = 'ovilog-15ef6';

// Liste FERMÉE : 21 noms historiques + 16 collections « lgs_* » du code (37). « lgs_journal_ecritures »
// n'en fait pas partie : c'est une clé de stockage local du téléphone (journal-ecritures.js), pas une collection.
export const COLLECTIONS_LOGISOL = [
  'campagnes', 'produits', 'mouvements_stock', 'rotations_plans', 'rotations_revisions',
  'stades_physiologiques_config', 'affectations_stade', 'plans_alimentation',
  'distributions_alimentation', 'interventions_config', 'parcelles', 'parcelles_config',
  'cultures_config', 'implantations', 'assolements', 'interventions', 'interventions_types',
  'stocks', 'stades_config', 'lots_animaux', 'prelevements',
  'lgs_assolement_previsionnel', 'lgs_batiments', 'lgs_cellules_grain', 'lgs_clotures_stock',
  'lgs_config', 'lgs_emplacements_fourrage', 'lgs_exploitation',
  'lgs_materiel', 'lgs_materiel_entretien', 'lgs_materiel_pieces', 'lgs_melanges',
  'lgs_mouvements_stock', 'lgs_paturage_exceptions', 'lgs_paturage_periodes',
  'lgs_plan_campagne', 'lgs_traces'
];
// Collections d'Ovilog dans l'ancien projet : jamais lues ni copiées ici.
export const COLLECTIONS_OVILOG = ['users', 'feedback', 'admins', 'erreurs'];

export const QUOTA_ECRITURES_JOUR = 18000;
const TAILLE_LOT = 400;
const DELAI_SAISIES_HORS_RESEAU_MS = 30000;
const CLE_PROGRESSION = 'logisol_transfert_progression';
const DETAILS_MAX = 30;

// ---------- comparaison exacte ----------

/**
 * Forme canonique d'une valeur Firestore : deux valeurs sont identiques si et seulement si
 * leurs formes canoniques le sont. Dates à la nanoseconde, tableaux dans l'ordre, clés
 * d'objet triées, champ absent ≠ champ null (un champ null reste une clé de l'objet).
 */
export function canonique(v) {
  if (v === null) return 'null';
  if (v instanceof Timestamp) return 'T(' + v.seconds + ',' + v.nanoseconds + ')';
  if (v instanceof GeoPoint) return 'G(' + v.latitude + ',' + v.longitude + ')';
  if (v instanceof Bytes) return 'B(' + v.toBase64() + ')';
  if (v instanceof DocumentReference) return 'R(' + v.path + ')';
  if (Array.isArray(v)) return '[' + v.map(canonique).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonique(v[k])).join(',') + '}';
  }
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : (Number.isNaN(v) ? 'NaN' : String(v));
  return typeof v + ':' + JSON.stringify(v);
}

/** Compare deux instantanés { id: data } d'une même collection. */
export function comparerCollection(ancien, nouveau) {
  const manquants = [], enTrop = [], differents = [];
  for (const id of Object.keys(ancien)) {
    if (!(id in nouveau)) manquants.push(id);
    else if (canonique(ancien[id]) !== canonique(nouveau[id])) differents.push(id);
  }
  for (const id of Object.keys(nouveau)) if (!(id in ancien)) enTrop.push(id);
  return {
    nAncien: Object.keys(ancien).length, nNouveau: Object.keys(nouveau).length,
    manquants, enTrop, differents,
    identique: !manquants.length && !enTrop.length && !differents.length
  };
}

// ---------- quota et reprise ----------

function aujourdhui() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function lireProgression() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(CLE_PROGRESSION) || 'null'); } catch (_) { p = null; }
  if (!p || typeof p !== 'object') p = { jour: aujourdhui(), ecritures: 0, faites: [] };
  if (p.jour !== aujourdhui()) { p.jour = aujourdhui(); p.ecritures = 0; }
  if (!Array.isArray(p.faites)) p.faites = [];
  return p;
}
function ecrireProgression(p) {
  try { localStorage.setItem(CLE_PROGRESSION, JSON.stringify(p)); } catch (_) { /* reprise perdue : pas bloquant */ }
}

// ---------- connexion au nouveau projet ----------

/**
 * Ouvre une connexion au nouveau projet, en mémoire seulement (rien sur l'appareil).
 * `motDePasse` n'est utilisé que pour cet appel : il n'est ni conservé ni journalisé.
 * @returns {Promise<{db, fermer: () => Promise<void>}>}
 */
export async function ouvrirNouveauProjet(email, motDePasse) {
  const app = initializeApp(CONFIG_NOUVEAU_PROJET, 'logisol-transfert-' + Date.now());
  let auth = null, db = null;
  const fermer = async () => {
    try { if (auth) await signOut(auth); } catch (_) { /* déjà déconnecté */ }
    try { if (db) await terminate(db); } catch (_) { /* déjà fermé */ }
    try { await deleteApp(app); } catch (_) { /* déjà supprimée */ }
    auth = null; db = null;
  };
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
    if (EMULATEUR_TRANSFERT) {
      connectAuthEmulator(auth, EMULATEUR_TRANSFERT.auth, { disableWarnings: true });
      connectFirestoreEmulator(db, EMULATEUR_TRANSFERT.hote, EMULATEUR_TRANSFERT.port);
    }
    await signInWithEmailAndPassword(auth, email, motDePasse);
    return { db, fermer };
  } catch (err) {
    await fermer();
    throw new Error(messageConnexion(err));
  }
}

function messageConnexion(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    return 'Connexion au nouveau projet refusée : e-mail ou mot de passe incorrect (compte du projet ' + NOM_NOUVEAU_PROJET + ').';
  }
  if (code === 'auth/network-request-failed') return 'Connexion au nouveau projet impossible : pas de réseau.';
  if (code === 'auth/too-many-requests') return 'Trop de tentatives de connexion : réessayer dans quelques minutes.';
  return 'Connexion au nouveau projet impossible (' + (code || 'erreur inconnue') + ').';
}

// ---------- lecture, copie, contrôle ----------

async function lireServeur(db, nom) {
  const snap = await getDocsFromServer(collection(db, nom));
  const docs = {};
  snap.docs.forEach((d) => { docs[d.id] = d.data(); });
  return docs;
}

async function attendreSaisiesHorsReseau(dbAncien) {
  let minuteur;
  const delai = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error(
      'Des saisies faites hors réseau ne sont pas encore arrivées sur le serveur. Rester en ligne quelques minutes, puis relancer le transfert.'
    )), DELAI_SAISIES_HORS_RESEAU_MS);
  });
  try { await Promise.race([waitForPendingWrites(dbAncien), delai]); }
  finally { clearTimeout(minuteur); }
}

/**
 * Copie puis contrôle. N'écrit QUE dans `dbNouveau` ; `dbAncien` est seulement lu.
 * @param {{dbAncien, dbNouveau, progression?: (texte:string) => void}} p
 */
export async function transfererEtControler({ dbAncien, dbNouveau, progression }) {
  const dire = (t) => { if (progression) progression(t); };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Hors réseau : le transfert demande une connexion. Relancer une fois en ligne.');
  }
  dire('Vérification des saisies hors réseau…');
  await attendreSaisiesHorsReseau(dbAncien);

  // 1. Copie, collection par collection, dans la limite du quota du jour
  const prog = lireProgression();
  const restantes = COLLECTIONS_LOGISOL.filter((c) => !prog.faites.includes(c));
  let quotaAtteint = null;
  for (const nom of restantes) {
    dire('Lecture de « ' + nom + ' »…');
    const ancien = await lireServeur(dbAncien, nom);
    const nouveau = await lireServeur(dbNouveau, nom);
    const aSupprimer = Object.keys(nouveau).filter((id) => !(id in ancien));
    const besoin = Object.keys(ancien).length + aSupprimer.length;
    if (prog.ecritures + besoin > QUOTA_ECRITURES_JOUR) {
      quotaAtteint = { collection: nom, besoin, deja: prog.ecritures };
      break;
    }
    const ops = Object.keys(ancien).map((id) => ({ type: 'set', id, data: ancien[id] }))
      .concat(aSupprimer.map((id) => ({ type: 'delete', id })));
    for (let i = 0; i < ops.length; i += TAILLE_LOT) {
      dire('Copie de « ' + nom + ' » : ' + Math.min(i + TAILLE_LOT, ops.length) + ' / ' + ops.length);
      const lot = writeBatch(dbNouveau);
      ops.slice(i, i + TAILLE_LOT).forEach((op) => {
        const ref = doc(dbNouveau, nom, op.id);
        if (op.type === 'set') lot.set(ref, op.data); else lot.delete(ref);
      });
      await lot.commit();
    }
    prog.faites.push(nom);
    prog.ecritures += besoin;
    ecrireProgression(prog);
  }

  // 2. Contrôle : relecture des deux côtés sur le serveur, comparaison exacte
  const resultats = [];
  for (const nom of COLLECTIONS_LOGISOL) {
    dire('Contrôle de « ' + nom + ' »…');
    resultats.push({ nom, ...comparerCollection(await lireServeur(dbAncien, nom), await lireServeur(dbNouveau, nom)) });
  }
  // Passe complète terminée : le prochain transfert (rattrapage avant la bascule) recopie tout
  if (!quotaAtteint) { prog.faites = []; ecrireProgression(prog); }
  return { date: new Date(), resultats, quotaAtteint, ecrituresDuJour: prog.ecritures };
}

// ---------- bilan ----------

/** Verdict global. */
export function verdict(rapport) {
  const ecarts = rapport.resultats.filter((r) => !r.identique);
  if (rapport.quotaAtteint) return { ok: false, texte: 'ÉCART : transfert incomplet (quota du jour atteint), reprendre demain' };
  if (ecarts.length) return { ok: false, texte: 'ÉCART : ' + ecarts.length + ' collection(s) différente(s) — ' + ecarts.map((r) => r.nom).join(', ') };
  return { ok: true, texte: 'TOUT IDENTIQUE' };
}

/** Bilan en texte brut copiable (aucun e-mail ni mot de passe). */
export function bilanTexte(rapport) {
  const v = verdict(rapport);
  const l = [];
  l.push('Transfert Logisol : ' + NOM_ANCIEN_PROJET + ' (ancien, lu seulement) → ' + NOM_NOUVEAU_PROJET + ' (nouveau)');
  l.push('Date : ' + rapport.date.toLocaleString('fr-FR'));
  l.push('VERDICT : ' + v.texte);
  l.push('');
  l.push('Collections de Logisol (liste fermée, ' + COLLECTIONS_LOGISOL.length + ') — ancien = nouveau :');
  const details = [];
  rapport.resultats.forEach((r) => {
    if (r.identique) { l.push('  ' + r.nom + ' : ' + r.nAncien + ' = ' + r.nNouveau + ' ✔'); return; }
    l.push('  ' + r.nom + ' : ' + r.nAncien + (r.nAncien === r.nNouveau ? ' = ' : ' ≠ ') + r.nNouveau + ' ✘'
      + ' (absents du nouveau : ' + r.manquants.length + ', en trop dans le nouveau : ' + r.enTrop.length
      + ', contenu différent : ' + r.differents.length + ')');
    r.manquants.forEach((id) => details.push(r.nom + '/' + id + ' : absent du nouveau projet'));
    r.enTrop.forEach((id) => details.push(r.nom + '/' + id + ' : présent seulement dans le nouveau projet'));
    r.differents.forEach((id) => details.push(r.nom + '/' + id + ' : contenu différent'));
  });
  if (details.length) {
    l.push('');
    l.push('Détail des écarts' + (details.length > DETAILS_MAX ? ' (' + DETAILS_MAX + ' premiers sur ' + details.length + ')' : '') + ' :');
    details.slice(0, DETAILS_MAX).forEach((d) => l.push('  ' + d));
  }
  if (rapport.quotaAtteint) {
    l.push('');
    l.push('Quota du jour atteint avant « ' + rapport.quotaAtteint.collection + ' » (' + rapport.quotaAtteint.besoin
      + ' écritures nécessaires, ' + rapport.quotaAtteint.deja + ' déjà faites aujourd\'hui sur ' + QUOTA_ECRITURES_JOUR
      + ') : relancer demain, le transfert reprend où il s\'est arrêté.');
  }
  l.push('');
  l.push('Collections d\'Ovilog dans l\'ancien projet, jamais copiées : ' + COLLECTIONS_OVILOG.join(', '));
  l.push('');
  l.push('À VÉRIFIER (une fois, avant la bascule) : console Firebase, projet ' + NOM_ANCIEN_PROJET
    + ' › Firestore Database › onglet Données. La colonne de gauche ne doit contenir AUCUN autre nom que les '
    + COLLECTIONS_LOGISOL.length + ' collections de Logisol et les ' + COLLECTIONS_OVILOG.length
    + ' d\'Ovilog ci-dessus. Un nom en plus : le signaler avant la bascule.');
  l.push('Bascule (étape 4) : seulement avec « TOUT IDENTIQUE » ET la vérification ci-dessus faite.');
  return l.join('\n');
}

// ---------- écran (Diagnostic › Outils) ----------

export function initTransfertProjet({ dbAncien }) {
  const el = {};
  ['email', 'mdp', 'lancer', 'etat', 'verdict', 'bilan', 'copier'].forEach((k) => { el[k] = document.getElementById('transfert-' + k); });
  if (!el.lancer) return;
  let enCours = false;
  el.lancer.addEventListener('click', async () => {
    if (enCours) return;
    const email = el.email.value.trim();
    // Mot de passe : lu une seule fois, le champ est vidé aussitôt ; il n'existe ensuite
    // que le temps de l'appel de connexion (jamais journalisé, jamais conservé).
    const motDePasse = el.mdp.value;
    el.mdp.value = '';
    if (!email || !motDePasse) { afficherEtat('Saisir l\'e-mail et le mot de passe du compte du NOUVEAU projet.', true); return; }
    enCours = true;
    el.lancer.disabled = true;
    el.verdict.hidden = true; el.bilan.hidden = true; el.copier.hidden = true;
    let connexion = null;
    try {
      afficherEtat('Connexion au nouveau projet…');
      connexion = await ouvrirNouveauProjet(email, motDePasse);
      const rapport = await transfererEtControler({ dbAncien, dbNouveau: connexion.db, progression: (t) => afficherEtat(t) });
      const v = verdict(rapport);
      el.verdict.textContent = (v.ok ? '✔ ' : '✘ ') + v.texte;
      el.verdict.className = 'transfert-verdict ' + (v.ok ? 'ok' : 'ecart');
      el.verdict.hidden = false;
      el.bilan.textContent = bilanTexte(rapport);
      el.bilan.hidden = false;
      el.copier.hidden = false;
      afficherEtat(v.ok ? 'Transfert terminé. Ancien projet inchangé.' : 'Transfert terminé avec des écarts : voir le bilan. Ancien projet inchangé.', !v.ok);
    } catch (err) {
      afficherEtat((err && err.message) || 'Transfert interrompu.', true);
    } finally {
      if (connexion) await connexion.fermer();
      connexion = null;
      enCours = false;
      el.lancer.disabled = false;
    }
  });
  el.copier.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(el.bilan.textContent); afficherEtat('Bilan copié.'); }
    catch (_) { afficherEtat('Copie impossible : sélectionner le texte du bilan à la main.', true); }
  });
  function afficherEtat(texte, erreur) {
    el.etat.textContent = texte;
    el.etat.classList.toggle('champ-aide-erreur', !!erreur);
  }
}
