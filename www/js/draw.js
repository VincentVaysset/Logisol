// Dessin d'un polygone à la main (Leaflet.draw) + calcul automatique de la
// surface géodésique en hectares à la fermeture du polygone.
import { getMap, latLngsToGeoJsonPolygon } from './map.js';

let drawnLayer = null;
let polygonDrawer = null;
let onPolygonReady = () => {};

function logDebug(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

// Log détaillé (message + début de stack) dans le bandeau de debug, pour ne
// pas dépendre uniquement de window.onerror sur ces handlers précis — utile
// en particulier si l'erreur réelle provient du code interne de
// Leaflet/Leaflet.draw (scripts chargés depuis un CDN cross-origin) : sans
// l'attribut crossorigin sur la balise <script>, le navigateur remplace le
// vrai message par "Script error." par sécurité (voir index.html).
function logError(context, err) {
  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? ' | stack: ' + String(err.stack).split('\n').slice(0, 3).join(' > ') : '';
  logDebug('Erreur dessin (' + context + ') : ' + message + stack);
}

export function initDraw(opts = {}) {
  const map = getMap();
  onPolygonReady = opts.onPolygonReady || (() => {});

  polygonDrawer = new L.Draw.Polygon(map, {
    shapeOptions: { color: '#3c7a4e', weight: 3 },
    showArea: false,
    allowIntersection: false
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    try {
      discardDrawnLayer();
      drawnLayer = e.layer;
      drawnLayer.addTo(map);
      const rings = drawnLayer.getLatLngs();
      const geometry = latLngsToGeoJsonPolygon(rings);
      const surfaceHa = computeAreaHa(rings[0]);
      onPolygonReady({ geometry, surfaceHa });
    } catch (err) {
      logError('draw:created', err);
    }
  });
}

export function startDrawing() {
  try {
    discardDrawnLayer();
    polygonDrawer.enable();
  } catch (err) {
    logError('startDrawing', err);
  }
}

export function cancelDrawing() {
  try {
    polygonDrawer.disable();
  } catch (err) {
    logError('cancelDrawing', err);
  }
}

// Retire le tracé temporaire de la carte (annulation ou après enregistrement,
// la version définitive étant ensuite rendue depuis Firestore par map.js).
export function discardDrawnLayer() {
  try {
    if (drawnLayer) {
      getMap().removeLayer(drawnLayer);
      drawnLayer = null;
    }
  } catch (err) {
    logError('discardDrawnLayer', err);
  }
}

function computeAreaHa(latlngs) {
  try {
    const m2 = L.GeometryUtil.geodesicArea(latlngs);
    return Math.round((m2 / 10000) * 100) / 100;
  } catch (err) {
    logError('computeAreaHa', err);
    return 0;
  }
}
