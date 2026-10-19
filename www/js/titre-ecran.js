// Ligne 3 de l'en-tête : titre de l'écran courant, repris du libellé de
// l'onglet actif. Purement visuel : on observe la classe is-active posée par
// main.js/setView, sans rien changer à la navigation.
const tabs = document.getElementById('tabs');
const titre = document.getElementById('ch-titre-ecran');
function maj() {
  const actif = tabs && tabs.querySelector('.tab.is-active .tab-label');
  if (titre) titre.textContent = actif ? actif.textContent : '';
}
if (tabs && titre) {
  new MutationObserver(maj).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
  maj();
}
