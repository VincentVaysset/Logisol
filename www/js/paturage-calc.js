// Calendrier de pâturage — calculs purs (aucun Firestore, aucun DOM), testables
// en Node. Maquette : docs/maquettes/maquette-calendrier-paturage.html.
//
// Modèle (collections lgs_paturage_periodes / lgs_paturage_exceptions) :
//  - une PÉRIODE : un lot entre sur une parcelle le jour `debut`, avec une
//    plage horaire (11:00–17:00 par défaut), et y reste jusqu'à `fin`
//    (incluse ; null = en cours). Entrer ailleurs clôt la période précédente ;
//  - un changement de parcelle dans la journée : la période qui se termine
//    ce jour-là porte `heuresDernierJour`, la suivante commence le même jour
//    avec ses propres heures — les deux partagent le jour ;
//  - une EXCEPTION par lot et par jour : « Pas de sortie » (SANS_SORTIE) ou
//    « Horaire différent » (HORAIRE), avec un motif.
// Année civile (pas la campagne 01/09–31/08). Pas de saison fixe : elle va de
// la première à la dernière sortie.

export const HEURES_DEFAUT = { debut: '11:00', fin: '17:00' };
export const MOTIFS = ['Pluie', 'Neige / gel', 'Orage', 'Chaleur', 'Sol trop humide', 'Autre'];

