// En-tête (maquette .hd) : titre de l'écran (h1) et campagne de la ligne 2,
// repris de l'onglet actif. Purement visuel : on observe la classe is-active
// posée par main.js/setView, sans rien changer à la navigation.
import { campagneEnCours } from './calendrier-campagne.js';

const TITRES = {
  ferme: 'Ma ferme', carte: 'Carte SIG / RPG', liste: 'Assolement',
  stocks: 'Stocks & coupes', troupeau: 'Troupeau', batiments: 'Bâtiments & séchoir'
};
const tabs = document.getElementById('tabs');
const titre = document.getElementById('ch-titre-ecran');
const campagne = document.getElementById('ch-campagne-texte');
const select = document.getElementById('campagne-stock-select');
function maj() {
  const actif = tabs && tabs.querySelector('.tab.is-active');
  if (titre) titre.textContent = actif ? (TITRES[actif.dataset.vue] || actif.textContent.trim()) : '';
  // Hors Stocks / Troupeau, la campagne culturale (calendrier 01/09) en texte.
  if (campagne) campagne.textContent = select && !select.hidden ? '' : `Campagne ${campagneEnCours()}`;
}
if (tabs && titre) {
  new MutationObserver(maj).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
  if (select) new MutationObserver(maj).observe(select, { attributes: true, attributeFilter: ['hidden'] });
  maj();
}
