// Synthèses du Réalisé (maquette-syntheses-app.html / -pdf.html) — module
// pur, sans Firestore : l'appelant (ui-rapports.js) lui passe les activités
// de la campagne (campagne de CHAQUE activité, cf. campagnes.js) déjà
// normalisées, plus deux résolveurs (culture en place, surface).
//
// Regroupements validés par Vincent :
//   semis       → par culture, parcelles en détail ;
//   épandages   → par parcelle (+ totaux exploitation par produit) ;
//   fourrages   → par fourrage · coupe ET par parcelle ;
//   céréales    → par culture (grain + paille), parcelles en détail ;
//   travaux     → par type ET par parcelle.
// Dose d'un groupe : affichée seulement si identique partout (pas de moyenne).
import { quantiteDeSaisie } from './poids-specifique.js';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const fr = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true });
const parDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));

/** Dose commune à toutes les lignes, sinon null (jamais de moyenne). */
export function doseUnique(lignes, champ = 'dose') {
  const v = lignes.map((l) => l[champ]);
  if (!v.length || v.some((x) => x == null)) return null;
  return v.every((x) => Math.abs(x - v[0]) < 1e-9) ? v[0] : null;
}

/**
 * Répartit une valeur saisie pour l'activité entière sur ses parcelles, au
 * prorata des surfaces (comme realise-calc.js).
 * @returns {Array<{id, ha, part}>} part = fraction de l'activité
 */
function repartir(ids, surfaceDe, declareeHa) {
  const somme = ids.reduce((t, id) => t + surfaceDe(id), 0);
  return ids.map((id) => {
    const part = somme > 0 ? surfaceDe(id) / somme : 1 / ids.length;
    return { id, part, ha: declareeHa != null ? declareeHa * part : surfaceDe(id) };
  });
}

/**
 * @param {object} ctx
 * @param {Array<{id, nom, surfaceHa}>} ctx.parcelles
 * @param {Array<{id, date, typeNom, formulaire, categorie, parcelleIds, s, tracteurNom, materielNom, chauffeur}>} ctx.activites
 * @param {(parcelleId:string, date:string)=>string|null} ctx.cultureA  culture en place à cette date
 */
export function calculerSyntheses({ parcelles, activites, cultureA }) {
  const parId = new Map(parcelles.map((p) => [p.id, p]));
  const surfaceDe = (id) => Number((parId.get(id) || {}).surfaceHa) || 0;
  const nomDe = (id) => (parId.get(id) || {}).nom || 'Sans nom';
  const acts = activites
    .map((a) => ({ ...a, s: a.s || {}, ids: (a.parcelleIds || []).filter((id) => parId.has(id)) }))
    .filter((a) => a.ids.length)
    .sort(parDate);
  // Culture de la campagne d'une parcelle : celle semée dans la campagne
  // (un épandage avant semis concerne la culture à venir), sinon celle en place.
  const semeeCampagne = new Map();
  acts.filter((a) => a.formulaire === 'SEMIS' && a.cultureNom && !a.derobee).forEach((a) => a.ids.forEach((id) => semeeCampagne.set(id, a.cultureNom)));
  const cultureCampagne = (id, date) => semeeCampagne.get(id) || (cultureA && cultureA(id, date)) || null;
  const res = {
    semis: semis(acts.filter((a) => a.formulaire === 'SEMIS'), surfaceDe, nomDe),
    epandages: epandages(acts.filter((a) => a.formulaire === 'FUMIER' || a.formulaire === 'CHAULAGE'), surfaceDe, nomDe, cultureCampagne),
    fourrages: fourrages(acts.filter((a) => (a.formulaire === 'PRESSAGE' && a.s.produitRecolte !== 'PAILLE') || a.formulaire === 'SECHAGE'), surfaceDe, nomDe, cultureA),
    cereales: cereales(acts, surfaceDe, nomDe, cultureA),
    travaux: travaux(acts, surfaceDe, nomDe, cultureCampagne)
  };
  res.tardives = recoltesTardives(res);
  return res;
}

