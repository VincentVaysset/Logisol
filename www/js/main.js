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
  fitToParcelles, centrerSurMaPosition, vueARestaurer,
  renderBatiments as renderBatimentsCarte, setOnBatimentClick,
  demarrerPlacement, arreterPlacement, positionPlacement
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
import { watchBatiments, onBatimentsChange, typeBatiment } from './batiments.js';
import { watchCellules, onCellulesChange } from './cellules.js';
import { watchEmplacements, onEmplacementsChange } from './emplacements.js';
import { watchMouvements, onMouvementsChange } from './mouvements.js';
import { setParcellesBatiments, openEditBatiment, setOnDemanderPlacement } from './ui-batiments.js';
import {
  initBatiments, setParcellesMouvements, renderVue as renderBatiments,
  ouvrirApercuBatiment, renderStockageParBatiment
} from './ui-mouvements.js';
import { verifierRegles } from './diagnostic-regles.js';
import { watchMateriels, onMaterielsChange } from './materiel.js';
import { initMateriel, renderMateriels } from './ui-materiel.js';

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
let latestBatiments = [];
let enrichedById = new Map();
let implantationsByParcelle = new Map();

const VUES = ['ferme', 'carte', 'liste', 'stocks', 'troupeau', 'batiments'];
let currentView = 'ferme';

