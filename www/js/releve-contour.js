// Relevé de contour au GPS/RTK — trace un polygone en marchant/roulant la
// limite d'une parcelle plutôt qu'en la dessinant au doigt sur l'ortho (voir
// draw.js pour ce second mode, toujours disponible par ailleurs). S'appuie
// sur gps.js (GpsService) pour la position et sur la même carte Leaflet que
// le reste de l'appli (map.js/getMap()).
//
// Chaque sommet posé garde le "fix" complet qui l'a produit ({accuracy,
// fixType, horodatage}) — c'est de là que releveGps.js (au sens : le champ
// releveGps attaché à la parcelle, cf. gps.js/releveGpsDepuisFix) tire sa
// valeur : la PIRE précision rencontrée sur l'ensemble du tracé, jamais la
// meilleure — un relevé n'est fiable qu'à hauteur de son pire point, pas de
// son meilleur.
import { getMap, latLngsToGeoJsonPolygon } from './map.js';
import { ecouterPositionNative, arreterEcoutePositionNative, releveGpsDepuisFix } from './gps.js';

let points = []; // [{lat, lon, accuracy, fixType, horodatage}]
let watchHandle = null;
let modeAuto = false;
let seuilAutoM = 2;
let onStateChange = () => {};
let onCurseurChange = () => {};
let dernierFixConnu = null;

// --- Rendu carte -------------------------------------------------------------
let polygonLayer = null;
let sommetsLayer = null;
let curseurMarker = null;

function assurerLayers() {
  const map = getMap();
  if (!map) return null;
  if (!polygonLayer) {
    polygonLayer = L.polygon([], { color: '#2563eb', weight: 3, fillOpacity: 0.15, dashArray: '4, 6' }).addTo(map);
  }
  if (!sommetsLayer) {
    sommetsLayer = L.layerGroup().addTo(map);
  }
  return map;
}

function redessiner() {
  const map = assurerLayers();
  if (!map) return;
  const latlngs = points.map((p) => [p.lat, p.lon]);
  polygonLayer.setLatLngs(latlngs);
  sommetsLayer.clearLayers();
  points.forEach((p, i) => {
    L.circleMarker([p.lat, p.lon], {
      radius: 7, color: '#1d4ed8', weight: 2, fillColor: '#fff', fillOpacity: 1
    }).bindTooltip(String(i + 1), { permanent: true, direction: 'top', className: 'releve-sommet-label' })
      .addTo(sommetsLayer);
  });
}

function afficherCurseur(fix) {
  const map = assurerLayers();
  if (!map) return;
  const style = fix.fixType === 'RTK_FIX' ? '#059669' : (fix.fixType === 'RTK_FLOAT' ? '#e0a326' : '#94a3b8');
  if (curseurMarker) {
    curseurMarker.setLatLng([fix.lat, fix.lon]);
    curseurMarker.setStyle({ color: style });
  } else {
    curseurMarker = L.circleMarker([fix.lat, fix.lon], {
      radius: 9, color: style, weight: 3, fillColor: style, fillOpacity: 0.35
    }).addTo(map);
  }
}

// --- Calcul de surface --------------------------------------------------------
function surfaceHaCourante() {
  if (points.length < 3) return null;
  try {
    const latlngs = points.map((p) => L.latLng(p.lat, p.lon));
    const m2 = L.GeometryUtil.geodesicArea(latlngs);
    return Math.round((m2 / 10000) * 100) / 100;
  } catch (err) {
    return null;
  }
}

function notifier() {
  try {
    onStateChange({
      actif: watchHandle != null,
      nbPoints: points.length,
      surfaceHa: surfaceHaCourante(),
      modeAuto,
      seuilAutoM
    });
  } catch (err) { /* jamais bloquant */ }
}

// --- Cycle de vie --------------------------------------------------------------
export function isActif() {
  return watchHandle != null;
}

export function initReleveContour(opts = {}) {
  onStateChange = opts.onStateChange || (() => {});
  onCurseurChange = opts.onCurseurChange || (() => {});
}

