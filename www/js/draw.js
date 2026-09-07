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

// Patch d'un bug connu de Leaflet.draw 1.0.4 sur écran tactile.
//
// Source réelle (leaflet.draw-src.js 1.0.4, vérifiée depuis le paquet npm) :
//   ligne 722  _onZoomEnd: function () {
//   ligne 723      if (this._markers !== null) {
//   ligne 724          this._updateGuide();          <-- appelé SANS argument
//   ligne 876  _updateGuide: function (newPos) {
//   ligne 880      newPos = newPos || this._map.latLngToLayerPoint(this._currentLatLng);
//
// this._currentLatLng n'est renseigné QUE dans _onMouseMove (ligne 734). Sur
// une tablette/téléphone en tactile pur, _onMouseMove ne se déclenche jamais :
// _currentLatLng reste undefined. Or Leaflet.draw écoute 'zoomend' et
// 'zoomlevelschange' pendant tout le dessin — au moindre zoom, la ligne 880
// appelle donc latLngToLayerPoint(undefined), et c'est Leaflet lui-même qui
// lève "Cannot read properties of undefined (reading 'lat')" (d'où une pile
// d'appel qui pointe vers leaflet.js et non vers notre code).
//
// L'erreur ne concerne QUE la ligne de guidage élastique : ni addVertex()
// (ligne 662), ni _finishShape() (ligne 700), ni completeShape() (ligne 684)
// ne lisent _currentLatLng — la pose des points et la fermeture du polygone
// ne sont donc pas affectées. Le patch se contente de ne pas dessiner le
// guide quand la position courante est inconnue, au lieu de laisser Leaflet
// planter.
function patchLeafletDrawGuide() {
  if (!window.L || !L.Draw || !L.Draw.Polyline || !L.Draw.Polyline.prototype._updateGuide) {
    logDebug('Patch Leaflet.draw non appliqué (_updateGuide introuvable)');
    return;
  }
  if (L.Draw.Polyline.prototype.__logisolGuidePatched) return;

  const original = L.Draw.Polyline.prototype._updateGuide;
  L.Draw.Polyline.prototype._updateGuide = function (newPos) {
    // Cas fautif exact de la ligne 880 : pas de position fournie ET pas de
    // position courante connue -> on ne dessine simplement pas le guide.
    if (!newPos && !this._currentLatLng) return;
    try {
      return original.call(this, newPos);
    } catch (err) {
      logError('_updateGuide (Leaflet.draw)', err);
    }
  };
  L.Draw.Polyline.prototype.__logisolGuidePatched = true;
  logDebug('Patch Leaflet.draw _updateGuide appliqué');
}

export function initDraw(opts = {}) {
  const map = getMap();
  onPolygonReady = opts.onPolygonReady || (() => {});

  patchLeafletDrawGuide();

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
