// Projet Firebase propre à Logisol (séparation d'Ovilog, étape 3 : transfert des données).
// Identifiants PUBLICS d'une appli web Firebase, pas des secrets : seules les règles du
// projet (firestore-logisol-1e61b.rules, compte du propriétaire seulement) protègent les données.
export const NOM_NOUVEAU_PROJET = 'logisol-1e61b';
export const CONFIG_NOUVEAU_PROJET = {
  apiKey: 'AIzaSyB-rKzWgYNnWd-Ic_zTtiaQMNMW7E-TLQo',
  authDomain: 'logisol-1e61b.firebaseapp.com',
  projectId: 'logisol-1e61b',
  storageBucket: 'logisol-1e61b.firebasestorage.app',
  messagingSenderId: '169159967861',
  appId: '1:169159967861:web:570df9186274851446e43c'
};
// Émulateur local pour les vérifications seulement (scripts jetables) : toujours null dans l'appli.
export const EMULATEUR_TRANSFERT = null;