/**
 * Récoltes de la campagne faites après le 31/08 (regain, dernière coupe) :
 * comptées dans les récoltes de leur campagne, mais entrées au stock de la
 * campagne de stock suivante (inventaire comptable au 31/08 inchangé).
 */
function recoltesTardives(res) {
  const lignes = [];
  res.fourrages.parCoupe.forEach((g) => g.lignes.forEach((l) => lignes.push({ date: l.date, t: l.t || 0, quoi: `${g.fourrage} · ${g.coupe == null ? 'coupe ?' : g.coupe + 'e coupe'}`, parcelle: l.parcelle })));
  res.cereales.groupes.forEach((g) => g.lignes.forEach((l) => { if (l.date && l.grainT) lignes.push({ date: l.date, t: l.grainT, quoi: g.nom, parcelle: l.parcelle }); }));
  return lignes;
}

// --- 1. Semis : par culture -------------------------------------------------
function semis(acts, surfaceDe, nomDe) {
  const groupes = new Map();
  acts.forEach((a) => {
    const declaree = num(a.s.surfaceHa);
    const dose = num(a.s.doseKgHa);
    const culture = a.cultureNom || 'Culture non renseignée';
    repartir(a.ids, surfaceDe, declaree).forEach(({ id, ha }) => {
      const g = groupes.get(culture) || { nom: culture, derobee: !!a.derobee, lignes: [] };
      g.lignes.push({ parcelleId: id, parcelle: nomDe(id), date: a.date, ha: r2(ha), dose,
        kg: dose != null ? Math.round(dose * ha) : null, semence: String(a.s.semence || '').trim(),
        materiel: a.materielNom || '', estimee: declaree == null || !!a.s.surfaceEstimee });
      groupes.set(culture, g);
    });
  });
  const liste = Array.from(groupes.values()).map((g) => {
    g.lignes.sort((x, y) => fr(x.parcelle, y.parcelle) || parDate(x, y));
    return { ...g, ha: r2(g.lignes.reduce((t, l) => t + l.ha, 0)),
      kg: g.lignes.some((l) => l.kg != null) ? g.lignes.reduce((t, l) => t + (l.kg || 0), 0) : null,
      kgPartiel: g.lignes.some((l) => l.kg == null), dose: doseUnique(g.lignes),
      nbParcelles: new Set(g.lignes.map((l) => l.parcelleId)).size, estimee: g.lignes.some((l) => l.estimee) };
  }).sort((x, y) => fr(x.nom, y.nom));
  // Dérobées : à part et hors total (la parcelle garde sa culture principale).
  const princ = liste.filter((g) => !g.derobee);
  const derobees = liste.filter((g) => g.derobee);
  return {
    groupes: princ,
    derobees,
    derobeesHa: r2(derobees.reduce((t, g) => t + g.ha, 0)),
    ha: r2(princ.reduce((t, g) => t + g.ha, 0)),
    kg: princ.some((g) => g.kg != null) ? princ.reduce((t, g) => t + (g.kg || 0), 0) : null,
    kgPartiel: princ.some((g) => g.kgPartiel),
    estimee: liste.some((g) => g.estimee)
  };
}

