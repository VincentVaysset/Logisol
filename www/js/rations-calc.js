// Moteur de calcul du module Rations : consommation dérivée des distributions
// réelles (jamais un décrément écrit), total prévu du plan de campagne, et
// le bilan qui confronte les deux — cf. affectations.js et plan-campagne.js
// pour le pourquoi d'un calcul purement dérivé, jamais stocké, à l'image de
// niveauContenant() côté mouvements de stock.
import { aujourdhui } from './implantations.js';
import { historiqueAffectations, affectationEnCours, tonnesComposant, tonnesComposantFenetre, composantsAffectation } from './affectations.js';
import { joursLignePlan } from './plan-campagne.js';
import { bornesCampagneStock, campagnesStockDisponibles } from './campagne-stock.js';

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

/** Consommation cumulée à ce jour, par aliment — tous lots, toutes distributions. */
export function consommationParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => {
      composantsAffectation(aff).forEach((c) => {
        if (!c.stockCle) return;
        if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
        const g = parCle.get(c.stockCle);
        g.tonnes = arrondi3(g.tonnes + tonnesComposant(aff, c, date));
      });
    });
  });
  return Array.from(parCle.values());
}

// 'fourrage' (foin, y compris paille si jamais elle apparaissait dans une
// ration — en pratique jamais, elle en est exclue), 'cereale' ou 'aliment'
// (achat du commerce) — cf. stocks.js/cleFoin,cleCereale,cleCommerce pour le
// format des clés.
function familleDeCle(cle) {
  const prefixe = String(cle || '').split('|')[0];
  if (prefixe === 'cereale') return 'cereale';
  if (prefixe === 'commerce') return 'aliment';
  return 'fourrage';
}

/**
 * Bilan par LOT, cumulé sur une campagne : Fourrages(t) / Céréales(t) /
 * Aliments(t), avec le détail par aliment de chaque lot — uniquement ce qui
 * a été RÉELLEMENT distribué. Aucune notion de suffisance ni d'achat ici :
 * ça, c'est le Prévisionnel (couverturePrevisionnelle), jamais confondu
 * (Prévu et Distribué ne se lisent jamais l'un l'autre, CLAUDE.md).
 * campagne : campagne Stocks/Troupeau (« 2025-2026 », 01/09-31/08, cf.
 * campagne-stock.js) — distincte de calculerCampagnes() (campagnes.js),
 * propre aux activités de parcelle. Une ration qui chevauche le 31/08 est
 * comptée au prorata des jours tombant dans la campagne.
 */
export function bilanParLot(lots, campagne, date = aujourdhui()) {
  const fenetre = bornesCampagneStock(campagne);
  return (lots || []).map((lot) => {
    const parAliment = new Map();
    historiqueAffectations(lot).forEach((aff) => {
      composantsAffectation(aff).forEach((c) => {
        if (!c.stockCle) return;
        const t = tonnesComposantFenetre(aff, c, fenetre, date);
        if (!(t > 0)) return;
        if (!parAliment.has(c.stockCle)) {
          parAliment.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, famille: familleDeCle(c.stockCle), tonnes: 0 });
        }
        const g = parAliment.get(c.stockCle);
        g.tonnes = arrondi3(g.tonnes + t);
      });
    });
    const items = Array.from(parAliment.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    const totaux = { fourrage: 0, cereale: 0, aliment: 0 };
    items.forEach((it) => { totaux[it.famille] = arrondi3(totaux[it.famille] + it.tonnes); });
    return {
      lotId: lot.id, lotNom: lot.nom || 'Lot',
      items, fourrages: totaux.fourrage, cereales: totaux.cereale, aliments: totaux.aliment
    };
  });
}

/** Total par aliment, tous lots confondus — ligne de synthèse sous le bilan par lot. */
export function totalParAlimentTousLots(bilanLots) {
  const parCle = new Map();
  (bilanLots || []).forEach((bl) => {
    bl.items.forEach((it) => {
      if (!parCle.has(it.cle)) parCle.set(it.cle, { cle: it.cle, label: it.label, famille: it.famille, tonnes: 0 });
      const g = parCle.get(it.cle);
      g.tonnes = arrondi3(g.tonnes + it.tonnes);
    });
  });
  return Array.from(parCle.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** Campagnes Stocks/Troupeau couvertes par l'historique des distributions,
 * de la plus ancienne à la campagne en cours, les plus récentes d'abord. */
export function campagnesDistribuees(lots, date = aujourdhui()) {
  const dates = [];
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => { if (aff.dateDebut) dates.push(aff.dateDebut); });
  });
  return campagnesStockDisponibles(dates, date);
}

/** Consommation par aliment sur la fenêtre d'une campagne (prorata), tous lots. */
export function consommationCampagneParStock(lots, campagne, date = aujourdhui()) {
  const fenetre = bornesCampagneStock(campagne);
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => {
      composantsAffectation(aff).forEach((c) => {
        if (!c.stockCle) return;
        const t = tonnesComposantFenetre(aff, c, fenetre, date);
        if (!(t > 0)) return;
        if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
        const g = parCle.get(c.stockCle);
        g.tonnes = arrondi3(g.tonnes + t);
      });
    });
  });
  return Array.from(parCle.values());
}

