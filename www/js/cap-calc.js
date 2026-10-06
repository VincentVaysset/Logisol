// Cap de déplacement pour la vue GPS « cap en haut » (vue-gps.js). Module pur,
// testable en Node.
//
// Source : le cap fourni par le GPS (heading/bearing) quand il existe, sinon
// calculé entre la dernière position retenue et la nouvelle (au moins
// DISTANCE_MIN_M d'écart, pour ne pas suivre le bruit). Jamais la boussole du
// téléphone : dans une cabine de tracteur elle est faussée par le métal.
// Le cap n'est mis à jour qu'au-dessus de ~1,5 km/h : à l'arrêt, le GPS
// « tourne » au hasard, on garde donc le dernier cap. Lissage circulaire
// (moyenne exponentielle sur l'angle, en passant correctement par 0°/360°).

export const SEUIL_VITESSE_MS = 1.5 / 3.6;
const DISTANCE_MIN_M = 2;

function normaliser(deg) { return ((deg % 360) + 360) % 360; }

/** Distance (m) et cap (°, 0 = nord, sens horaire) entre deux points proches. */
export function distanceEtCap(a, b) {
  const latMoy = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (b.lon - a.lon) * 111320 * Math.cos(latMoy);
  const dy = (b.lat - a.lat) * 110574;
  return { distance: Math.hypot(dx, dy), cap: normaliser(Math.atan2(dx, dy) * 180 / Math.PI) };
}

/** Écart signé le plus court de `de` vers `vers`, dans ]-180, 180]. */
export function ecartAngle(de, vers) {
  const d = normaliser(vers - de);
  return d > 180 ? d - 360 : d;
}

/**
 * @param {{alpha?:number}} opts  alpha : poids de la nouvelle mesure (0..1)
 * @returns {{maj:(fix:{lat,lon,horodatage?,cap?,vitesse?})=>number|null, cap:()=>number|null}}
 */
export function creerSuiviCap({ alpha = 0.35 } = {}) {
  let cap = null;
  let dernier = null;   // dernière position retenue {lat, lon, t}
  return {
    cap: () => cap,
    maj(fix) {
      if (!fix || !isFinite(fix.lat) || !isFinite(fix.lon)) return cap;
      const t = Number(fix.horodatage) || Date.now();
      const point = { lat: fix.lat, lon: fix.lon, t };
      if (!dernier) { dernier = point; return cap; }
      const { distance, cap: capTrajet } = distanceEtCap(dernier, point);
      const dt = (t - dernier.t) / 1000;
      const vitesse = fix.vitesse != null && isFinite(fix.vitesse) && fix.vitesse >= 0
        ? Number(fix.vitesse)
        : (dt > 0 ? distance / dt : 0);
      let mesure = null;
      if (vitesse >= SEUIL_VITESSE_MS) {
        if (fix.cap != null && isFinite(fix.cap)) mesure = normaliser(Number(fix.cap));
        else if (distance >= DISTANCE_MIN_M) mesure = capTrajet;
      }
      if (distance >= DISTANCE_MIN_M) dernier = point;
      if (mesure == null) return cap;
      cap = cap == null ? mesure : normaliser(cap + alpha * ecartAngle(cap, mesure));
      return cap;
    }
  };
}
