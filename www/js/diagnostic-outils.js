// Diagnostic > Outils : pour une parcelle et une date, ce qui existe
// réellement en base — sur le téléphone (cache Firestore) ET sur le serveur,
// avec l'état de synchronisation de chaque document — plus le journal
// persistant des écritures (journal-ecritures.js). Tout est rendu en texte
// brut copiable : c'est ce texte qu'on transmet quand une saisie disparaît,
// sans passer par la console Firebase.
import { db } from './firebase-config.js';
import {
  collection, query, where, getDocsFromCache, getDocsFromServer
} from '../vendor/firebase/firebase-firestore.js';
import { lireJournal, viderJournal, ligneJournal } from './journal-ecritures.js';
import { toastSucces, toastErreur } from './toast.js';
import { rapportTransferts } from './diagnostic-transferts.js';

const DELAI_SERVEUR_MS = 8000;
const el = {};

export function initOutilsDiagnostic() {
  ['panel', 'etat', 'parcelle', 'parcelles', 'date', 'chercher', 'resultat', 'journal', 'copier', 'vider', 'fermer',
   'transferts', 'transferts-resultat']
    .forEach((k) => { el[k] = document.getElementById('diag-' + k); });
  const bouton = document.getElementById('debug-outils');
  if (!bouton || !el.panel) return;
  bouton.addEventListener('click', ouvrir);
  el.fermer.addEventListener('click', () => { el.panel.hidden = true; });
  el.chercher.addEventListener('click', rechercher);
  el.vider.addEventListener('click', () => {
    if (!confirm('Vider le journal des écritures ? Les données en base ne sont pas touchées.')) return;
    viderJournal().then(afficherJournal);
  });
  el.copier.addEventListener('click', copierTout);
  el.transferts.addEventListener('click', () => {
    el['transferts-resultat'].hidden = false;
    try { el['transferts-resultat'].textContent = rapportTransferts(); }
    catch (err) { el['transferts-resultat'].textContent = 'Aperçu impossible : ' + raison(err); }
  });
}

async function ouvrir() {
  el.panel.hidden = false;
  if (!el.date.value) el.date.value = new Date().toISOString().slice(0, 10);
  afficherJournal();
  el.etat.textContent = 'Lecture de l\'état...';
  try {
    const parcelles = await lireLocal(collection(db, 'parcelles'));
    el.parcelles.innerHTML = parcelles.docs
      .map((d) => `<option value="${echap(d.data().nom || d.id)}"></option>`).join('');
  } catch (_) { /* liste de suggestions seulement */ }
  el.etat.textContent = await etatGlobal();
}

function echap(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function lireLocal(q) { return getDocsFromCache(q); }
function lireServeur(q) {
  return Promise.race([
    getDocsFromServer(q),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(
      new Error(`pas de réponse en ${DELAI_SERVEUR_MS / 1000} s`), { code: 'délai' })), DELAI_SERVEUR_MS))
  ]);
}
// Message court pour l'écran : le texte brut du SDK fait trois lignes.
function raisonServeur(err) {
  const code = err && err.code;
  if (code === 'unavailable') return 'hors ligne ou serveur injoignable';
  if (code === 'délai') return `pas de réponse en ${DELAI_SERVEUR_MS / 1000} s`;
  if (code === 'permission-denied') return 'accès refusé par les règles Firestore';
  return raison(err);
}
function raison(err) { return `${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`; }
function heure(ts) {
  if (!ts) return '—';
  const ms = typeof ts.toMillis === 'function' ? ts.toMillis() : (ts.seconds ? ts.seconds * 1000 : null);
  return ms ? new Date(ms).toLocaleString('fr-FR') : '—';
}

