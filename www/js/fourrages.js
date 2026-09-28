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
import { cleFoin, labelFoin, cleCereale, labelCereale, labelCoupe, cleCommerce, clePaille } from './stocks.js';
import { getCelluleById, contenuDe } from './cellules.js';
import { getEmplacementById } from './emplacements.js';
import { niveauContenant } from './mouvements.js';
import { consommationParStock } from './rations-calc.js';

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
 * @returns {{cle:string,label:string,famille:'foin'|'cereale'|'paille'}|null}
 */
export function identiteDuMouvement(m) {
  if (!m) return null;
  // Copies figées écrites à la saisie : on s'en sert en priorité, elles
  // restent justes même si le contenant a changé de nature depuis.
  if (m.categorieCle) {
    return {
      cle: m.categorieCle,
      label: m.categorieLabel || m.categorieCle,
      // La paille est identifiée à part : c'est ce qui permet de l'exclure
      // du bilan des rations et du prévisionnel d'alimentation (elle n'a
      // aucun suivi de consommation, cf. CLAUDE.md) sans la retirer de
      // l'onglet Stocks, où elle doit rester visible.
      famille: m.categorieCle.startsWith('cereale') ? 'cereale'
        : m.categorieCle === clePaille() ? 'paille'
        : 'foin'
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
  // Achat sans contenant suivi (concentré, amendement bio...) : identifié par
  // son produit commercial, comme un aliment du commerce (cf. stades.js) —
  // sinon un tel achat resterait invisible des catégories de stock et donc
  // impossible à choisir comme aliment d'une ration distribuée ou d'un plan
  // de campagne (cf. affectations.js / plan-campagne.js).
  if (m.typeMouvement === 'ENTREE_ACHAT' && m.destinationType === 'AUTRE' && m.produit) {
    return { cle: cleCommerce(m.produit), label: m.produit, famille: 'commerce' };
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

/**
 * Montant d'un mouvement d'achat/vente — jamais stocké (cf. mouvements.js/
 * nettoyer(), prixTonne reste un prix unitaire), toujours recalculé à
 * l'affichage pour rester juste si le prix est corrigé après coup.
 */
export function montantMouvement(m) {
  if (!m || !(Number(m.prixTonne) > 0)) return 0;
  return arrondi3(tonnesDuMouvement(m) * Number(m.prixTonne));
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

/**
 * Stock RÉELLEMENT disponible par catégorie de fourrage : récoltes et achats,
 * moins ventes, consommation animaux et interventions au champ — cf. le
 * bridge tunnel d'activité -> mouvement (ui-intervention.js) qui fait déjà
 * entrer les interventions champ dans ce même journal.
 *
 * Contrairement à agregerMouvements() (qui ne compte que les ENTRÉES, donc un
 * total brut de récolte), cette fonction rejoue les SORTIES aussi : elle
 * additionne, sur tous les contenants existants, ce que ventilationContenant()
 * sait dire du niveau NET restant, réparti au prorata par lot. Une récolte
 * saisie à la main dans l'onglet Stocks (collection "stocks", sans contenant)
 * n'a pas d'existence dans le journal et ne peut donc pas être décomptée
 * ici — elle reste dans le total brut affiché à côté, pas fondue dedans.
 * @returns {Array<{cle, label, tonnes, bottes}>}
 */
export function stockNetParCategorie(mouvements, cellules, emplacements) {
  const parCle = new Map();
  const ajouter = (type, id) => {
    const niveau = niveauContenant(type, id, mouvements);
    const v = ventilationContenant(type, id, mouvements, niveau.quantite);
    v.lots.forEach((l) => {
      if (!parCle.has(l.cle)) {
        parCle.set(l.cle, { cle: l.cle, label: l.label, tonnes: 0, bottes: 0 });
      }
      const g = parCle.get(l.cle);
      g.tonnes = arrondi3(g.tonnes + l.tonnesRestantes);
      if (v.unite === 'bottes') g.bottes = arrondi3(g.bottes + l.quantiteRestante);
    });
  };
  (cellules || []).forEach((c) => ajouter('CELLULE', c.id));
  (emplacements || []).forEach((e) => ajouter('EMPLACEMENT_FOURRAGE', e.id));
  return Array.from(parCle.values())
    .filter((g) => g.tonnes > 0.001 || g.bottes > 0.5)
    .sort((a, b) => b.tonnes - a.tonnes);
}

// LA fonction unique du stock restant, appelée à l'identique par l'onglet
// Stocks (stocks-net) et par la tuile "Stock restant" de Troupeau — plus
// aucune autre source ne calcule ce chiffre (cf. audit troupeau/stocks) :
//   entrées + sorties manuelles du journal (ventes, pertes, transferts,
//   inventaires) − consommation dérivée des distributions de ration
//   (rations-calc.js, jamais un mouvement de stock écrit pour elles).
//
// Les mouvements SORTIE_ALIMENTATION (ancienne saisie manuelle d'une sortie
// pour le troupeau, désormais remplacée par les distributions) sont exclus
// du calcul, de même que tout mouvement marqué excluCalcul — sans ça, une
// sortie alimentation déjà enregistrée à la main compterait EN PLUS de la
// distribution qui décrit la même consommation, et le stock semblerait plus
// bas qu'il ne l'est réellement. Ces mouvements ne sont pas supprimés (cf.
// "Sorties alimentation manuelles", ui-rations.js) : seulement écartés d'ici.
export function stockDisponibleCanonique(mouvements, cellules, emplacements, lots, date) {
  const retenus = (mouvements || []).filter((m) => m.typeMouvement !== 'SORTIE_ALIMENTATION' && !m.excluCalcul);
  const net = stockNetParCategorie(retenus, cellules, emplacements);
  const parCle = new Map(net.map((g) => [g.cle, { ...g }]));
  consommationParStock(lots || [], date).forEach((c) => {
    if (!parCle.has(c.cle)) parCle.set(c.cle, { cle: c.cle, label: c.label, tonnes: 0, bottes: 0 });
    const g = parCle.get(c.cle);
    g.tonnes = arrondi3(g.tonnes - c.tonnes);
  });
  // Un aliment distribué au-delà de son stock net (sur-affecté, ou consommé
  // avant la saisie de sa récolte) doit rester VISIBLE, y compris négatif —
  // le cacher masquerait justement l'écart à corriger. Seul l'ordre
  // d'affichage est refait ici (stockNetParCategorie triait sur le stock
  // brut, avant déduction des distributions).
  return Array.from(parCle.values()).sort((a, b) => b.tonnes - a.tonnes);
}

// Types comptés comme "entrée" pour le Prévisionnel : récoltes, achats, un
// inventaire d'ouverture (déclaré en INVENTAIRE — remplace le niveau constaté
// au lieu de s'y ajouter, ce qui modélise exactement "voici ce que j'ai en
// stock au début de la campagne") et les transferts (neutres à l'échelle de
// l'exploitation, un même lot changeant seulement de contenant). AUCUNE
// sortie (vente, perte, alimentation) : le Prévisionnel compare le total
// entré sur la campagne au besoin total, jamais ce qu'il en reste aujourd'hui
// — c'est stockDisponibleCanonique() qui répond à cette question-là.
const TYPES_ENTREE_CAMPAGNE = ['ENTREE_RECOLTE', 'ENTREE_ACHAT', 'INVENTAIRE', 'TRANSFERT'];

/**
 * Stock "entrées campagne" par catégorie, pour le tableau de couverture du
 * Prévisionnel (Aliment | Stock | Besoin prévu | Solde | À acheter) — jamais
 * les distributions ni les autres sorties, cf. rations-calc.js/
 * couverturePrevisionnelle qui compare ce chiffre au besoin planifié.
 * @returns {Array<{cle, label, tonnes, bottes}>}
 */
export function entreesCampagneParCategorie(mouvements, cellules, emplacements) {
  const retenus = (mouvements || []).filter((m) => TYPES_ENTREE_CAMPAGNE.includes(m.typeMouvement));
  return stockNetParCategorie(retenus, cellules, emplacements);
}

// Les tuiles/tableaux de l'onglet Stocks (totaux par famille, coupe × type,
// "Par catégorie") affichaient les ENTRÉES BRUTES (agregerParCategorie +
// agregerMouvements, jamais réduites par une sortie) — d'où l'écart constaté
// entre "30 t" ici et "29,52 t" dans la liste "Stock disponible" (celle-ci
// DÉJÀ sur stockDisponibleCanonique). Cette fonction fusionne les DEUX : le
// tonnage canonique (stockDisponibleCanonique, seule source de vérité) avec
// les métadonnées que seules les entrées portent (coupe, fourrage,
// conservation, nbRecoltes...), pour que tous les affichages de Stocks
// lisent enfin le même chiffre — sans perdre le détail qui fait le tableau
// croisé et "Par catégorie".
// @param {Array} categories  fourrages.fusionnerCategories() — entrées brutes, avec métadonnées
// @param {Array} net         stockDisponibleCanonique() — LE tonnage qui fait foi
export function categoriesAvecStockNet(categories, net) {
  const parCle = new Map((net || []).map((g) => [g.cle, g]));
  return (categories || []).map((c) => {
    const g = parCle.get(c.cle);
    return { ...c, tonnes: g ? g.tonnes : 0 };
  });
}

/**
 * Tous les mouvements qui concernent un aliment donné — pour la fiche
 * aliment de l'onglet Stocks (ui-fiche-aliment.js).
 *
 * Les ENTRÉES (récolte, achat) s'identifient directement (identiteDuMouvement).
 * Les SORTIES (vente, perte, alimentation, transfert) ne portent, elles,
 * aucune identité propre (cf. en-tête de fichier : ce que tire une sortie
 * n'est jamais précisé au champ) — on les rattache donc au(x) contenant(s)
 * qui ont réellement reçu cet aliment, même logique que
 * ventilationContenant() au niveau d'UN contenant, étendue ici à TOUS ceux
 * qui portent cette clé.
 */
export function mouvementsDeAliment(cle, mouvements) {
  const conteneurs = new Set();
  mouvements.forEach((m) => {
    const id = identiteDuMouvement(m);
    if (id && id.cle === cle && ENTREES.includes(m.typeMouvement) && m.destinationType && m.destinationId) {
      conteneurs.add(m.destinationType + '|' + m.destinationId);
    }
  });
  return mouvements
    .filter((m) => {
      const id = identiteDuMouvement(m);
      if (id && id.cle === cle) return true;
      return !!(m.sourceType && m.sourceId && conteneurs.has(m.sourceType + '|' + m.sourceId));
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
