// Vue « Réalisé » des Rapports (maquette-charte-rapports-realise.html) :
// uniquement les activités enregistrées et les mouvements de stock. Le
// prévisionnel n'apparaît qu'en COLONNE DE COMPARAISON, jamais additionné au
// réel (CLAUDE.md : le réel et le prévu ne se mélangent jamais). Module pur.

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Semis réalisés de la campagne.
 * @param {object} p
 * @param {Array<{id, nom, surfaceHa}>} p.parcelles
 * @param {Map<string,{code,label,saison}>} p.prevus  parcelleId -> culture prévue semée cette campagne
 * @param {Array<{id, date, parcelleIds, surfaceHa:number|null, surfaceEstimee?, doseKgHa:number|null, semence?, cultureNom?}>} p.semis
 * @returns {{lignes, aSemer, seme, prevu, reste, kg, estimee}}
 *   kg = dose × surface semée, calculé ici, jamais stocké.
 */
export function semisRealises({ parcelles, prevus, semis }) {
  const surf = new Map(parcelles.map((x) => [x.id, Number(x.surfaceHa) || 0]));
  const semees = new Set();
  const lignes = semis.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((s) => {
    const ids = s.parcelleIds || [];
    ids.forEach((id) => semees.add(id));
    const declaree = s.surfaceHa != null ? Number(s.surfaceHa) : null;
    const ha = declaree != null ? declaree : ids.reduce((t, id) => t + (surf.get(id) || 0), 0);
    const prevu = ids.map((id) => prevus.get(id)).find(Boolean);
    const dose = s.doseKgHa != null ? Number(s.doseKgHa) : null;
    return { id: s.id, label: (prevu && prevu.label) || s.cultureNom || 'Semis', semence: String(s.semence || '').trim(), date: s.date,
      ha: r2(ha), estimee: declaree == null || !!s.surfaceEstimee, dose, kg: dose != null ? Math.round(dose * ha) : null };
  });
  const aSemerParCode = new Map();
  let prevu = 0;
  prevus.forEach((c, id) => {
    const ha = surf.get(id) || 0;
    prevu += ha;
    if (semees.has(id)) return;
    const x = aSemerParCode.get(c.code) || { label: c.label, saison: c.saison, ha: 0 };
    x.ha += ha;
    aSemerParCode.set(c.code, x);
  });
  const aSemer = Array.from(aSemerParCode.values()).map((x) => ({ ...x, ha: r2(x.ha) })).sort((a, b) => b.ha - a.ha);
  const seme = r2(lignes.reduce((t, l) => t + l.ha, 0));
  return { lignes, aSemer, seme, prevu: r2(prevu), reste: r2(aSemer.reduce((t, x) => t + x.ha, 0)),
    kg: lignes.some((l) => l.kg != null) ? lignes.reduce((t, l) => t + (l.kg || 0), 0) : null,
    estimee: lignes.some((l) => l.estimee) };
}

/**
 * Fertilisation réalisée, un bilan par produit.
 * @param {object} p
 * @param {Array<{id, nom, surfaceHa}>} p.parcelles
 * @param {Map<string,{fumierTHa, chauxTHa}>} p.prevu  parcelleId -> doses prévues (t/ha)
 * @param {Array<{date, parcelleIds, produit:'fumier'|'chaux', tonnes?:number, doseTHa?:number}>} p.epandages
 *   fumier : tonnes de l'activité, réparties au prorata des surfaces ;
 *   chaux  : dose (t/ha) × surface de chaque parcelle.
 */
export function fertilisationRealisee({ parcelles, prevu, epandages }) {
  const parId = new Map(parcelles.map((x) => [x.id, x]));
  const champ = { fumier: 'fumierTHa', chaux: 'chauxTHa' };
  return ['fumier', 'chaux'].map((produit) => {
    const reel = new Map();   // parcelleId -> { t, date }
    epandages.filter((e) => e.produit === produit).forEach((e) => {
      const ids = (e.parcelleIds || []).filter((id) => parId.has(id));
      const somme = ids.reduce((t, id) => t + (Number(parId.get(id).surfaceHa) || 0), 0);
      ids.forEach((id) => {
        const ha = Number(parId.get(id).surfaceHa) || 0;
        const t = produit === 'chaux' ? (Number(e.doseTHa) || 0) * ha
          : (Number(e.tonnes) || 0) * (somme > 0 ? ha / somme : 1 / ids.length);
        const x = reel.get(id) || { t: 0, date: '' };
        x.t += t;
        if (e.date > x.date) x.date = e.date;
        reel.set(id, x);
      });
    });
    const ids = new Set([...reel.keys(), ...parcelles.filter((x) => Number((prevu.get(x.id) || {})[champ[produit]]) > 0).map((x) => x.id)]);
    const doses = new Set();
    const lignes = Array.from(ids).map((id) => {
      const pc = parId.get(id);
      const ha = Number(pc.surfaceHa) || 0;
      const dose = Number((prevu.get(id) || {})[champ[produit]]) || 0;
      if (dose > 0) doses.add(dose);
      const pv = dose > 0 ? r2(dose * ha) : null;
      const re = reel.has(id) ? r2(reel.get(id).t) : null;
      return { nom: pc.nom || 'Sans nom', ha, date: re != null ? reel.get(id).date : '', tHaReel: re != null && ha > 0 ? r2(re / ha) : null,
        prevu: pv, realise: re, ecart: re != null ? r2(re - (pv || 0)) : null, aFaire: re == null };
    }).sort((a, b) => (a.aFaire - b.aFaire) || a.nom.localeCompare(b.nom, 'fr'));
    const prevuT = r2(lignes.reduce((t, l) => t + (l.prevu || 0), 0));
    const realiseT = r2(lignes.reduce((t, l) => t + (l.realise || 0), 0));
    return { produit, lignes, prevuT, realiseT, ecartT: r2(realiseT - prevuT),
      pct: prevuT > 0 ? Math.round((realiseT / prevuT) * 100) : null, doseUnique: doses.size === 1 ? [...doses][0] : null };
  });
}

/**
 * Bilan stocks par catégorie, dérivé des groupes de l'onglet Stocks (journal
 * des mouvements rejoué, jamais saisi). Entrées = stock de départ + récoltes +
 * achats ; Sorties = Entrées − Stock, pour que le tableau tombe juste même
 * avec un ajustement d'inventaire (écart avec la consommation des lots).
 */
export function syntheseStocks(groupes) {
  const lignes = groupes.map((g) => {
    const entrees = (g.depart || 0) + (g.recolte || 0) + (g.achat || 0);
    return { nom: g.nom, depart: g.depart || 0, recolte: g.recolte || 0, achat: g.achat || 0, entrees,
      sorties: Math.max(0, entrees - (g.reste || 0)), conso: g.conso || 0, reste: g.reste || 0 };
  });
  const somme = (k) => lignes.reduce((t, l) => t + l[k], 0);
  return { lignes, tot: { depart: somme('depart'), recolte: somme('recolte'), achat: somme('achat'), entrees: somme('entrees'),
    sorties: somme('sorties'), conso: somme('conso'), reste: somme('reste') } };
}
