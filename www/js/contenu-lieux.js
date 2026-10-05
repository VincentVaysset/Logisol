// Contenu des bâtiments, TOUJOURS dérivé de Stocks : jamais saisi deux fois.
//
// Le journal dit ce qui est entré dans chaque contenant (récoltes, achats,
// transferts, ventes, pertes, inventaires). Les rations distribuées et les
// ajustements d'inventaire, eux, ne portent que sur un ALIMENT, sans contenant
// (cf. fourrages.js/stockDisponibleCanonique). Pour que la somme des cellules
// soit exactement le chiffre de Stocks, chaque aliment est donc réparti entre
// les contenants qui le contiennent, au prorata de ce que le journal y laisse.
// C'est une estimation, et la fiche de la cellule le dit : si une cellule a
// été vidée en premier, un Mouvement la corrige.
//
// Module pur (aucun import) : testable en Node tel quel.

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

/**
 * @param {Array<{cle:string, unite:'t'|'bottes', lots:Array<{cle,label,tonnes,quantite}>}>} contenants
 *   cle : identifiant du contenant (« CELLULE|id ») ; lots : contenu net du
 *   journal par aliment (tonnes ; quantite = bottes pour un emplacement).
 * @param {Map<string,number>} cible  tonnes par aliment selon Stocks.
 * @returns {Map<string,{tonnes:number, quantite:number, lots:Array}>}
 *   contenu réparti : la somme, aliment par aliment, vaut la cible dès que le
 *   journal place cet aliment dans au moins un contenant.
 */
export function repartirSurContenants(contenants, cible) {
  const brut = new Map();
  (contenants || []).forEach((c) => (c.lots || []).forEach((l) => {
    brut.set(l.cle, arrondi3((brut.get(l.cle) || 0) + (Number(l.tonnes) || 0)));
  }));
  const facteur = new Map();
  brut.forEach((b, cle) => {
    // Bottes jamais pesées : 0 t au journal comme dans Stocks, rien à répartir.
    if (!(b > 0.0005)) { facteur.set(cle, 1); return; }
    const t = cible && cible.has(cle) ? Number(cible.get(cle)) || 0 : 0;
    facteur.set(cle, t / b);
  });
  const res = new Map();
  (contenants || []).forEach((c) => {
    const lots = (c.lots || []).map((l) => {
      const f = facteur.has(l.cle) ? facteur.get(l.cle) : 1;
      return { ...l, tonnes: arrondi3((Number(l.tonnes) || 0) * f), quantite: arrondi3((Number(l.quantite) || 0) * f) };
    }).filter((l) => Math.abs(l.tonnes) >= 0.0005 || Math.abs(l.quantite) >= 0.5)
      .sort((a, b) => b.tonnes - a.tonnes || b.quantite - a.quantite);
    res.set(c.cle, {
      tonnes: arrondi3(lots.reduce((n, l) => n + l.tonnes, 0)),
      quantite: arrondi3(lots.reduce((n, l) => n + l.quantite, 0)),
      lots
    });
  });
  return res;
}

/**
 * Groupe d'affichage d'un bâtiment. Un bâtiment typé garde son groupe ; un
 * Mixte se classe selon ce qu'il contient : fourrage, sinon grain, sinon lots,
 * et « Mixtes » s'il n'a encore rien.
 * @param {string} type  BERGERIE | STOCKAGE_GRAIN | STOCKAGE_FOURRAGE | MIXTE
 * @param {{fourrage:boolean, grain:boolean, lots:boolean}} contenu
 */
export function groupeBatiment(type, contenu = {}) {
  if (type === 'STOCKAGE_FOURRAGE') return 'fourrage';
  if (type === 'STOCKAGE_GRAIN') return 'grain';
  if (type === 'BERGERIE') return 'bergeries';
  if (contenu.fourrage) return 'fourrage';
  if (contenu.grain) return 'grain';
  if (contenu.lots) return 'bergeries';
  return 'mixtes';
}

export const GROUPES_BATIMENTS = [
  { id: 'fourrage', nom: 'Fourrage' },
  { id: 'grain', nom: 'Grain et aliments' },
  { id: 'bergeries', nom: 'Bergeries' },
  { id: 'mixtes', nom: 'Mixtes' }
];

/** Tonnage arrondi à 1 décimale pour l'affichage (« 203,5 »). */
export function fmt1(v) {
  const n = Math.round((Number(v) || 0) * 10) / 10;
  return (Object.is(n, -0) ? 0 : n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/** Taux de remplissage en % (entier), null sans capacité connue. */
export function taux(tonnes, capacite) {
  const c = Number(capacite) || 0;
  return c > 0 ? Math.round(((Number(tonnes) || 0) / c) * 100) : null;
}
