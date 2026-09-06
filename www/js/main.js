// Bootstrap de l'appli : lancé une fois l'utilisateur authentifié
// (voir auth.js, qui dispatch "logisol:auth" sur onAuthStateChanged).
// Combine parcelles + cultures_config + assolements (campagne en cours) pour
// calculer la couleur/le libellé de chaque parcelle, puis alimente la carte,
// la légende et la vue liste.
import { ensureSeeded as ensureCulturesSeeded, watchCultures, onCulturesChange } from './cultures-config.js';
import { getCampagneActuelle, watchAssolements } from './assolements.js';
import { resolveCouleur, resolveLabel } from './vocation.js';
import { watchParcelles } from './parcelles.js';
import { initMap, renderParcelles, renderLegend, refreshMapSize } from './map.js';
import { initDraw, startDrawing } from './draw.js';
import { initImport } from './import-geojson.js';
import { openCreate, openEdit } from './ui.js';

let booted = false;

const campagneId = getCampagneActuelle();

// État "combine-latest" : chaque watch met à jour sa part et redéclenche le
// recalcul global (couleur/libellé) + le rendu (carte, légende, vue liste).
let latestParcelles = [];
let latestCultures = [];
let latestAssolements = []; // déjà filtrés sur la campagne en cours
let enrichedById = new Map();
let assolementsByParcelle = new Map();

let currentView = 'map'; // 'map' | 'list'
const mapEl = document.getElementById('map');
const listViewEl = document.getElementById('list-view');
const btnToggleView = document.getElementById('btn-toggle-view');

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

function recomputeAndRender() {
  const culturesById = new Map(latestCultures.map((c) => [c.id, c]));
  assolementsByParcelle = new Map(latestAssolements.map((a) => [a.parcelleId, a]));

  const enriched = latestParcelles.map((p) => ({
    ...p,
    _couleur: resolveCouleur(p, assolementsByParcelle, culturesById),
    _label: resolveLabel(p, assolementsByParcelle, culturesById)
  }));
  enrichedById = new Map(enriched.map((p) => [p.id, p]));

  renderParcelles(enriched);
  renderLegend(computeLegendItems(enriched));
  if (currentView === 'list') renderListView(enriched);
}

function computeLegendItems(enriched) {
  const seen = new Map(); // label -> couleur, dans l'ordre de première apparition
  enriched.forEach((p) => {
    if (!seen.has(p._label)) seen.set(p._label, p._couleur);
  });
  return Array.from(seen.entries()).map(([label, couleur]) => ({ label, couleur }));
}

function openEditWithAssolement(parcelle) {
  const assol = assolementsByParcelle.get(parcelle.id);
  openEdit(parcelle, assol ? assol.cultureId : null);
}

function renderListView(enriched) {
  if (!enriched.length) {
    listViewEl.innerHTML = '<p class="list-empty">Aucune parcelle pour le moment.</p>';
    return;
  }
  listViewEl.innerHTML = enriched
    .map(
      (p) => `
    <div class="parcelle-card" data-id="${escapeAttr(p.id)}">
      <span class="parcelle-card-swatch" style="background:${escapeAttr(p._couleur)}"></span>
      <div class="parcelle-card-info">
        <div class="parcelle-card-nom">${escapeHtml(p.nom || 'Sans nom')}</div>
        <div class="parcelle-card-sub">${escapeHtml(p._label)} · ${formatSurface(p.surfaceHa)} ha</div>
      </div>
    </div>`
    )
    .join('');
  listViewEl.querySelectorAll('.parcelle-card').forEach((card) => {
    card.addEventListener('click', () => {
      const p = enrichedById.get(card.dataset.id);
      if (p) openEditWithAssolement(p);
    });
  });
}

function formatSurface(v) {
  return typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : '?';
}

function setView(view) {
  currentView = view;
  mapEl.hidden = view !== 'map';
  listViewEl.hidden = view !== 'list';
  btnToggleView.textContent = view === 'map' ? '📋 Liste' : '🗺️ Carte';
  if (view === 'list') {
    renderListView(Array.from(enrichedById.values()));
  } else {
    // #map vient d'être redémasqué : Leaflet ne redétecte pas tout seul
    // qu'un conteneur display:none a repris sa taille normale, ce qui peut
    // décaler tuiles/contrôles jusqu'à ce qu'un zoom force le recalcul.
    refreshMapSize();
  }
}

async function boot() {
  if (booted) return;
  booted = true;

  try {
    log('Auth OK — démarrage du bootstrap');

    await ensureCulturesSeeded();
    log('Cultures initialisées');
    onCulturesChange((cultures) => {
      latestCultures = cultures;
      recomputeAndRender();
    });
    watchCultures(); // démarre l'écoute Firestore réelle (onCulturesChange reçoit aussi le snapshot initial)

    watchAssolements(campagneId, (assolements) => {
      latestAssolements = assolements;
      recomputeAndRender();
    });
    log('Assolements (campagne ' + campagneId + ') initialisés');

    initMap('map', {
      onParcelleClick: (id) => {
        const p = enrichedById.get(id);
        if (p) openEditWithAssolement(p);
      }
    });
    log('Carte initialisée');

    initDraw({
      onPolygonReady: ({ geometry, surfaceHa }) => openCreate({ geometry, surfaceHa })
    });
    log('Dessin initialisé');

    initImport({
      onImported: (count) => {
        alert(`${count} parcelle(s) importée(s). Clique sur chacune pour compléter vocation/culture et notes.`);
      },
      onError: (err) => alert('Import impossible : ' + err.message)
    });
    log('Import initialisé');

    watchParcelles((list) => {
      latestParcelles = list;
      recomputeAndRender();
    });
    log('Écoute Firestore active');

    document.getElementById('btn-draw').addEventListener('click', () => {
      setView('map'); // dessiner nécessite la carte, même si on était en vue liste
      startDrawing();
    });

    btnToggleView.addEventListener('click', () => setView(currentView === 'map' ? 'list' : 'map'));

    log('Prêt.');
  } catch (err) {
    booted = false; // permet une nouvelle tentative si l'auth se redéclenche
    log('ERREUR bootstrap : ' + (err && err.message ? err.message : String(err)));
    throw err;
  }
}

document.addEventListener('logisol:auth', () => boot());
// Rattrapage : si Firebase Auth a répondu plus vite que le temps nécessaire à
// ce module (et ses imports) pour s'enregistrer sur l'événement ci-dessus,
// l'événement a été perdu silencieusement — voir auth.js. On vérifie donc
// aussi directement le drapeau, "booted" empêchant tout double démarrage.
if (window.__logisolAuthUser) boot();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
