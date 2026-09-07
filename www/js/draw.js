// Dessin d'un polygone à la main (Leaflet.draw) + calcul automatique de la
// surface géodésique en hectares à la fermeture du polygone.
import { getMap, latLngsToGeoJsonPolygon } from './map.js';

let drawnLayer = null;
let polygonDrawer = null;
let onPolygonReady = () => {};
let dernierSommetAjouteA = 0;
const DELAI_ANNULATION_SOMMET_MS = 400;

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

// Patch du bug "un pincement à deux doigts ajoute des sommets au polygone".
//
// Source réelle (leaflet.draw-src.js 1.0.4, ligne 802) :
//   _onTouch: function (e) {
//     var originalEvent = e.originalEvent;
//     if (originalEvent.touches && originalEvent.touches[0] && ...) {
//       clientX = originalEvent.touches[0].clientX;   <-- prend le 1er doigt
//       ...  this._startPoint(...); this._endPoint(...);   <-- pose un sommet
//
// _onTouch est branché sur les événements 'touchstart' ET 'click' de la carte
// (lignes 595-596). Il ne teste QUE l'existence de touches[0], JAMAIS
// touches.length : le second doigt d'un pincement déclenche donc un nouveau
// _onTouch et pose un sommet parasite. Le garde ci-dessous ignore tout
// événement multi-touch, qui ne peut être qu'un geste de zoom, jamais une
// intention de poser un point.
function patchLeafletDrawTouch() {
  if (!window.L || !L.Draw || !L.Draw.Polyline || !L.Draw.Polyline.prototype._onTouch) {
    logDebug('Patch Leaflet.draw non appliqué (_onTouch introuvable)');
    return;
  }
  if (L.Draw.Polyline.prototype.__logisolTouchPatched) return;

  const original = L.Draw.Polyline.prototype._onTouch;
  L.Draw.Polyline.prototype._onTouch = function (e) {
    const oe = e && e.originalEvent;
    if (oe && oe.touches && oe.touches.length > 1) {
      logDebug('pincement détecté (' + oe.touches.length + ' doigts) : sommet ignoré');
      return;
    }
    return original.call(this, e);
  };
  L.Draw.Polyline.prototype.__logisolTouchPatched = true;
  logDebug('Patch Leaflet.draw _onTouch appliqué');
}

export function initDraw(opts = {}) {
  const map = getMap();
  onPolygonReady = opts.onPolygonReady || (() => {});

  patchLeafletDrawGuide();
  patchLeafletDrawTouch();

  polygonDrawer = new L.Draw.Polygon(map, {
    shapeOptions: { color: '#3c7a4e', weight: 3 },
    showArea: false,
    allowIntersection: false
  });

  // Le garde multi-touch ci-dessus n'attrape que le SECOND doigt : le premier
  // doigt d'un pincement arrive seul (touches.length === 1) et a donc déjà
  // posé un sommet avant que le geste ne soit reconnaissable comme un zoom.
  // On retire donc ce sommet a posteriori si un zoom démarre juste après
  // (fenêtre de 400 ms), en utilisant l'API deleteLastVertex() de la
  // librairie (ligne 637 de la source).
  map.on('zoomstart', () => {
    // enabled() : accesseur public de L.Handler (leaflet-src.js l.5931).
    if (!polygonDrawer || typeof polygonDrawer.enabled !== 'function' || !polygonDrawer.enabled()) return;
    const depuisDernierSommet = Date.now() - dernierSommetAjouteA;
    if (!dernierSommetAjouteA || depuisDernierSommet > DELAI_ANNULATION_SOMMET_MS) return;
    try {
      if (polygonDrawer._markers && polygonDrawer._markers.length > 0) {
        polygonDrawer.deleteLastVertex();
        // deleteLastVertex() repasse par _vertexChanged, qui refire DRAWVERTEX
        // (source l.748) : sans cette remise à zéro, un second zoomstart dans
        // la foulée supprimerait un sommet légitime.
        dernierSommetAjouteA = 0;
        logDebug('zoom démarré ' + depuisDernierSommet + 'ms après un sommet : sommet annulé');
      }
    } catch (err) {
      logError('annulation sommet au zoom', err);
    }
  });

  // Suit la pose de chaque sommet (événement officiel de la librairie).
  map.on(L.Draw.Event.DRAWVERTEX, () => {
    dernierSommetAjouteA = Date.now();
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    try {
      discardDrawnLayer();
      drawnLayer = e.layer;
      drawnLayer.addTo(map);
      const rings = drawnLayer.getLatLngs();
      const geometry = latLngsToGeoJsonPolygon(rings);
      const surfaceHa = computeAreaHa(rings[0]);
      reactiverDoubleClickZoom(); // le dessin est terminé
      onPolygonReady({ geometry, surfaceHa });
    } catch (err) {
      logError('draw:created', err);
    }
  });
}

export function startDrawing() {
  try {
    discardDrawnLayer();
    dernierSommetAjouteA = 0;
    // Leaflet.draw ne désactive JAMAIS doubleClickZoom (vérifié : 0 occurrence
    // dans toute sa source). Pendant le tracé, un double-tap zoomerait donc la
    // carte en plus de poser des sommets. On le coupe le temps du dessin ; le
    // pincement à deux doigts reste, lui, pleinement fonctionnel pour zoomer.
    const map = getMap();
    if (map && map.doubleClickZoom) map.doubleClickZoom.disable();
    polygonDrawer.enable();
  } catch (err) {
    logError('startDrawing', err);
  }
}

function reactiverDoubleClickZoom() {
  try {
    const map = getMap();
    if (map && map.doubleClickZoom) map.doubleClickZoom.enable();
  } catch (err) {
    logError('reactiverDoubleClickZoom', err);
  }
}

export function cancelDrawing() {
  try {
    polygonDrawer.disable();
    reactiverDoubleClickZoom();
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
