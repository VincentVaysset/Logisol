// Traçabilité des fourrages, de la récolte jusqu'aux rations.
//
// Ce module ne stocke rien : il RELIT le journal des mouvements pour en
// extraire des « lots de fourrage identifiés ». Un lot, c'est ce qui rend un
// fourrage distinct d'un autre au moment de le donner aux brebis : son type
// (luzerne, RGA, prairie permanente...), son numéro de coupe, et son mode de
// conservation (botte ou séché en grange).
//
// POURQUOI RELIRE PLUTÔT QUE STOCKER UN AGRÉGAT
// Le niveau d'un contenant est déjà dérivé du journal (cf. mouvements.js).
// Tenir en plus un tableau de lots écrit à côté ferait un second registre à
// maintenir en cohérence, et c'est exactement le genre de duplication qui
// finit par diverger. La clé d'identité est partagée avec les récoltes
// saisies à la main dans l'onglet Stocks (stocks.js) : une 1ʳᵉ coupe de
// luzerne en botte est la même chose quelle que soit la porte d'entrée, donc
// la même colonne et la même ration.
import { cleFoin, labelFoin, cleCereale, labelCereale, labelCoupe } from './stocks.js';
import { getCelluleById, contenuDe } from './cellules.js';
import { getEmplacementById } from './emplacements.js';

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

/** Les entrées qui font grossir un stock identifiable. */
const ENTREES = ['ENTREE_RECOLTE', 'ENTREE_ACHAT'];

/**
 * Conservation déduite du contenant d'arrivée : des bottes dans un hangar,
 * du vrac dans une cellule de séchage. Elle est aussi FIGÉE sur le mouvement
 * à l'écriture — si une cellule change de contenu plus tard, l'historique ne
 * doit pas se réécrire tout seul.
 */
export function conservationDuContenant(type, id) {
  if (type === 'EMPLACEMENT_FOURRAGE') return 'botte';
  if (type === 'CELLULE') {
    const c = getCelluleById(id);
    return c && contenuDe(c) === 'FOURRAGE' ? 'grange' : null;
  }
  return null;
}

/**
 * Identité du lot porté par un mouvement.
 * @returns {{cle:string,label:string,famille:'foin'|'cereale'}|null}
 */
export function identiteDuMouvement(m) {
  if (!m) return null;
  // Copies figées écrites à la saisie : on s'en sert en priorité, elles
  // restent justes même si le contenant a changé de nature depuis.
  if (m.categorieCle) {
    return {
      cle: m.categorieCle,
      label: m.categorieLabel || m.categorieCle,
      famille: m.categorieCle.startsWith('cereale') ? 'cereale' : 'foin'
    };
  }
  const conservation = m.conservation || conservationDuContenant(m.destinationType, m.destinationId);
  if (conservation) {
    return {
      cle: cleFoin(conservation, m.numeroCoupe, m.typeFourrage),
      label: labelFoin(conservation, m.numeroCoupe, m.typeFourrage),
      famille: 'foin'
    };
  }
  if (m.destinationType === 'CELLULE' && m.typeGrain) {
    return { cle: cleCereale(m.typeGrain), label: labelCereale(m.typeGrain), famille: 'cereale' };
  }
  return null;
}

/**
 * Tonnage d'un mouvement, quelle que soit son unité de saisie.
 * Des bottes sans poids renseigné ne valent AUCUN tonnage : inventer un
 * poids moyen ferait apparaître un stock qui n'a jamais été pesé.
 */
export function tonnesDuMouvement(m) {
  if (!m) return 0;
  if (m.unite === 'bottes') {
    const kg = Number(m.poidsBotteKg) || 0;
    return arrondi3(((Number(m.quantite) || 0) * kg) / 1000);
  }
  return arrondi3(m.quantite);
}

