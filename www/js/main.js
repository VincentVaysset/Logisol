// Bootstrap de l'appli : lancé une fois l'utilisateur authentifié
// (voir auth.js, qui dispatch "logisol:auth" sur onAuthStateChanged).
//
// Rôle : combiner toutes les sources Firestore (parcelles, cultures,
// implantations, interventions, types d'intervention) et alimenter les trois
// vues — Ferme (carte + fil d'activités), Carte (plein écran, dessin/import)
// et Parcelles (liste). Les trois PARTAGENT la même carte Leaflet, qui change
// seulement de hauteur.
import { ensureSeeded as ensureCulturesSeeded, watchCultures, onCulturesChange } from './cultures-config.js';
import {
  watchImplantations, onImplantationsChange, implantationEnCours, migrerAnciensAssolements
} from './implantations.js';
import { ensureSeeded as ensureTypesSeeded, watchTypes, onTypesChange } from './interventions-types.js';
import { watchInterventions } from './interventions.js';
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
import { setParcellesDisponibles } from './ui-intervention.js';
import { initAccueil, majEtat, renderFeed, ouvrirApercu, fermerApercu } from './accueil.js';
import { watchStocks, onStocksChange, agregerParCategorie } from './stocks.js';
import { ensureSeeded as ensureStadesSeeded, watchStades, onStadesChange } from './stades.js';
import { watchLots, watchPrelevements, onLotsChange, onPrelevementsChange } from './lots.js';
import {
  initStocks, setParcelles as setParcellesStocks, setStocks,
  renderVue as renderStocks
} from './ui-stocks.js';
import {
  initAlimentation, setCategories, renderVue as renderTroupeau
} from './ui-alimentation.js';

let booted = false;
let centrageInitialFait = false;

// État "combine-latest" : chaque watch met à jour sa part et redéclenche le
// recalcul global (couleur/libellé) puis le rendu des vues concernées.
let latestParcelles = [];
let latestCultures = [];
let latestImplantations = [];
let latestInterventions = [];
let latestTypes = [];
let latestStocks = [];
let enrichedById = new Map();
let implantationsByParcelle = new Map();

const VUES = ['ferme', 'carte', 'liste', 'stocks', 'troupeau'];
let currentView = 'ferme';

const mapEl = document.getElementById('map');
const feedEl = document.getElementById('feed');
const listViewEl = document.getElementById('list-view');
const stocksViewEl = document.getElementById('stocks-view');
const troupeauViewEl = document.getElementById('troupeau-view');
const tabsEl = document.getElementById('tabs');
const fabCarte = document.getElementById('fab-carte');
const drawToolbar = document.getElementById('draw-toolbar');
const drawCount = document.getElementById('draw-count');
const drawHint = document.getElementById('draw-hint');
const btnDrawUndo = document.getElementById('btn-draw-undo');
const btnDrawFinish = document.getElementById('btn-draw-finish');
const btnDrawCancel = document.getElementById('btn-draw-cancel');

function log(msg) {
  if (window.__logisolDebug) window.__logisolDebug(msg);
}

// --- Recalcul et rendu ----------------------------------------------------
function recomputeAndRender() {
  const culturesById = new Map(latestCultures.map((c) => [c.id, c]));

  // Une seule implantation « en cours » par parcelle : c'est elle qui donne la
  // couleur et le libellé partout (carte, légende, liste, aperçu).
  implantationsByParcelle = new Map();
  latestParcelles.forEach((p) => {
    const impl = implantationEnCours(p.id, undefined, latestImplantations);
    if (impl) implantationsByParcelle.set(p.id, impl);
  });

  const enriched = latestParcelles.map((p) => ({
    ...p,
    _couleur: resolveCouleur(p, implantationsByParcelle, culturesById),
    _label: resolveLabel(p, implantationsByParcelle, culturesById)
  }));
  enrichedById = new Map(enriched.map((p) => [p.id, p]));

  renderParcelles(enriched);
  renderLegend(computeLegendItems(enriched));
  setParcellesDisponibles(enriched);
  setParcellesStocks(enriched);

  majEtat({
    parcelles: enriched,
    cultures: latestCultures,
    implantations: latestImplantations,
    interventions: latestInterventions,
    typesIntervention: latestTypes
  });
  if (currentView === 'ferme') renderFeed();
  if (currentView === 'liste') renderListView(enriched);

  centrerAuPremierChargement(enriched);
}

