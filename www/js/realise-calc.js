// Vue « Réalisé » des Rapports (maquette-charte-rapports-realise.html) :
// uniquement les activités enregistrées et les mouvements de stock. Le
// prévisionnel n'apparaît qu'en COLONNE DE COMPARAISON, jamais additionné au
// réel (CLAUDE.md : le réel et le prévu ne se mélangent jamais). Module pur.

const r2 = (v) => Math.round(v * 100) / 100;

/** Doses d'épandage au-delà desquelles une saisie est à vérifier (t/ha). */
export const SEUILS_EPANDAGE_T_HA = { fumier: 60, chaux: 10 };

// Ligne d'épandage au-delà du seuil (erreur d'unité probable) : exclue des
// totaux et du %, signalée sous le tableau.
export function noteAVerifier(nom, lignes) {
  const seuil = SEUILS_EPANDAGE_T_HA[nom === 'Fumier' ? 'fumier' : 'chaux'];
  return `Valeur à vérifier (au-delà de ${seuil} t/ha, unité kg/t ?) : ${lignes.map((l) => `${l.nom} ${(Math.round(l.tHaReel * 10) / 10).toLocaleString('fr-FR')} t/ha`).join(', ')}. Exclue des totaux et du %.`;
}

const sansAccent = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/**
 * La culture semée (nom de cultures_config, ex. « Blé tendre ») est-elle celle
 * prévue (référentiel prévisionnel, ex. « Blé 2 ») ? Les deux listes ne
 * partagent pas d'identifiant : rapprochement par espèce. Nom inconnu : oui
 * (rien à signaler).
 */
export function memeCulture(nom, prev) {
  const n = sansAccent(nom);
  if (!n || !prev) return true;
  switch (prev.famille) {
    case 'CEREALES': return !!prev.grain && n.includes(sansAccent(prev.grain));
    case 'LUZERNE': case 'SEMIS_PRAIRIE': return n.includes('luzerne');
    case 'PRAIRIE_COURTE': return /\brg\b|ray/.test(n);
    case 'FETUQUE': return n.includes('fetuque');
    case 'PN': return n.includes('prairie');
    default: return true;
  }
}

/**
 * Semis réalisés de la campagne, une ligne par parcelle semée (une par semis
 * si la parcelle l'a été deux fois), puis les parcelles prévues non semées.
 * La culture affichée est TOUJOURS celle de l'activité (le réel) ; le prévu
 * n'apparaît qu'en mention « prévu : X » quand il diffère.
 * Les dérobées / couverts forment un tableau à part (`derobees`) : hors
 * total semé, hors reste à semer, et une parcelle qui n'en porte qu'une reste
 * « À semer » pour sa culture prévue.
 * @param {object} p
 * @param {Array<{id, nom, surfaceHa}>} p.parcelles
 * @param {Map<string,{code,label,saison,famille,grain?}>} p.prevus  parcelleId -> culture prévue semée cette campagne
 * @param {Array<{id, date, parcelleIds, surfaceHa:number|null, surfaceEstimee?, doseKgHa:number|null, semence?, cultureNom?, derobee?}>} p.semis
 *   surfaceHa d'un semis sur plusieurs parcelles : répartie au prorata de leur surface.
 * @returns {{lignes, derobees, seme, prevu, reste, kg, kgPartiel, sansDose, parCulture, estimee}}
 *   kg = dose × surface semée, calculé ici, jamais stocké ; null si aucune dose.
 */
