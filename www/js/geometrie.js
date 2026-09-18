// Conversion entre la géométrie GeoJSON utilisée dans toute l'appli et la
// forme réellement stockable dans Firestore.
//
// POURQUOI CE MODULE EXISTE
// Firestore INTERDIT les tableaux imbriqués : un tableau ne peut pas contenir
// directement un autre tableau (il peut en revanche contenir des objets, qui
// eux peuvent contenir des tableaux). Or une géométrie GeoJSON Polygon est
// exactement cela — un tableau (les anneaux) de tableaux (les sommets) de
// tableaux ([lon, lat]) :
//
//   { type: "Polygon", coordinates: [ [ [3.87, 43.62], [3.88, 43.62], ... ] ] }
//
// Toute tentative d'enregistrement échouait donc côté serveur avec :
//   invalid-argument — Function addDoc() called with invalid data.
//   Nested arrays are not supported
//
// On stocke donc les anneaux et les sommets sous forme d'OBJETS, ce que
// Firestore accepte sans réserve :
//
//   { type: "Polygon", anneaux: [ { sommets: [ {lon, lat}, ... ] } ] }
//
// La conversion est faite au seul endroit qui parle à Firestore
// (parcelles.js) : le reste de l'appli — carte, dessin, import, fiche —
// continue de manipuler du GeoJSON standard, sans rien savoir de tout ceci.

// GeoJSON Polygon -> forme stockable dans Firestore
export function geoJsonVersFirestore(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  return {
    type: 'Polygon',
    anneaux: geometry.coordinates.map((ring) => ({
      sommets: ring.map(([lon, lat]) => ({ lon, lat }))
    }))
  };
}

// Forme stockée dans Firestore -> GeoJSON Polygon
export function firestoreVersGeoJson(contour) {
  if (!contour || contour.type !== 'Polygon' || !Array.isArray(contour.anneaux)) {
    return null;
  }
  return {
    type: 'Polygon',
    coordinates: contour.anneaux.map((anneau) =>
      (Array.isArray(anneau && anneau.sommets) ? anneau.sommets : []).map((s) => [s.lon, s.lat])
    )
  };
}
