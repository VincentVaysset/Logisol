// Dessin d'un polygone à la main (Leaflet.draw) + calcul automatique de la
// surface géodésique en hectares à la fermeture du polygone.
//
// Le flux est PILOTÉ PAR UNE BARRE D'OUTILS EXPLICITE (voir index.html,
// #draw-toolbar), pas par les gestes cachés de Leaflet.draw : au doigt, la
// fermeture "tape sur le premier point" et le double-clic sont trop peu
// fiables, et rien n'indiquait à l'utilisateur comment annuler ou terminer.
import { getMap, latLngsToGeoJsonPolygon } from './map.js';

let drawnLayer = null;
let polygonDrawer = null;
let onPolygonReady = () => {};
let onStateChange = () => {};
let dernierSommetAjouteA = 0;
let handlersCarteInstalles = false;
const DELAI_ANNULATION_SOMMET_MS = 400;

// Zoom minimum pour dessiner. En dessous, un écart de quelques pixels au doigt
// vaut plusieurs kilomètres sur le terrain : c'est ce qui produisait des
// "parcelles grandes comme la France" quand la carte s'ouvrait sur le pays
// entier. À z15, un pixel vaut environ 3 m — un tracé de parcelle a du sens.
export const ZOOM_MINI_DESSIN = 15;

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
// ne sont donc pas affectées.
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
// _onTouch ne teste QUE l'existence de touches[0], JAMAIS touches.length : le
// second doigt d'un pincement déclenche donc un nouveau _onTouch et pose un
// sommet parasite. Le garde ci-dessous ignore tout événement multi-touch, qui
// ne peut être qu'un geste de zoom, jamais une intention de poser un point.
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
}

// Le "tooltip d'erreur" de Leaflet.draw (_showErrorTooltip, ligne 762) est une
// petite bulle qui suit le curseur. Au doigt, il n'y a pas de curseur : la
// bulle reste invisible ou hors écran. C'est exactement ce qui transformait un
// refus de fermeture en CUL-DE-SAC SILENCIEUX (le tracé restait à l'écran,
// rien ne se passait, aucune explication). On remonte donc le motif dans le
// bandeau de diagnostic.
function patchLeafletDrawErrorTooltip() {
  if (!window.L || !L.Draw || !L.Draw.Polyline || !L.Draw.Polyline.prototype._showErrorTooltip) return;
  if (L.Draw.Polyline.prototype.__logisolErrPatched) return;

  const original = L.Draw.Polyline.prototype._showErrorTooltip;
  L.Draw.Polyline.prototype._showErrorTooltip = function () {
    const n = (this._markers && this._markers.length) || 0;
    logDebug(n < 3
      ? 'Fermeture refusée : ' + n + ' point(s) posé(s), il en faut au moins 3'
      : 'Fermeture refusée par Leaflet.draw — utilise ↩ puis ✅ Terminer');
    try {
      return original.call(this);
    } catch (err) {
      logError('_showErrorTooltip', err);
    }
  };
  L.Draw.Polyline.prototype.__logisolErrPatched = true;
}

// Supprime la fermeture automatique du polygone au DOUBLE-CLIC.
//
// Source réelle (leaflet.draw-src.js 1.0.4, _updateFinishHandler l.1124) :
//   if (markerCount === 1) { this._markers[0].on('click', this._finishShape); }
//   if (markerCount > 2)   { this._markers[markerCount-1].on('dblclick', this._finishShape); }
//
// La 2e règle est pensée pour une souris. Au doigt, deux appuis rapprochés
// (ce qui arrive sans cesse quand on longe un bord de champ en posant des
// points) sont interprétés par Leaflet comme un double-tap : le tracé se
// FERMAIT tout seul, en plein milieu, sans que rien ne l'annonce.
// Reproduit en test : 4 points posés à 150 ms d'intervalle -> tracé fermé
// d'office au 4e. On ne garde donc QUE la fermeture explicite :
//   * appui sur le tout premier point (règle 1, conservée), ou
//   * bouton ✅ Terminer de la barre d'outils.
function patchLeafletDrawNoDblclickFinish() {
  if (!window.L || !L.Draw || !L.Draw.Polygon || !L.Draw.Polygon.prototype._updateFinishHandler) return;
  if (L.Draw.Polygon.prototype.__logisolNoDblFinish) return;

  L.Draw.Polygon.prototype._updateFinishHandler = function () {
    if (this._markers.length === 1) {
      this._markers[0].on('click', this._finishShape, this);
    }
  };
  L.Draw.Polygon.prototype.__logisolNoDblFinish = true;
}

