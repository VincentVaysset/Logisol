// Vue GPS pendant un tracé de chantier : « Nord en haut » / « Cap en haut »
// (comme un GPS de voiture), suivi automatique et bouton « Recentrer ».
//
// - Rotation : leaflet-rotate (vendor/), pilotée UNIQUEMENT par le cap GPS
//   (cap-calc.js) ; jamais au doigt, jamais par la boussole (cf. map.js).
// - Suivi : en « Cap en haut », le tracteur est placé au tiers bas de l'écran
//   pour voir loin devant ; en « Nord en haut », au centre. Déplacer la carte
//   au doigt met le suivi en pause et fait apparaître « Recentrer ». Zoomer ne
//   le met pas en pause.
// - Écran maintenu allumé (Wake Lock) tant que la vue GPS est ouverte.
// Le tracé (ruban à la largeur de l'outil) est dessiné par
// trace-intervention.js, inchangé.
import { getMap } from './map.js';
import { creerSuiviCap } from './cap-calc.js';
import { garderEcranAllume, libererEcran } from './gps.js';

const CLE_ORIENTATION = 'logisol.vueGps.orientation';

let controle = null;
let btnOrientation = null;
let btnRecentrer = null;
let actif = false;
let suivi = true;
let orientation = lireOrientation();   // 'nord' | 'cap'
let suiviCap = null;
let dernierFix = null;

function lireOrientation() {
  try { return localStorage.getItem(CLE_ORIENTATION) === 'cap' ? 'cap' : 'nord'; } catch (_) { return 'nord'; }
}
function ecrireOrientation(v) {
  try { localStorage.setItem(CLE_ORIENTATION, v); } catch (_) { /* préférence locale seulement */ }
}

function majBoutons() {
  if (!btnOrientation) return;
  // Le bouton dit ce qui est affiché, et bascule vers l'autre vue.
  btnOrientation.textContent = orientation === 'cap' ? '⬆️ Cap en haut' : '🧭 Nord en haut';
  btnOrientation.setAttribute('aria-pressed', orientation === 'cap' ? 'true' : 'false');
  btnRecentrer.hidden = suivi;
}

function creerControle(map) {
  const Ctrl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'vue-gps-ctrl');
      btnOrientation = L.DomUtil.create('button', 'vue-gps-btn', div);
      btnOrientation.type = 'button';
      btnOrientation.id = 'btn-gps-orientation';
      btnRecentrer = L.DomUtil.create('button', 'vue-gps-btn vue-gps-recentrer', div);
      btnRecentrer.type = 'button';
      btnRecentrer.id = 'btn-gps-recentrer';
      btnRecentrer.textContent = '🎯 Recentrer';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(btnOrientation, 'click', basculerOrientation);
      L.DomEvent.on(btnRecentrer, 'click', recentrer);
      majBoutons();
      return div;
    }
  });
  return new Ctrl().addTo(map);
}

function surDeplacementManuel() {
  if (!actif || !suivi) return;
  suivi = false;
  majBoutons();
}

function appliquerCap() {
  const map = getMap();
  if (!map || typeof map.setBearing !== 'function') return;
  const cap = suiviCap ? suiviCap.cap() : null;
  // leaflet-rotate : bearing = rotation de la carte dans le sens horaire ;
  // pour que le cap pointe vers le haut, on tourne la carte de -cap.
  map.setBearing(orientation === 'cap' && cap != null ? 360 - cap : 0);
}

function centrerSur(fix, animer) {
  const map = getMap();
  if (!map || !fix) return;
  const taille = map.getSize();
  const cible = L.point(taille.x / 2, orientation === 'cap' ? (taille.y * 2) / 3 : taille.y / 2);
  const actuel = map.latLngToContainerPoint([fix.lat, fix.lon]);
  const decalage = actuel.subtract(cible);
  if (Math.abs(decalage.x) < 1 && Math.abs(decalage.y) < 1) return;
  const centre = L.point(taille.x / 2, taille.y / 2).add(decalage);
  map.panTo(map.containerPointToLatLng(centre), { animate: !!animer, duration: 0.4, noMoveStart: true });
}

function basculerOrientation() {
  orientation = orientation === 'cap' ? 'nord' : 'cap';
  ecrireOrientation(orientation);
  majBoutons();
  appliquerCap();
  if (suivi) centrerSur(dernierFix, false);
}

function recentrer() {
  suivi = true;
  majBoutons();
  centrerSur(dernierFix, true);
}

/** Ouvre la vue GPS (appelé au démarrage d'un tracé). */
export function ouvrirVueGps() {
  const map = getMap();
  if (!map) return;
  if (!controle) {
    controle = creerControle(map);
    map.on('dragstart', surDeplacementManuel);
  }
  controle.getContainer().hidden = false;
  actif = true;
  suivi = true;
  suiviCap = creerSuiviCap();
  dernierFix = null;
  majBoutons();
  appliquerCap();
  garderEcranAllume();
}

/** Nouvelle position pendant le tracé. */
export function majVueGps(fix) {
  if (!actif || !fix) return;
  dernierFix = fix;
  suiviCap.maj(fix);
  appliquerCap();
  if (suivi) centrerSur(fix, true);
}

/** Ferme la vue GPS : carte remise nord en haut, écran libéré. */
export function fermerVueGps() {
  if (!actif) return;
  actif = false;
  if (controle) controle.getContainer().hidden = true;
  const map = getMap();
  if (map && typeof map.setBearing === 'function') map.setBearing(0);
  libererEcran();
}

export function etatVueGps() {
  const map = getMap();
  return { actif, suivi, orientation, cap: suiviCap ? suiviCap.cap() : null, bearing: map && map.getBearing ? map.getBearing() : 0 };
}
