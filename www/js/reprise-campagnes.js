// Reprise de l'historique des campagnes : recalcule la campagne de chaque
// activité déjà enregistrée avec la règle ACTUELLE de campagnes.js
// (calculerCampagnes — la même que celle qui propose la campagne au moment
// de la saisie), et ne touche qu'aux écarts trouvés.
//
// Idempotente : une fois les écarts appliqués, rejouer previsualiserReprise()
// ne doit plus rien lister (les campagnes recalculées correspondent alors à
// celles enregistrées). Toute action irréversible s'annonce avant d'être
// appliquée et reste réversible (CLAUDE.md) : previsualiserReprise() n'écrit
// jamais rien, et appliquerReprise() garde l'ancienne valeur de chaque
// activité modifiée (campagneAvantReprise) pour qu'annulerReprise() puisse
// la restaurer.
import { calculerCampagnes } from './campagnes.js';
import { campagneDeDate } from './calendrier-campagne.js';

// Comme campagnes.js : import différé d'interventions.js (Firestore), pour
// que calculerEcarts() reste testable en Node pur (cf.
// scratchpad/test-reprise-campagnes.mjs) sans jamais tirer firebase-config.js.
let modulesReels = null;
async function chargerModulesReels() {
  if (!modulesReels) {
    const m = await import('./interventions.js');
    modulesReels = { getInterventions: m.getInterventions, ecrireCampagne: m.ecrireCampagne };
  }
  return modulesReels;
}

/** Pré-charge interventions.js — à appeler une fois au bootstrap, comme
 * preparerCampagnes(). */
export async function preparerReprise() {
  await chargerModulesReels();
}

function parParcelle(interventions) {
  const carte = new Map();
  for (const itv of interventions) {
    if (itv.cibleType !== 'PARCELLE' || !Array.isArray(itv.parcelleIds)) continue;
    for (const id of itv.parcelleIds) {
      if (!carte.has(id)) carte.set(id, []);
      carte.get(id).push(itv);
    }
  }
  return carte;
}

// Avant le 28/09/2026 (commit des campagnes unifiées), le champ Campagne
// d'une activité se tapait à la main sans être marqué « forcé » : une valeur
// de cette époque peut être un choix volontaire, à vérifier avant d'appliquer.
const DEBUT_CALCUL_AUTO = Date.parse('2026-09-28T00:00:00Z');
function saisieManuellePossible(itv) {
  const c = itv.creeLe;
  const ms = c && typeof c.toMillis === 'function' ? c.toMillis() : (c && c.seconds ? c.seconds * 1000 : null);
  return ms != null && ms < DEBUT_CALCUL_AUTO;
}

/**
 * Calcul pur (sans Firestore) de la reprise : la campagne que
 * calculerCampagnes() donnerait aujourd'hui, comparée à celle enregistrée —
 * séparé de previsualiserReprise() pour rester testable en Node (cf.
 * scratchpad/test-reprise-campagnes.mjs : rejouer ce calcul sur une liste
 * déjà "appliquée" doit renvoyer 0 écart).
 * Une activité = une ligne, même sur plusieurs parcelles. Jamais écrites
 * (`ignorees`) :
 *  - une campagne forcée (« forcée, ignorée »), même si la règle dirait autre chose ;
 *  - une activité dont les parcelles donnent des campagnes différentes : elle
 *    attend la campagne par parcelle.
 * @returns {{ ecarts: Array<{activiteId, parcelleId, parcelleIds, date, typeId, typeNom,
 *   ancienneCampagne, nouvelleCampagne, saisieManuelle}>,
 *   ignorees: Array<{activiteId, parcelleIds, date, typeNom, ancienneCampagne, raison,
 *   parParcelle: Array<[parcelleId, campagne]>}> }}
 */
export function calculerReprise(interventions, deps = {}) {
  const calcul = new Map();   // activiteId -> Map(parcelleId -> { valeur, sansForcage })
  for (const [parcelleId, activites] of parParcelle(interventions)) {
    const items = activites.map((a) => ({ id: a.id, date: a.date, typeId: a.typeId, forcerCampagne: a.forcerCampagne || null, saisie: a.saisie || null }));
    const r = calculerCampagnes(items, campagneDeDate, deps, parcelleId);
    for (const a of activites) {
      if (!calcul.has(a.id)) calcul.set(a.id, new Map());
      calcul.get(a.id).set(parcelleId, { valeur: r.get(a.id), sansForcage: r.sansForcage.get(a.id) });
    }
  }
  const parId = new Map(interventions.map((i) => [i.id, i]));
  const ecarts = [];
  const ignorees = [];
  for (const [id, parcelles] of calcul) {
    const a = parId.get(id);
    const ancienne = a.campagneId || null;
    const parParc = Array.from(parcelles.entries());
    const base = { activiteId: id, parcelleIds: parParc.map(([p]) => p), date: a.date, typeId: a.typeId, typeNom: a.typeNom || '', ancienneCampagne: ancienne };
    if (a.forcerCampagne) {
      if (parParc.some(([, v]) => v.sansForcage !== String(a.forcerCampagne))) {
        ignorees.push({ ...base, raison: 'forcee', forcee: String(a.forcerCampagne), parParcelle: parParc.map(([p, v]) => [p, v.sansForcage]) });
      }
      continue;
    }
    const valeurs = new Set(parParc.map(([, v]) => v.valeur));
    if (valeurs.size > 1) {
      if (parParc.some(([, v]) => v.valeur !== ancienne)) ignorees.push({ ...base, raison: 'divergente', parParcelle: parParc.map(([p, v]) => [p, v.valeur]) });
      continue;
    }
    const nouvelle = [...valeurs][0];
    if (nouvelle && nouvelle !== ancienne) {
      ecarts.push({ ...base, parcelleId: base.parcelleIds[0], nouvelleCampagne: nouvelle, saisieManuelle: saisieManuellePossible(a) });
    }
  }
  const parDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  return { ecarts: ecarts.sort(parDate), ignorees: ignorees.sort(parDate) };
}

/** Compatibilité : les seuls écarts applicables. */
export function calculerEcarts(interventions, deps = {}) {
  return calculerReprise(interventions, deps).ecarts;
}

/** Liste, sans rien écrire, les écarts (et les activités ignorées) de l'historique réel. */
export function previsualiserReprise(interventions) {
  const reels = modulesReels || {};
  const liste = interventions || (reels.getInterventions ? reels.getInterventions() : null);
  if (!liste) throw new Error('previsualiserReprise : appelle preparerReprise() au démarrage, ou passe la liste des interventions explicitement.');
  return calculerReprise(liste);
}

/** Écrit UNIQUEMENT les écarts listés par previsualiserReprise(). */
export async function appliquerReprise(ecarts) {
  const { ecrireCampagne } = await chargerModulesReels();
  for (const e of ecarts) {
    await ecrireCampagne(e.activiteId, {
      campagneId: e.nouvelleCampagne,
      campagneAvantReprise: e.ancienneCampagne
    });
  }
  return ecarts.length;
}

/** Restaure la campagne d'UNE activité telle qu'elle était avant la reprise. */
export async function annulerReprise(activiteId, interventions) {
  const { getInterventions, ecrireCampagne } = await chargerModulesReels();
  const liste = interventions || getInterventions();
  const itv = liste.find((i) => i.id === activiteId);
  if (!itv || itv.campagneAvantReprise == null) return false;
  await ecrireCampagne(activiteId, { campagneId: itv.campagneAvantReprise, campagneAvantReprise: null });
  return true;
}