// Les bulles d'aide de Leaflet.draw sont en anglais par défaut
// ("Click to start drawing shape", "Click first point to close this shape").
// L.drawLocal est le point d'extension prévu par la librairie pour cela.
function traduireLeafletDraw() {
  if (!window.L || !L.drawLocal || !L.drawLocal.draw) return;
  const h = L.drawLocal.draw.handlers;
  if (h && h.polygon && h.polygon.tooltip) {
    h.polygon.tooltip.start = 'Touche la carte pour poser le 1er coin';
    h.polygon.tooltip.cont = 'Touche la carte pour poser le coin suivant';
    h.polygon.tooltip.end = 'Touche le 1er point, ou ✅ Terminer';
  }
  if (h && h.polyline) {
    if (h.polyline.tooltip) h.polyline.tooltip.start = 'Touche la carte pour commencer';
    if (h.polyline.error) h.polyline.error = '<strong>Attention :</strong> le contour se croise';
  }
}

function appliquerPatches() {
  traduireLeafletDraw();
  patchLeafletDrawGuide();
  patchLeafletDrawTouch();
  patchLeafletDrawErrorTooltip();
  patchLeafletDrawNoDblclickFinish();
}

function notifierEtat() {
  try {
    onStateChange({ actif: isDrawing(), sommets: nbSommets() });
  } catch (err) {
    logError('notifierEtat', err);
  }
}

export function nbSommets() {
  if (!polygonDrawer || !polygonDrawer._markers) return 0;
  return polygonDrawer._markers.length;
}

export function isDrawing() {
  return !!(polygonDrawer && typeof polygonDrawer.enabled === 'function' && polygonDrawer.enabled());
}

export function initDraw(opts = {}) {
  const map = getMap();
  onPolygonReady = opts.onPolygonReady || (() => {});
  onStateChange = opts.onStateChange || (() => {});

  appliquerPatches();

  if (handlersCarteInstalles) return;
  handlersCarteInstalles = true;

  // Le garde multi-touch ci-dessus n'attrape que le SECOND doigt : le premier
  // doigt d'un pincement arrive seul (touches.length === 1) et a donc déjà
  // posé un sommet avant que le geste ne soit reconnaissable comme un zoom.
  // On retire donc ce sommet a posteriori si un zoom démarre juste après
  // (fenêtre de 400 ms), via l'API publique deleteLastVertex() (ligne 637).
  map.on('zoomstart', () => {
    if (!isDrawing()) return;
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
        notifierEtat();
      }
    } catch (err) {
      logError('annulation sommet au zoom', err);
    }
  });

  // Suit la pose de chaque sommet (événement officiel de la librairie).
  map.on(L.Draw.Event.DRAWVERTEX, () => {
    dernierSommetAjouteA = Date.now();
    notifierEtat();
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    // Chaque étape est tracée : si le flux casse de nouveau sur la tablette,
    // le bandeau dit exactement où, au lieu d'un cul-de-sac muet.
    logDebug('tracé fermé (draw:created) — calcul de la surface');
    let geometry = null;
    let surfaceHa = 0;
    let croise = false;
    try {
      discardDrawnLayer();
      drawnLayer = e.layer;
      drawnLayer.addTo(map);
      const rings = drawnLayer.getLatLngs();
      geometry = latLngsToGeoJsonPolygon(rings);
      surfaceHa = computeAreaHa(rings[0]);
      // Contrepartie assumée de allowIntersection:true : un contour qui se
      // croise est accepté, mais sa surface géodésique n'a alors plus de sens
      // (les deux lobes d'un « nœud papillon » s'annulent et donnent ~0 ha).
      // On le DIT au lieu d'enregistrer un chiffre faux en silence.
      croise = typeof drawnLayer.intersects === 'function' ? !!drawnLayer.intersects() : false;
      logDebug('surface calculée : ' + surfaceHa + ' ha' + (croise ? ' (contour croisé !)' : '') + ' — ouverture de la fiche');
    } catch (err) {
      logError('draw:created', err);
    }
    reactiverDoubleClickZoom();

    // completeShape()/_finishShape() émettent draw:created AVANT d'appeler
    // disable() (source l. 692 et 709) : lu maintenant, enabled() renverrait
    // encore true et la barre d'outils de dessin resterait affichée pour
    // toujours — masquant du même coup les boutons flottants, donc
    // impossible de dessiner une 2e parcelle. On relit l'état une fois la
    // pile de Leaflet.draw déroulée.
    setTimeout(notifierEtat, 0);

    // L'ouverture de la fiche est DÉLIBÉRÉMENT hors du try ci-dessus et dans
    // son propre try : une erreur en ouvrant le formulaire ne doit pas passer
    // pour une erreur de géométrie, et inversement.
    try {
      onPolygonReady({ geometry, surfaceHa, croise });
    } catch (err) {
      logError('ouverture de la fiche', err);
    }
  });
}

