// Clôtures de campagne Stocks/Troupeau (collection lgs_clotures_stock, un
// document par campagne « 2025-2026 ») et VERROU des saisies qu'elles figent.
//
// Tant qu'une campagne est clôturée, tout ce qui changerait son stock ou son
// bilan est refusé : mouvements de stock datés jusqu'à son 31/08, rations
// dont un jour modifié tombe jusqu'à ce 31/08. Clôturer une campagne fige
// aussi tout ce qui la précède. Réouvrir la campagne (Stocks) lève le verrou.
//
// Module volontairement minimal (seulement Firestore et campagne-stock.js) :
// mouvements.js et affectations.js l'importent pour se protéger eux-mêmes,
// donc sur TOUS les chemins d'écriture, sans dépendance circulaire.
import { db } from './firebase-config.js';
import { collection, onSnapshot } from '../vendor/firebase/firebase-firestore.js';
import { bornesCampagneStock } from './campagne-stock.js';

export const COL_CLOTURES = 'lgs_clotures_stock';

let clotures = [];
const ecouteurs = new Set();

export function getClotures() { return clotures; }
export function getCloture(campagne) { return clotures.find((c) => c.id === campagne) || null; }
export function onCloturesChange(cb) { ecouteurs.add(cb); cb(clotures); return () => ecouteurs.delete(cb); }

export function watchClotures() {
  return onSnapshot(collection(db, COL_CLOTURES), (snap) => {
    clotures = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ecouteurs.forEach((cb) => cb(clotures));
  });
}

/** Dernier jour figé par une clôture en vigueur (« 2026-08-31 »), ou null. */
export function finVerrouillee() {
  let fin = null;
  clotures.forEach((c) => {
    if (c.statut !== 'cloturee') return;
    const b = bornesCampagneStock(c.id);
    if (b && (!fin || b.fin > fin)) fin = b.fin;
  });
  return fin;
}

function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?'; }

/**
 * Refuse une écriture qui toucherait un jour figé.
 * @param {string} date  premier jour modifié par l'écriture
 * @param {string} quoi  ce qui est modifié, pour le message
 */
export function verifierDateModifiable(date, quoi = 'les saisies') {
  const fin = finVerrouillee();
  if (fin && date && date <= fin) {
    const c = clotures.filter((x) => x.statut === 'cloturee')
      .map((x) => x.id).sort().pop();
    throw new Error(`Campagne ${c} clôturée : impossible de modifier ${quoi} au ${dateFr(date)}. ` +
      'Réouvre la campagne depuis Stocks pour la corriger.');
  }
}