export function demarrerReleve() {
  if (watchHandle != null) return;
  points = [];
  dernierFixConnu = null;
  assurerLayers();
  redessiner();
  watchHandle = ecouterPositionNative((fix) => {
    dernierFixConnu = fix;
    afficherCurseur(fix);
    try { onCurseurChange(fix); } catch (err) { /* jamais bloquant */ }
    if (modeAuto) considererAjoutAuto(fix);
  }, {
    onError: () => { /* le badge/le bandeau d'aide restent la source d'info visible, pas d'alerte bloquante ici */ }
  });
  notifier();
}

export function arreterReleve() {
  arreterEcoutePositionNative(watchHandle);
  watchHandle = null;
  dernierFixConnu = null;
  if (polygonLayer) { polygonLayer.remove(); polygonLayer = null; }
  if (sommetsLayer) { sommetsLayer.remove(); sommetsLayer = null; }
  if (curseurMarker) { curseurMarker.remove(); curseurMarker = null; }
  points = [];
  notifier();
}

function considererAjoutAuto(fix) {
  if (!points.length) { ajouterPoint(fix); return; }
  const dernier = points[points.length - 1];
  const distance = L.latLng(dernier.lat, dernier.lon).distanceTo(L.latLng(fix.lat, fix.lon));
  if (distance >= seuilAutoM) ajouterPoint(fix);
}

function ajouterPoint(fix) {
  points.push({ lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, fixType: fix.fixType, horodatage: fix.horodatage });
  redessiner();
  notifier();
}

// Bouton "Ajouter un point" (mode manuel) : pose le sommet au niveau du
// dernier fix GPS connu (le curseur affiché sur la carte), jamais à
// l'endroit où l'utilisateur a tapé sur l'écran — le doigt n'est pas le
// relevé, seule l'antenne/le GPS l'est.
export function ajouterPointManuel() {
  if (!dernierFixConnu) return false;
  ajouterPoint(dernierFixConnu);
  return true;
}

export function annulerDernierPoint() {
  if (!points.length) return false;
  points.pop();
  redessiner();
  notifier();
  return true;
}

export function reinitialiserPoints() {
  points = [];
  redessiner();
  notifier();
}

export function activerModeAuto(actif) {
  modeAuto = !!actif;
  notifier();
}

export function definirSeuilAutoM(metres) {
  const v = Number(metres);
  if (Number.isFinite(v) && v > 0) seuilAutoM = v;
  notifier();
}

export function nbPoints() {
  return points.length;
}

// Un point d'accuracy inconnue (null) est traité comme PIRE que n'importe
// quelle précision connue — on ne sait rien de lui, ce n'est jamais un point
// à ignorer par optimisme. Une fois qu'un point inconnu a pris la place de
// "pire", plus rien ne peut l'en déloger (un connu, même très imprécis,
// reste toujours plus informatif qu'un inconnu).
function estPire(candidat, actuel) {
  if (actuel.accuracy == null) return false;
  if (candidat.accuracy == null) return true;
  return candidat.accuracy > actuel.accuracy;
}

/**
 * Résultat exploitable une fois le relevé terminé (geometry GeoJSON,
 * surface, et releveGps = pire précision/fixType rencontrés sur le tracé) —
 * null tant qu'il manque des points. Rien n'est écrit dans Firestore ici :
 * à l'appelant (ui-releve.js) de choisir la destination (nouvelle parcelle
 * via openCreate, ou mise à jour d'une parcelle existante).
 */
export function getResultat() {
  if (points.length < 3) return null;
  const geometry = latLngsToGeoJsonPolygon([points.map((p) => L.latLng(p.lat, p.lon))]);
  const pire = points.reduce((pire, c) => (estPire(c, pire) ? c : pire));
  return {
    geometry,
    surfaceHa: surfaceHaCourante(),
    releveGps: releveGpsDepuisFix(pire)
  };
}
