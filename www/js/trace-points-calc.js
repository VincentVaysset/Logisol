// Points d'un tracé de chantier : filtrage à l'enregistrement, simplification
// au stockage, format compact pour lgs_traces. Module pur, testable en Node.
//
// Point : { lat, lon, t } (t en ms). Les « coupures » sont les indices des
// points qui NE se relient PAS au précédent (reprise après une interruption de
// l'appli) : rien n'est dessiné entre les deux.

const M_PAR_DEG_LAT = 110574;
function mParDegLon(lat) { return 111320 * Math.cos((lat * Math.PI) / 180); }
function distanceM(a, b) {
  const kx = mParDegLon((a.lat + b.lat) / 2);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * M_PAR_DEG_LAT);
}

/**
 * Filtre à la volée : un point est retenu s'il est à ≥ distM du dernier
 * retenu, ou ≥ dtS secondes après lui. Le tout premier est toujours retenu.
 */
export function creerFiltre({ distM = 3, dtS = 3 } = {}) {
  let dernier = null;
  return {
    garder(p) {
      if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return false;
      if (!dernier || distanceM(dernier, p) >= distM || (p.t - dernier.t) / 1000 >= dtS) { dernier = p; return true; }
      return false;
    },
    reinitialiser() { dernier = null; }
  };
}

/**
 * Douglas-Peucker (tolérance en mètres), itératif (pas de récursion profonde
 * sur 10 000 points). Garde toujours le premier et le dernier point.
 */
export function douglasPeucker(points, tolM = 1) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const lat0 = points[0].lat;
  const kx = mParDegLon(lat0);
  const xy = points.map((p) => [(p.lon - points[0].lon) * kx, (p.lat - lat0) * M_PAR_DEG_LAT]);
  const garde = new Uint8Array(n);
  garde[0] = 1; garde[n - 1] = 1;
  const pile = [[0, n - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    if (b - a < 2) continue;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let max = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let d;
      if (l2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        d = Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
      }
      if (d > max) { max = d; idx = i; }
    }
    if (max > tolM) { garde[idx] = 1; pile.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => garde[i]);
}

/**
 * Simplifie un tracé en respectant ses coupures : chaque morceau continu est
 * simplifié séparément. Retourne { points, coupures } (indices recalculés).
 */
export function simplifierTrace(points, coupures = [], tolM = 1) {
  const bornes = [0, ...coupures.filter((c) => c > 0 && c < points.length).sort((a, b) => a - b), points.length];
  const sortie = [];
  const nouvellesCoupures = [];
  for (let k = 0; k < bornes.length - 1; k++) {
    const morceau = points.slice(bornes[k], bornes[k + 1]);
    if (!morceau.length) continue;
    if (sortie.length) nouvellesCoupures.push(sortie.length);
    sortie.push(...douglasPeucker(morceau, tolM));
  }
  return { points: sortie, coupures: nouvellesCoupures };
}

/** Morceaux continus d'un tracé (pour l'affichage : une polyligne par morceau). */
export function morceauxContinus(points, coupures = []) {
  const bornes = [0, ...coupures.filter((c) => c > 0 && c < points.length).sort((a, b) => a - b), points.length];
  const res = [];
  for (let k = 0; k < bornes.length - 1; k++) {
    const m = points.slice(bornes[k], bornes[k + 1]);
    if (m.length) res.push(m);
  }
  return res;
}

// --- Format compact (Firestore : pas de tableaux imbriqués) ----------------
// Trois listes parallèles : lat, lon (6 décimales, ~11 cm) et t en secondes
// depuis `debut` (ms). ~27 octets par point dans Firestore.
export const OCTETS_PAR_POINT = 27;
export const POINTS_PAR_MORCEAU = 25000;   // ~675 Ko, sous la limite de ~800 Ko

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Découpe en morceaux compacts : [{ lat:[], lon:[], t:[] }]. */
export function encoderMorceaux(points, debut, parMorceau = POINTS_PAR_MORCEAU) {
  const morceaux = [];
  for (let i = 0; i < points.length; i += parMorceau) {
    const tranche = points.slice(i, i + parMorceau);
    morceaux.push({
      lat: tranche.map((p) => r6(p.lat)),
      lon: tranche.map((p) => r6(p.lon)),
      t: tranche.map((p) => Math.max(0, Math.round((p.t - debut) / 1000)))
    });
  }
  return morceaux;
}

/** Morceaux (dans l'ordre) -> points { lat, lon, t(ms) }. */
export function decoderMorceaux(morceaux, debut) {
  const points = [];
  (morceaux || []).forEach((m) => {
    const n = Math.min((m.lat || []).length, (m.lon || []).length);
    for (let i = 0; i < n; i++) points.push({ lat: m.lat[i], lon: m.lon[i], t: debut + ((m.t && m.t[i]) || 0) * 1000 });
  });
  return points;
}

export function longueurM(points, coupures = []) {
  return morceauxContinus(points, coupures).reduce((tot, m) => {
    for (let i = 1; i < m.length; i++) tot += distanceM(m[i - 1], m[i]);
    return tot;
  }, 0);
}