// --- 2. Épandages : par parcelle + totaux par produit ------------------------
const PRODUITS = { FUMIER: 'Fumier', CHAULAGE: 'Chaux' };
function epandages(acts, surfaceDe, nomDe, cultureA) {
  const parP = new Map();
  acts.forEach((a) => {
    const produit = PRODUITS[a.formulaire];
    const tonnesAct = a.formulaire === 'FUMIER' ? quantiteDeSaisie('FUMIER', a.s) : null;
    const doseChaux = a.formulaire === 'CHAULAGE' ? num(a.s.doseTonnesHa) : null;
    repartir(a.ids, surfaceDe, null).forEach(({ id, ha, part }) => {
      const t = a.formulaire === 'FUMIER' ? (tonnesAct != null ? tonnesAct * part : null) : (doseChaux != null ? doseChaux * ha : null);
      const p = parP.get(id) || { parcelleId: id, parcelle: nomDe(id), ha: r2(surfaceDe(id)), culture: '', lignes: [] };
      p.lignes.push({ produit, date: a.date, t: t == null ? null : r2(t), tHa: t != null && ha > 0 ? r2(t / ha) : null });
      parP.set(id, p);
    });
  });
  const parcellesL = Array.from(parP.values()).map((p) => {
    const dernier = p.lignes[p.lignes.length - 1];
    const t = p.lignes.reduce((x, l) => x + (l.t || 0), 0);
    return { ...p, culture: (cultureA && cultureA(p.parcelleId, dernier.date)) || '', t: r2(t),
      tHa: p.ha > 0 && p.lignes.length === 1 ? dernier.tHa : null };
  }).sort((x, y) => fr(x.parcelle, y.parcelle));
  const parProduit = Object.values(PRODUITS).map((produit) => {
    const ps = parcellesL.filter((p) => p.lignes.some((l) => l.produit === produit));
    if (!ps.length) return null;
    return { produit, nbParcelles: ps.length, ha: r2(ps.reduce((t, p) => t + p.ha, 0)),
      t: r2(ps.reduce((t, p) => t + p.lignes.filter((l) => l.produit === produit).reduce((x, l) => x + (l.t || 0), 0), 0)) };
  }).filter(Boolean);
  return { parcelles: parcellesL, parProduit, ha: r2(parcellesL.reduce((t, p) => t + p.ha, 0)) };
}

// --- 3. Fourrages : par fourrage · coupe et par parcelle ----------------------
function tonnesFourrage(a) {
  if (a.formulaire === 'PRESSAGE') {
    const b = num(a.s.nbBottes), kg = num(a.s.poidsBotteKg);
    return b != null && kg != null ? r3(b * kg / 1000) : null;
  }
  return quantiteDeSaisie('SECHAGE', a.s);
}
function fourrages(acts, surfaceDe, nomDe, cultureA) {
  const lignes = [];
  acts.forEach((a) => {
    const t = tonnesFourrage(a);
    const declaree = num(a.s.surfaceHa);
    const seche = a.formulaire === 'SECHAGE';
    repartir(a.ids, surfaceDe, declaree).forEach(({ id, ha, part }) => {
      const base = String(a.s.typeFourrage || '').trim() || (cultureA && cultureA(id, a.date)) || 'Fourrage';
      const fourrage = a.derobee ? `${base} (dérobée)` : base;
      const unites = seche ? num(a.s.nbRemorques) : num(a.s.nbBottes);
      lignes.push({ parcelleId: id, parcelle: nomDe(id), culture: (cultureA && cultureA(id, a.date)) || '',
        parcelleHa: r2(surfaceDe(id)), date: a.date, fourrage, coupe: num(a.s.numeroCoupe), seche,
        mode: seche ? 'séché' : 'bottes', unites: unites != null ? r2(unites * part) : null,
        ha: r2(ha), t: t == null ? null : r3(t * part), estimee: declaree == null || !!a.s.surfaceEstimee });
    });
  });
  const somme = (ls, k) => ls.reduce((x, l) => x + (l[k] || 0), 0);
  const tHa = (t, ha) => (ha > 0 ? r2(t / ha) : null);
  const modes = (ls) => [...new Set(ls.map((l) => l.mode))].join(' + ');

  const gA = new Map();
  lignes.forEach((l) => {
    const k = `${l.fourrage.toLowerCase()}|${l.coupe == null ? 99 : l.coupe}`;
    const g = gA.get(k) || { fourrage: l.fourrage, coupe: l.coupe, lignes: [] };
    g.lignes.push(l); gA.set(k, g);
  });
  const parCoupe = Array.from(gA.values()).map((g) => {
    const t = somme(g.lignes, 't'), ha = somme(g.lignes, 'ha');
    return { ...g, mode: modes(g.lignes), t: r2(t), ha: r2(ha), tHa: tHa(t, ha),
      nbParcelles: new Set(g.lignes.map((l) => l.parcelleId)).size, estimee: g.lignes.some((l) => l.estimee),
      bottes: g.lignes.some((l) => !l.seche) ? Math.round(somme(g.lignes.filter((l) => !l.seche), 'unites')) : null };
  }).sort((x, y) => fr(x.fourrage, y.fourrage) || (x.coupe || 99) - (y.coupe || 99));

  const gB = new Map();
  lignes.forEach((l) => {
    const g = gB.get(l.parcelleId) || { parcelleId: l.parcelleId, parcelle: l.parcelle, ha: l.parcelleHa, culture: l.culture, lignes: [] };
    g.lignes.push(l); gB.set(l.parcelleId, g);
  });
  const parParcelle = Array.from(gB.values()).map((g) => {
    const t = somme(g.lignes, 't');
    return { ...g, t: r2(t), tHa: tHa(t, g.ha), nbCoupes: g.lignes.length };
  }).sort((x, y) => fr(x.parcelle, y.parcelle));

  const seche = lignes.filter((l) => l.seche), bottes = lignes.filter((l) => !l.seche);
  return { parCoupe, parParcelle, t: r2(somme(lignes, 't')), tSeche: r2(somme(seche, 't')), tBottes: r2(somme(bottes, 't')),
    nbBottes: Math.round(somme(bottes, 'unites')), estimee: lignes.some((l) => l.estimee) };
}

