// Tracé en cours, sauvegardé au fil de l'eau sur le téléphone (IndexedDB) :
// si l'appli est fermée, tuée par Android ou plante pendant le chantier,
// rien n'est perdu, et le tracé est proposé à la reprise au redémarrage.
// Le brouillon est effacé quand l'activité est enregistrée (le tracé part
// alors dans lgs_traces) ou abandonnée volontairement.
//
// Base séparée de celle de Firestore. Sans IndexedDB (navigation privée...),
// tout est sans effet : le tracé marche, simplement sans filet.
const NOM_BASE = 'logisol-traces-en-cours';

let basePromise = null;
function base() {
  if (basePromise) return basePromise;
  basePromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(NOM_BASE, 1);
      req.onupgradeneeded = () => {
        const b = req.result;
        if (!b.objectStoreNames.contains('sessions')) b.createObjectStore('sessions', { keyPath: 'id' });
        if (!b.objectStoreNames.contains('lots')) b.createObjectStore('lots', { autoIncrement: true }).createIndex('session', 'session');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return basePromise;
}

function transaction(stores, mode, travail) {
  return base().then((b) => new Promise((resolve) => {
    if (!b) { resolve(null); return; }
    try {
      const tx = b.transaction(stores, mode);
      let resultat = null;
      travail(tx, (r) => { resultat = r; });
      tx.oncomplete = () => resolve(resultat);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch (_) { resolve(null); }
  }));
}

/** Ouvre un brouillon. contexte : ce qu'il faut pour rouvrir l'activité. */
export function ouvrirBrouillon(id, { debut, largeurM, contexte, coupures = [] }) {
  return transaction(['sessions'], 'readwrite', (tx) => {
    tx.objectStore('sessions').put({ id, debut, largeurM: largeurM || null, contexte: contexte || {}, coupures, majLe: Date.now() });
  });
}

/** Ajoute des points ({lat,lon,t}) au brouillon. */
export function ajouterPointsBrouillon(id, points, { coupure = false } = {}) {
  if (!points || !points.length) return Promise.resolve(null);
  return transaction(['lots'], 'readwrite', (tx) => {
    tx.objectStore('lots').add({ session: id, coupure, pts: points.map((p) => [p.lat, p.lon, p.t]) });
  });
}

/** Brouillons trouvés sur le téléphone : [{ id, debut, largeurM, contexte, points, coupures }]. */
export function lireBrouillons() {
  return transaction(['sessions', 'lots'], 'readonly', (tx, rendre) => {
    const sessions = [];
    const lots = [];
    tx.objectStore('sessions').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { sessions.push(c.value); c.continue(); } };
    tx.objectStore('lots').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { lots.push(c.value); c.continue(); } };
    tx.addEventListener('complete', () => {
      rendre(sessions.map((s) => {
        const points = [];
        const coupures = [];
        lots.filter((l) => l.session === s.id).forEach((l) => {
          if (l.coupure && points.length) coupures.push(points.length);
          l.pts.forEach(([lat, lon, t]) => points.push({ lat, lon, t }));
        });
        return { ...s, points, coupures };
      }));
    });
  }).then((r) => r || []);
}

/** Met à jour le contexte d'un brouillon (activité enregistrée, id connu...). */
export function majContexteBrouillon(id, contexte) {
  return transaction(['sessions'], 'readwrite', (tx) => {
    const st = tx.objectStore('sessions');
    st.get(id).onsuccess = (e) => { const s = e.target.result; if (s) st.put({ ...s, contexte: { ...s.contexte, ...contexte }, majLe: Date.now() }); };
  });
}

export function supprimerBrouillon(id) {
  if (!id) return Promise.resolve(null);
  return transaction(['sessions', 'lots'], 'readwrite', (tx) => {
    tx.objectStore('sessions').delete(id);
    const idx = tx.objectStore('lots').index('session');
    idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { tx.objectStore('lots').delete(c.primaryKey); c.continue(); }
    };
  });
}
