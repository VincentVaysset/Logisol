// Initialisation Leaflet, fonds de carte, rendu des parcelles (polygones
// colorés par vocation/culture) et légende. Ne connaît rien de
// Firestore/cultures : reçoit des parcelles déjà enrichies (_couleur, _label)
// calculées par main.js.
let map = null;
const layers = new Map(); // id parcelle -> L.Polygon
let onParcelleClick = () => {};
let legendControl = null;
let lastLegendItems = [];
let vueRestauree = false; // true si on a rouvert sur la dernière vue enregistrée

const CLE_VUE = 'logisol.derniereVue';
const ZOOM_FERME = 16; // zoom "parcelle" : on voit les limites de champs

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

// --- Mémorisation de la dernière vue ------------------------------------
// Au 2e lancement et aux suivants, l'appli rouvre exactement là où Vincent
// l'a laissée (donc sur la ferme), au lieu de la France entière.
function lireVueEnregistree() {
  try {
    const brut = localStorage.getItem(CLE_VUE);
    if (!brut) return null;
    const v = JSON.parse(brut);
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number' || typeof v.zoom !== 'number') return null;
    if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180 || v.zoom < 2 || v.zoom > 19) return null;
    return v;
  } catch (e) {
    return null;
  }
}

function enregistrerVue() {
  if (!map) return;
  try {
    const c = map.getCenter();
    localStorage.setItem(CLE_VUE, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }));
  } catch (e) {
    // localStorage indisponible (mode privé, quota) : sans conséquence.
  }
}

export function vueARestaurer() {
  return vueRestauree;
}

// --- Fonds de carte ------------------------------------------------------
function coucheIgn(layerName, format, extra) {
  return L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
      '&LAYER=' + layerName +
      '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
      '&FORMAT=' + format,
    Object.assign({ maxZoom: 19, attribution: 'IGN-F/Géoportail' }, extra || {})
  );
}

export function initMap(containerId, opts = {}) {
  log('initMap : L ' + (typeof L !== 'undefined' ? 'disponible' : 'MANQUANT — Leaflet non chargé'));

  map = L.map(containerId, { zoomControl: true });

  const vue = lireVueEnregistree();
  if (vue) {
    vueRestauree = true;
    map.setView([vue.lat, vue.lng], vue.zoom);
    log('vue restaurée : ' + vue.lat.toFixed(4) + ', ' + vue.lng.toFixed(4) + ' z' + vue.zoom);
  } else {
    map.setView([46.6, 2.4], 6); // aucune vue connue : France entière
    log('aucune vue enregistrée — centrage auto à faire');
  }

  // Fond satellite IGN Ortho (gratuit, sans clé API). TILEMATRIXSET=PM
  // (Pseudo-Mercator / EPSG:3857) correspond exactement au découpage XYZ
  // standard de Leaflet {z}/{x}/{y}, aucune conversion requise.
  const ortho = coucheIgn('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg').addTo(map);
  const planIgn = coucheIgn('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png');
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });

  // SURCOUCHE DE REPÈRES : l'ortho seule ne montre ni nom de commune, ni
  // route, ni lieu-dit — impossible de se situer. Cette couche CARTO est une
  // image PNG TRANSPARENTE ne contenant QUE les étiquettes (noms de communes,
  // lieux-dits, numéros de routes) : posée par-dessus le satellite, elle rend
  // la photo lisible sans la masquer. Activée par défaut.
  // Variante "dark_only_labels" : texte CLAIR à halo sombre, conçu pour être
  // posé sur un fond foncé — donc lisible sur une photo aérienne de champs
  // (vert/brun), là où la variante à texte noir se confondrait avec le sol.
  const reperes = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap, &copy; CARTO'
  }).addTo(map);

  // Parcellaire cadastral IGN : limites officielles des parcelles, en
  // surcouche transparente. Sert de calque de référence pour caler un tracé
  // sur le vrai bord de champ. Désactivé par défaut (il charge des tuiles en
  // plus), activable depuis le bouton calques. Même serveur que l'ortho, déjà
  // joignable depuis la tablette.
  const cadastre = coucheIgn('CADASTRALPARCELS.PARCELLAIRE_EXPRESS', 'image/png', {
    opacity: 0.8,
    attribution: 'IGN-F/Géoportail — Parcellaire Express'
  });

  // Si le CDN des repères est injoignable depuis la tablette, on le dit dans
  // le bandeau au lieu de laisser un satellite muet sans explication.
  let erreurReperesSignalee = false;
  reperes.on('tileerror', () => {
    if (erreurReperesSignalee) return;
    erreurReperesSignalee = true;
    log('Repères (noms de lieux) injoignables — bascule sur "Plan IGN" via le bouton calques');
  });

  L.control.layers(
    { 'Satellite IGN': ortho, 'Plan IGN': planIgn, 'OpenStreetMap': osm },
    { 'Noms de lieux et routes': reperes, 'Limites cadastrales': cadastre },
    { position: 'topright', collapsed: true }
  ).addTo(map);

  onParcelleClick = opts.onParcelleClick || (() => {});

  legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    renderLegendInto(div, lastLegendItems);
    return div;
  };
  legendControl.addTo(map);

  map.on('moveend', enregistrerVue);

  // Poignée de diagnostic, au même titre que window.__logisolDebug : permet
  // d'inspecter/piloter la carte depuis la console distante (chrome://inspect)
  // quand un comportement n'est reproductible que sur la tablette.
  window.__logisolMap = map;

  // #screen-app vient d'être démasqué (hidden -> false) dans le MÊME appel
  // synchrone qui mène ici (dispatch de "logisol:auth"), avant que le
  // navigateur n'ait eu l'occasion de faire un repaint/reflow. Leaflet mesure
  // la taille du conteneur #map à la création de L.map(...) : si ce dernier
  // était encore display:none (ou de taille non définitive) à cet instant,
  // Leaflet garde en cache une taille interne fausse (souvent 0x0), ce qui
  // décale ensuite tous ses calculs de pixels — un tap est alors converti en
  // coordonnées géographiques fausses (c'est ce qui donnait des parcelles
  // grandes comme la France). invalidateSize() force le recalcul avec la vraie
  // taille, une fois le rendu réellement stabilisé (frame suivante).
  requestAnimationFrame(() => {
    if (map) map.invalidateSize();
  });

  // ResizeObserver : correctif STRUCTUREL, à la place des rAF/timeout devinés.
  // Quelle que soit la raison pour laquelle #map prend sa taille définitive
  // tardivement (WebView Android, barre d'état, bandeau de diagnostic,
  // barre d'outils de dessin qui apparaît, retour de la vue Liste,
  // rotation...), on rappelle invalidateSize() dès que la taille CHANGE.
  const container = document.getElementById(containerId);
  if (container && typeof ResizeObserver !== 'undefined') {
    let lastW = -1;
    let lastH = -1;
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      log('taille carte ' + w + 'x' + h + ' -> invalidateSize');
      // invalidateSize() modifie la mise en page : l'appeler DANS le callback
      // relance l'observateur dans la même boucle et le navigateur émet
      // "ResizeObserver loop completed with undelivered notifications".
      // On le reporte à la frame suivante.
      requestAnimationFrame(() => {
        if (map) map.invalidateSize();
      });
    });
    ro.observe(container);
  }
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
  window.addEventListener('orientationchange', () => {
    if (map) setTimeout(() => map.invalidateSize(), 200);
  });

  return map;
}

