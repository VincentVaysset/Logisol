// Traçage GPS en direct d'un chantier (bande de passage) — colorie la
// surface réellement couverte par l'outil pendant une fauche, un épandage,
// un déchaumage... S'appuie sur GpsService (gps.js) comme releve-contour.js,
// mais construit un RUBAN de largeur L (celle du matériel choisi) le long du
// trajet plutôt qu'un contour fermé, et calcule la surface UNIQUE couverte
// (chevauchements/doublons jamais comptés deux fois).
//
// RÉTROCOMPATIBILITÉ (largeur inconnue)
// Un matériel sans largeurTravailMetres renseignée ne permet aucun calcul de
// surface (un ruban de largeur 0 n'a pas d'aire) : le tracé retombe alors sur
// une simple polyligne filaire, sans le moindre calcul d'aire — jamais une
// valeur inventée.
//
// MÉTHODE DE CALCUL DE SURFACE (grille, pas un polygone unique)
// Fusionner exactement des centaines de quadrilatères qui se chevauchent
// (vraie union polygonale) demanderait une bibliothèque de géométrie
// dédiée, absente du projet (aucune dépendance de plus pour ça). On
// rasterise à la place chaque quadrilatère sur une grille de cellules de
// 0,5 m de côté, dans le plan Web Mercator (mètres, via L.CRS.EPSG3857,
// négligeable comme déformation à l'échelle d'un chantier) : chaque cellule
// couverte est ajoutée à un Set commun, qui ne peut donc jamais compter deux
// fois la même surface au sol quel que soit le nombre de passages qui s'y
// superposent. Surface = nombre de cellules déjà vues × 0,25 m².
import { getMap } from './map.js';
import { ecouterPositionNative, arreterEcoutePositionNative } from './gps.js';

const TAILLE_CELLULE_M = 0.5;
const AIRE_CELLULE_M2 = TAILLE_CELLULE_M * TAILLE_CELLULE_M;
const DISTANCE_MIN_SEGMENT_M = 0.3; // filtre le bruit GPS à l'arrêt

let watchHandle = null;
let largeurM = 0; // 0/null -> mode filaire, pas de calcul de surface
let dernierPointMercator = null; // {x, y} en mètres, dernier point RETENU (segment précédent)
let distanceTotaleM = 0;
let cellulesCouvertes = new Set();
let debutTraceMs = null; // Date.now() au démarrage — sert à calculer la durée pour getResultat()
let onStateChange = () => {};
let onCurseurChange = () => {};

// --- Rendu carte -------------------------------------------------------------
let rubanLayer = null;   // L.layerGroup des quadrilatères déjà tracés (mode largeur)
let filLayer = null;     // L.polyline (mode filaire, sans largeur)
let curseurMarker = null;

function assurerLayers() {
  const map = getMap();
  if (!map) return null;
  if (!rubanLayer) rubanLayer = L.layerGroup().addTo(map);
  if (!filLayer) filLayer = L.polyline([], { color: '#16a34a', weight: 4 }).addTo(map);
  return map;
}

function afficherCurseur(fix) {
  const map = assurerLayers();
  if (!map) return;
  if (curseurMarker) {
    curseurMarker.setLatLng([fix.lat, fix.lon]);
  } else {
    curseurMarker = L.circleMarker([fix.lat, fix.lon], {
      radius: 8, color: '#16a34a', weight: 3, fillColor: '#16a34a', fillOpacity: 0.4
    }).addTo(map);
  }
}

// Point en mètres (projection Web Mercator, indépendante du zoom) -> {x,y}.
function versMercator(lat, lon) {
  return L.CRS.EPSG3857.project(L.latLng(lat, lon));
}
function depuisMercator(pt) {
  const ll = L.CRS.EPSG3857.unproject(L.point(pt.x, pt.y));
  return [ll.lat, ll.lng];
}

/**
 * Ajoute un segment [a -> b] (mètres) au tracé : dessine le quadrilatère du
 * ruban (si largeurM > 0) et marque les cellules de grille qu'il couvre.
 */
