// Initialisation Leaflet, rendu des parcelles (polygones colorés par
// vocation/culture) et légende. Ne connaît rien de Firestore/cultures : reçoit
// des parcelles déjà enrichies (_couleur, _label) calculées par main.js.
let map = null;
const layers = new Map(); // id parcelle -> L.Polygon
let onParcelleClick = () => {};
let legendControl = null;
let lastLegendItems = [];

export function initMap(containerId, opts = {}) {
  if (window.__logisolDebug) {
    window.__logisolDebug('initMap : L ' + (typeof L !== 'undefined' ? 'disponible' : 'MANQUANT — Leaflet non chargé'));
  }
  map = L.map(containerId).setView([46.6, 2.4], 6); // vue par défaut : France
  // Fond de carte satellite IGN Ortho (Géoplateforme, gratuit, sans clé API).
  // TILEMATRIXSET=PM (Pseudo-Mercator / EPSG:3857) correspond exactement au
  // découpage XYZ standard de Leaflet {z}/{x}/{y}, aucune conversion requise.
  L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', {
    maxZoom: 19,
    attribution: 'IGN-F/Géoportail'
  }).addTo(map);

  onParcelleClick = opts.onParcelleClick || (() => {});

  legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    renderLegendInto(div, lastLegendItems);
    return div;
  };
  legendControl.addTo(map);

  // #screen-app vient d'être démasqué (hidden -> false) dans le MÊME appel
  // synchrone qui mène ici (dispatch de "logisol:auth"), avant que le
  // navigateur n'ait eu l'occasion de faire un repaint/reflow. Leaflet mesure
  // la taille du conteneur #map à la création de L.map(...) : si ce dernier
  // était encore display:none (ou de taille non définitive) à cet instant,
  // Leaflet garde en cache une taille interne fausse (souvent 0x0), ce qui
  // décale ensuite tous ses calculs de pixels — panneaux, contrôles (dont la
  // légende) et tuiles peuvent alors sembler "disparaître" à certains niveaux
  // de zoom/pan et ne se recaler que lorsqu'un zoom manuel force Leaflet à
  // recalculer. invalidateSize() force ce recalcul avec la vraie taille, une
  // fois le rendu réellement stabilisé (frame suivante), puis à chaque
  // redimensionnement/rotation de l'écran.
  requestAnimationFrame(() => {
    if (map) map.invalidateSize();
  });
  // Second passage différé : sur WebView Android, la hauteur définitive du
  // conteneur peut n'être stabilisée qu'après quelques frames (barre d'état,
  // clavier, bandeau de diagnostic qui vient d'être inséré au-dessus...).
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 400);
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
  window.addEventListener('orientationchange', () => {
    if (map) setTimeout(() => map.invalidateSize(), 200);
  });

  return map;
}

function renderLegendInto(container, items) {
  container.innerHTML = items.length
    ? items.map((it) =>
        `<div class="legend-item"><span class="legend-swatch" style="background:${escapeAttr(it.couleur)}"></span>${escapeHtml(it.label)}</div>`
      ).join('')
    : '<div class="legend-item">Aucune parcelle</div>';
}

// items : [{label, couleur}] déjà dédupliqués — voir vocation.js pour le calcul.
export function renderLegend(items) {
  lastLegendItems = items;
  const container = legendControl && legendControl.getContainer();
  if (container) renderLegendInto(container, items);
}

export function getMap() {
  return map;
}

// À appeler chaque fois que #map redevient visible après avoir été caché
// (bascule vue Carte/Liste) : même raison que le requestAnimationFrame de
// initMap() ci-dessus, Leaflet ne détecte pas tout seul qu'un conteneur
// display:none vient de réapparaître.
export function refreshMapSize() {
  if (!map) return;
  requestAnimationFrame(() => map.invalidateSize());
}

// list : parcelles enrichies par main.js, chaque item porte _couleur et _label.
export function renderParcelles(list) {
  const seen = new Set();
  list.forEach((p) => {
    const latlngs = geoJsonPolygonToLatLngs(p.coordonnees);
    if (!latlngs) return;
    seen.add(p.id);
    const color = p._couleur || '#888888';

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
    const label = p._label ? ` — ${p._label}` : '';
    layer.bindTooltip((p.nom || 'Sans nom') + label, { sticky: true });
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
