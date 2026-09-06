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

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

document.addEventListener('logisol:auth', async () => {
  if (booted) return;
  booted = true;

  try {
    log('Auth OK — démarrage du bootstrap');

    await ensureSeeded();
    log('Types d\'usage initialisés');
    watchTypes();

    initMap('map', {
      onParcelleClick: (id) => {
        const p = parcellesById.get(id);
        if (p) openEdit(p);
      }
    });
    log('Carte initialisée');

    initDraw({
      onPolygonReady: ({ geometry, surfaceHa }) => openCreate({ geometry, surfaceHa })
    });
    log('Dessin initialisé');

    initImport({
      onImported: (count) => {
        alert(`${count} parcelle(s) importée(s). Clique sur chacune pour compléter usage et notes.`);
      },
      onError: (err) => alert('Import impossible : ' + err.message)
    });
    log('Import initialisé');

    watchParcelles((list) => {
      parcellesById = new Map(list.map((p) => [p.id, p]));
      renderParcelles(list);
    });
    log('Écoute Firestore active');

    document.getElementById('btn-draw').addEventListener('click', () => startDrawing());
    log('Prêt.');
  } catch (err) {
    booted = false; // permet une nouvelle tentative si l'auth se redéclenche
    log('ERREUR bootstrap : ' + (err && err.message ? err.message : String(err)));
    throw err;
  }
});
