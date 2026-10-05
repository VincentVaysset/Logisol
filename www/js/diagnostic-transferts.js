// Diagnostic > Outils > Transferts : ce que changerait la correction « un
// transfert conserve le stock » sur TES données, AVANT de l'activer. Rien
// n'est écrit : on calcule les deux versions côte à côte (ancien calcul,
// nouveau calcul) pour Stocks, Bâtiments et les campagnes clôturées.
import { getMouvements } from './mouvements.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';
import { getBatimentById } from './batiments.js';
import { stockAuSoir, journalSansCloture } from './clotures-stock.js';
import { contenuDesLieux } from './lieux.js';
import { getClotures } from './verrou-campagne.js';
import { bornesCampagneStock } from './campagne-stock.js';
import { aujourdhuiIso } from './campagne-stock.js';
import { compositionDesTransferts } from './transferts-calc.js';
import { identiteDuMouvement, tonnesDuMouvement } from './fourrages.js';

const AVANT = { transferts: false };
const APRES = { transferts: true };

function n(v) { return (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?'; }
function signe(v) { return `${v > 0 ? '+' : ''}${n(v)}`; }

/** Lignes « aliment : avant → après » pour ce qui change (> 5 kg). */
function comparer(avant, apres) {
  const a = new Map(avant.map((g) => [g.cle, g]));
  const b = new Map(apres.map((g) => [g.cle, g]));
  const cles = new Set([...a.keys(), ...b.keys()]);
  const lignes = [];
  let totA = 0, totB = 0;
  cles.forEach((cle) => {
    const ta = a.has(cle) ? a.get(cle).tonnes : 0;
    const tb = b.has(cle) ? b.get(cle).tonnes : 0;
    totA += ta; totB += tb;
    if (Math.abs(ta - tb) > 0.005) lignes.push(`   ${(a.get(cle) || b.get(cle)).label} : ${n(ta)} t → ${n(tb)} t (${signe(tb - ta)} t)`);
  });
  return { lignes, totA, totB };
}

function nomContenant(cle) {
  const [type, id] = cle.split('|');
  const c = type === 'CELLULE' ? getCellules().find((x) => x.id === id) : getEmplacements().find((x) => x.id === id);
  if (!c) return cle;
  const b = getBatimentById(c.batimentId);
  return `${b ? b.nom + ' — ' : ''}${c.nom || id}`;
}

export function rapportTransferts() {
  const auj = aujourdhuiIso();
  const mouvements = getMouvements();
  const transferts = mouvements.filter((m) => m.typeMouvement === 'TRANSFERT');
  const out = ['TRANSFERTS — APERÇU AVANT / APRÈS LA CORRECTION (rien n\'est modifié)'];
  if (!transferts.length) {
    out.push('Aucun transfert dans le journal : la correction ne change aucun chiffre.');
    return out.join('\n');
  }

  // 1. Chaque transfert et ce qu'il déplace (composition du départ à sa date)
  const retenus = mouvements.filter((m) => m.typeMouvement !== 'SORTIE_ALIMENTATION' && m.typeMouvement !== 'AJUSTEMENT' && !m.excluCalcul);
  const compo = new Map(compositionDesTransferts(retenus, { identite: identiteDuMouvement, tonnes: tonnesDuMouvement })
    .map((c) => [c.mouvement.id, c.lots]));
  out.push(`${transferts.length} transfert(s) dans le journal :`);
  transferts.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((m, i) => {
    const unite = m.unite === 'bottes' ? 'bottes' : 't';
    const meme = m.sourceId && m.sourceId === m.destinationId;
    out.push(`${i + 1}. ${dateFr(m.date)} · ${m.sourceNom || nomContenant(`${m.sourceType}|${m.sourceId}`)} → ${m.destinationNom || nomContenant(`${m.destinationType}|${m.destinationId}`)} · ${n(m.quantite)} ${unite}` +
      (m.excluCalcul ? ' · EXCLU du calcul' : '') + (meme ? ' · VERS LUI-MÊME (sans effet)' : ''));
    const lots = compo.get(m.id) || [];
    out.push(lots.length
      ? `   déplacé : ${lots.map((l) => `${l.label} ${unite === 'bottes' ? n(l.quantite) + ' bottes (' + n(l.tonnes) + ' t)' : n(l.tonnes) + ' t'}`).join(' · ')}`
      : '   déplacé : rien d\'identifié (le départ était vide ou d\'origine non renseignée à cette date)');
  });

  // 2. Stocks aujourd'hui (avec le stock de départ des clôtures, comme l'onglet)
  out.push('', `STOCKS AU ${dateFr(auj)} (onglet Stocks)`);
  const s = comparer(stockAuSoir(auj, AVANT), stockAuSoir(auj, APRES));
  out.push(...(s.lignes.length ? s.lignes : ['   aucun changement']));
  out.push(`   Total : ${n(s.totA)} t → ${n(s.totB)} t (${signe(s.totB - s.totA)} t)`);

  // 3. Bâtiments : contenants qui changent
  out.push('', 'BÂTIMENTS (contenants qui changent)');
  const la = contenuDesLieux(auj, AVANT);
  const lb = contenuDesLieux(auj, APRES);
  const lignesB = [];
  new Set([...la.keys(), ...lb.keys()]).forEach((cle) => {
    const a = la.get(cle) || { tonnes: 0, quantite: 0 };
    const b = lb.get(cle) || { tonnes: 0, quantite: 0 };
    if (Math.abs(a.tonnes - b.tonnes) > 0.005 || Math.abs(a.quantite - b.quantite) > 0.5) {
      const bottes = cle.startsWith('EMPLACEMENT_FOURRAGE') ? ` (${Math.round(a.quantite)} → ${Math.round(b.quantite)} bottes)` : '';
      lignesB.push(`   ${nomContenant(cle)} : ${n(a.tonnes)} t → ${n(b.tonnes)} t${bottes}`);
    }
  });
  out.push(...(lignesB.length ? lignesB : ['   aucun changement']));

  // 4. Campagnes clôturées : l'instantané n'est PAS recalculé
  out.push('', 'CAMPAGNES CLÔTURÉES (stock de départ figé)');
  const clotures = getClotures().filter((c) => Array.isArray(c.lignes) && c.lignes.length);
  if (!clotures.length) out.push('   aucune campagne clôturée : rien de figé, aucun effet de ce côté.');
  clotures.forEach((c) => {
    const fin = bornesCampagneStock(c.id).fin;
    const avant = transferts.filter((m) => m.date <= fin && !m.excluCalcul);
    out.push(`   ${c.id} (${c.statut === 'reouverte' ? 'réouverte' : 'clôturée'}, comptage du ${dateFr(c.dateComptage)}) : ${avant.length} transfert(s) daté(s) jusqu'au ${dateFr(fin)}`);
    if (!avant.length) { out.push('     aucun effet : l\'instantané reste juste.'); return; }
    const j = comparer(journalSansCloture(fin, AVANT), journalSansCloture(fin, APRES));
    out.push(`     Théorique au ${dateFr(fin)} (vue ${c.id}) :`);
    out.push(...(j.lignes.length ? j.lignes.map((l) => '  ' + l) : ['        aucun changement']));
    out.push(`     Stock de départ ${c.id.slice(5)}-${Number(c.id.slice(5)) + 1} (instantané) : INCHANGÉ — il vient du comptage, pas du calcul.`);
    if (j.lignes.length) {
      out.push('     Si ton comptage avait déjà « absorbé » ce stock perdu (ajustement positif à la clôture), cet ajustement le');
      out.push('     compterait désormais une 2e fois dans la vue au 31/08 de cette campagne. Les stocks d\'aujourd\'hui, eux, partent');
      out.push('     de l\'instantané : voir « Stocks » ci-dessus. Rouvrir puis reclôturer recalculerait proprement.');
      const ajusts = mouvements.filter((m) => m.typeMouvement === 'AJUSTEMENT' && (c.ajustementIds || []).includes(m.id));
      if (ajusts.length) out.push(`     Ajustements de cette clôture : ${ajusts.map((m) => `${m.categorieLabel || m.categorieCle} ${signe(m.quantite)} t`).join(' · ')}`);
    }
  });
  return out.join('\n');
}
