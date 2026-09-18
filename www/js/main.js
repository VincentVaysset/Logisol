// Bootstrap de l'appli : lancé une fois l'utilisateur authentifié
// (voir auth.js, qui dispatch "logisol:auth" sur onAuthStateChanged).
// Combine parcelles + cultures_config + assolements (campagne en cours) pour
// calculer la couleur/le libellé de chaque parcelle, puis alimente la carte,
// la légende et la vue liste.
import { ensureSeeded as ensureCulturesSeeded, watchCultures, onCulturesChange } from './cultures-config.js';
import { getCampagneActuelle, watchAssolements } from './assolements.js';
import { resolveCouleur, resolveLabel } from './vocation.js';
import { watchParcelles } from './parcelles.js';
import {
  initMap, renderParcelles, renderLegend, refreshMapSize,
  fitToParcelles, centrerSurMaPosition, vueARestaurer
} from './map.js';
import {
  initDraw, startDrawing, cancelDrawing, undoLastPoint, finishDrawing,
  raisonDeRefus, isDrawing
} from './draw.js';
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
let centrageInitialFait = false;
const mapEl = document.getElementById('map');
const listViewEl = document.getElementById('list-view');
const btnToggleView = document.getElementById('btn-toggle-view');
const fabRow = document.querySelector('.fab-row');
const drawToolbar = document.getElementById('draw-toolbar');
const drawCount = document.getElementById('draw-count');
const drawHint = document.getElementById('draw-hint');
const btnDrawUndo = document.getElementById('btn-draw-undo');
const btnDrawFinish = document.getElementById('btn-draw-finish');
const btnDrawCancel = document.getElementById('btn-draw-cancel');

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
  centrerAuPremierChargement(enriched);
}

// Centrage automatique à l'ouverture, une seule fois par lancement.
// Priorité : 1) la vue enregistrée au dernier usage (gérée dans map.js, donc
// rien à faire ici), 2) le cadrage sur les parcelles existantes, 3) le GPS de
// l'appareil au tout premier lancement. Objectif : ne JAMAIS laisser l'appli
// ouverte sur la France entière, où un tap vaut plusieurs kilomètres.
function centrerAuPremierChargement(enriched) {
  if (centrageInitialFait) return;
  if (vueARestaurer()) {
    centrageInitialFait = true; // on rouvre là où il s'était arrêté
    return;
  }
  if (enriched.length) {
    if (fitToParcelles(enriched)) {
      centrageInitialFait = true;
      return;
    }
  }
  // Aucune parcelle enregistrée et aucune vue connue : on tente le GPS.
  centrageInitialFait = true;
  log('Aucune parcelle ni vue connue — tentative de centrage GPS');
  centrerSurMaPosition({
    onError: () => afficherIndice("Position GPS indisponible : zoome à la main sur la ferme, la vue sera mémorisée pour les prochaines fois.")
  });
}

// --- Messages contextuels au-dessus de la carte --------------------------
let indiceTimer = null;
function afficherIndice(texte, dureeMs) {
  if (!drawHint) return;
  clearTimeout(indiceTimer);
  drawHint.textContent = texte;
  drawHint.hidden = false;
  if (dureeMs !== 0) {
    indiceTimer = setTimeout(() => { drawHint.hidden = true; }, dureeMs || 7000);
  }
}
function masquerIndice() {
  if (!drawHint) return;
  clearTimeout(indiceTimer);
  drawHint.hidden = true;
}