function ajouterSegmentRuban(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < DISTANCE_MIN_SEGMENT_M) return;
  distanceTotaleM += segLen;

  if (!largeurM) {
    filLayer.addLatLng(depuisMercator(b));
    return;
  }

  const ux = dx / segLen, uy = dy / segLen;   // vecteur unitaire le long du trajet
  const px = -uy, py = ux;                     // perpendiculaire (largeur du ruban)
  const demi = largeurM / 2;

  // Quadrilatère du ruban, pour l'affichage uniquement.
  const coin = (pt, signe) => depuisMercator({ x: pt.x + signe * px * demi, y: pt.y + signe * py * demi });
  const quad = [coin(a, 1), coin(b, 1), coin(b, -1), coin(a, -1)];
  L.polygon(quad, { color: '#16a34a', weight: 0, fillColor: '#22c55e', fillOpacity: 0.35 }).addTo(rubanLayer);

  // Rasterisation : la boîte englobante du quadrilatère en mètres, testée
  // cellule par cellule en coordonnées locales (long du trajet / travers) —
  // un simple rectangle dans ce repère, pas besoin d'un test point-dans-
  // polygone général.
  const xmin = Math.min(a.x, b.x) - Math.abs(px) * demi;
  const xmax = Math.max(a.x, b.x) + Math.abs(px) * demi;
  const ymin = Math.min(a.y, b.y) - Math.abs(py) * demi;
  const ymax = Math.max(a.y, b.y) + Math.abs(py) * demi;
  const ix0 = Math.floor(xmin / TAILLE_CELLULE_M), ix1 = Math.ceil(xmax / TAILLE_CELLULE_M);
  const iy0 = Math.floor(ymin / TAILLE_CELLULE_M), iy1 = Math.ceil(ymax / TAILLE_CELLULE_M);

  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      const cx = (ix + 0.5) * TAILLE_CELLULE_M;
      const cy = (iy + 0.5) * TAILLE_CELLULE_M;
      const s = (cx - a.x) * ux + (cy - a.y) * uy; // position le long du trajet
      const t = (cx - a.x) * px + (cy - a.y) * py; // position en travers
      if (s >= 0 && s <= segLen && t >= -demi && t <= demi) {
        cellulesCouvertes.add(ix + ',' + iy);
      }
    }
  }
}

function surfaceHaCouverte() {
  if (!largeurM) return null;
  return Math.round((cellulesCouvertes.size * AIRE_CELLULE_M2 / 10000) * 1000) / 1000;
}

function notifier() {
  try {
    onStateChange({
      actif: watchHandle != null,
      distanceM: Math.round(distanceTotaleM),
      surfaceHa: surfaceHaCouverte(),
      dureeMin: debutTraceMs != null ? Math.round((Date.now() - debutTraceMs) / 60000) : 0,
      modeFilaire: !largeurM
    });
  } catch (err) { /* jamais bloquant */ }
}

export function initTraceIntervention(opts = {}) {
  onStateChange = opts.onStateChange || (() => {});
  onCurseurChange = opts.onCurseurChange || (() => {});
}

export function isActif() {
  return watchHandle != null;
}

/** largeurMetres : celle du matériel choisi, ou 0/null/undefined -> filaire. */
export function demarrerTrace(largeurMetres) {
  if (watchHandle != null) return;
  largeurM = Number(largeurMetres) > 0 ? Number(largeurMetres) : 0;
  distanceTotaleM = 0;
  cellulesCouvertes = new Set();
  dernierPointMercator = null;
  debutTraceMs = Date.now();
  assurerLayers();
  watchHandle = ecouterPositionNative((fix) => {
    afficherCurseur(fix);
    try { onCurseurChange(fix); } catch (err) { /* jamais bloquant */ }
    const pt = versMercator(fix.lat, fix.lon);
    if (dernierPointMercator) {
      ajouterSegmentRuban(dernierPointMercator, pt);
    } else {
      // Tout premier point du tracé : rien à relier, mais la polyligne filaire
      // doit déjà partir d'ici (pas seulement du 2e point) pour ne pas
      // afficher un tracé amputé de son tout début.
      filLayer.addLatLng([fix.lat, fix.lon]);
    }
    dernierPointMercator = pt;
    notifier();
  }, {
    onError: () => { /* le badge/bandeau restent la source d'info, pas d'alerte bloquante ici */ }
  });
  notifier();
}

/**
 * Change la largeur en cours de route (matériel changé pendant le
 * chantier) : s'applique aux PROCHAINS segments seulement — le ruban déjà
 * tracé garde la largeur réelle avec laquelle il a été parcouru.
 */
export function definirLargeur(largeurMetres) {
  largeurM = Number(largeurMetres) > 0 ? Number(largeurMetres) : 0;
  notifier();
}

export function arreterTrace() {
  arreterEcoutePositionNative(watchHandle);
  watchHandle = null;
  dernierPointMercator = null;
  debutTraceMs = null;
  if (rubanLayer) { rubanLayer.remove(); rubanLayer = null; }
  if (filLayer) { filLayer.remove(); filLayer = null; }
  if (curseurMarker) { curseurMarker.remove(); curseurMarker = null; }
  cellulesCouvertes = new Set();
  distanceTotaleM = 0;
  notifier();
}

/**
 * Résultat exploitable : surfaceHa (null en mode filaire, jamais une valeur
 * inventée) + distanceM/dureeHeures, à titre indicatif dans les deux modes —
 * dureeHeures vient du chrono interne (début du tracé -> maintenant), jamais
 * d'une heure de début/fin saisie à la main. À appeler AVANT arreterTrace()
 * (qui remet le chrono à zéro), cf. ui-trace-intervention.js.
 */
export function getResultat() {
  const dureeHeures = debutTraceMs != null
    ? Math.round(((Date.now() - debutTraceMs) / 3600000) * 100) / 100
    : null;
  return {
    surfaceHa: surfaceHaCouverte(),
    distanceM: Math.round(distanceTotaleM),
    dureeHeures,
    modeFilaire: !largeurM
  };
}