/** Les entrées de récolte identifiées, les plus récentes d'abord. */
export function lotsEntres(mouvements) {
  return mouvements
    .filter((m) => ENTREES.includes(m.typeMouvement))
    .map((m) => {
      const id = identiteDuMouvement(m);
      if (!id) return null;
      return {
        mouvementId: m.id,
        cle: id.cle,
        label: id.label,
        famille: id.famille,
        typeFourrage: m.typeFourrage || null,
        numeroCoupe: m.numeroCoupe || null,
        conservation: m.conservation || null,
        date: m.date,
        parcelleId: m.sourceType === 'PARCELLE' ? m.sourceId : null,
        parcelleNom: m.sourceType === 'PARCELLE' ? m.sourceNom : '',
        contenantType: m.destinationType,
        contenantId: m.destinationId,
        contenantNom: m.destinationNom || '',
        quantite: Number(m.quantite) || 0,
        unite: m.unite || 't',
        tonnes: tonnesDuMouvement(m)
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Ce que contient un contenant, lot par lot.
 *
 * Les sorties ne disent pas DE QUEL lot elles proviennent — on ne le demande
 * pas au champ, et l'inventer serait faux. Quand il est sorti plus que rien,
 * les lots entrés sont donc répartis AU PRORATA de ce qui reste, et l'écran
 * le dit explicitement plutôt que de laisser croire à un suivi lot par lot.
 *
 * @returns {{niveau:number, unite:string, totalEntre:number, prorata:boolean,
 *            lots:Array<{cle,label,tonnes,quantite,entrees:Array}>}}
 */
export function ventilationContenant(type, id, mouvements, niveau) {
  const entrees = mouvements.filter(
    (m) => ENTREES.includes(m.typeMouvement) && m.destinationType === type && m.destinationId === id
  );
  const unite = type === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't';

  const parCle = new Map();
  entrees.forEach((m) => {
    const ident = identiteDuMouvement(m);
    const cle = ident ? ident.cle : 'inconnu';
    if (!parCle.has(cle)) {
      parCle.set(cle, {
        cle,
        label: ident ? ident.label : 'Origine non renseignée',
        numeroCoupe: m.numeroCoupe || null,
        typeFourrage: m.typeFourrage || null,
        quantite: 0, tonnes: 0, entrees: []
      });
    }
    const g = parCle.get(cle);
    g.quantite = arrondi3(g.quantite + (Number(m.quantite) || 0));
    g.tonnes = arrondi3(g.tonnes + tonnesDuMouvement(m));
    g.entrees.push(m);
  });

  const totalEntre = arrondi3(Array.from(parCle.values()).reduce((n, g) => n + g.quantite, 0));
  const n = niveau != null ? Number(niveau) : totalEntre;
  const prorata = totalEntre > 0 && Math.abs(n - totalEntre) > 0.001;
  const facteur = totalEntre > 0 ? Math.max(0, n) / totalEntre : 0;

  const lots = Array.from(parCle.values()).map((g) => ({
    ...g,
    quantiteRestante: prorata ? arrondi3(g.quantite * facteur) : g.quantite,
    tonnesRestantes: prorata ? arrondi3(g.tonnes * facteur) : g.tonnes
  })).sort((a, b) => b.quantiteRestante - a.quantiteRestante);

  return { niveau: arrondi3(n), unite, totalEntre, prorata, lots };
}

/** Résumé d'une ligne : « 15 t 1ʳᵉ coupe Luzerne ». */
export function resumeLot(lot, unite) {
  const q = unite === 'bottes'
    ? `${Math.round(lot.quantiteRestante)} botte${lot.quantiteRestante > 1 ? 's' : ''}`
    : `${lot.tonnesRestantes} t`;
  const quoi = lot.typeFourrage
    ? `${labelCoupe(lot.numeroCoupe)} ${lot.typeFourrage}`
    : lot.label;
  return `${q} ${quoi}`;
}

/**
 * Catégories déduites du journal, au MÊME format que
 * stocks.agregerParCategorie() — de quoi les fondre dans le tableau croisé
 * et dans le choix de ration sans que rien d'autre n'ait à savoir d'où elles
 * viennent.
 *
 * Seules les ENTRÉES sont comptées : ce que le troupeau consomme est déjà
 * calculé à partir des périodes de prélèvement (cf. alimentation.js), et le
 * déduire ici une seconde fois le compterait deux fois.
 */
export function agregerMouvements(mouvements) {
  const parCle = new Map();
  lotsEntres(mouvements).forEach((l) => {
    if (!parCle.has(l.cle)) {
      parCle.set(l.cle, {
        cle: l.cle,
        label: l.label,
        categorie: l.famille,
        conservation: l.conservation,
        coupe: l.numeroCoupe,
        fourrage: l.typeFourrage,
        espece: l.famille === 'cereale' ? l.typeFourrage : null,
        tonnes: 0, nbRecoltes: 0, nbBottes: 0, nbRemorques: 0, surfaceHa: 0,
        lignes: [], origine: 'journal'
      });
    }
    const g = parCle.get(l.cle);
    g.tonnes = arrondi3(g.tonnes + l.tonnes);
    g.nbRecoltes++;
    if (l.unite === 'bottes') g.nbBottes += l.quantite;
    g.lignes.push(l);
  });
  return Array.from(parCle.values());
}

/**
 * Fond les récoltes saisies à la main et celles venues du journal dans un
 * seul jeu de catégories. Les deux sources alimentent le même fourrage : les
 * séparer obligerait à choisir laquelle regarder.
 */
export function fusionnerCategories(categoriesStocks, categoriesJournal) {
  const parCle = new Map();
  const ajouter = (c) => {
    const existant = parCle.get(c.cle);
    if (!existant) { parCle.set(c.cle, { ...c, lignes: c.lignes.slice() }); return; }
    existant.tonnes = arrondi3(existant.tonnes + c.tonnes);
    existant.nbRecoltes += c.nbRecoltes || 0;
    existant.nbBottes += c.nbBottes || 0;
    existant.nbRemorques += c.nbRemorques || 0;
    existant.surfaceHa = Math.round((existant.surfaceHa + (c.surfaceHa || 0)) * 100) / 100;
    existant.lignes = existant.lignes.concat(c.lignes || []);
    existant.origine = existant.origine === c.origine ? existant.origine : 'mixte';
  };
  (categoriesStocks || []).forEach((c) => ajouter({ origine: 'saisie', ...c }));
  (categoriesJournal || []).forEach(ajouter);
  return Array.from(parCle.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr'));
}

/**
 * Croisement coupe × type de fourrage, alimenté par les deux sources.
 * @returns {{fourrages:string[], coupes:number[], valeur:(coupe,fourrage)=>number}}
 */
export function croiseCoupeFourrage(categories) {
  const fourrages = [];
  const coupes = new Set();
  const grille = new Map();
  (categories || [])
    .filter((c) => c.categorie === 'foin')
    .forEach((c) => {
      const f = c.fourrage || '?';
      if (!fourrages.includes(f)) fourrages.push(f);
      const n = Number(c.coupe) || 0;
      coupes.add(n);
      const k = `${n}|${f}`;
      grille.set(k, arrondi3((grille.get(k) || 0) + (Number(c.tonnes) || 0)));
    });
  fourrages.sort((a, b) => a.localeCompare(b, 'fr'));
  return {
    fourrages,
    coupes: Array.from(coupes).sort((a, b) => a - b),
    valeur: (coupe, fourrage) => grille.get(`${coupe}|${fourrage}`) || 0
  };
}
