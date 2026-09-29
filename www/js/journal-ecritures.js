// Journal persistant des écritures d'activités et d'implantations, consultable
// depuis Diagnostic > Outils. Il survit au redémarrage et ne dépend PAS de
// Firestore (c'est justement Firestore qu'il sert à surveiller) : base
// IndexedDB à part, « logisol-journal ».
//
// IndexedDB et non localStorage : mesuré (profil Chromium sur disque, appli
// tuée 300 ms après l'écriture), localStorage perd la ligne — Chromium ne
// l'écrit sur disque qu'après un délai — alors qu'une transaction IndexedDB
// terminée est déjà sur le disque. Or c'est précisément la dernière ligne
// avant un « balayage » de l'appli qui compte. localStorage ne sert que de
// secours si IndexedDB est indisponible.
const BASE = 'logisol-journal';
const STORE = 'ecritures';
const CLE_SECOURS = 'lgs_journal_ecritures';
const MAX = 400;

let ouverture = null;
let ajouts = 0;

function base() {
  if (!ouverture) {
    ouverture = new Promise((res, rej) => {
      try {
        const q = indexedDB.open(BASE, 1);
        q.onupgradeneeded = () => q.result.createObjectStore(STORE, { autoIncrement: true });
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      } catch (err) { rej(err); }
    });
  }
  return ouverture;
}

function requete(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function secoursLire() {
  try { return JSON.parse(localStorage.getItem(CLE_SECOURS) || '[]'); } catch (_) { return []; }
}
function secoursAjouter(entree) {
  try { localStorage.setItem(CLE_SECOURS, JSON.stringify(secoursLire().concat([entree]).slice(-MAX))); } catch (_) { /* ignoré */ }
}

async function elaguer(db) {
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const trop = (await requete(store.count())) - MAX;
  if (trop <= 0) return;
  let n = 0;
  store.openCursor().onsuccess = (ev) => {
    const c = ev.target.result;
    if (c && n++ < trop) { c.delete(); c.continue(); }
  };
}

/**
 * @param {string} evenement  ex. « tentative », « enregistré sur le téléphone »
 * @param {object} [infos]    { coll, id, detail, erreur }
 */
export function journaliser(evenement, infos = {}) {
  const entree = {
    t: new Date().toISOString(),
    ev: evenement,
    coll: infos.coll || '',
    id: infos.id || '',
    detail: infos.detail || '',
    erreur: infos.erreur || '',
    reseau: typeof navigator !== 'undefined' && navigator.onLine === false ? 'hors ligne' : 'en ligne',
    cache: typeof window !== 'undefined' && window.__logisolCacheMemoire ? 'MÉMOIRE' : 'disque'
  };
  // Jamais attendu, jamais bloquant : le journal ne doit pas retarder une saisie.
  base()
    .then((db) => {
      db.transaction(STORE, 'readwrite').objectStore(STORE).add(entree);
      if (++ajouts % 50 === 0) elaguer(db).catch(() => {});
    })
    .catch(() => secoursAjouter(entree));
}

/** Toutes les lignes, de la plus ancienne à la plus récente. */
export async function lireJournal() {
  try {
    const db = await base();
    const lignes = await requete(db.transaction(STORE).objectStore(STORE).getAll());
    return secoursLire().concat(lignes).sort((a, b) => (a.t < b.t ? -1 : 1));
  } catch (_) {
    return secoursLire();
  }
}

export async function viderJournal() {
  try { localStorage.removeItem(CLE_SECOURS); } catch (_) { /* ignoré */ }
  try { const db = await base(); await requete(db.transaction(STORE, 'readwrite').objectStore(STORE).clear()); } catch (_) { /* ignoré */ }
}

/** Une ligne lisible, pensée pour être copiée telle quelle dans un message. */
export function ligneJournal(e) {
  const d = new Date(e.t);
  const h = `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR')}`;
  return `${h} · ${e.ev}` +
    (e.coll ? ` · ${e.coll}${e.id ? '/' + e.id : ''}` : '') +
    (e.detail ? ` · ${e.detail}` : '') +
    (e.erreur ? ` · ⚠ ${e.erreur}` : '') +
    ` · [${e.reseau}, cache ${e.cache}]`;
}
