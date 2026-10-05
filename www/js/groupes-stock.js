// Groupes d'affichage de l'onglet Stocks : Luzerne, Foin de prairie (PT + PN),
// Enrubannage / ensilage, Céréales (dont « Concentrés achetés »), Paille.
//
// Présentation SEULEMENT : chaque ligne garde sa clé précise (categorieCle),
// qui reste l'identité réelle du stock jusqu'à la ration — rien n'est
// fusionné au moment de calculer. Les chiffres viennent tous de
// fourrages.js/stockDisponibleCanonique (reste), des entrées du journal
// (récolté, acheté) et des rations distribuées (consommé).
//
// Module pur (aucun import) : testable en Node tel quel.

export const GROUPES = [
  { id: 'luzerne',     nom: 'Luzerne',                famille: 'fourrages' },
  { id: 'prairie',     nom: 'Foin de prairie',        famille: 'fourrages', precision: 'PT + PN' },
  { id: 'enrubannage', nom: 'Enrubannage / ensilage', famille: 'fourrages' },
  { id: 'cereales',    nom: 'Céréales',               famille: 'cereales' },
  { id: 'paille',      nom: 'Paille',                 famille: 'paille' }
];

// Bilan campagne seulement : les concentrés achetés y forment un groupe à
// part (dans Stocks, ils restent des lignes du groupe Céréales).
const GROUPE_CONCENTRES = { id: 'concentres', nom: 'Concentrés achetés', famille: 'cereales' };

const COUPES = ['', '1ʳᵉ coupe', '2ᵉ coupe', '3ᵉ coupe', '4ᵉ coupe'];

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

function majuscule(s) { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; }

/** Lecture d'une clé (stocks.js/cleFoin, cleCereale, clePaille, cleCommerce). */
export function lireCle(cle) {
  const [prefixe, a, b, c] = String(cle || '').split('|');
  if (prefixe === 'foin') {
    return { type: 'foin', conservation: a || 'botte', coupe: Number(String(b || '').replace('c', '')) || 0, fourrage: c || '', achat: a === 'achat' };
  }
  if (prefixe === 'cereale') return { type: 'cereale', espece: a || '' };
  if (prefixe === 'paille') return { type: 'paille', achat: a === 'achat', nom: a === 'achat' ? b || '' : '' };
  if (prefixe === 'commerce') return { type: 'commerce', nom: a || '', achat: true };
  return { type: 'autre' };
}

/** Aliment acheté et nommé (concentré, foin ou paille) : sa propre ligne de stock. */
export function estAchete(cle) { return !!lireCle(cle).achat; }

/**
 * Groupe d'une clé. meta (facultatif) : { fourrage, enrubannage } — le nom
 * lisible du fourrage et si l'aliment est entré dans un hangar d'enrubannage
 * ou d'ensilage (la clé ne le dit pas : un enrubannage est stocké « en botte »).
 */
export function groupeDeCle(cle, meta = {}) {
  const k = lireCle(cle);
  if (k.type === 'paille') return 'paille';
  if (k.type === 'cereale' || k.type === 'commerce') return 'cereales';
  const nom = `${meta.fourrage || ''} ${k.fourrage || ''}`.toLowerCase();
  if (meta.enrubannage || /enrubann|ensil/.test(nom)) return 'enrubannage';
  if (/luzerne/.test(nom)) return 'luzerne';
  return 'prairie';
}

function methode(conservation) { return conservation === 'grange' ? 'séchée grange' : 'en botte'; }

/** Libellé d'une ligne dans son groupe : coupe × méthode, espèce... */
export function libelleLigne(cle, label, meta = {}) {
  const k = lireCle(cle);
  const groupe = groupeDeCle(cle, meta);
  if (estAchete(cle)) return `${label || majuscule(k.nom || k.fourrage)} · acheté`;
  if (k.type === 'paille') return 'Paille en botte';
  if (k.type === 'cereale') {
    const espece = meta.espece || String(label || '').replace(/^Céréale\s*—\s*/, '') || k.espece;
    return majuscule(espece);
  }
  if (k.type === 'commerce') return label || majuscule(k.nom);
  if (k.type === 'foin') {
    const coupe = COUPES[k.coupe] || '';
    const fourrage = meta.fourrage || majuscule(k.fourrage.replace(/-/g, ' '));
    if (groupe === 'luzerne') return [coupe || 'coupe non précisée', methode(k.conservation)].join(' · ');
    return [fourrage, coupe, groupe === 'enrubannage' ? '' : methode(k.conservation)].filter(Boolean).join(' · ');
  }
  return label || cle;
}

