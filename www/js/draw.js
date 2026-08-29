// Dessin d'un polygone à la main (Leaflet.draw) + calcul automatique de la
// surface géodésique en hectares à la fermeture du polygone.
import { getMap, latLngsToGeoJsonPolygon } from './map.js';

let drawnLayer = null;
let polygonDrawer = null;
let onPolygonReady = () => {};

export function initDraw(opts = {}) {
  const map = getMap();
  onPolygonReady = opts.onPolygonReady || (() => {});

  polygonDrawer = new L.Draw.Polygon(map, {
    shapeOptions: { color: '#3c7a4e', weight: 3 },
    showArea: false,
    allowIntersection: false
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    discardDrawnLayer();
    drawnLayer = e.layer;
    drawnLayer.addTo(map);
    const rings = drawnLayer.getLatLngs();
    const geometry = latLngsToGeoJsonPolygon(rings);
    const surfaceHa = computeAreaHa(rings[0]);
    onPolygonReady({ geometry, surfaceHa });
  });
}

export function startDrawing() {
  discardDrawnLayer();
  polygonDrawer.enable();
}

export function cancelDrawing() {
  polygonDrawer.disable();
}

// Retire le tracé temporaire de la carte (annulation ou après enregistrement,
// la version définitive étant ensuite rendue depuis Firestore par map.js).
export function discardDrawnLayer() {
  if (drawnLayer) {
    getMap().removeLayer(drawnLayer);
    drawnLayer = null;
  }
}

function computeAreaHa(latlngs) {
  const m2 = L.GeometryUtil.geodesicArea(latlngs);
  return Math.round((m2 / 10000) * 100) / 100;
}
