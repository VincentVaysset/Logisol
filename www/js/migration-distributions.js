// Migration additive et idempotente : convertit l'historique des périodes
// par stade (lots.js/prelevements) en distributions (affectations.js), pour
// que la campagne déjà enregistrée compte dans le bilan — qui ne lit,
// depuis la consolidation, QUE les distributions (cf. rations-calc.js).
//
// N'écrit JAMAIS dans "prelevements" ni ne le supprime : c'est une source,
// jamais touchée. Chaque groupe de périodes déjà migré porte
// migreDePrelevement = son groupeId sur la distribution créée — rejouer la
// migration ne recrée donc rien qui existe déjà, quel que soit le nombre de
// fois qu'elle tourne.
import { db } from './firebase-config.js';
import { doc, updateDoc, serverTimestamp } from "../vendor/firebase/firebase-firestore.js";
import { periodesLot } from './lots.js';
import { affectationsLot } from './affectations.js';

function idAffectation() {
  return Math.random().toString(36).slice(2, 10);
}

function dejaMigre(lot, groupeId) {
  return affectationsLot(lot).some((a) => a.migreDePrelevement === groupeId);
}

// Une ligne de prélèvement sans catégorie n'a rien à distribuer (composant
// jamais rattaché à un stock, cf. lots.js/planifierPeriode) — on ne fabrique
// pas un composant fantôme pour autant.
function composantsDuGroupe(groupe) {
  return groupe.lignes
    .filter((p) => p.categorieCle)
    .map((p) => ({
      stockCle: p.categorieCle,
      stockLabel: p.categorieLabel || p.categorieCle,
      kgParAnimalJour: Number(p.rationKgParBrebis) || 0
    }))
    .filter((c) => c.kgParAnimalJour > 0);
}

/**
 * Migre un seul lot. Retourne le lot TEL QU'IL SERA après (affectations
 * fusionnées localement, sans dépendre du délai de l'écouteur Firestore —
 * même principe que le reste de l'appli, cf. ui-materiel.js/affichage
 * optimiste), et le nombre de groupes migrés (0 si déjà fait).
 * @param {object} lot
 * @param {Array} prelevements  liste complète (lots.getPrelevements())
 */
export async function migrerLot(lot, prelevements) {
  const groupes = periodesLot(lot.id, prelevements).filter((g) => !dejaMigre(lot, g.groupeId));
  if (!groupes.length) return { lot, n: 0 };

  const nouvelles = groupes.map((g) => ({
    id: idAffectation(),
    composants: composantsDuGroupe(g),
    nbBrebis: Number(g.nbBrebis) || 0,
    dateDebut: g.debut,
    dateFin: g.fin || null,
    migreDePrelevement: g.groupeId,
    creeLe: new Date().toISOString()
  }));

  const affectations = affectationsLot(lot).concat(nouvelles);
  await updateDoc(doc(db, 'lots_animaux', lot.id), { affectations, majLe: serverTimestamp() });
  return { lot: { ...lot, affectations }, n: nouvelles.length };
}

/**
 * Migre tous les lots. Idempotent : ne touche que ce qui n'a pas encore de
 * distribution portant ce migreDePrelevement.
 * @returns {Promise<{lotsTouches:number, groupesMigres:number, lotsApres:Array}>}
 *   lotsApres : les MÊMES lots, avec leurs affectations telles qu'après la
 *   migration — à utiliser pour un recalcul immédiat (avant/après), sans
 *   attendre l'aller-retour Firestore.
 */
export async function migrerTousLesLots(lots, prelevements) {
  let lotsTouches = 0;
  let groupesMigres = 0;
  const lotsApres = [];
  for (const lot of lots || []) {
    const { lot: lotMaj, n } = await migrerLot(lot, prelevements);
    lotsApres.push(lotMaj);
    if (n > 0) { lotsTouches++; groupesMigres += n; }
  }
  return { lotsTouches, groupesMigres, lotsApres };
}