async function etatGlobal() {
  const v = window.__LOGISOL_VERSION || {};
  const lignes = [
    `Appli      : build ${v.build || '?'}${v.commit ? ' · ' + v.commit : ''}`,
    `Réseau     : ${navigator.onLine ? 'en ligne' : 'HORS LIGNE'}`,
    `Stockage   : ${window.__logisolCacheMemoire
      ? 'MÉMOIRE SEULEMENT — ce qui est saisi maintenant sera perdu à la fermeture'
      : 'disque du téléphone (IndexedDB)'}`,
    `Heure      : ${new Date().toLocaleString('fr-FR')}`
  ];
  try {
    for (const nom of ['interventions', 'implantations']) {
      const snap = await lireLocal(collection(db, nom));
      const attente = snap.docs.filter((d) => d.metadata.hasPendingWrites).length;
      lignes.push(`${nom.padEnd(14)}: ${snap.size} sur le téléphone, dont ${attente} en attente d'envoi au serveur`);
    }
  } catch (err) {
    lignes.push('Cache illisible : ' + raison(err));
  }
  return lignes.join('\n');
}

async function rechercher() {
  const saisie = el.parcelle.value.trim();
  const date = el.date.value;
  if (!saisie || !date) { toastErreur('Indique une parcelle et une date.'); return; }
  el.resultat.hidden = false;
  el.resultat.textContent = 'Recherche sur le téléphone et sur le serveur...';
  el.chercher.disabled = true;
  try {
    el.resultat.textContent = await construireRapport(saisie, date);
  } catch (err) {
    el.resultat.textContent = 'Recherche impossible : ' + raison(err);
  } finally {
    el.chercher.disabled = false;
    el.etat.textContent = await etatGlobal();
    afficherJournal();
  }
}

async function construireRapport(saisie, date) {
  const out = [`RECHERCHE « ${saisie} » au ${date}`, ''];

  // Parcelles correspondantes (nom ou identifiant), d'abord sur le téléphone.
  let parcelles = (await lireLocal(collection(db, 'parcelles'))).docs;
  let source = 'téléphone';
  if (!parcelles.some((d) => correspond(d, saisie))) {
    try { parcelles = (await lireServeur(collection(db, 'parcelles'))).docs; source = 'serveur'; } catch (_) { /* reste local */ }
  }
  const trouvees = parcelles.filter((d) => correspond(d, saisie));
  if (!trouvees.length) {
    out.push(`Aucune parcelle ne correspond (ni nom ni identifiant), cherché sur : ${source}.`);
    return out.join('\n');
  }

  let cultures = new Map();
  try {
    cultures = new Map((await lireLocal(collection(db, 'cultures_config'))).docs.map((d) => [d.id, d.data().nom || d.id]));
  } catch (_) { /* noms de culture facultatifs */ }

  for (const p of trouvees) {
    out.push(`■ PARCELLE ${p.data().nom || '?'}  (id ${p.id})`);
    out.push(...await rapportActivites(p.id, date));
    out.push(...await rapportImplantations(p.id, date, cultures));
    out.push(...await rapportJournal(p.id, date));
    out.push('');
  }
  return out.join('\n');
}

function correspond(d, saisie) {
  const n = norm(saisie);
  return d.id === saisie || norm(d.data().nom).includes(n);
}

// Présence de chaque document : sur le téléphone (et en attente d'envoi ou
// non) / sur le serveur (présent, absent, injoignable).
function fusionner(local, serveur, garder) {
  const ids = new Map();
  for (const d of local.docs) if (garder(d.data())) ids.set(d.id, { data: d.data(), local: d });
  if (serveur.docs) {
    for (const d of serveur.docs) {
      if (!garder(d.data())) continue;
      const e = ids.get(d.id) || { data: d.data() };
      e.serveur = d;
      ids.set(d.id, e);
    }
  }
  return [...ids.entries()];
}
function etatDoc(e, serveur) {
  const tel = !e.local ? '❌ absent'
    : e.local.metadata.hasPendingWrites ? '⏳ présent, EN ATTENTE d\'envoi' : '✅ présent, synchronisé';
  const srv = serveur.erreur ? `? injoignable (${serveur.erreur})` : (e.serveur ? '✅ présent' : '❌ absent');
  return `      téléphone : ${tel}\n      serveur   : ${srv}`;
}
async function lirePaire(q) {
  const local = await lireLocal(q);
  let serveur;
  try { serveur = await lireServeur(q); } catch (err) { serveur = { erreur: raisonServeur(err) }; }
  return { local, serveur };
}

