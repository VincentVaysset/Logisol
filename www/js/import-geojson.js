// Import d'un fichier GeoJSON (export xFarm ou Telepac/RPG) : accepte
// Feature / FeatureCollection / Polygon(s) / MultiPolygon(s), en WGS84
// uniquement pour la V1 (voir cahier des charges — Lambert-93 non supporté).
import { createParcelle } from './parcelles.js';

export function initImport(opts = {}) {
  const input = document.getElementById('input-geojson');
  const btn = document.getElementById('btn-import');

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Le fichier n'est pas un JSON valide.");
      }

      const polygons = extractPolygons(json);
      if (!polygons.length) {
        throw new Error("Aucun polygone trouvé dans ce fichier GeoJSON.");
      }

      // Valider AVANT toute écriture, pour ne pas créer une partie des
      // parcelles puis échouer au milieu.
      polygons.forEach(({ geometry }) => validateWGS84(geometry));

      let count = 0;
      for (const { geometry, props } of polygons) {
        count++;
        const surfaceHa = computeAreaHa(geometry);
        await createParcelle({
          nom: (props && (props.nom || props.NOM || props.name)) || `Parcelle importée ${count}`,
          // vocation par défaut "culture" (cas le plus courant à l'import) ;
          // aucun assolement créé, la parcelle apparaît en gris "à renseigner"
          // jusqu'à ce que l'éleveur choisisse la culture depuis sa fiche.
          vocation: 'culture',
          surfaceHa,
          couleur: '',
          coordonnees: geometry,
          notes: ''
        });
      }

      opts.onImported && opts.onImported(count);
    } catch (err) {
      if (opts.onError) opts.onError(err);
      else alert('Import impossible : ' + err.message);
    }
  });
}

function extractPolygons(json) {
  const out = [];
  const pushGeom = (geometry, props) => {
    if (!geometry) return;
    if (geometry.type === 'Polygon') {
      out.push({ geometry, props: props || {} });
    } else if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((coords) => {
        out.push({ geometry: { type: 'Polygon', coordinates: coords }, props: props || {} });
      });
    }
  };

  if (json && json.type === 'FeatureCollection' && Array.isArray(json.features)) {
    json.features.forEach((f) => pushGeom(f.geometry, f.properties));
  } else if (json && json.type === 'Feature') {
    pushGeom(json.geometry, json.properties);
  } else if (json && (json.type === 'Polygon' || json.type === 'MultiPolygon')) {
    pushGeom(json, {});
  }
  return out;
}

function validateWGS84(geometry) {
  for (const ring of geometry.coordinates) {
    for (const pt of ring) {
      const lon = pt[0];
      const lat = pt[1];
      if (typeof lon !== 'number' || typeof lat !== 'number' || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        throw new Error(
          'Coordonnées hors WGS84 détectées (longitude/latitude attendues, ex: 2.35 / 48.85). ' +
          "Seul le format GeoJSON standard WGS84 est supporté pour l'instant " +
          '(un export Lambert-93 / RGF93 brut ne fonctionnera pas).'
        );
      }
    }
  }
}

function computeAreaHa(geometry) {
  const ring = geometry.coordinates[0].map(([lon, lat]) => L.latLng(lat, lon));
  const m2 = L.GeometryUtil.geodesicArea(ring);
  return Math.round((m2 / 10000) * 100) / 100;
}
