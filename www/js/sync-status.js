// Voyant de synchro du header : 🟢 dès qu'un aller-retour Firestore a
// réellement touché le serveur (pas seulement répondu depuis le cache
// IndexedDB local), 🟠 sinon.
//
// POURQUOI UN CANARI PLUTÔT QUE navigator.onLine SEUL
// navigator.onLine dit si l'appareil a une interface réseau active, pas si
// Firestore est joignable (portail captif, pare-feu, DNS cassé...) : un
// faux "🟢" serait pire qu'un vrai "🟠", puisque c'est justement le signal
// qui doit dire à Vincent s'il peut faire confiance à ce qu'il voit. On
// écoute donc en plus, avec includeMetadataChanges, les métadonnées du
// PREMIER flux de données déjà ouvert ailleurs (parcelles) : son
// snapshot.metadata.fromCache dit sans ambiguïté si la dernière réponse
// vient du serveur ou seulement du cache — exactement ce qu'il faut pour
// savoir si un nouvel appareil (tablette) a bien fini de rapatrier les
// données du téléphone, pas seulement lu un cache vide.
import { db } from './firebase-config.js';
import { collection, onSnapshot } from "../vendor/firebase/firebase-firestore.js";

let enLigne = typeof navigator !== 'undefined' ? navigator.onLine : true;
let confirmeParServeur = false; // true dès qu'un snapshot non-cache est arrivé
const listeners = new Set();

function etat() {
  return enLigne && confirmeParServeur ? 'synced' : 'offline';
}

function notifier() {
  const e = etat();
  listeners.forEach((cb) => cb(e));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { enLigne = true; notifier(); });
  window.addEventListener('offline', () => { enLigne = false; notifier(); });
}

export function initSyncStatus() {
  // 'parcelles' : déjà surveillée par ailleurs (parcelles.js/watchParcelles),
  // ce second listener ne coûte rien de plus côté réseau (mêmes documents,
  // déjà en cache local) et ne modifie aucun état applicatif — il ne fait
  // que lire les métadonnées du flux.
  onSnapshot(
    collection(db, 'parcelles'),
    { includeMetadataChanges: true },
    (snap) => {
      confirmeParServeur = !snap.metadata.fromCache;
      notifier();
    },
    () => {
      // Erreur de flux (règles, réseau...) : on ne sait plus, navigator.onLine
      // reste seul juge tant qu'un snapshot ne vient pas confirmer à nouveau.
      confirmeParServeur = false;
      notifier();
    }
  );
}

export function onSyncStatusChange(cb) {
  listeners.add(cb);
  cb(etat());
  return () => listeners.delete(cb);
}
