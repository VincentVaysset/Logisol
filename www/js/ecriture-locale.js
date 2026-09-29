// Firestore ne résout une écriture (setDoc/updateDoc/deleteDoc) qu'à l'accusé
// du SERVEUR. Hors couverture, cet accusé n'arrive qu'au retour du réseau :
// tout `await` enchaîné derrière reste suspendu en mémoire et meurt avec
// l'appli si on la ferme — les écritures suivantes ne sont jamais faites
// (reproduit : Semis perdu au redémarrage, son implantation gardée).
// L'écriture elle-même est en file dans IndexedDB dès l'appel et partira
// seule au retour du réseau.
//
// ecrire() n'attend donc que la file LOCALE : getDocFromCache passe par la
// même file interne du SDK que l'écriture, derrière elle, et ne répond qu'une
// fois celle-ci inscrite dans le cache persistant. Un refus serveur (règles,
// document > 1 Mio...) arrive plus tard : il est signalé, jamais avalé.
//
// Les écritures d'activités et d'implantations sont en plus tracées dans le
// journal persistant (Diagnostic > Outils) : tentative, inscription locale,
// confirmation ou refus du serveur.
import { getDocFromCache } from '../vendor/firebase/firebase-firestore.js';
import { toastErreur } from './toast.js';
import { journaliser } from './journal-ecritures.js';

const TRACEES = ['interventions', 'implantations'];

export async function ecrire(ref, ecriture, libelle, detail = '') {
  const coll = ref.parent ? ref.parent.id : '';
  const trace = TRACEES.includes(coll);
  const infos = { coll, id: ref.id, detail: detail || libelle };
  if (trace) journaliser('tentative', infos);
  ecriture.then(
    () => { if (trace) journaliser('confirmé par le serveur', infos); },
    (err) => {
      const code = err && err.code ? err.code + ' — ' : '';
      const msg = `${libelle} refusé(e) par le serveur : ${code}${(err && err.message) || err}`;
      if (trace) journaliser('REFUSÉ par le serveur', { ...infos, erreur: code + ((err && err.message) || err) });
      if (window.__logisolDebug) window.__logisolDebug(msg);
      toastErreur(msg);
    }
  );
  try { await getDocFromCache(ref); } catch (_) { /* absent du cache (suppression) : la barrière a joué */ }
  if (trace) {
    journaliser(window.__logisolCacheMemoire
      ? 'en MÉMOIRE seulement (perdu à la fermeture)'
      : 'enregistré sur le téléphone', infos);
  }
}
