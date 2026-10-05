// Calcul de l'inventaire à DATE DE COMPTAGE (validé avec l'exploitant).
//
// Notations, par aliment, en tonnes :
//   R      stock réel compté le jour C, en fin de journée ;
//   T(d)   stock théorique de l'appli au soir du jour d (mouvements,
//          rations, ajustements déjà saisis) ;
//   flux   ce qui a changé le stock du 01/09 au jour C inclus = T(C) − T(31/08)
//          (entrées, sorties, consommation des rations, ajustements).
//
// Inventaire simple (campagne laissée ouverte) :
//   écart = R − T(C), AJUSTEMENT daté C.
// Clôture (C ≥ 31/08) :
//   stock déduit au 31/08 = R − flux ; écart = déduit − T(31/08), AJUSTEMENT
//   daté 31/08 ; le déduit devient le stock de départ de la campagne suivante.
//   PAILLE : pas de suivi de consommation, donc pas de déduction — le stock
//   au 31/08 est SAISI directement (la paille pressée en juillet-août est
//   reportée, jamais remise à zéro) ; écart = saisi − T(31/08).
// Un stock déduit négatif est incohérent (une saisie depuis le 31/08 est
// fausse) : la ligne bloque la validation tant qu'elle n'est pas confirmée.
//
// Module pur (aucun import) : testable en Node tel quel.

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

/**
 * @param {object} p
 * @param {number} p.theoriqueC    T(C)
 * @param {number} p.theorique31   T(31/08) — utile seulement à la clôture
 * @param {number|null} p.saisie   R (ou, paille à la clôture, le stock au 31/08) ; null = non saisi
 * @param {boolean} p.paille
 * @param {boolean} p.cloture
 */
export function calculerLigne({ theoriqueC = 0, theorique31 = 0, saisie = null, paille = false, cloture = false }) {
  const saisi = saisie !== null && saisie !== '' && isFinite(Number(saisie));
  const flux = arrondi3(theoriqueC - theorique31);
  if (!cloture) {
    const ecart = saisi ? arrondi3(Number(saisie) - theoriqueC) : 0;
    return { saisi, flux: null, deduit31: null, ecart, dateAjustement: 'comptage', bloquant: false };
  }
  if (!saisi) {
    // Ligne non comptée : pas d'écart, le théorique au 31/08 est gardé tel quel.
    return { saisi, flux, deduit31: arrondi3(theorique31), ecart: 0, dateAjustement: '31/08', bloquant: false };
  }
  const deduit31 = paille ? arrondi3(Number(saisie)) : arrondi3(Number(saisie) - flux);
  return {
    saisi, flux: paille ? null : flux, deduit31,
    ecart: arrondi3(deduit31 - theorique31),
    dateAjustement: '31/08',
    bloquant: deduit31 < -0.0005
  };
}

/** Stock de départ de la campagne suivante : un chiffre par aliment. */
export function instantane(lignes) {
  return lignes.map((l) => ({ cle: l.cle, label: l.label, tonnes: arrondi3(l.calcul.deduit31) }));
}

/** Campagne que clôture un comptage du jour C : celle dont le 31/08 est le
 * dernier ≤ C (« 2025-2026 » pour un comptage du 31/08/2026 comme du 05/10/2026). */
export function campagneACloturer(dateComptage) {
  const m = String(dateComptage || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const a = Number(m[1]);
  const finCetteAnnee = `${a}-08-31`;
  const debut = dateComptage >= finCetteAnnee ? a - 1 : a - 2;
  return `${debut}-${debut + 1}`;
}
