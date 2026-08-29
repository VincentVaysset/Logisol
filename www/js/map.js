// Initialisation Leaflet, rendu des parcelles (polygones colorés) et légende.
import { getTypes, onTypesChange, colorForType } from './types-usage.js';

let map = null;
const layers = new Map(); // id parcelle -> L.Polygon
let onParcelleClick = () => {};
let legendControl = null;

export function initMap(containerId, opts = {}) {
  map = L.map(containerId).setView([46.6, 2.4], 6); // vue par défaut : France
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  onParcelleClick = opts.onParcelleClick || (() => {});

  legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    renderLegend(div);
    return div;
  };
  legendControl.addTo(map);

  onTypesChange(() => {
    const container = legendControl.getContainer();
    if (container) renderLegend(container);
  });

  return map;
}

function renderLegend(container) {
  const types = getTypes();
  container.innerHTML = types.length
    ? types.map((t) =>
        `<div class="legend-item"><span class="legend-swatch" style="background:${escapeAttr(t.couleur)}"></span>${escapeHtml(t.nom)}</div>`
      ).join('')
    : '<div class="legend-item">Aucun type défini</div>';
}

export function getMap() {
  return map;
}

export function renderParcelles(list) {
  const seen = new Set();
  list.forEach((p) => {
    const latlngs = geoJsonPolygonToLatLngs(p.coordonnees);
    if (!latlngs) return;
    seen.add(p.id);
    const color = p.couleur || colorForType(p.typeUsage);

    let layer = layers.get(p.id);
    if (layer) {
      layer.setLatLngs(latlngs);
      layer.setStyle({ color, fillColor: color });
    } else {
      layer = L.polygon(latlngs, { color, fillColor: color, fillOpacity: 0.45, weight: 2 });
      layer.on('click', () => onParcelleClick(p.id));
      layer.addTo(map);
      layers.set(p.id, layer);
    }
    layer.bindTooltip(p.nom || 'Sans nom', { sticky: true });
  });

  // Retirer de la carte les parcelles qui ont disparu (supprimées ailleurs)
  Array.from(layers.keys()).forEach((id) => {
    if (!seen.has(id)) {
      map.removeLayer(layers.get(id));
      layers.delete(id);
    }
  });
}

// Géométrie GeoJSON (lon, lat) -> tableaux de L.LatLng (lat, lon) pour Leaflet
export function geoJsonPolygonToLatLngs(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  return geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
}

// Anneaux L.LatLng (issus de layer.getLatLngs()) -> géométrie GeoJSON Polygon (WGS84)
export function latLngsToGeoJsonPolygon(latlngsRings) {
  const coordinates = latlngsRings.map((ring) => {
    const coords = ring.map((ll) => [ll.lng, ll.lat]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coords.push(first);
    }
    return coords;
  });
  return { type: 'Polygon', coordinates };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
