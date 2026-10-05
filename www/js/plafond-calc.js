// Consommation plafonnée au stock : un aliment ne peut jamais être consommé
// au-delà de ce qu'il en reste. Rejeu JOUR PAR JOUR, tous lots confondus
// (plusieurs lots peuvent manger le même aliment) :
//   disponible(d) = stock hors rations au soir de d − consommé avant d
//   consommé(d)   = min(demande(d), disponible(d))
// Quand le disponible ne couvre plus la demande, la consommation est
// plafonnée (partagée entre les lots au prorata de leur demande) : c'est un
// « manque », daté. Rien ne bascule tout seul sur un autre aliment : la
// ration reste telle quelle, plafonnée, jusqu'à ce que l'exploitant reporte.
//
// Module pur (aucun import) : testable en Node tel quel.

// Numéro de jour en UTC strict : aller-retour exact quel que soit le fuseau.
function jour(iso) { return Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000); }
function iso(j) { return new Date(j * 86400000).toISOString().slice(0, 10); }
const EPS = 1e-9;

/**
 * @param {object} p
 * @param {Array<{affectations:Array}>} p.lots
 * @param {(date:string)=>{stock:Map<string,number>, ancre:string|null}} p.baseAu
 *   stock hors rations (tonnes) au soir d'une date ; `ancre` change quand un
 *   stock de départ de clôture s'applique (la consommation cumulée repart de 0).
 * @param {string[]} p.datesBase  dates où baseAu change (mouvements, clôtures)
 * @param {string} p.jusquA       dernier jour simulé (inclus)
 * @returns {{manques:Map<string,Array<{debut,finExclue,f}>>, deficit:Map<string,number>}}
 *   manques : jours où la demande n'est couverte qu'à la fraction f (< 1).
 */
export function simulerConsommation({ lots, baseAu, datesBase = [], jusquA }) {
  const periodes = [];
  (lots || []).forEach((lot) => (lot.affectations || []).forEach((a) => {
    const nb = Number(a.nbBrebis) || 0;
    const comps = (Array.isArray(a.composants) ? a.composants : Array.isArray(a.snapshot) ? a.snapshot : [])
      .filter((c) => c.stockCle && Number(c.kgParAnimalJour) > 0);
    if (!a.dateDebut || !nb || !comps.length) return;
    periodes.push({ debut: jour(a.dateDebut), fin: a.dateFin ? jour(a.dateFin) : Infinity, comps, nb });
  }));
  const manques = new Map();
  const deficit = new Map();
  if (!periodes.length || !jusquA) return { manques, deficit };

  const premier = Math.min(...periodes.map((p) => p.debut));
  const dernier = jour(jusquA);
  const changements = new Set((datesBase || []).map(jour));
  let base = null;
  let ancre;
  const cumul = new Map();

  for (let d = premier; d <= dernier; d++) {
    if (!base || changements.has(d)) {
      base = baseAu(iso(d));
      if (base.ancre !== ancre) { cumul.clear(); ancre = base.ancre; }
    }
    const demande = new Map();
    periodes.forEach((p) => {
      if (d < p.debut || d >= p.fin) return;
      p.comps.forEach((c) => demande.set(c.stockCle, (demande.get(c.stockCle) || 0) + (p.nb * Number(c.kgParAnimalJour)) / 1000));
    });
    demande.forEach((t, cle) => {
      const dispo = (base.stock.get(cle) || 0) - (cumul.get(cle) || 0);
      const mange = Math.max(0, Math.min(t, dispo));
      cumul.set(cle, (cumul.get(cle) || 0) + mange);
      const f = t > 0 ? mange / t : 1;
      if (f >= 1 - EPS) return;
      deficit.set(cle, (deficit.get(cle) || 0) + (t - mange));
      if (!manques.has(cle)) manques.set(cle, []);
      const segs = manques.get(cle);
      const der = segs[segs.length - 1];
      if (der && der.finJ === d && Math.abs(der.f - f) < EPS) der.finJ = d + 1;
      else segs.push({ debutJ: d, finJ: d + 1, f });
    });
  }
  manques.forEach((segs) => segs.forEach((s) => { s.debut = iso(s.debutJ); s.finExclue = iso(s.finJ); }));
  return { manques, deficit };
}

/**
 * Jours « effectivement nourris » d'un aliment sur [debut, finExclue) : les
 * jours de manque ne comptent que pour leur fraction couverte.
 */
export function joursEffectifs(manques, cle, debut, finExclue) {
  const a = jour(debut);
  const b = finExclue ? jour(finExclue) : a;
  if (!(b > a)) return 0;
  let n = b - a;
  const segs = manques && manques.get(cle);
  if (segs) segs.forEach((s) => {
    const o = Math.min(b, s.finJ) - Math.max(a, s.debutJ);
    if (o > 0) n -= o * (1 - s.f);
  });
  return n;
}

/** Premier jour de manque d'un aliment dans [debut, finExclue), ou null. */
export function premierManque(manques, cle, debut, finExclue) {
  const segs = manques && manques.get(cle);
  if (!segs) return null;
  const a = jour(debut);
  const b = finExclue ? jour(finExclue) : Infinity;
  const s = segs.find((x) => x.finJ > a && x.debutJ < b);
  return s ? iso(Math.max(a, s.debutJ)) : null;
}

/**
 * Aliments dont le manque s'aggrave entre deux simulations (contrôle d'une
 * saisie ou d'une modification de ration) : [{cle, date}] — date = premier
 * jour de manque de la nouvelle simulation.
 */
export function manquesAggraves(avant, apres) {
  const res = [];
  apres.deficit.forEach((t, cle) => {
    const t0 = avant.deficit.get(cle) || 0;
    if (!(t > t0 + 0.0005)) return;
    // Premier jour où la couverture devient moins bonne qu'avant.
    const fAvant = (j) => {
      const s = (avant.manques.get(cle) || []).find((x) => x.debutJ <= j && j < x.finJ);
      return s ? s.f : 1;
    };
    let date = null;
    (apres.manques.get(cle) || []).some((s) => {
      for (let j = s.debutJ; j < s.finJ; j++) {
        if (s.f < fAvant(j) - EPS) { date = iso(j); return true; }
      }
      return false;
    });
    res.push({ cle, date });
  });
  return res;
}
