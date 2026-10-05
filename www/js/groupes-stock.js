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

const COUPES = ['', '1ʳᵉ coupe', '2ᵉ coupe', '3ᵉ coupe', '4ᵉ coupe'];

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

function majuscule(s) { const t = String(s || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; }

/** Lecture d'une clé (stocks.js/cleFoin, cleCereale, clePaille, cleCommerce). */
export function lireCle(cle) {
  const [prefixe, a, b, c] = String(cle || '').split('|');
  if (prefixe === 'foin') {
    return { type: 'foin', conservation: a || 'botte', coupe: Number(String(b || '').replace('c', '')) || 0, fourrage: c || '' };
  }
  if (prefixe === 'cereale') return { type: 'cereale', espece: a || '' };
  if (prefixe === 'paille') return { type: 'paille' };
  if (prefixe === 'commerce') return { type: 'commerce', nom: a || '' };
  return { type: 'autre' };
}

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
  if (k.type === 'paille') return 'Paille en botte';
  if (k.type === 'cereale') {
    const espece = meta.espece || String(label || '').replace(/^Céréale\s*—\s*/, '') || k.espece;
    return majuscule(espece);
  }
  if (k.type === 'commerce') return label || majuscule(k.nom);
  if (k.type === 'foin') {
    const coupe = COUPES[k.coupe] || '';
    const fourrage = meta.fourrage || majuscule(k.fourrage.replace(/-/g, ' '));
    if (groupe === 'luzerne') return [coupe || 'coupe ?', methode(k.conservation)].join(' · ');
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
  let concentres = null;

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
    if (lireCle(cle).type === 'commerce') {
      // Concentrés achetés : UNE ligne dans Céréales, détail des produits.
      if (!concentres) {
        concentres = { cle: null, cles: [], libelle: 'Concentrés achetés', reste: 0, produits: [] };
        g.lignes.push(concentres);
      }
      concentres.cles.push(cle);
      concentres.reste = arrondi3(concentres.reste + r);
      concentres.produits.push(label);
      return;
    }
    g.lignes.push({ cle, cles: [cle], libelle: libelleLigne(cle, label, m), reste: r });
  });

  groupes.forEach((g) => {
    const base = g.depart + g.recolte + g.achat;
    g.jauge = base > 0 ? Math.max(0, Math.min(100, Math.round((g.reste / base) * 100))) : null;
    g.lignes.sort((a, b) => (a.cle === null) - (b.cle === null) || a.libelle.localeCompare(b.libelle, 'fr'));
  });

  const somme = (fam) => arrondi3(groupes.filter((g) => g.famille === fam).reduce((n, g) => n + g.reste, 0));
  const totaux = { fourrages: somme('fourrages'), cereales: somme('cereales'), paille: somme('paille') };
  totaux.total = arrondi3(totaux.fourrages + totaux.cereales + totaux.paille);
  return { totaux, groupes: groupes.filter((g) => g.cles.length) };
}