// --- 4. Céréales & paille : par culture ---------------------------------------
function cereales(acts, surfaceDe, nomDe, cultureA) {
  const parP = new Map(); // parcelleId -> ligne
  const ligne = (id) => {
    if (!parP.has(id)) parP.set(id, { parcelleId: id, parcelle: nomDe(id), ha: r2(surfaceDe(id)), culture: '', date: null, grainT: null, bottes: null, pailleT: null });
    return parP.get(id);
  };
  acts.filter((a) => a.formulaire === 'MOISSON').forEach((a) => {
    const t = quantiteDeSaisie('MOISSON', a.s);
    repartir(a.ids, surfaceDe, null).forEach(({ id, part }) => {
      const l = ligne(id);
      // Culture moissonnée = celle en place la veille (la moisson la clôture).
      l.culture = l.culture || (cultureA && (cultureA(id, a.date) || cultureA(id, veille(a.date)))) || libelleEspece(a.s.typeAliment);
      l.date = l.date || a.date;
      if (t != null) l.grainT = r3((l.grainT || 0) + t * part);
    });
  });
  acts.filter((a) => a.formulaire === 'PRESSAGE' && a.s.produitRecolte === 'PAILLE').forEach((a) => {
    const b = num(a.s.nbBottes), kg = num(a.s.poidsBotteKg);
    repartir(a.ids, surfaceDe, null).forEach(({ id, part }) => {
      const l = ligne(id);
      l.culture = l.culture || (cultureA && (cultureA(id, a.date) || cultureA(id, veille(a.date)))) || 'Paille';
      if (b != null) l.bottes = r2((l.bottes || 0) + b * part);
      if (b != null && kg != null) l.pailleT = r3((l.pailleT || 0) + b * part * kg / 1000);
    });
  });
  const somme = (ls, k) => (ls.some((l) => l[k] != null) ? ls.reduce((x, l) => x + (l[k] || 0), 0) : null);
  const qHa = (t, ha) => (t != null && ha > 0 ? r2(t * 10 / ha) : null);
  const g = new Map();
  parP.forEach((l) => {
    l.qHa = qHa(l.grainT, l.ha);
    const k = l.culture || 'Culture non renseignée';
    if (!g.has(k)) g.set(k, { nom: k, lignes: [] });
    g.get(k).lignes.push(l);
  });
  const groupes = Array.from(g.values()).map((x) => {
    x.lignes.sort((a, b) => fr(a.parcelle, b.parcelle));
    const ha = r2(x.lignes.reduce((t, l) => t + l.ha, 0));
    const grainT = somme(x.lignes, 'grainT');
    // q/ha du groupe : sur les seules parcelles moissonnées.
    const haGrain = x.lignes.filter((l) => l.grainT != null).reduce((t, l) => t + l.ha, 0);
    return { ...x, ha, grainT: grainT == null ? null : r2(grainT), qHa: qHa(grainT, haGrain),
      bottes: somme(x.lignes, 'bottes'), pailleT: somme(x.lignes, 'pailleT') };
  }).sort((a, b) => fr(a.nom, b.nom));
  const tot = (k, f) => { const v = somme(groupes, k); return v == null ? null : f(v); };
  return { groupes, grainT: tot('grainT', r2), pailleT: tot('pailleT', r2), bottes: tot('bottes', Math.round),
    ha: r2(groupes.reduce((t, x) => t + x.ha, 0)) };
}
function veille(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function libelleEspece(v) {
  const s = String(v || '').trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// --- 5. Travaux : par type et par parcelle ------------------------------------
// Par type : les travaux qui n'ont pas leur propre section (sol, fauche...).
// Par parcelle : le carnet complet de la parcelle (semis, épandages et
// récoltes compris), daté.
const AILLEURS = new Set(['SEMIS', 'FUMIER', 'CHAULAGE', 'PRESSAGE', 'SECHAGE', 'MOISSON']);
export function estTravailDeParcelle(a) {
  if (a.categorie === 'TROUPEAU') return false;
  return !['Note', 'Observation'].includes(a.typeNom);
}
function travaux(acts, surfaceDe, nomDe, cultureA) {
  const carnet = acts.filter(estTravailDeParcelle);
  const gT = new Map();
  carnet.filter((a) => !AILLEURS.has(a.formulaire)).forEach((a) => {
    const declaree = a.formulaire === 'SURFACE' ? num(a.s.surfaceHa) : null;
    const nom = a.typeNom || 'Autre';
    const g = gT.get(nom) || { type: nom, lignes: [] };
    repartir(a.ids, surfaceDe, declaree).forEach(({ id, ha }) => {
      g.lignes.push({ parcelleId: id, parcelle: nomDe(id), date: a.date, ha: r2(ha) });
    });
    gT.set(nom, g);
  });
  const parType = Array.from(gT.values()).map((g) => ({ ...g,
    ha: r2(g.lignes.reduce((t, l) => t + l.ha, 0)),
    nbParcelles: new Set(g.lignes.map((l) => l.parcelleId)).size,
    parcellesNoms: [...new Set(g.lignes.map((l) => l.parcelle))].sort(fr) }))
    .sort((a, b) => fr(a.type, b.type));

  const gP = new Map();
  carnet.forEach((a) => a.ids.forEach((id) => {
    const g = gP.get(id) || { parcelleId: id, parcelle: nomDe(id), ha: r2(surfaceDe(id)), lignes: [] };
    g.lignes.push({ date: a.date, type: a.typeNom || 'Autre', tracteur: a.tracteurNom || '', outil: a.materielNom || '', chauffeur: a.chauffeur || '' });
    gP.set(id, g);
  }));
  const parParcelle = Array.from(gP.values()).map((g) => {
    g.lignes.sort(parDate);
    const derniere = g.lignes[g.lignes.length - 1];
    return { ...g, culture: (cultureA && cultureA(g.parcelleId, derniere.date)) || '' };
  }).sort((a, b) => fr(a.parcelle, b.parcelle));
  return { parType, parParcelle };
}

/** Note du bilan stocks : récoltes de la campagne faites après le 31/08 (null si aucune). */
export function noteTardives(tardives, camp) {
  const apres = (tardives || []).filter((l) => l.date > `${camp}-08-31`);
  if (!apres.length) return null;
  const t = apres.reduce((x, l) => x + l.t, 0);
  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
  return `Récoltes ${camp} faites après le 31/08 : ${fmt(t)} t (${apres.map((l) => `${l.quoi}, ${l.parcelle}`).join(' ; ')}). `
    + `Comptées dans les récoltes ${camp}, elles entrent au stock ${camp}-${Number(camp) + 1} pour l'hiver ; l'inventaire comptable reste au 31/08.`;
}
