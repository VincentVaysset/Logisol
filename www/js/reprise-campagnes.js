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

/**
 * Calcul pur (sans Firestore) des écarts entre la campagne enregistrée et
 * celle que calculerCampagnes() donnerait aujourd'hui — séparé de
 * previsualiserReprise() pour rester testable en Node, comme campagnes.js
 * (cf. scratchpad/test-reprise-campagnes.mjs : rejouer ce calcul sur une
 * liste déjà "appliquée" doit renvoyer 0 écart, c'est l'idempotence exigée
 * par le point 5 du ticket).
 * @returns {Array<{activiteId, parcelleId, date, typeId, typeNom,
 *                   ancienneCampagne, nouvelleCampagne}>}
 */
export function calculerEcarts(interventions, deps = {}) {
  const parParc = parParcelle(interventions);
  const ecarts = [];
  for (const [parcelleId, activites] of parParc) {
    const items = activites.map((a) => ({
      id: a.id, date: a.date, typeId: a.typeId, forcerCampagne: a.forcerCampagne || null
    }));
    const nouvelles = calculerCampagnes(items, (d) => d.slice(0, 4), deps);
    for (const a of activites) {
      const nouvelle = nouvelles.get(a.id);
      const ancienne = a.campagneId || null;
      if (nouvelle && nouvelle !== ancienne) {
        ecarts.push({
          activiteId: a.id, parcelleId, date: a.date, typeId: a.typeId, typeNom: a.typeNom || '',
          ancienneCampagne: ancienne, nouvelleCampagne: nouvelle
        });
      }
    }
  }
  return ecarts.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** Liste, sans rien écrire, les écarts de l'historique réel de l'appli. */
export function previsualiserReprise(interventions) {
  const reels = modulesReels || {};
  const liste = interventions || (reels.getInterventions ? reels.getInterventions() : null);
  if (!liste) throw new Error('previsualiserReprise : appelle preparerReprise() au démarrage, ou passe la liste des interventions explicitement.');
  return calculerEcarts(liste);
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
