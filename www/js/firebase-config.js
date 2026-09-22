// Config Firebase — MÊME projet que Ovilog (ovilog-15ef6), collections
// dédiées à Logisol uniquement. Ne jamais lire/écrire dans les collections
// d'Ovilog depuis ce fichier ou ailleurs dans Logisol.
//
// LIBRAIRIES EMBARQUÉES, PAS CHARGÉES DEPUIS UN CDN
// Le SDK Firebase (comme Leaflet) est servi depuis www/vendor/, donc empaqueté
// dans l'APK. Sans cela, l'appli ne démarrait tout simplement pas sans réseau :
// le premier import échouait avant la moindre ligne de code métier, et aucun
// cache hors-ligne n'y aurait changé quoi que ce soit.
import { initializeApp } from "../vendor/firebase/firebase-app.js";
import { getAuth } from "../vendor/firebase/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager
} from "../vendor/firebase/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDY_Z3Jqo92RAuJlYX5K4sZKTFmf-0P-h4",
  authDomain: "ovilog-15ef6.firebaseapp.com",
  projectId: "ovilog-15ef6",
  storageBucket: "ovilog-15ef6.firebasestorage.app",
  messagingSenderId: "861492569011",
  appId: "1:861492569011:web:67ade13ee7fdedff62a1c6"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// CACHE PERSISTANT (IndexedDB) — le mode hors-ligne côté données.
// Les documents déjà vus restent lisibles sans réseau, et les écritures
// faites hors couverture sont mises en file puis envoyées au retour du
// signal : onSnapshot répond immédiatement depuis le cache, si bien que
// l'interface se comporte pareil dans les deux cas. Indispensable en bout de
// parcelle, là où la 4G tombe.
//
// Si IndexedDB est indisponible (mode privé, stockage bloqué), on repart sans
// cache plutôt que d'empêcher l'appli de démarrer : mieux vaut une appli qui
// exige le réseau qu'une appli qui ne s'ouvre pas.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
  });
  if (window.__logisolDebug) window.__logisolDebug('Cache hors-ligne actif');
} catch (err) {
  firestore = initializeFirestore(app, {});
  if (window.__logisolDebug) {
    window.__logisolDebug('Cache hors-ligne indisponible : ' + ((err && err.message) || err));
  }
}
export const db = firestore;
