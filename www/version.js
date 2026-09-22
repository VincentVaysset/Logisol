// Identité de la version installée.
//
// Après dix-neuf builds, rien sur la tablette ne permettait de savoir LEQUEL
// était installé. Un symptôme corrigé dans le code mais persistant sur
// l'appareil est alors indiscernable d'un correctif qui ne marche pas : on
// cherche des heures dans le code un problème déjà réglé, simplement pas
// encore installé.
//
// Ce fichier est RÉÉCRIT PAR LA CI avant `cap sync` (voir
// .github/workflows/build-android.yml). La valeur ci-dessous est celle d'un
// lancement en local, depuis les sources.
window.__LOGISOL_VERSION = {
  build: 'local',
  commit: 'dev',
  date: ''
};
