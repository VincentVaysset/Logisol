// Campagne STOCKS / TROUPEAU : fenêtre FIXE du 01/09 au 31/08, comme la
// compta — « 2025-2026 » va du 01/09/2025 au 31/08/2026 inclus.
//
// À NE PAS CONFONDRE avec la campagne CULTURE d'une parcelle (campagnes.js/
// calculerCampagnes : bascule au premier travail qui détruit la culture) :
// deux notions distinctes, deux modules, aucun ne lit l'autre. Les clés n'ont
// d'ailleurs pas la même forme (« 2025-2026 » ici, « 2026 » côté culture).
//
// Module pur (aucun import) : testable en Node tel quel.

const ecouteurs = new Set();
let choisie = null;

function p2(n) { return String(n).padStart(2, '0'); }

export function aujourdhuiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** « 2025-2026 » pour toute date du 01/09/2025 au 31/08/2026. */
export function campagneStockDe(dateIso) {
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const a = Number(m[1]);
  const debut = Number(m[2]) >= 9 ? a : a - 1;
  return `${debut}-${debut + 1}`;
}

/** Bornes INCLUSES : { debut: '2025-09-01', fin: '2026-08-31' }. */
export function bornesCampagneStock(id) {
  const a = Number(String(id || '').slice(0, 4));
  if (!a) return null;
  return { debut: `${a}-09-01`, fin: `${a + 1}-08-31` };
}

export function campagneStockCourante(date = aujourdhuiIso()) {
  return campagneStockDe(date);
}

export function campagneStockSuivante(id) {
  const a = Number(String(id || '').slice(0, 4));
  return a ? `${a + 1}-${a + 2}` : null;
}

export function libelleCampagneStock(id) {
  return id ? `Campagne ${id}` : '';
}

/**
 * Date de référence d'une campagne pour lire un stock : aujourd'hui pour la
 * campagne en cours, son 31/08 pour une campagne passée.
 */
export function dateReferenceCampagne(id, date = aujourdhuiIso()) {
  const b = bornesCampagneStock(id);
  if (!b) return date;
  return date < b.fin ? date : b.fin;
}

/**
 * Campagnes proposées au sélecteur, la plus récente d'abord : de la plus
 * ancienne date présente dans les données jusqu'à la campagne en cours.
 */
export function campagnesStockDisponibles(dates, date = aujourdhuiIso()) {
  const courante = campagneStockDe(date);
  let premier = Number(courante.slice(0, 4));
  (dates || []).forEach((d) => {
    const c = campagneStockDe(d);
    if (c) premier = Math.min(premier, Number(c.slice(0, 4)));
  });
  const fin = Number(courante.slice(0, 4));
  const out = [];
  for (let a = fin; a >= premier; a--) out.push(`${a}-${a + 1}`);
  return out;
}

function jour(dateIso) { return Math.round(Date.parse(dateIso + 'T12:00:00') / 86400000); }

/**
 * Jours d'une période [debut, finExclue) qui tombent dans la fenêtre
 * [fenetre.debut, fenetre.fin] (bornes incluses) et pas après dateMax
 * (incluse). finExclue null = période encore ouverte. C'est ce qui coupe une
 * ration au prorata quand elle chevauche le 31/08.
 */
export function joursDansFenetre(debut, finExclue, fenetre, dateMax) {
  if (!debut || !fenetre) return 0;
  let a = jour(debut);
  let b = finExclue ? jour(finExclue) : Infinity;   // exclue
  a = Math.max(a, jour(fenetre.debut));
  b = Math.min(b, jour(fenetre.fin) + 1);
  if (dateMax) b = Math.min(b, jour(dateMax) + 1);
  const n = b - a;
  return isFinite(n) && n > 0 ? n : 0;
}

// --- Campagne choisie dans l'en-tête (partagée par Stocks et Troupeau) -----
export function getCampagneStockChoisie() {
  return choisie || campagneStockCourante();
}
export function setCampagneStockChoisie(id) {
  if (!id || id === choisie) return;
  choisie = id;
  ecouteurs.forEach((cb) => cb(id));
}
export function onCampagneStockChange(cb) {
  ecouteurs.add(cb);
  return () => ecouteurs.delete(cb);
}