export function semisRealises({ parcelles, prevus, semis }) {
  const parId = new Map(parcelles.map((x) => [x.id, x]));
  const surf = (id) => Number((parId.get(id) || {}).surfaceHa) || 0;
  const nomDe = (id) => (parId.get(id) || {}).nom || 'Sans nom';
  const semees = new Set();
  const faites = [];
  const derobees = [];
  semis.forEach((s) => {
    const ids = (s.parcelleIds || []).filter((id) => parId.has(id));
    const declaree = s.surfaceHa != null ? Number(s.surfaceHa) : null;
    const somme = ids.reduce((t, id) => t + surf(id), 0);
    const dose = s.doseKgHa != null && s.doseKgHa !== '' ? Number(s.doseKgHa) : null;
    ids.forEach((id) => {
      const ha = declaree == null ? surf(id) : declaree * (somme > 0 ? surf(id) / somme : 1 / ids.length);
      const prevu = prevus.get(id);
      const ligne = { parcelleId: id, parcelle: nomDe(id), culture: s.cultureNom || 'Culture non renseignée',
        prevuDifferent: !s.derobee && prevu && !memeCulture(s.cultureNom, prevu) ? prevu.label : null,
        semence: String(s.semence || '').trim(), date: s.date, ha: r2(ha), estimee: declaree == null || !!s.surfaceEstimee,
        dose, kg: dose != null ? Math.round(dose * ha) : null, aSemer: false, derobee: !!s.derobee };
      if (s.derobee) derobees.push(ligne);
      else { semees.add(id); faites.push(ligne); }
    });
  });
  const aSemer = [];
  let prevu = 0;
  prevus.forEach((c, id) => {
    if (!parId.has(id)) return;
    prevu += surf(id);
    if (!semees.has(id)) aSemer.push({ parcelleId: id, parcelle: nomDe(id), culture: c.label, saison: c.saison, ha: r2(surf(id)), aSemer: true });
  });
  const parNom = (a, b) => a.parcelle.localeCompare(b.parcelle, 'fr', { numeric: true }) || (a.date || '').localeCompare(b.date || '');
  faites.sort(parNom);
  aSemer.sort(parNom);
  derobees.sort(parNom);
  const toutes = [...faites, ...derobees];
  const parCulture = new Map();
  toutes.forEach((l) => {
    const x = parCulture.get(l.culture) || { culture: l.culture, ha: 0, kg: 0, kgPartiel: false, avecDose: false };
    x.ha += l.ha;
    if (l.kg != null) { x.kg += l.kg; x.avecDose = true; } else x.kgPartiel = true;
    parCulture.set(l.culture, x);
  });
  const totalKg = (ls) => (ls.some((l) => l.kg != null) ? ls.reduce((t, l) => t + (l.kg || 0), 0) : null);
  return {
    lignes: [...faites, ...aSemer],
    derobees,
    derobeesHa: r2(derobees.reduce((t, l) => t + l.ha, 0)),
    derobeesKg: totalKg(derobees),
    derobeesKgPartiel: derobees.some((l) => l.dose == null),
    seme: r2(faites.reduce((t, l) => t + l.ha, 0)),
    prevu: r2(prevu),
    reste: r2(aSemer.reduce((t, x) => t + x.ha, 0)),
    kg: totalKg(faites),
    kgPartiel: faites.some((l) => l.dose == null),
    sansDose: [...new Set(toutes.filter((l) => l.dose == null).map((l) => l.parcelle))],
    parCulture: Array.from(parCulture.values()).map((x) => ({ culture: x.culture, ha: r2(x.ha), kg: x.avecDose ? x.kg : null, kgPartiel: x.kgPartiel }))
      .sort((a, b) => a.culture.localeCompare(b.culture, 'fr', { numeric: true })),
    estimee: toutes.some((l) => l.estimee)
  };
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
        prevu: pv, realise: re, ecart: re != null ? r2(re - (pv || 0)) : null, aFaire: re == null,
        // Au-delà du seuil : presque toujours une erreur d'unité (kg pour t).
        aVerifier: re != null && ha > 0 && re / ha > SEUILS_EPANDAGE_T_HA[produit] };
    }).sort((a, b) => (a.aFaire - b.aFaire) || a.nom.localeCompare(b.nom, 'fr'));
    // Une ligne à vérifier sort des totaux et du % (prévu compris) : un
    // chiffre faux ne doit pas en fausser d'autres.
    const comptees = lignes.filter((l) => !l.aVerifier);
    const prevuT = r2(comptees.reduce((t, l) => t + (l.prevu || 0), 0));
    const realiseT = r2(comptees.reduce((t, l) => t + (l.realise || 0), 0));
    return { produit, lignes, prevuT, realiseT, ecartT: r2(realiseT - prevuT), aVerifier: lignes.filter((l) => l.aVerifier),
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