// --- Centrage ------------------------------------------------------------

// Cadre la carte sur l'ensemble des parcelles connues. Renvoie true si le
// centrage a pu se faire (au moins une géométrie exploitable).
export function fitToParcelles(list) {
  if (!map || !Array.isArray(list) || !list.length) return false;
  const bounds = L.latLngBounds([]);
  list.forEach((p) => {
    const latlngs = geoJsonPolygonToLatLngs(p.coordonnees);
    if (latlngs) latlngs.forEach((ring) => ring.forEach((pt) => bounds.extend(pt)));
  });
  if (!bounds.isValid()) return false;
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  log('carte centrée sur ' + list.length + ' parcelle(s)');
  return true;
}

// Centre sur la position GPS de l'appareil. Utilisé au tout premier lancement
// (aucune parcelle, aucune vue enregistrée) et par le bouton 📍.
export function centrerSurMaPosition(opts = {}) {
  if (!map) return;
  if (!navigator.geolocation) {
    log('Géolocalisation non disponible sur cet appareil');
    if (opts.onError) opts.onError('Géolocalisation non disponible.');
    return;
  }
  log('Géolocalisation demandée...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], opts.zoom || ZOOM_FERME);
      log('position GPS : ' + latitude.toFixed(4) + ', ' + longitude.toFixed(4));
      if (opts.onSuccess) opts.onSuccess();
    },
    (err) => {
      log('Géolocalisation refusée/indisponible : ' + (err && err.message ? err.message : err));
      if (opts.onError) opts.onError(err && err.message ? err.message : 'Position indisponible.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

export function getZoom() {
  return map ? map.getZoom() : 0;
}

// --- Légende -------------------------------------------------------------
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
    // Étiquette PERMANENTE : le nom de la parcelle est écrit en clair sur la
    // carte (et pas seulement au survol — impossible à obtenir au doigt).
    const contenu =
      `<span class="parcelle-label-nom">${escapeHtml(p.nom || 'Sans nom')}</span>` +
      (p._label ? `<span class="parcelle-label-sub">${escapeHtml(p._label)}</span>` : '');
    const tooltip = layer.getTooltip();
    if (tooltip) {
      tooltip.setContent(contenu);
    } else {
      layer.bindTooltip(contenu, {
        permanent: true,
        direction: 'center',
        className: 'parcelle-label',
        opacity: 1
      });
    }
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
