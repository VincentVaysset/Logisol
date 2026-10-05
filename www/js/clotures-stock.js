// Stock au soir d'une date AVEC le stock de départ figé par la dernière
// clôture, et écritures de l'inventaire / de la clôture / de la réouverture.
//
// Stock de départ : une clôture enregistre l'instantané de chaque aliment au
// 31/08. Pour une date postérieure, stock = instantané + (journal au soir de
// la date − journal au 31/08). Tant que la campagne est clôturée, ses saisies
// sont verrouillées (verrou-campagne.js) et l'instantané vaut exactement le
// journal au 31/08 : le résultat est identique au calcul direct. Une fois
// réouverte, les corrections faites avant le 31/08 ne changent PAS le départ
// de la campagne suivante tant qu'elle n'est pas clôturée à nouveau (bandeau
// « … sera recalculé à la clôture ») — c'est la re-clôture qui le met à jour.
import { db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from '../vendor/firebase/firebase-firestore.js';
import { stockDisponibleCanonique } from './fourrages.js';
import { getMouvements, createMouvement } from './mouvements.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';
import { getLots } from './lots.js';
import { getClotures, COL_CLOTURES } from './verrou-campagne.js';
import { bornesCampagneStock } from './campagne-stock.js';
import { instantane } from './inventaire-calc.js';
import { ecrire } from './ecriture-locale.js';

function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }

function journalAuSoir(date) {
  return stockDisponibleCanonique(getMouvements(), getCellules(), getEmplacements(), getLots(), date);
}

/** Dernière clôture (avec instantané) dont le 31/08 précède strictement date. */
function departApplicable(date) {
  return getClotures()
    .filter((c) => Array.isArray(c.lignes) && c.lignes.length && bornesCampagneStock(c.id).fin < date)
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0] || null;
}

/**
 * Stock par aliment au soir d'une date — LA source de l'onglet Stocks, de
 * l'Inventaire et du « Stock restant » de Troupeau.
 * @returns {Array<{cle,label,tonnes}>}
 */
export function stockAuSoir(date) {
  const actuel = journalAuSoir(date);
  const depart = departApplicable(date);
  if (!depart) return actuel;
  const auFin = new Map(journalAuSoir(bornesCampagneStock(depart.id).fin).map((g) => [g.cle, g.tonnes]));
  const parCle = new Map();
  const ligne = (cle, label) => {
    if (!parCle.has(cle)) parCle.set(cle, { cle, label, tonnes: 0, bottes: 0 });
    return parCle.get(cle);
  };
  depart.lignes.forEach((l) => { ligne(l.cle, l.label).tonnes = arrondi3(l.tonnes); });
  actuel.forEach((g) => { const x = ligne(g.cle, g.label); x.tonnes = arrondi3(x.tonnes + g.tonnes); });
  auFin.forEach((t, cle) => { const x = ligne(cle, cle); x.tonnes = arrondi3(x.tonnes - t); });
  return Array.from(parCle.values()).sort((a, b) => b.tonnes - a.tonnes);
}

export function stockTheoriqueAu(cle, date) {
  const g = stockAuSoir(date).find((x) => x.cle === cle);
  return g ? g.tonnes : 0;
}

function dateFr(iso) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }

/**
 * Enregistre un inventaire : un AJUSTEMENT par écart, daté du comptage
 * (inventaire simple) ou du 31/08 (clôture) ; à la clôture, l'instantané au
 * 31/08 devient le stock de départ de la campagne suivante.
 * @param {{dateComptage:string, cloture:boolean, campagne:string|null,
 *          lignes:Array<{cle,label,calcul}>}} p
 */
export async function enregistrerInventaire({ dateComptage, cloture, campagne, lignes }) {
  const fin = cloture ? bornesCampagneStock(campagne).fin : null;
  const ajustementIds = [];
  for (const l of lignes) {
    if (!(Math.abs(l.calcul.ecart) >= 0.001)) continue;
    const ref = await createMouvement({
      date: cloture ? fin : dateComptage,
      typeMouvement: 'AJUSTEMENT', quantite: l.calcul.ecart, unite: 't',
      categorieCle: l.cle, categorieLabel: l.label,
      libelle: `Inventaire du ${dateFr(dateComptage)}` + (cloture ? ` — clôture ${campagne}` : '')
    });
    ajustementIds.push(ref.id);
  }
  if (cloture) {
    const ref = doc(db, COL_CLOTURES, campagne);
    const precedente = getClotures().find((c) => c.id === campagne);
    await ecrire(ref, setDoc(ref, {
      campagne, statut: 'cloturee', dateComptage,
      lignes: instantane(lignes),
      ajustementIds: ((precedente && precedente.ajustementIds) || []).concat(ajustementIds),
      clotureLe: serverTimestamp(), majLe: serverTimestamp()
    }, { merge: true }), 'Clôture de campagne', `clôture ${campagne}`);
  }
  return { nbAjustements: ajustementIds.length };
}

/** Réouvre une campagne clôturée : ses saisies redeviennent modifiables. */
export async function reouvrirCampagne(campagne) {
  const ref = doc(db, COL_CLOTURES, campagne);
  await ecrire(ref, setDoc(ref, { statut: 'reouverte', reouverteLe: serverTimestamp(), majLe: serverTimestamp() }, { merge: true }),
    'Réouverture de campagne', `réouverture ${campagne}`);
}
