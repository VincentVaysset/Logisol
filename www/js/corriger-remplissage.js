// Corriger sans remplissage — action ponctuelle sur UNE intervention Moisson
// enregistrée avant le retrait du champ Remplissage (%) du formulaire
// (tonnesReelles = nbBennes × capaciteBenne × PS, sans facteur remplissage
// désormais) : ne migre rien en masse, ne touche à aucune autre ligne.
// Recalcule cette seule activité et le mouvement de stock qu'elle a créé via
// poids-specifique.js/quantiteDeSaisie — la même fonction qu'à la saisie,
// jamais un second calcul. Même principe et même granularité que
// corriger-ps.js/corrigerAvecPs.
import { getInterventions, updateIntervention, quantiteDeSaisie } from './interventions.js';
import { getMouvements, updateMouvement } from './mouvements.js';
import { getTypeById, formulaireDe } from './interventions-types.js';

/** Une intervention Moisson porte-t-elle encore l'ancien facteur remplissage ? */
export function estCorrigeableRemplissage(itv) {
  if (!itv) return false;
  const type = getTypeById(itv.typeId);
  if (formulaireDe(type) !== 'MOISSON') return false;
  const s = itv.saisie || {};
  return s.capaciteBenne != null && s.remplissageBenne != null;
}

/**
 * Retire remplissageBenne de la saisie d'UNE intervention Moisson et
 * recalcule sa quantité (et le mouvement de stock qu'elle a créé) avec la
 * formule actuelle (nbBennes × capaciteBenne × PS, sans remplissage).
 * @returns {{quantite:number}}
 */
export async function corrigerRemplissage(interventionId) {
  const itv = getInterventions().find((i) => i.id === interventionId);
  if (!itv) throw new Error('Activité introuvable.');
  if (!estCorrigeableRemplissage(itv)) {
    throw new Error("Cette activité n'a pas de remplissage à corriger.");
  }

  const saisie = { ...itv.saisie, remplissageBenne: null };
  const quantite = quantiteDeSaisie('MOISSON', saisie);
  const flux = itv.flux ? { ...itv.flux, quantite } : null;

  await updateIntervention(interventionId, { ...itv, saisie, flux });

  if (itv.mouvementId) {
    const m = getMouvements().find((x) => x.id === itv.mouvementId);
    if (m) await updateMouvement(m.id, { ...m, quantite });
  }

  return { quantite };
}