async function rapportActivites(parcelleId, date) {
  const out = [`  ACTIVITÉS du ${date} :`];
  const { local, serveur } = await lirePaire(query(collection(db, 'interventions'), where('date', '==', date)));
  const surParcelle = (d) => Array.isArray(d.parcelleIds) && d.parcelleIds.includes(parcelleId);
  const liste = fusionner(local, serveur, surParcelle);
  if (!liste.length) out.push('    (aucune, ni sur le téléphone ni sur le serveur' + (serveur.erreur ? ' — serveur injoignable' : '') + ')');
  for (const [id, e] of liste) {
    const d = e.data;
    out.push(`    • ${d.typeNom || '?'} · statut ${d.statut || '?'} · campagne ${d.campagneId || '—'}  (id ${id})`);
    const attente = e.local && e.local.metadata.hasPendingWrites;
    const h = (ts) => (ts ? heure(ts) : attente ? 'en attente du serveur' : '—');
    out.push(`      créée ${h(d.creeLe)} · modifiée ${h(d.majLe)}`);
    out.push(etatDoc(e, serveur));
  }
  // Voisinage (téléphone) : une date mal saisie ne doit pas passer pour une perte.
  try {
    const toutes = (await lireLocal(collection(db, 'interventions'))).docs
      .filter((x) => surParcelle(x.data()) && x.data().date !== date && Math.abs(jours(x.data().date) - jours(date)) <= 7);
    if (toutes.length) {
      out.push('    Autres activités sur cette parcelle à ±7 jours (téléphone) :');
      toutes.forEach((x) => out.push(`      - ${x.data().date} ${x.data().typeNom || '?'}${x.metadata.hasPendingWrites ? ' (en attente d\'envoi)' : ''}`));
    }
  } catch (_) { /* voisinage facultatif */ }
  return out;
}
function jours(iso) { return Math.round(new Date(iso + 'T12:00:00').getTime() / 86400000); }

async function rapportImplantations(parcelleId, date, cultures) {
  const out = [`  CULTURES (implantations) concernées par le ${date} :`];
  const { local, serveur } = await lirePaire(query(collection(db, 'implantations'), where('parcelleId', '==', parcelleId)));
  const concerne = (d) => d.dateSemis === date || d.dateFin === date ||
    (d.dateSemis <= date && (!d.dateFin || d.dateFin >= date));
  const liste = fusionner(local, serveur, concerne);
  if (!liste.length) out.push('    (aucune : la parcelle apparaît « à renseigner » à cette date)');
  for (const [id, e] of liste) {
    const d = e.data;
    out.push(`    • ${cultures.get(d.cultureId) || d.cultureId || '?'} · semée ${d.dateSemis || '?'} · fin ${d.dateFin || 'en cours'}  (id ${id})`);
    out.push(etatDoc(e, serveur));
  }
  return out;
}

async function rapportJournal(parcelleId, date) {
  const lignes = (await lireJournal()).filter((e) => (e.detail || '').includes(date) || (e.detail || '').includes(parcelleId));
  if (!lignes.length) return ['  JOURNAL : aucune écriture tracée pour cette parcelle/date.'];
  return ['  JOURNAL (écritures tracées pour cette parcelle/date) :', ...lignes.map((e) => '    ' + ligneJournal(e))];
}

async function afficherJournal() {
  const liste = await lireJournal();
  el.journal.textContent = liste.length
    ? liste.slice().reverse().map(ligneJournal).join('\n')
    : 'Journal vide.';
}

async function copierTout() {
  const texte = [el.etat.textContent, el.resultat.hidden ? '' : el.resultat.textContent,
    el['transferts-resultat'].hidden ? '' : el['transferts-resultat'].textContent,
    'JOURNAL DES ÉCRITURES (plus récent en premier)', el.journal.textContent].filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(texte);
    toastSucces('Copié : colle-le dans ton message.');
  } catch (_) {
    // Presse-papiers refusé : sélection manuelle du résultat.
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el.resultat.hidden ? el.journal : el.resultat);
    sel.removeAllRanges(); sel.addRange(r);
    toastErreur('Copie automatique impossible : texte sélectionné, copie-le à la main.');
  }
}
