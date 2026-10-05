// Contenu de chaque contenant AVEC les transferts : un transfert conserve le
// stock total. Ce qui sort du contenant de départ entre dans le contenant
// d'arrivée avec la composition du départ à la date du transfert, au prorata
// (en bottes pour un hangar, sans conversion en tonnes).
//
// Jusqu'ici, ventilationContenant (fourrages.js) ne connaissait que les
// ENTRÉES (récolte, achat) : le départ perdait bien la quantité transférée,
// mais l'arrivée ne la recevait jamais. Le stock disparaissait de Stocks
// (10 t d'orge transférées : 22,2 t -> 12,2 t).
//
// Même règle de prorata qu'avant pour tout le reste : sans transfert, le
// résultat est identique à ventilationContenant, au gramme près. Le journal
// n'est jamais réécrit : seul le calcul change.
//
// Module pur : identité et tonnage d'un mouvement sont injectés
// (fourrages.js/identiteDuMouvement, tonnesDuMouvement), testable en Node.

const ENTREES = ['ENTREE_RECOLTE', 'ENTREE_ACHAT'];

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }
function msDe(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

/**
 * @param {Array} mouvements  journal (déjà filtré comme Stocks le filtre)
 * @param {{identite:(m)=>({cle,label}|null), tonnes:(m)=>number}} deps
 * @returns {Map<string,{niveau, unite, totalEntre, prorata, lots:Array<{cle,label,typeFourrage,numeroCoupe,quantite,tonnes,quantiteRestante,tonnesRestantes,parTransfert}>}>}
 *   clé « TYPE|id » du contenant.
 */
export function ventilationAvecTransferts(mouvements, { identite, tonnes }) {
  const etats = new Map();
  const etat = (type, id) => {
    const k = `${type}|${id}`;
    if (!etats.has(k)) {
      etats.set(k, { type, id, unite: type === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't', niveau: 0, totalEntre: 0, entrees: new Map() });
    }
    return etats.get(k);
  };
  const contenant = (type) => type === 'CELLULE' || type === 'EMPLACEMENT_FOURRAGE';
  const ajouter = (e, lot) => {
    if (!e.entrees.has(lot.cle)) {
      e.entrees.set(lot.cle, { cle: lot.cle, label: lot.label, typeFourrage: lot.typeFourrage || null,
        numeroCoupe: lot.numeroCoupe || null, quantite: 0, tonnes: 0, parTransfert: false });
    }
    const g = e.entrees.get(lot.cle);
    g.quantite += lot.quantite;
    g.tonnes += lot.tonnes;
    if (lot.parTransfert) g.parTransfert = true;
    e.totalEntre += lot.quantite;
  };

  // Ordre de mouvements.js/niveauContenant : date, puis heure de création.
  const chrono = (mouvements || []).slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : msDe(a.creeLe) - msDe(b.creeLe)));

  chrono.forEach((m) => {
    const q = Number(m.quantite) || 0;
    const dest = contenant(m.destinationType) && m.destinationId ? etat(m.destinationType, m.destinationId) : null;
    const src = contenant(m.sourceType) && m.sourceId ? etat(m.sourceType, m.sourceId) : null;

    if (m.typeMouvement === 'TRANSFERT' && src && dest && src !== dest) {
      // Composition du départ À CET INSTANT : ses entrées au prorata de son
      // niveau. On en déplace la part transférée (au plus ce qu'il contient).
      const deplace = Math.min(q, Math.max(0, src.niveau));
      const ratio = src.totalEntre > 0 ? deplace / src.totalEntre : 0;
      const memeUnite = src.unite === dest.unite;
      const lots = Array.from(src.entrees.values())
        .map((g) => ({ ...g, quantite: g.quantite * ratio, tonnes: g.tonnes * ratio, parTransfert: true }))
        .filter((l) => l.quantite > 0 || l.tonnes > 0);
      if (!memeUnite) {
        // Cellule <-> hangar : la quantité arrive dans l'unité du mouvement
        // (bottes si un hangar est en jeu), répartie selon les tonnes.
        const totalT = lots.reduce((n, l) => n + l.tonnes, 0);
        const totalQ = lots.reduce((n, l) => n + l.quantite, 0);
        lots.forEach((l) => { l.quantite = q * (totalT > 0 ? l.tonnes / totalT : totalQ > 0 ? l.quantite / totalQ : 0); });
      }
      lots.forEach((l) => ajouter(dest, l));
      // L'arrivée ne reçoit que ce que le départ contenait : un transfert
      // saisi au-delà du contenu ne crée pas de stock (le départ, lui, passe
      // en négatif comme dans niveauContenant, l'écart reste visible).
      src.niveau -= q;
      dest.niveau += memeUnite ? deplace : q;
      return;
    }

    if (m.typeMouvement === 'INVENTAIRE' && dest) { dest.niveau = q; return; }
    if (dest) {
      dest.niveau += q;
      if (ENTREES.includes(m.typeMouvement)) {
        const id = identite(m);
        ajouter(dest, {
          cle: id ? id.cle : 'inconnu', label: id ? id.label : 'Origine non renseignée',
          typeFourrage: m.typeFourrage, numeroCoupe: m.numeroCoupe, quantite: q, tonnes: Number(tonnes(m)) || 0
        });
      }
    }
    if (src) src.niveau -= q;
  });

  const res = new Map();
  etats.forEach((e, k) => {
    const totalEntre = arrondi3(e.totalEntre);
    const n = arrondi3(e.niveau);
    const prorata = totalEntre > 0 && Math.abs(n - totalEntre) > 0.001;
    const facteur = totalEntre > 0 ? Math.max(0, n) / totalEntre : 0;
    const lots = Array.from(e.entrees.values()).map((g) => ({
      ...g,
      quantite: arrondi3(g.quantite),
      tonnes: arrondi3(g.tonnes),
      quantiteRestante: arrondi3(prorata ? g.quantite * facteur : g.quantite),
      tonnesRestantes: arrondi3(prorata ? g.tonnes * facteur : g.tonnes)
    })).sort((a, b) => b.quantiteRestante - a.quantiteRestante);
    res.set(k, { niveau: n, unite: e.unite, totalEntre, prorata, lots });
  });
  return res;
}

/**
 * Ce que chaque transfert a déplacé (pour l'aperçu Diagnostic et la liste
 * Historique) : rejoue le journal jusqu'au transfert, exclu.
 * @returns {Array<{mouvement, lots:Array<{cle,label,quantite,tonnes}>}>}
 */
export function compositionDesTransferts(mouvements, deps) {
  const chrono = (mouvements || []).slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : msDe(a.creeLe) - msDe(b.creeLe)));
  return chrono.map((m, i) => {
    if (m.typeMouvement !== 'TRANSFERT') return null;
    const avant = ventilationAvecTransferts(chrono.slice(0, i), deps);
    const s = avant.get(`${m.sourceType}|${m.sourceId}`);
    const q = Number(m.quantite) || 0;
    if (!s || !(s.niveau > 0)) return { mouvement: m, lots: [] };
    const part = Math.min(q, s.niveau) / s.niveau;
    return {
      mouvement: m,
      lots: s.lots.map((l) => ({ cle: l.cle, label: l.label, quantite: arrondi3(l.quantiteRestante * part), tonnes: arrondi3(l.tonnesRestantes * part) }))
        .filter((l) => l.quantite > 0 || l.tonnes > 0)
    };
  }).filter(Boolean);
}