// Stocks et troupeau partagent la même agrégation par catégorie : c'est elle
// qui relie une récolte (« 2ᵉ coupe de luzerne en botte ») au stock sur lequel
// un lot d'animaux prélève. La calculer une fois évite qu'elles divergent.
function recomputeStocksEtTroupeau() {
  setCategories(agregerParCategorie(latestStocks));
  if (currentView === 'stocks') renderStocks();
  if (currentView === 'troupeau') renderTroupeau();
}

function computeLegendItems(enriched) {
  const seen = new Map(); // label -> couleur, dans l'ordre de première apparition
  enriched.forEach((p) => {
    if (!seen.has(p._label)) seen.set(p._label, p._couleur);
  });
  return Array.from(seen.entries()).map(([label, couleur]) => ({ label, couleur }));
}

function openEditParcelle(parcelle) {
  openEdit(parcelle, implantationsByParcelle.get(parcelle.id) || null);
}

function renderListView(enriched) {
  if (!enriched.length) {
    listViewEl.innerHTML = '<p class="list-empty">Aucune parcelle pour le moment.</p>';
    return;
  }
  listViewEl.innerHTML = enriched
    .map((p) => {
      const impl = implantationsByParcelle.get(p.id);
      const depuis = impl ? ` · depuis le ${impl.dateSemis}` : '';
      return `
    <div class="parcelle-card" data-id="${escapeAttr(p.id)}">
      <span class="parcelle-card-swatch" style="background:${escapeAttr(p._couleur)}"></span>
      <div class="parcelle-card-info">
        <div class="parcelle-card-nom">${escapeHtml(p.nom || 'Sans nom')}</div>
        <div class="parcelle-card-sub">${escapeHtml(p._label)} · ${formatSurface(p.surfaceHa)} ha${escapeHtml(depuis)}</div>
      </div>
    </div>`;
    })
    .join('');
  listViewEl.querySelectorAll('.parcelle-card').forEach((card) => {
    card.addEventListener('click', () => {
      const p = enrichedById.get(card.dataset.id);
      if (p) ouvrirApercu(p);
    });
  });
}

function formatSurface(v) {
  return typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : '?';
}

// --- Centrage automatique -------------------------------------------------
// Priorité : 1) la vue enregistrée au dernier usage (gérée dans map.js),
// 2) le cadrage sur les parcelles existantes, 3) le GPS au tout premier
// lancement. Objectif : ne jamais laisser l'appli ouverte sur la France
// entière, où un tap vaut plusieurs kilomètres.
function centrerAuPremierChargement(enriched) {
  if (centrageInitialFait) return;
  if (vueARestaurer()) {
    centrageInitialFait = true;
    return;
  }
  if (enriched.length && fitToParcelles(enriched)) {
    centrageInitialFait = true;
    return;
  }
  centrageInitialFait = true;
  log('Aucune parcelle ni vue connue — tentative de centrage GPS');
  centrerSurMaPosition({
    onError: () =>
      afficherIndice("Position GPS indisponible : zoome à la main sur la ferme, la vue sera mémorisée pour les prochaines fois.")
  });
}

// --- Messages contextuels au-dessus de la carte ---------------------------
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
  fabCarte.hidden = actif || currentView !== 'carte';
  tabsEl.classList.toggle('tabs-bloques', actif);
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