const mapEl = document.getElementById('map');
const feedEl = document.getElementById('feed');
const listViewEl = document.getElementById('list-view');
const stocksViewEl = document.getElementById('stocks-view');
const troupeauViewEl = document.getElementById('troupeau-view');
const batimentsViewEl = document.getElementById('batiments-view');
const tabsEl = document.getElementById('tabs');
const fabCarte = document.getElementById('fab-carte');
const drawToolbar = document.getElementById('draw-toolbar');
const drawCount = document.getElementById('draw-count');
const drawHint = document.getElementById('draw-hint');
const btnDrawUndo = document.getElementById('btn-draw-undo');
const btnDrawFinish = document.getElementById('btn-draw-finish');
const btnDrawCancel = document.getElementById('btn-draw-cancel');
const placeToolbar = document.getElementById('place-toolbar');
const placeInfo = document.getElementById('place-info');

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
  setParcellesBatiments(enriched);
  setParcellesMouvements(enriched);

  majEtat({
    parcelles: enriched,
    cultures: latestCultures,
    implantations: latestImplantations,
    interventions: latestInterventions,
    typesIntervention: latestTypes,
    batiments: latestBatiments
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
  if (currentView === 'stocks') { renderStocks(); renderStockageParBatiment(); }
  if (currentView === 'troupeau') renderTroupeau();
}

// Bâtiments : la carte les affiche dans les vues Ferme et Carte, la vue
// Bâtiments en donne le détail. Les deux sont alimentées par la même liste
// enrichie (icône et couleur du type) pour qu'un bâtiment ait exactement la
// même identité visuelle partout.
function recomputeBatiments() {
  const enrichis = latestBatiments.map((b) => {
    const t = typeBatiment(b.type);
    return { ...b, _icone: t.icone, _couleur: t.couleur };
  });
  renderBatimentsCarte(enrichis);
  majEtat({ batiments: latestBatiments });
  if (currentView === 'ferme') renderFeed();
  if (currentView === 'batiments') { renderBatiments(); renderMateriels(); }
  if (currentView === 'stocks') renderStockageParBatiment();
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

// Bandeau d'alerte des règles : visible depuis toutes les vues, et pas
// seulement depuis celles qui affichent la carte.
function afficherAlerteRegles(message) {
  const el = document.getElementById('alerte-regles');
  const texte = document.getElementById('alerte-regles-texte');
  if (!el || !texte) return;
  texte.textContent = '⚠️ ' + message;
  el.hidden = false;
}

// Les règles vivent côté serveur : une fois corrigées dans la console, elles
// s'appliquent immédiatement, sans réinstaller ni même redémarrer l'appli.
// Ce bouton le rend évident et évite un cycle de désinstallation inutile.
async function revérifierRegles() {
  const bouton = document.getElementById('alerte-regles-retest');
  const texte = document.getElementById('alerte-regles-texte');
  if (bouton) { bouton.disabled = true; bouton.textContent = 'Vérification...'; }
  try {
    const refusees = await verifierRegles(afficherAlerteRegles);
    if (!refusees.length && texte) {
      texte.textContent = '✅ Toutes les collections sont accessibles. Tu peux enregistrer.';
      setTimeout(() => { document.getElementById('alerte-regles').hidden = true; }, 6000);
    }
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = '🔄 Revérifier'; }
  }
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

// --- Placement d'un bâtiment sur la carte ---------------------------------
// Bascule l'appli en vue Carte, affiche une barre d'outils dédiée, et rend
// la main au formulaire une fois le point validé ou abandonné.
let placementEnCours = null;
let vueAvantPlacement = null;

function initPlacement() {
  document.getElementById('btn-place-ok').addEventListener('click', () => terminerPlacement(true));
  document.getElementById('btn-place-cancel').addEventListener('click', () => terminerPlacement(false));

  setOnDemanderPlacement((opts) => {
    placementEnCours = opts;
    // On note d'où l'on vient : après validation, le formulaire réapparaît
    // par-dessus SA vue d'origine (Bâtiments), et non par-dessus la carte —
    // sinon, en fermant le formulaire, on se retrouve sur un écran qui n'a
    // rien à voir avec ce qu'on était en train de faire.
    vueAvantPlacement = currentView;
    setView('carte');
    placeToolbar.hidden = false;
    fabCarte.hidden = true;
    placeInfo.textContent = opts.depart ? 'Déplace le repère' : 'Touche la carte';
    afficherIndice('Touche la carte à l\'emplacement du bâtiment. Tu peux ensuite faire glisser le repère pour ajuster.', 0);
    demarrerPlacement({
      depart: opts.depart,
      onChange: (pos) => {
        placeInfo.textContent = pos.lat.toFixed(5) + ', ' + pos.lng.toFixed(5);
      }
    });
  });
}

function terminerPlacement(valider) {
  const pos = valider ? positionPlacement() : null;
  arreterPlacement();
  placeToolbar.hidden = true;
  fabCarte.hidden = currentView !== 'carte';
  masquerIndice();
  const opts = placementEnCours;
  const retour = vueAvantPlacement;
  placementEnCours = null;
  vueAvantPlacement = null;
  if (retour && retour !== 'carte') setView(retour);
  if (!opts) return;
  if (valider) {
    if (!pos) {
      // Valider sans avoir touché la carte ne doit pas effacer une position
      // existante : on repasse simplement la main au formulaire.
      opts.onAnnuler();
      return;
    }
    opts.onValider(pos);
  } else {
    opts.onAnnuler();
  }
}

// --- Navigation entre les trois vues --------------------------------------
function setView(vue) {
  if (!VUES.includes(vue)) return;
  // Changer de vue pendant un tracé laisserait un dessin orphelin actif sur
  // une carte qui rétrécit ou disparaît : on le termine proprement d'abord.
  if (vue !== 'carte' && isDrawing()) cancelDrawing();
  // Un placement en cours sur une carte qu'on quitte laisserait une barre
  // d'outils orpheline et un formulaire qui n'est jamais rendu.
  if (vue !== 'carte' && placementEnCours) terminerPlacement(false);

  currentView = vue;
  // La carte n'existe que dans les vues qui l'utilisent : la laisser affichée
  // sous une vue Stocks ou Troupeau chargerait des tuiles pour rien.
  mapEl.hidden = vue !== 'ferme' && vue !== 'carte';
  mapEl.classList.toggle('map-reduite', vue === 'ferme');
  feedEl.hidden = vue !== 'ferme';
  listViewEl.hidden = vue !== 'liste';
  stocksViewEl.hidden = vue !== 'stocks';
  troupeauViewEl.hidden = vue !== 'troupeau';
  batimentsViewEl.hidden = vue !== 'batiments';
  fabCarte.hidden = vue !== 'carte';

  tabsEl.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.vue === vue);
  });

  if (vue === 'ferme') renderFeed();
  if (vue === 'liste') renderListView(Array.from(enrichedById.values()));
  if (vue === 'stocks') { renderStocks(); renderStockageParBatiment(); }
  if (vue === 'troupeau') renderTroupeau();
  if (vue === 'batiments') { renderBatiments(); renderMateriels(); }
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
    initPlacement();
    document.getElementById('alerte-regles-close').addEventListener('click', () => {
      document.getElementById('alerte-regles').hidden = true;
    });
    document.getElementById('alerte-regles-retest').addEventListener('click', revérifierRegles);
    initStocks({ onChange: recomputeStocksEtTroupeau });
    initAlimentation();
    initBatiments({ onChange: recomputeBatiments });
    initMateriel();

    // Taper un bâtiment sur la carte ouvre sa fiche, comme pour une parcelle.
    setOnBatimentClick((id) => {
      const b = latestBatiments.find((x) => x.id === id);
      if (b) ouvrirApercuBatiment(b);
    });

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

    onBatimentsChange((list) => { latestBatiments = list; recomputeBatiments(); });
    watchBatiments();
    onCellulesChange(() => recomputeBatiments());
    watchCellules();
    onEmplacementsChange(() => recomputeBatiments());
    watchEmplacements();
    onMouvementsChange(() => recomputeBatiments());
    watchMouvements();
    onMaterielsChange(() => { if (currentView === 'batiments') renderMateriels(); });
    watchMateriels();

    await ensureCulturesSeeded();
    await ensureTypesSeeded();
    await ensureStadesSeeded();

    const reprises = await migrerAnciensAssolements();
    if (reprises) log(reprises + ' ancien(s) assolement(s) repris en implantations');

    // Diagnostic des règles, en dernier et sans bloquer : il transforme un
    // « permission-denied » muet en message qui dit quelle collection est
    // refusée et quoi coller dans la console Firebase.
    verifierRegles((message) => afficherAlerteRegles(message));

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
