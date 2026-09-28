// Corriger avec PS — action ponctuelle sur UNE intervention Moisson déjà
// enregistrée sans PS (avant ce champ, ou laissé vide) : ne migre rien en
// masse, ne touche à aucune autre ligne. Recalcule cette seule activité et
// le mouvement de stock qu'elle a créé via interventions.js/quantiteDeSaisie
// — la même fonction qu'à la saisie, jamais un second calcul — et mémorise
// le PS comme valeur par défaut pour la prochaine moisson de la même espèce.
import { getInterventions, updateIntervention, quantiteDeSaisie } from './interventions.js';
import { getMouvements, updateMouvement } from './mouvements.js';
import { getTypeById, formulaireDe } from './interventions-types.js';
import { psVersTonnesM3, estCerealeAliment } from './poids-specifique.js';
import { setPsDefaut } from './ps-defauts.js';

/** Une intervention Moisson est-elle corrigeable (pas encore de PS) ? */
export function estCorrigeableAvecPs(itv) {
  if (!itv) return false;
  const type = getTypeById(itv.typeId);
  if (formulaireDe(type) !== 'MOISSON') return false;
  const s = itv.saisie || {};
  return s.ps == null;
}

/**
 * Recalcule UNE intervention Moisson avec le PS donné (t/m³ ou kg/hL,
 * converti automatiquement), et le mouvement de stock qu'elle a créé.
 * @returns {{quantite:number, psTonnesM3:number}}
 */
export async function corrigerAvecPs(interventionId, psSaisi) {
  const itv = getInterventions().find((i) => i.id === interventionId);
  if (!itv) throw new Error('Activité introuvable.');
  if (!estCorrigeableAvecPs(itv)) {
    throw new Error("Cette activité a déjà un PS enregistré, ou n'est pas une moisson.");
  }

  const psTonnesM3 = psVersTonnesM3(psSaisi);
  if (psTonnesM3 == null) throw new Error('PS invalide.');

  const saisie = { ...(itv.saisie || {}), ps: psSaisi };
  const quantite = quantiteDeSaisie('MOISSON', saisie);
  const flux = itv.flux ? { ...itv.flux, quantite } : null;

  await updateIntervention(interventionId, { ...itv, saisie, flux });

  if (itv.mouvementId) {
    const m = getMouvements().find((x) => x.id === itv.mouvementId);
    if (m) await updateMouvement(m.id, { ...m, quantite });
  }

  if (estCerealeAliment(saisie.typeAliment)) {
    await setPsDefaut(saisie.typeAliment, psTonnesM3);
  }

  return { quantite, psTonnesM3 };
}

/**
 * Annule une correction PS sur UNE intervention : retire ps de sa saisie et
 * recalcule le tonnage avec la règle d'avant (comportement inchangé tant
 * que rien n'est corrigé, cf. poids-specifique.js/quantiteDeSaisie) — sans
 * trace séparée à tenir à jour, puisque enlever ps suffit à reconstituer
 * exactement l'état précédent (tonnageBenne/poidsSpecifique restent
 * intacts, ils n'ont jamais été touchés par corrigerAvecPs).
 * @returns {{quantite:number}}
 */
export async function annulerCorrectionPs(interventionId) {
  const itv = getInterventions().find((i) => i.id === interventionId);
  if (!itv || !itv.saisie || itv.saisie.ps == null) throw new Error('Rien à annuler.');

  const saisie = { ...itv.saisie, ps: null };
  const quantite = quantiteDeSaisie('MOISSON', saisie);
  const flux = itv.flux ? { ...itv.flux, quantite } : null;

  await updateIntervention(interventionId, { ...itv, saisie, flux });

  if (itv.mouvementId) {
    const m = getMouvements().find((x) => x.id === itv.mouvementId);
    if (m) await updateMouvement(m.id, { ...m, quantite });
  }

  return { quantite };
}