// --- Navigation entre les trois vues --------------------------------------
function setView(vue) {
  if (!VUES.includes(vue)) return;
  // Changer de vue pendant un tracé laisserait un dessin orphelin actif sur
  // une carte qui rétrécit ou disparaît : on le termine proprement d'abord.
  if (vue !== 'carte' && isDrawing()) cancelDrawing();

  currentView = vue;
  // La carte n'existe que dans les vues qui l'utilisent : la laisser affichée
  // sous une vue Stocks ou Troupeau chargerait des tuiles pour rien.
  mapEl.hidden = vue !== 'ferme' && vue !== 'carte';
  mapEl.classList.toggle('map-reduite', vue === 'ferme');
  feedEl.hidden = vue !== 'ferme';
  listViewEl.hidden = vue !== 'liste';
  stocksViewEl.hidden = vue !== 'stocks';
  troupeauViewEl.hidden = vue !== 'troupeau';
  fabCarte.hidden = vue !== 'carte';

  tabsEl.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.vue === vue);
  });

  if (vue === 'ferme') renderFeed();
  if (vue === 'liste') renderListView(Array.from(enrichedById.values()));
  if (vue === 'stocks') renderStocks();
  if (vue === 'troupeau') renderTroupeau();
  if (vue === 'ferme' || vue === 'carte') {
    // #map vient de changer de taille (ou de redevenir visible) : Leaflet ne
    // le détecte pas seul, ce qui décalerait tuiles, contrôles et surtout la
    // conversion tap -> coordonnées.
    refreshMapSize();
  }
}

// --- Bootstrap ------------------------------------------------------------
async function boot() {
  if (booted) return;
  booted = true;

  try {
    log('Auth OK — démarrage du bootstrap');

    // --- 1) Interface d'abord, SANS aucune dépendance réseau ---
    // Tout le câblage se fait avant la moindre requête Firestore : sinon, sur
    // réseau lent, les boutons restent affichés mais morts plusieurs secondes.
    initMap('map', {
      onParcelleClick: (id) => {
        const p = enrichedById.get(id);
        if (p) ouvrirApercu(p);
      }
    });
    log('Carte initialisée');

    initDraw({
      onPolygonReady: ({ geometry, surfaceHa, croise }) => openCreate({ geometry, surfaceHa, croise }),
      onStateChange: majEtatDessin
    });

    initImport({
      onImported: (count) => {
        alert(`${count} parcelle(s) importée(s). Touche chaque parcelle pour compléter culture et notes.`);
      },
      onError: (err) => alert('Import impossible : ' + err.message)
    });

    initAccueil({ onModifierParcelle: openEditParcelle });
    initStocks({ onChange: recomputeStocksEtTroupeau });
    initAlimentation();

    tabsEl.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => setView(b.dataset.vue));
    });

    document.getElementById('btn-draw').addEventListener('click', () => {
      setView('carte');
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
      setView('carte');
      afficherIndice('Recherche de ta position...', 0);
      centrerSurMaPosition({
        onSuccess: () => afficherIndice('Centré sur ta position.', 3000),
        onError: (m) => afficherIndice('Position indisponible : ' + m, 7000)
      });
    });

    document.getElementById('btn-fit').addEventListener('click', () => {
      setView('carte');
      if (!fitToParcelles(Array.from(enrichedById.values()))) {
        afficherIndice("Aucune parcelle enregistrée pour l'instant.", 5000);
      }
    });

    majEtatDessin({ actif: false, sommets: 0 });
    setView('ferme');
    log('Interface prête (boutons actifs)');

    // --- 2) Puis les données (réseau) : plus rien d'interactif n'attend ---
    // Les écoutes temps réel sont posées AVANT les opérations lentes
    // (amorçage, migration) : l'écran se remplit dès les premières données au
    // lieu d'attendre la fin de tout.
    onCulturesChange((cultures) => { latestCultures = cultures; recomputeAndRender(); });
    watchCultures();

    onImplantationsChange((impl) => { latestImplantations = impl; recomputeAndRender(); });
    watchImplantations();

    onTypesChange((types) => { latestTypes = types; recomputeAndRender(); });
    watchTypes();

    watchInterventions((list) => { latestInterventions = list; recomputeAndRender(); });
    watchParcelles((list) => { latestParcelles = list; recomputeAndRender(); });

    onStocksChange((list) => { latestStocks = list; setStocks(list); recomputeStocksEtTroupeau(); });
    watchStocks();

    onStadesChange(() => recomputeStocksEtTroupeau());
    watchStades();
    onLotsChange(() => recomputeStocksEtTroupeau());
    watchLots();
    onPrelevementsChange(() => recomputeStocksEtTroupeau());
    watchPrelevements();

    await ensureCulturesSeeded();
    await ensureTypesSeeded();
    await ensureStadesSeeded();

    const reprises = await migrerAnciensAssolements();
    if (reprises) log(reprises + ' ancien(s) assolement(s) repris en implantations');

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
