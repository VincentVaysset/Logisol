// Diagnostic > Outils > Lots et rations : état, en lecture seule. Chaque lot,
// chacune de ses périodes de ration (dates, aliments, kg/j, consommé), les
// périodes qui se chevauchent et les aliments consommés au-delà du stock
// (plafonnés depuis le point 1, plafond-conso.js). Rien n'est écrit : c'est
// le texte à transmettre avant toute clôture ou correction de lot.
import { getLots, typeAnimauxDe } from './lots.js';
import { historiqueAffectations, composantsAffectation, tonnesComposant } from './affectations.js';
import { simulationCourante, epuisementsDuLot } from './plafond-conso.js';
import { getBatimentById } from './batiments.js';

function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }
function n(v) { return (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
const TYPES = { BREBIS: 'Brebis', AGNELLES: 'Agnelles', BELIERS: 'Béliers' };

export function rapportLots() {
  const lots = getLots();
  const out = ['LOTS ET RATIONS — ÉTAT (rien n\'est modifié)', `${lots.length} lot(s).`];
  const chevauchements = [];
  const labels = new Map();
  lots.forEach((lot) => {
    const b = lot.batimentId ? getBatimentById(lot.batimentId) : null;
    out.push('', `• ${lot.nom || 'Lot'} — ${TYPES[typeAnimauxDe(lot)]} · ${lot.nbBrebis || 0} têtes${b ? ' · ' + b.nom : ''}${lot.dateCloture ? ' · CLÔTURÉ le ' + dateFr(lot.dateCloture) : ''}`);
    const periodes = historiqueAffectations(lot).slice().reverse();
    if (!periodes.length) out.push('   aucune ration distribuée');
    periodes.forEach((a, i) => {
      const comps = composantsAffectation(a);
      comps.forEach((c) => labels.set(c.stockCle, c.stockLabel));
      const conso = comps.reduce((t, c) => t + tonnesComposant(a, c), 0);
      out.push(`   ${i + 1}. ${dateFr(a.dateDebut)} → ${a.dateFin ? dateFr(a.dateFin) : 'en cours'} · ${a.nbBrebis || 0} têtes : ` +
        (comps.length ? comps.map((c) => `${c.stockLabel} ${n(c.kgParAnimalJour)} kg/j`).join(' + ') : 'pâturage') + ` — consommé ${n(conso)} t`);
      periodes.slice(i + 1).forEach((o, j) => {
        if (a.dateDebut < (o.dateFin || '9999-12-31') && o.dateDebut < (a.dateFin || '9999-12-31')) {
          const m = `${lot.nom} : période ${i + 1} (${dateFr(a.dateDebut)} → ${a.dateFin ? dateFr(a.dateFin) : 'en cours'}) et période ${i + j + 2} (${dateFr(o.dateDebut)} → ${o.dateFin ? dateFr(o.dateFin) : 'en cours'})`;
          chevauchements.push(m);
          out.push(`      ⚠️ CHEVAUCHE la période ${i + j + 2}`);
        }
      });
    });
    epuisementsDuLot(lot).forEach((e) => out.push(`   ⚠️ ${e.composant.stockLabel} épuisé le ${dateFr(e.date)} (ration du ${dateFr(e.aff.dateDebut)}) : consommation plafonnée depuis`));
  });
  out.push('', 'PÉRIODES QUI SE CHEVAUCHENT');
  out.push(...(chevauchements.length ? chevauchements.map((c) => '   ' + c) : ['   aucune']));
  out.push('', 'ALIMENTS CONSOMMÉS AU-DELÀ DU STOCK (tous lots — consommation plafonnée)');
  const sim = simulationCourante();
  const lignes = [];
  if (sim) sim.deficit.forEach((t, cle) => {
    const segs = sim.manques.get(cle) || [];
    lignes.push(`   ${labels.get(cle) || cle} : épuisé le ${dateFr(segs.length ? segs[0].debut : '')}, ${n(t)} t demandées non couvertes`);
  });
  out.push(...(lignes.length ? lignes : ['   aucun']));
  return out.join('\n');
}