// Renvoie null si tout va bien, ou un message expliquant pourquoi on ne peut
// pas dessiner maintenant (affiché tel quel à l'utilisateur).
export function raisonDeRefus() {
  const map = getMap();
  if (!map) return 'Carte non initialisée.';
  if (map.getZoom() < ZOOM_MINI_DESSIN) {
    return `Zoome sur ta parcelle avant de dessiner (zoom actuel ${map.getZoom()}, minimum ${ZOOM_MINI_DESSIN}). Utilise 📍 pour te placer sur la ferme.`;
  }
  return null;
}

export function startDrawing() {
  try {
    const map = getMap();
    discardDrawnLayer();
    dernierSommetAjouteA = 0;

    // INSTANCE NEUVE À CHAQUE DESSIN. L.Handler.enable() ne fait rien si son
    // drapeau interne _enabled est encore à true, et disable() laisse l'objet
    // à moitié démonté si removeHooks() lève (ses champs _markerGroup,
    // _poly, _mouseMarker sont supprimés au fur et à mesure). Réutiliser la
    // même instance signifiait donc qu'UN SEUL incident pendant le 1er tracé
    // rendait tous les suivants impossibles, sans message : c'est le bug
    // "je ne peux dessiner qu'une seule parcelle". Repartir d'une instance
    // neuve rend chaque tracé indépendant du précédent.
    if (polygonDrawer) {
      try { polygonDrawer.disable(); } catch (err) { logError('disable ancien tracé', err); }
    }
    polygonDrawer = new L.Draw.Polygon(map, {
      shapeOptions: { color: '#ffb300', weight: 3, fillOpacity: 0.25 },
      showArea: false,
      // allowIntersection: TRUE À DESSEIN. Avec false, Leaflet.draw REFUSE de
      // fermer le polygone dès que deux segments se croisent, et se contente
      // d'afficher une bulle d'erreur qui n'existe pas au doigt : le tracé
      // restait figé à l'écran sans que la fiche ne s'ouvre jamais. Un bord de
      // champ un peu tremblé au doigt suffit à croiser. On accepte donc le
      // tracé tel qu'il est : la surface reste calculable et la géométrie
      // corrigeable plus tard, ce qui vaut infiniment mieux qu'un blocage.
      allowIntersection: true
    });
    // Leaflet.draw ne désactive JAMAIS doubleClickZoom (vérifié : 0 occurrence
    // dans toute sa source). Pendant le tracé, un double-tap zoomerait donc la
    // carte en plus de poser des sommets. On le coupe le temps du dessin ; le
    // pincement à deux doigts reste, lui, pleinement fonctionnel pour zoomer.
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    polygonDrawer.enable();
    logDebug('mode dessin activé (zoom ' + map.getZoom() + ')');
    notifierEtat();
  } catch (err) {
    logError('startDrawing', err);
    notifierEtat();
  }
}

// ↩ Annule le dernier point posé. Renvoie false s'il ne reste plus rien à
// annuler (Leaflet.draw refuse de supprimer le tout dernier sommet).
export function undoLastPoint() {
  try {
    if (!isDrawing()) return false;
    if (nbSommets() <= 1) return false;
    polygonDrawer.deleteLastVertex();
    dernierSommetAjouteA = 0;
    notifierEtat();
    return true;
  } catch (err) {
    logError('undoLastPoint', err);
    return false;
  }
}

// ✅ Ferme le polygone sans avoir à viser le premier point au doigt.
// completeShape() (source l.684) ne teste QUE le nombre de sommets (>= 3 pour
// un polygone) : contrairement à _finishShape(), elle ne peut pas être
// refusée pour cause de segments croisés.
export function finishDrawing() {
  try {
    if (!isDrawing()) return false;
    if (nbSommets() < 3) {
      logDebug('Terminer refusé : ' + nbSommets() + ' point(s), il en faut au moins 3');
      return false;
    }
    polygonDrawer.completeShape();
    return true;
  } catch (err) {
    logError('finishDrawing', err);
    return false;
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
    if (polygonDrawer) polygonDrawer.disable();
    reactiverDoubleClickZoom();
  } catch (err) {
    logError('cancelDrawing', err);
  } finally {
    notifierEtat();
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
