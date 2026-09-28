// Historique PS : liste les interventions céréales existantes qui portent
// déjà un poidsSpecifique saisi (l'ancien champ, jamais appliqué avant le
// ticket PS) mais dont la quantité a été calculée sans lui — et propose de
// les corriger toutes, en une prévisualisation puis un "Appliquer" unique.
// Jamais de migration silencieuse (cf. CLAUDE.md) : previsualiserHistoriquePs()
// n'écrit rien, appliquerHistoriquePs() ne touche que les lignes listées, et
// chacune reste annulable au cas par cas (corriger-ps.js/annulerCorrectionPs).
import { quantiteDeSaisie } from './poids-specifique.js';

// Comme campagnes.js/reprise-campagnes.js : import différé des modules
// Firestore (interventions.js, et corriger-ps.js qui l'importe à son tour),
// pour que calculerEcartsPs() reste testable en Node pur (cf.
// scratchpad/test-historique-ps.mjs) sans jamais tirer firebase-config.js.
let modulesReels = null;
async function chargerModulesReels() {
  if (!modulesReels) {
    const [typesM, itvM, corrigerM] = await Promise.all([
      import('./interventions-types.js'), import('./interventions.js'), import('./corriger-ps.js')
    ]);
    modulesReels = {
      getTypeById: typesM.getTypeById,
      formulaireDe: typesM.formulaireDe,
      getInterventions: itvM.getInterventions,
      corrigerAvecPs: corrigerM.corrigerAvecPs
    };
  }
  return modulesReels;
}

export async function preparerHistoriquePs() {
  await chargerModulesReels();
}

/**
 * Calcul pur (sans Firestore) des lignes corrigeables : une intervention
 * Moisson dont poidsSpecifique est saisi mais ps ne l'est pas encore, et
 * dont la quantité recalculée avec ce PS diffère de celle déjà enregistrée.
 * @returns {Array<{activiteId, date, typeNom, parcelleIds, psSaisi,
 *                   ancienneQuantite, nouvelleQuantite}>}
 */
export function calculerEcartsPs(interventions, deps = {}) {
  const reels = modulesReels || {};
  const getTypeById = deps.getTypeById || reels.getTypeById;
  const formulaireDe = deps.formulaireDe || reels.formulaireDe;
  if (!getTypeById || !formulaireDe) {
    throw new Error('calculerEcartsPs : dépendances manquantes — appelle preparerHistoriquePs() au démarrage, ou passe-les explicitement (deps).');
  }

  const ecarts = [];
  for (const itv of interventions || []) {
    const type = getTypeById(itv.typeId);
    if (formulaireDe(type) !== 'MOISSON') continue;
    const s = itv.saisie || {};
    if (s.poidsSpecifique == null || s.ps != null) continue;

    const ancienneQuantite = itv.flux ? itv.flux.quantite : null;
    const nouvelleQuantite = quantiteDeSaisie('MOISSON', { ...s, ps: s.poidsSpecifique });
    if (nouvelleQuantite == null || nouvelleQuantite === ancienneQuantite) continue;

    ecarts.push({
      activiteId: itv.id, date: itv.date, typeNom: itv.typeNom || '',
      parcelleIds: itv.parcelleIds || [], psSaisi: s.poidsSpecifique,
      ancienneQuantite, nouvelleQuantite
    });
  }
  return ecarts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Liste, sans rien écrire, les écarts de l'historique réel de l'appli. */
export function previsualiserHistoriquePs(interventions) {
  const reels = modulesReels || {};
  const liste = interventions || (reels.getInterventions ? reels.getInterventions() : null);
  if (!liste) throw new Error('previsualiserHistoriquePs : appelle preparerHistoriquePs() au démarrage, ou passe la liste des interventions explicitement.');
  return calculerEcartsPs(liste);
}

/** Applique UNIQUEMENT les écarts listés — une correction par ligne, via
 * corriger-ps.js/corrigerAvecPs (le même chemin que "Corriger avec PS"). */
export async function appliquerHistoriquePs(ecarts) {
  const { corrigerAvecPs } = await chargerModulesReels();
  for (const e of ecarts) {
    await corrigerAvecPs(e.activiteId, e.psSaisi);
  }
  return ecarts.length;
}
