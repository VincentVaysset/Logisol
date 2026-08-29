// Bootstrap de l'appli : lancé une fois l'utilisateur authentifié
// (voir auth.js, qui dispatch "logisol:auth" sur onAuthStateChanged).
import { ensureSeeded, watchTypes } from './types-usage.js';
import { watchParcelles } from './parcelles.js';
import { initMap, renderParcelles } from './map.js';
import { initDraw, startDrawing } from './draw.js';
import { initImport } from './import-geojson.js';
import { openCreate, openEdit } from './ui.js';

let parcellesById = new Map();
let booted = false;

document.addEventListener('logisol:auth', async () => {
  if (booted) return;
  booted = true;

  await ensureSeeded();
  watchTypes();

  initMap('map', {
    onParcelleClick: (id) => {
      const p = parcellesById.get(id);
      if (p) openEdit(p);
    }
  });

  initDraw({
    onPolygonReady: ({ geometry, surfaceHa }) => openCreate({ geometry, surfaceHa })
  });

  initImport({
    onImported: (count) => {
      alert(`${count} parcelle(s) importée(s). Clique sur chacune pour compléter usage et notes.`);
    },
    onError: (err) => alert('Import impossible : ' + err.message)
  });

  watchParcelles((list) => {
    parcellesById = new Map(list.map((p) => [p.id, p]));
    renderParcelles(list);
  });

  document.getElementById('btn-draw').addEventListener('click', () => startDrawing());
});
