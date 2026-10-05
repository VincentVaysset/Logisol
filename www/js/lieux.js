// Contenu réel de chaque cellule et emplacement, tel que Stocks le compte :
// le journal place les aliments dans les contenants, puis rations et
// ajustements (portés par l'aliment, sans contenant) sont répartis au
// prorata (cf. contenu-lieux.js). Une seule source pour l'onglet Bâtiments,
// l'aperçu d'un bâtiment sur la carte et les fiches cellule / emplacement.
import { getMouvements } from './mouvements.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';
import { ventilationsDesContenants } from './fourrages.js';
import { stockAuSoir } from './clotures-stock.js';
import { aujourdhuiIso } from './campagne-stock.js';
import { repartirSurContenants } from './contenu-lieux.js';

/**
 * @returns {Map<string,{tonnes,quantite,lots,poidsMoyenBotteKg}>}
 *   clé « CELLULE|id » ou « EMPLACEMENT_FOURRAGE|id ».
 */
export function contenuDesLieux(date = aujourdhuiIso(), opts = {}) {
  // Même filtre que fourrages.js/stockDisponibleCanonique : sans lui, la
  // répartition partirait d'un autre journal que celui de Stocks.
  const retenus = getMouvements().filter((m) => m.typeMouvement !== 'SORTIE_ALIMENTATION' &&
    m.typeMouvement !== 'AJUSTEMENT' && !m.excluCalcul && (!date || m.date <= date));
  const ventilations = ventilationsDesContenants(retenus, getCellules(), getEmplacements(), opts);
  const contenants = [];
  ventilations.forEach((v, cle) => contenants.push({
    cle,
    unite: v.unite,
    lots: v.lots.map((l) => ({
      cle: l.cle, label: l.label, typeFourrage: l.typeFourrage, numeroCoupe: l.numeroCoupe,
      tonnes: l.tonnesRestantes, quantite: l.quantiteRestante
    }))
  }));
  const cible = new Map(stockAuSoir(date, opts).map((g) => [g.cle, g.tonnes]));
  const res = repartirSurContenants(contenants, cible);
  res.forEach((v, cle) => { v.poidsMoyenBotteKg = (ventilations.get(cle) || {}).poidsMoyenBotteKg || 0; });
  return res;
}

export function contenuDuLieu(type, id, rep = contenuDesLieux()) {
  return rep.get(`${type}|${id}`) || { tonnes: 0, quantite: 0, lots: [], poidsMoyenBotteKg: 0 };
}
