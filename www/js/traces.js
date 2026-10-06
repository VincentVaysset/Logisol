// Historique des tracés de chantier : collection lgs_traces, JAMAIS dans le
// document de l'activité (limite de 1 Mio par document).
//
//   lgs_traces/{interventionId}        métadonnées (petit document) : parcelles,
//                                      type, date, largeur, nb de points...
//   lgs_traces/{interventionId}~{n}    morceau n des points, format compact
//                                      (trace-points-calc.js), ~25 000 points
//                                      maximum par morceau (< 800 Ko)
//
// Les points sont simplifiés à l'enregistrement (Douglas-Peucker 1 m). Les
// écritures passent par ecrire() : hors réseau, elles attendent dans la file
// locale de Firestore et partent seules au retour du réseau. La liste des
// tracés d'une parcelle ne lit que les métadonnées.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp
} from '../vendor/firebase/firebase-firestore.js';
import { ecrire } from './ecriture-locale.js';
import { simplifierTrace, encoderMorceaux, decoderMorceaux } from './trace-points-calc.js';

const COL = 'lgs_traces';
// Morceaux effacés d'office à la suppression / au remplacement : 10 morceaux
// = 250 000 points, des dizaines d'heures de tracé. Effacer un document qui
// n'existe pas est sans effet : aucune lecture préalable, donc rien à
// attendre hors réseau.
const MORCEAUX_MAX = 10;

const refMeta = (id) => doc(db, COL, id);
const refMorceau = (id, n) => doc(db, COL, `${id}~${n}`);

/**
 * Enregistre (ou remplace) le tracé d'une activité.
 * @param {string} interventionId
 * @param {{points:Array<{lat,lon,t}>, coupures?:number[], parcelleIds?:string[], typeId?, typeNom?, couleur?, date?, largeurM?, materielId?, distanceM?, surfaceHa?}} trace
 */
export async function enregistrerTrace(interventionId, trace) {
  if (!interventionId || !trace || !Array.isArray(trace.points) || trace.points.length < 2) return null;
  const { points, coupures } = simplifierTrace(trace.points, trace.coupures || [], 1);
  const debut = points[0].t;
  const morceaux = encoderMorceaux(points, debut);
  const batch = writeBatch(db);
  batch.set(refMeta(interventionId), {
    interventionId,
    parcelleIds: Array.isArray(trace.parcelleIds) ? trace.parcelleIds.slice() : [],
    typeId: trace.typeId || null,
    typeNom: trace.typeNom || '',
    couleur: trace.couleur || '',
    date: trace.date || '',
    largeurM: Number(trace.largeurM) > 0 ? Number(trace.largeurM) : null,
    materielId: trace.materielId || null,
    distanceM: trace.distanceM != null ? Number(trace.distanceM) : null,
    surfaceHa: trace.surfaceHa != null ? Number(trace.surfaceHa) : null,
    debut,
    fin: points[points.length - 1].t,
    nbPoints: points.length,
    nbPointsEnregistres: trace.points.length,
    nbMorceaux: morceaux.length,
    coupures,
    source: 'GPS_TELEPHONE',
    majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
  morceaux.forEach((m, n) => batch.set(refMorceau(interventionId, n), { traceDe: interventionId, morceau: n, ...m }));
  for (let n = morceaux.length; n < MORCEAUX_MAX; n++) batch.delete(refMorceau(interventionId, n));
  await ecrire(refMeta(interventionId), batch.commit(), 'Tracé', `${points.length} points`);
  return { nbPoints: points.length, nbMorceaux: morceaux.length };
}

/** Tracé complet d'une activité : { meta, points, coupures } ou null. */
export async function lireTrace(interventionId) {
  const meta = await getDoc(refMeta(interventionId));
  if (!meta.exists()) return null;
  const m = meta.data();
  const docs = await Promise.all(Array.from({ length: m.nbMorceaux || 0 }, (_, n) => getDoc(refMorceau(interventionId, n))));
  const morceaux = docs.filter((d) => d.exists()).map((d) => d.data()).sort((a, b) => a.morceau - b.morceau);
  return { meta: m, points: decoderMorceaux(morceaux, m.debut), coupures: m.coupures || [] };
}

/** Métadonnées des tracés d'une parcelle (sans les points). */
export async function tracesDeParcelle(parcelleId) {
  const snap = await getDocs(query(collection(db, COL), where('parcelleIds', 'array-contains', parcelleId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Supprime le tracé d'une activité (métadonnées + tous ses morceaux). */
export async function supprimerTrace(interventionId) {
  if (!interventionId) return;
  const batch = writeBatch(db);
  batch.delete(refMeta(interventionId));
  for (let n = 0; n < MORCEAUX_MAX; n++) batch.delete(refMorceau(interventionId, n));
  await ecrire(refMeta(interventionId), batch.commit(), 'Suppression du tracé');
}