/**
 * @param {object} p
 * @param {Array<{cle,label,tonnes}>} p.reste        stock à la date de référence
 * @param {Map<string,number>}         p.depart      stock au 31/08 précédent (veille du 01/09)
 * @param {Map<string,{recolte,achat}>} p.entrees    entrées de la campagne
 * @param {Map<string,number>}         p.conso       consommé sur la campagne (rations)
 * @param {Map<string,object>}         p.meta        { fourrage, espece, enrubannage } par clé
 * @param {Map<string,string[]>}       [p.mangeePar] noms des lots qui consomment chaque clé
 */
export function construireGroupes({ reste = [], depart = new Map(), entrees = new Map(), conso = new Map(), meta = new Map(), mangeePar = new Map() }) {
  const labels = new Map();
  const cles = new Set();
  reste.forEach((r) => { cles.add(r.cle); labels.set(r.cle, r.label); });
  [depart, entrees, conso].forEach((m) => m.forEach((v, cle) => {
    cles.add(cle);
    if (!labels.has(cle) && v && v.label) labels.set(cle, v.label);
  }));
  const resteDe = new Map(reste.map((r) => [r.cle, Number(r.tonnes) || 0]));

  const groupes = GROUPES.map((g) => ({
    ...g, reste: 0, depart: 0, recolte: 0, achat: 0, conso: 0, lignes: [], cles: [], mangeePar: []
  }));
  const parId = new Map(groupes.map((g) => [g.id, g]));

  Array.from(cles).sort().forEach((cle) => {
    const m = meta.get(cle) || {};
    const g = parId.get(groupeDeCle(cle, m));
    const r = arrondi3(resteDe.get(cle) || 0);
    const d = arrondi3(depart.get(cle) || 0);
    const e = entrees.get(cle) || { recolte: 0, achat: 0 };
    const c = arrondi3(conso.get(cle) || 0);
    // Une clé sans stock ni mouvement sur la campagne n'a rien à montrer.
    if (Math.abs(r) < 0.001 && Math.abs(d) < 0.001 && !e.recolte && !e.achat && !c) return;
    g.reste = arrondi3(g.reste + r);
    g.depart = arrondi3(g.depart + d);
    g.recolte = arrondi3(g.recolte + (e.recolte || 0));
    g.achat = arrondi3(g.achat + (e.achat || 0));
    g.conso = arrondi3(g.conso + c);
    g.cles.push(cle);
    (mangeePar.get(cle) || []).forEach((lot) => { if (!g.mangeePar.includes(lot)) g.mangeePar.push(lot); });
    const label = labels.get(cle) || cle;
    // Un aliment acheté et nommé a sa propre ligne, « Tourteau colza ·
    // acheté » : c'est ce qui permet d'en suivre le stock.
    g.lignes.push({ cle, cles: [cle], libelle: libelleLigne(cle, label, m), reste: r, achete: estAchete(cle) });
  });

  groupes.forEach((g) => {
    const base = g.depart + g.recolte + g.achat;
    g.jauge = base > 0 ? Math.max(0, Math.min(100, Math.round((g.reste / base) * 100))) : null;
    // Produits de la ferme d'abord, achats ensuite.
    g.lignes.sort((a, b) => a.achete - b.achete || a.libelle.localeCompare(b.libelle, 'fr'));
  });

  const somme = (fam) => arrondi3(groupes.filter((g) => g.famille === fam).reduce((n, g) => n + g.reste, 0));
  const totaux = { fourrages: somme('fourrages'), cereales: somme('cereales'), paille: somme('paille') };
  totaux.total = arrondi3(totaux.fourrages + totaux.cereales + totaux.paille);
  return { totaux, groupes: groupes.filter((g) => g.cles.length) };
}