// Reflète l'état du dessin dans l'interface. Appelé par draw.js à chaque
// changement (sommet posé, annulé, tracé fermé ou abandonné).
function majEtatDessin({ actif, sommets }) {
  drawToolbar.hidden = !actif;
  fabRow.hidden = actif;          // les boutons flottants gêneraient le tracé
  btnToggleView.disabled = actif;
  drawCount.textContent = sommets + (sommets > 1 ? ' points' : ' point');
  btnDrawUndo.disabled = sommets < 2;
  btnDrawFinish.disabled = sommets < 3;
  if (actif) {
    afficherIndice(
      sommets < 3
        ? 'Touche la carte pour poser les coins de la parcelle (3 minimum), puis ✅ Terminer.'
        : 'Continue à poser des coins, puis ✅ Terminer pour fermer la parcelle.',
      0
    );
  } else {
    masquerIndice();
  }
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
  // Passer en vue liste pendant un tracé laisserait un dessin orphelin actif
  // sur une carte invisible : on le termine proprement d'abord.
  if (view === 'list' && isDrawing()) cancelDrawing();
  currentView = view;
  mapEl.hidden = view !== 'map';
  listViewEl.hidden = view !== 'list';
  fabRow.hidden = view !== 'map';
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

    // --- 1) Interface d'abord, SANS aucune dépendance réseau ---
    // Auparavant, "await ensureCulturesSeeded()" (un aller-retour Firestore,
    // plus jusqu'à 6 écritures au tout premier lancement) était exécuté AVANT
    // initMap/initDraw/initImport et avant l'attachement des écouteurs de
    // clic. Résultat : pendant plusieurs secondes sur un réseau mobile lent,
    // les boutons "Dessiner"/"Importer"/bascule étaient affichés mais
    // totalement morts, sans le moindre retour visuel. Comme l'écouteur de la
    // bascule était attaché en dernier, "ça ne marche qu'après avoir cliqué
    // sur Carte/Liste" signifiait en réalité "ça ne marche qu'une fois le
    // bootstrap réseau terminé" — la bascule n'y était pour rien.
    // Rien ici ne dépend de Firestore : tout est câblé immédiatement.
    initMap('map', {
      onParcelleClick: (id) => {
        const p = enrichedById.get(id);
        if (p) openEditWithAssolement(p);
      }
    });
    log('Carte initialisée');

    initDraw({
      onPolygonReady: ({ geometry, surfaceHa, croise }) => openCreate({ geometry, surfaceHa, croise }),
      onStateChange: majEtatDessin
    });

    initImport({
      onImported: (count) => {
        alert(`${count} parcelle(s) importée(s). Clique sur chacune pour compléter vocation/culture et notes.`);
      },
      onError: (err) => alert('Import impossible : ' + err.message)
    });

    document.getElementById('btn-draw').addEventListener('click', () => {
      setView('map'); // dessiner nécessite la carte, même si on était en vue liste
      // Garde anti-"parcelle grande comme la France" : à faible zoom, l'écart
      // de quelques pixels d'un doigt vaut des kilomètres sur le terrain.
      const refus = raisonDeRefus();
      if (refus) {
        afficherIndice(refus, 9000);
        log('dessin refusé : ' + refus);
        return;
      }
      startDrawing();
    });

    btnDrawUndo.addEventListener('click', () => {
      if (!undoLastPoint()) afficherIndice('Plus rien à annuler — utilise ✖ Annuler pour tout reprendre.', 5000);
    });
    btnDrawFinish.addEventListener('click', () => {
      if (!finishDrawing()) afficherIndice('Il faut au moins 3 points pour fermer une parcelle.', 5000);
    });
    btnDrawCancel.addEventListener('click', () => {
      cancelDrawing();
      afficherIndice('Dessin annulé.', 3000);
    });

    document.getElementById('btn-locate').addEventListener('click', () => {
      setView('map');
      afficherIndice('Recherche de ta position...', 0);
      centrerSurMaPosition({
        onSuccess: () => afficherIndice('Centré sur ta position.', 3000),
        onError: (m) => afficherIndice('Position indisponible : ' + m, 7000)
      });
    });

    document.getElementById('btn-fit').addEventListener('click', () => {
      setView('map');
      if (!fitToParcelles(Array.from(enrichedById.values()))) {
        afficherIndice("Aucune parcelle enregistrée pour l'instant.", 5000);
      }
    });

    btnToggleView.addEventListener('click', () => setView(currentView === 'map' ? 'list' : 'map'));
    majEtatDessin({ actif: false, sommets: 0 });
    log('Interface prête (boutons actifs)');

    // --- 2) Puis les données (réseau) : plus rien d'interactif n'attend ---
    await ensureCulturesSeeded();
    onCulturesChange((cultures) => {
      latestCultures = cultures;
      recomputeAndRender();
    });
    watchCultures(); // démarre l'écoute Firestore réelle (onCulturesChange reçoit aussi le snapshot initial)

    watchAssolements(campagneId, (assolements) => {
      latestAssolements = assolements;
      recomputeAndRender();
    });

    watchParcelles((list) => {
      latestParcelles = list;
      recomputeAndRender();
    });

    log('Prêt (campagne ' + campagneId + ').');
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
