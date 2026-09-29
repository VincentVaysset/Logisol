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
import { getDocFromCache } from '../vendor/firebase/firebase-firestore.js';
import { toastErreur } from './toast.js';

export async function ecrire(ref, ecriture, libelle) {
  ecriture.catch((err) => {
    const msg = `${libelle} refusé(e) par le serveur : ` +
      `${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`;
    if (window.__logisolDebug) window.__logisolDebug(msg);
    toastErreur(msg);
  });
  try { await getDocFromCache(ref); } catch (_) { /* absent du cache (suppression) : la barrière a joué */ }
}