/**
 * Bilan campagne de Troupeau : consommé par groupe d'aliment, ventilé brebis /
 * agnelles, les deux totaux en tête, et le détail par aliment de chaque
 * groupe (les achetés portent `achete`). Les concentrés achetés forment leur
 * propre groupe. Uniquement les rations distribuées (entrée :
 * rations-calc.js/bilanParLot) — un ajustement d'inventaire n'y entre jamais.
 * @param {Array<{type:'BREBIS'|'AGNELLES', items:Array<{cle,label,tonnes}>}>} lotsBilan
 * @param {Map<string,object>} [meta]
 */
export function bilanParTypeAnimaux(lotsBilan, meta = new Map()) {
  const totaux = { brebis: 0, agnelles: 0 };
  const parGroupe = new Map();
  (lotsBilan || []).forEach((lb) => {
    const champ = lb.type === 'AGNELLES' ? 'agnelles' : 'brebis';
    (lb.items || []).forEach((it) => {
      const t = Number(it.tonnes) || 0;
      if (!(t > 0)) return;
      const id = lireCle(it.cle).type === 'commerce' ? GROUPE_CONCENTRES.id : groupeDeCle(it.cle, meta.get(it.cle) || {});
      if (!parGroupe.has(id)) {
        const def = id === GROUPE_CONCENTRES.id ? GROUPE_CONCENTRES : GROUPES.find((g) => g.id === id);
        parGroupe.set(id, { id, nom: def.nom, total: 0, brebis: 0, agnelles: 0, aliments: new Map() });
      }
      const g = parGroupe.get(id);
      g[champ] = arrondi3(g[champ] + t);
      g.total = arrondi3(g.total + t);
      totaux[champ] = arrondi3(totaux[champ] + t);
      if (!g.aliments.has(it.cle)) {
        g.aliments.set(it.cle, { cle: it.cle, libelle: libelleLigne(it.cle, it.label, meta.get(it.cle) || {}),
          achete: estAchete(it.cle), total: 0, brebis: 0, agnelles: 0 });
      }
      const a = g.aliments.get(it.cle);
      a[champ] = arrondi3(a[champ] + t);
      a.total = arrondi3(a.total + t);
    });
  });
  const ordre = GROUPES.map((g) => g.id);
  ordre.splice(ordre.indexOf('cereales') + 1, 0, GROUPE_CONCENTRES.id);
  const groupes = Array.from(parGroupe.values()).sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
  groupes.forEach((g) => {
    g.pctBrebis = g.total > 0 ? Math.round((g.brebis / g.total) * 100) : 0;
    g.pctAgnelles = g.total > 0 ? 100 - g.pctBrebis : 0;
    g.aliments = Array.from(g.aliments.values())
      .sort((a, b) => a.achete - b.achete || b.total - a.total || a.libelle.localeCompare(b.libelle, 'fr'));
  });
  return { totaux, groupes };
}

/**
 * Ration par animal et par jour, séparée fourrages / concentrés (vigilance
 * acidose) : kg bruts, informatif, aucun seuil. La paille n'est jamais un
 * composant de ration.
 * @param {Array<{stockCle, kgParAnimalJour}>} composants
 * @returns {{fourrages:number, concentres:number, total:number, pctConcentres:number|null}}
 */
export function rationParAnimal(composants) {
  let fourrages = 0, concentres = 0;
  (composants || []).forEach((c) => {
    const kg = Number(c.kgParAnimalJour) || 0;
    const k = lireCle(c.stockCle);
    if (k.type === 'cereale' || k.type === 'commerce') concentres += kg;
    else if (k.type !== 'paille') fourrages += kg;
  });
  const total = fourrages + concentres;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { fourrages: r2(fourrages), concentres: r2(concentres), total: r2(total),
    pctConcentres: total > 0 ? Math.round((concentres / total) * 100) : null };
}
