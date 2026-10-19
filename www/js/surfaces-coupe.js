// Surfaces fauchées par coupe (bloc de l'onglet Stocks, rapports). Module pur.
//
// Entrée : les récoltes de fourrage (Pressage hors paille, Séchage) avec leur
// culture (type de fourrage), n° de coupe, tonnage, parcelles et surface
// récoltée. Règles validées :
// - une parcelle compte UNE fois par (culture, n° de coupe), même si la coupe
//   est répartie entre plusieurs activités (bottes + grange) : les tonnages
//   s'additionnent, la surface non ;
// - deux surfaces différentes déclarées pour la même parcelle et la même
//   coupe : la plus grande est retenue, et l'écart est signalé (conflits) ;
// - t/ha = tonnage total de la coupe / surface unique de la coupe ;
// - surface absente (récolte antérieure au champ) : surface des parcelles,
//   marquée estimée (*).
// La surface d'une activité sur plusieurs parcelles est répartie au prorata
// de la surface de chaque parcelle.

const EPS = 0.005;
const r2 = (v) => Math.round(v * 100) / 100;
const cleCulture = (t) => String(t || '').trim().toLowerCase();

/**
 * @param {Array<{id, parcelleIds:string[], culture:string, coupe:number, tonnes:number, surfaceHa:number|null, surfaceEstimee?:boolean}>} recoltes
 * @param {Map<string,{nom?:string, surfaceHa?:number}>} parcelles
 * @returns {Array<{culture, surfaceHa, tonnes, estimee, coupes:Array<{numero, surfaceHa, tonnes, tHa, estimee, conflits:Array<{parcelleId, nom, valeurs:number[]}>}>, prochaine:number}>}
 */
export function surfacesParCoupe(recoltes, parcelles) {
  const cultures = new Map();
  (recoltes || []).forEach((r) => {
    const k = cleCulture(r.culture);
    const n = Number(r.coupe);
    const ids = (r.parcelleIds || []).filter(Boolean);
    if (!k || !(n > 0) || !ids.length) return;
    if (!cultures.has(k)) cultures.set(k, { culture: String(r.culture).trim(), coupes: new Map() });
    const c = cultures.get(k);
    if (!c.coupes.has(n)) c.coupes.set(n, { numero: n, tonnes: 0, parcelles: new Map() });
    const cp = c.coupes.get(n);
    cp.tonnes += Number(r.tonnes) || 0;
    const surfP = ids.map((id) => Number((parcelles.get(id) || {}).surfaceHa) || 0);
    const somme = surfP.reduce((a, b) => a + b, 0);
    const declaree = r.surfaceHa != null && isFinite(r.surfaceHa) ? Number(r.surfaceHa) : null;
    const estimee = declaree == null || !!r.surfaceEstimee;
    ids.forEach((id, i) => {
      const ha = declaree == null ? surfP[i]
        : (ids.length === 1 ? declaree : (somme > 0 ? declaree * surfP[i] / somme : declaree / ids.length));
      const prec = cp.parcelles.get(id);
      if (!prec) { cp.parcelles.set(id, { ha, estimee, valeurs: [ha] }); return; }
      if (!prec.valeurs.some((v) => Math.abs(v - ha) <= EPS)) prec.valeurs.push(ha);
      if (ha > prec.ha + EPS) { prec.ha = ha; prec.estimee = estimee; }
    });
  });
  return Array.from(cultures.values()).map((c) => {
    const parcelleMax = new Map();
    const coupes = Array.from(c.coupes.values()).sort((a, b) => a.numero - b.numero).map((cp) => {
      let surface = 0;
      let estimee = false;
      const conflits = [];
      cp.parcelles.forEach((p, id) => {
        surface += p.ha;
        if (p.estimee) estimee = true;
        if (p.valeurs.length > 1) conflits.push({ parcelleId: id, nom: (parcelles.get(id) || {}).nom || id, valeurs: p.valeurs.map(r2).sort((a, b) => b - a) });
        if (!parcelleMax.has(id) || p.ha > parcelleMax.get(id)) parcelleMax.set(id, p.ha);
      });
      return { numero: cp.numero, surfaceHa: r2(surface), tonnes: Math.round(cp.tonnes * 1000) / 1000,
        tHa: surface > 0 ? r2(cp.tonnes / surface) : null, estimee, conflits };
    });
    const tonnes = coupes.reduce((t, x) => t + x.tonnes, 0);
    return { culture: c.culture, coupes, tonnes: Math.round(tonnes * 1000) / 1000,
      surfaceHa: r2(Array.from(parcelleMax.values()).reduce((a, b) => a + b, 0)),
      estimee: coupes.some((x) => x.estimee), prochaine: Math.max(...coupes.map((x) => x.numero)) + 1 };
  }).sort((a, b) => b.tonnes - a.tonnes);
}