/** Besoin journalier COURANT, par aliment — seulement les distributions actives aujourd'hui. */
export function besoinJournalierParStock(lots, date = aujourdhui()) {
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    const aff = affectationEnCours(lot, date);
    if (!aff) return;
    const nb = Number(aff.nbBrebis) || 0;
    composantsAffectation(aff).forEach((c) => {
      if (!c.stockCle) return;
      if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, kgParJour: 0 });
      parCle.get(c.stockCle).kgParJour += nb * (Number(c.kgParAnimalJour) || 0);
    });
  });
  return Array.from(parCle.values());
}

/**
 * Total prévu par aliment sur tout le plan de campagne : Σ lignes
 * [ effectifPrevu × kgParAnimalJour × nbJours planifiés ].
 * @param {{stades: Array}} plan  sortie de plan-campagne.getPlan()
 */
export function prevuCampagneParAliment(plan) {
  const parCle = new Map();
  ((plan && plan.stades) || []).forEach((ligne) => {
    const jours = joursLignePlan(ligne);
    const effectif = Number(ligne.effectifPrevu) || 0;
    (ligne.composants || []).forEach((c) => {
      if (!c.stockCle) return;
      if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, { cle: c.stockCle, label: c.stockLabel, tonnes: 0 });
      const kg = effectif * (Number(c.kgParAnimalJour) || 0) * jours;
      const g = parCle.get(c.stockCle);
      g.tonnes = arrondi3(g.tonnes + kg / 1000);
    });
  });
  return Array.from(parCle.values());
}

// Marge de confort sous laquelle une couverture positive passe en orange
// plutôt qu'en vert (partagée par couverturePrevisionnelle et bilanParAliment
// ci-dessous) : moins de 15 % d'avance sur le besoin, c'est "juste" plutôt
// que confortable. Valeur de convenance, pas une règle métier communiquée
// par l'exploitant — ajustable si besoin.
const MARGE_JUSTE = 0.15;

/**
 * Tableau de couverture du Prévisionnel : Aliment | Stock (entrées campagne)
 * | Besoin prévu | Solde | À acheter — LE SEUL endroit de l'appli où "à
 * acheter" existe. Ne lit JAMAIS les distributions ni la consommation
 * réelle : uniquement le plan (besoin prévu, total sur toute la campagne) et
 * les entrées de stock (fourrages.js/entreesCampagneParCategorie) — Prévu et
 * Distribué ne se lisent jamais l'un l'autre (CLAUDE.md).
 * @param {Array<{cle,label,tonnes}>} entreesCampagne  fourrages.js/entreesCampagneParCategorie
 * @param {{stades: Array}} plan  sortie de plan-campagne.getPlan()
 */
export function couverturePrevisionnelle(entreesCampagne, plan) {
  const besoin = new Map(prevuCampagneParAliment(plan).map((p) => [p.cle, p]));
  const stock = new Map((entreesCampagne || []).map((s) => [s.cle, s]));
  const cles = new Set([...besoin.keys(), ...stock.keys()]);

  return Array.from(cles).map((cle) => {
    const b = besoin.get(cle);
    const s = stock.get(cle);
    const stockT = s ? s.tonnes : 0;
    const besoinT = b ? b.tonnes : 0;
    const solde = arrondi3(stockT - besoinT);
    const aAcheter = Math.max(0, arrondi3(besoinT - stockT));

    let statut = 'vert';
    if (solde < 0) statut = 'rouge';
    else if (besoinT > 0 && solde / besoinT < MARGE_JUSTE) statut = 'orange';

    return {
      cle, label: (b && b.label) || (s && s.label) || cle,
      stock: stockT, besoin: besoinT, solde, aAcheter, statut
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr'));
}

/**
 * Stock disponible par aliment : entrées (récoltes + achats, catégories
 * fusionnées de l'onglet Stocks) moins consommation calculée depuis les
 * distributions — jamais un décrément écrit sur le stock lui-même.
 * @param {Array} categories  sortie de fourrages.fusionnerCategories()
 */
export function stockDisponibleParItem(categories, lots, date = aujourdhui()) {
  const parCle = new Map();
  (categories || []).forEach((c) => {
    parCle.set(c.cle, { cle: c.cle, label: c.label, entrees: Number(c.tonnes) || 0, consomme: 0 });
  });
  consommationParStock(lots, date).forEach((c) => {
    if (!parCle.has(c.cle)) parCle.set(c.cle, { cle: c.cle, label: c.label, entrees: 0, consomme: 0 });
    parCle.get(c.cle).consomme = c.tonnes;
  });
  return Array.from(parCle.values()).map((c) => ({ ...c, disponible: arrondi3(c.entrees - c.consomme) }));
}


/** Lots qui ont mangé chaque aliment sur la campagne (« Mangée par … » de Stocks). */
export function lotsConsommateurs(lots, campagne, date = aujourdhui()) {
  const fenetre = bornesCampagneStock(campagne);
  const parCle = new Map();
  (lots || []).forEach((lot) => {
    historiqueAffectations(lot).forEach((aff) => {
      composantsAffectation(aff).forEach((c) => {
        if (!c.stockCle || !(tonnesComposantFenetre(aff, c, fenetre, date) > 0)) return;
        if (!parCle.has(c.stockCle)) parCle.set(c.stockCle, []);
        const noms = parCle.get(c.stockCle);
        const nom = lot.nom || 'Lot';
        if (!noms.includes(nom)) noms.push(nom);
      });
    });
  });
  return parCle;
}