const J = 864e5;
const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export function ajouterJours(iso, n) {
  const d = new Date(ms(iso) + n * J);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export const ecartJours = (a, b) => Math.round((ms(b) - ms(a)) / J);
/** « 11:30 » -> 11.5 */
export function heureDecimale(h) {
  const [a, b] = String(h || '0:0').split(':').map(Number);
  return Math.round(((a || 0) + (b || 0) / 60) * 100) / 100;
}
const duree = (h) => Math.max(0, heureDecimale(h.fin) - heureDecimale(h.debut));

/** Agnelles et laitières peuvent partager une parcelle en septembre-octobre seulement. */
export const melangeAutorise = (iso) => ['09', '10'].includes(String(iso).slice(5, 7));

/**
 * Ce que fait un lot un jour donné (jours passés et aujourd'hui seulement).
 * @returns {null | {sorti:boolean, items:Array<{parcelleId, heures:{debut,fin}, demi:''|'g'|'d'}>, exception, periodes}}
 *   demi : 'g' = la période se termine ce jour (première moitié), 'd' = elle y commence (seconde moitié).
 */
export function jourLot(lotId, iso, { periodes, exceptions, aujourdhui }) {
  if (iso > aujourdhui) return null;
  const ps = periodes.filter((p) => p.lotId === lotId && p.debut <= iso && (p.fin == null || p.fin >= iso))
    .sort((a, b) => (a.debut < b.debut ? -1 : 1));
  if (!ps.length) return null;
  const ex = exceptions.find((e) => e.lotId === lotId && e.date === iso) || null;
  if (ex && ex.type === 'SANS_SORTIE') return { sorti: false, items: [], exception: ex, periodes: ps };
  const items = ps.map((p) => {
    let h = { debut: p.heureDebut || HEURES_DEFAUT.debut, fin: p.heureFin || HEURES_DEFAUT.fin };
    if (p.fin === iso && p.heuresDernierJour) h = p.heuresDernierJour;
    if (ex && ex.type === 'HORAIRE') h = { debut: ex.heureDebut, fin: ex.heureFin };
    return { parcelleId: p.parcelleId, heures: h, demi: ps.length > 1 ? (p.fin === iso ? 'g' : 'd') : '' };
  });
  return { sorti: true, items, exception: ex, periodes: ps };
}

export function heuresLot(lotId, iso, ctx) {
  const j = jourLot(lotId, iso, ctx);
  return j && j.sorti ? j.items.reduce((t, i) => t + duree(i.heures), 0) : 0;
}

/**
 * Contenu d'une case parcelle × jour.
 * @param {Array<{id, type:'BREBIS'|'AGNELLES'}>} lots
 * @returns {{k:''|'l'|'a'|'la'|'np', demi:'', npType?}}  l = laitières, a = agnelles, la = ensemble, np = affecté non sorti
 */
export function caseParcelle(parcelleId, iso, ctx) {
  const dehors = new Set();
  let demi = '';
  let np = null;
  ctx.lots.forEach((lot) => {
    const j = jourLot(lot.id, iso, ctx);
    if (!j) return;
    if (j.sorti) {
      const it = j.items.find((x) => x.parcelleId === parcelleId);
      if (it) { dehors.add(lot.type === 'AGNELLES' ? 'a' : 'l'); if (it.demi) demi = it.demi; }
    } else if (j.periodes.some((p) => p.parcelleId === parcelleId) && !np) np = lot.type === 'AGNELLES' ? 'a' : 'l';
  });
  if (dehors.size === 2) return { k: 'la', demi };
  if (dehors.size === 1) return { k: [...dehors][0], demi };
  if (np) return { k: 'np', demi: '', npType: np };
  return { k: '', demi: '' };
}

/** Dernier jour (≤ aujourd'hui) où un lot était dehors sur la parcelle, ou null. */
export function derniereSortie(parcelleId, ctx) {
  let best = null;
  ctx.periodes.filter((p) => p.parcelleId === parcelleId && p.debut <= ctx.aujourdhui).forEach((p) => {
    for (let d = p.fin && p.fin < ctx.aujourdhui ? p.fin : ctx.aujourdhui; d >= p.debut; d = ajouterJours(d, -1)) {
      if (best && d <= best) break;
      const lot = ctx.lots.find((l) => l.id === p.lotId);
      if (!lot) break;
      const j = jourLot(lot.id, d, ctx);
      if (j && j.sorti && j.items.some((i) => i.parcelleId === parcelleId)) { best = d; break; }
    }
  });
  return best;
}

/**
 * Faire entrer un lot sur une parcelle à partir d'une date : plan d'écritures
 * (rien n'est écrit ici). La période du lot en cours ce jour-là est close la
 * veille (ou le jour même, avec ses heures du dernier jour, pour un changement
 * dans la journée) ; la nouvelle période reprend la fin de celle qu'elle
 * remplace, ou s'arrête la veille de la période suivante du lot.
 * @returns {{creer?:object, modifier:Array<{id, champs}>, supprimer:Array<string>, memeParcelle:boolean}}
 */
export function planEntree({ periodes, lotId, parcelleId, date, heures, dansLaJournee = false }) {
  const duLot = periodes.filter((p) => p.lotId === lotId);
  const cov = duLot.filter((p) => p.debut <= date && (p.fin == null || p.fin >= date));
  const ici = cov.find((p) => p.parcelleId === parcelleId);
  if (ici && !dansLaJournee) {
    return { modifier: [{ id: ici.id, champs: { heureDebut: heures.debut, heureFin: heures.fin } }], supprimer: [], memeParcelle: true };
  }
  const suivante = duLot.filter((p) => p.debut > date).sort((a, b) => (a.debut < b.debut ? -1 : 1))[0];
  const autres = cov.filter((p) => p.parcelleId !== parcelleId);
  const fin = autres.length ? (autres[0].fin ?? null) : (suivante ? ajouterJours(suivante.debut, -1) : null);
  const modifier = [];
  const supprimer = [];
  autres.forEach((p) => {
    if (dansLaJournee) {
      modifier.push({ id: p.id, champs: { fin: date, heuresDernierJour: { debut: p.heureDebut || HEURES_DEFAUT.debut, fin: heures.debut } } });
    } else if (p.debut === date) supprimer.push(p.id);
    else modifier.push({ id: p.id, champs: { fin: ajouterJours(date, -1), heuresDernierJour: null } });
  });
  return { creer: { lotId, parcelleId, debut: date, fin, heureDebut: heures.debut, heureFin: heures.fin, heuresDernierJour: null },
    modifier, supprimer, memeParcelle: false };
}

/** Jours de l'année (≤ aujourd'hui) avec au moins une sortie, par type de lot. */
export function joursAvecSortie(annee, ctx) {
  const res = { BREBIS: 0, AGNELLES: 0 };
  const fin = `${annee}-12-31` < ctx.aujourdhui ? `${annee}-12-31` : ctx.aujourdhui;
  for (let d = `${annee}-01-01`; d <= fin; d = ajouterJours(d, 1)) {
    ['BREBIS', 'AGNELLES'].forEach((t) => {
      if (ctx.lots.some((l) => l.type === t && (jourLot(l.id, d, ctx) || {}).sorti)) res[t]++;
    });
  }
  return res;
}

/** Bornes de la vue Saison : première sortie − 7 j → dernière sortie (ou aujourd'hui) + 7 j, dans l'année. */
export function bornesSaison(annee, ctx) {
  const dans = ctx.periodes.filter((p) => p.debut <= `${annee}-12-31` && (p.fin || ctx.aujourdhui) >= `${annee}-01-01`);
  if (!dans.length) return null;
  const premiere = dans.reduce((m, p) => (p.debut < m ? p.debut : m), '9999');
  const derniere = dans.reduce((m, p) => { const f = p.fin || ctx.aujourdhui; return f > m ? f : m; }, '0000');
  const borne = (d) => (d < `${annee}-01-01` ? `${annee}-01-01` : d > `${annee}-12-31` ? `${annee}-12-31` : d);
  const fin = derniere > ctx.aujourdhui ? derniere : (ctx.aujourdhui <= `${annee}-12-31` ? ctx.aujourdhui : derniere);
  return { debut: borne(ajouterJours(premiere, -7)), fin: borne(ajouterJours(fin, 7)) };
}

/** Par parcelle sur une période : heures cumulées (tous lots) et nombre de passages (périodes commencées). */
export function bilanParcelle(parcelleId, debut, fin, ctx) {
  let heures = 0;
  const lim = fin < ctx.aujourdhui ? fin : ctx.aujourdhui;
  for (let d = debut; d <= lim; d = ajouterJours(d, 1)) {
    ctx.lots.forEach((l) => {
      const j = jourLot(l.id, d, ctx);
      if (j && j.sorti) j.items.filter((i) => i.parcelleId === parcelleId).forEach((i) => { heures += duree(i.heures); });
    });
  }
  const passages = ctx.periodes.filter((p) => p.parcelleId === parcelleId && p.debut >= debut && p.debut <= fin && p.debut <= ctx.aujourdhui).length;
  return { heures: Math.round(heures * 10) / 10, passages };
}

/** Jours sans sortie (exceptions SANS_SORTIE) et horaires différents d'une période, pour le carnet. */
export function exceptionsEntre(debut, fin, ctx) {
  return ctx.exceptions.filter((e) => e.date >= debut && e.date <= fin).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
