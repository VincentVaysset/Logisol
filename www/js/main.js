// Bootstrap de l'appli : lancé une fois l'utilisateur authentifié
// (voir auth.js, qui dispatch "logisol:auth" sur onAuthStateChanged).
//
// Rôle : combiner toutes les sources Firestore (parcelles, cultures,
// implantations, interventions, types d'intervention) et alimenter les trois
// vues — Ferme (carte + fil d'activités), Carte (plein écran, dessin/import)
// et Parcelles (liste). Les trois PARTAGENT la même carte Leaflet, qui change
// seulement de hauteur.
import {
  ensureSeeded as ensureCulturesSeeded, watchCultures, onCulturesChange, migrerFamillesPrairie,
  ensureColzaFourrager
} from './cultures-config.js';
import {
  watchImplantations, onImplantationsChange, implantationEnCours, migrerAnciensAssolements,
  migrerImplantationsNonCloturees
} from './implantations.js';
import { ensureSeeded as ensureTypesSeeded, watchTypes, onTypesChange } from './interventions-types.js';
import { watchInterventions } from './interventions.js';
import { resolveCouleur, resolveLabel } from './vocation.js';
import { getVueLegende, onVueLegendeChange } from './vue-legende.js';
import { watchParcelles } from './parcelles.js';
import { initSyncStatus, onSyncStatusChange } from './sync-status.js';
import {
  initMap, renderParcelles, renderLegend, refreshMapSize,
  fitToParcelles, centrerSurMaPosition, vueARestaurer,
  renderBatiments as renderBatimentsCarte, setOnBatimentClick,
  demarrerPlacement, arreterPlacement, positionPlacement,
  startEditContour, stopEditContour
} from './map.js';
import {
  initDraw, startDrawing, cancelDrawing, undoLastPoint, finishDrawing,
  raisonDeRefus, isDrawing
} from './draw.js';
import { initImport } from './import-geojson.js';
import { openCreate, openEdit, setSecteursConnus, setDerobeesConnues, setOnDemanderModifContour } from './ui.js';
import {
  setParcellesDisponibles, setChauffeursConnus, setCreateursDeContenant
} from './ui-intervention.js';
import { initAccueil, majEtat, renderFeed, ouvrirApercu, fermerApercu } from './accueil.js';
import { watchStocks, onStocksChange, agregerParCategorie } from './stocks.js';
import { ensureSeeded as ensureStadesSeeded, watchStades, onStadesChange } from './stades.js';
import { watchLots, watchPrelevements, onLotsChange, onPrelevementsChange } from './lots.js';
import {
  initStocks, setParcelles as setParcellesStocks, setStocks,
  setCategories as setCategoriesStocks, renderVue as renderStocks
} from './ui-stocks.js';
import {
  initAlimentation, setCategories, renderVue as renderTroupeau
} from './ui-alimentation.js';
import { watchBatiments, onBatimentsChange, typeBatiment } from './batiments.js';
import { watchCellules, onCellulesChange } from './cellules.js';
import { watchEmplacements, onEmplacementsChange } from './emplacements.js';
import { watchMouvements, onMouvementsChange, getMouvements } from './mouvements.js';
import { agregerMouvements, fusionnerCategories } from './fourrages.js';
import { watchPrevisions, onPrevisionsChange, migrerRGT0 } from './assolement-previsionnel.js';
import {
  initAssolement, setParcellesAssolement, rafraichirAssolement
} from './ui-assolement.js';
import {
  setParcellesBatiments, openEditBatiment, setOnDemanderPlacement,
  openCreateBatiment, openCreateCellule, openCreateEmplacement
} from './ui-batiments.js';
import {
  initBatiments, setParcellesMouvements, renderVue as renderBatiments,
  ouvrirApercuBatiment, renderStockageParBatiment
} from './ui-mouvements.js';
import { verifierRegles } from './diagnostic-regles.js';
import { watchMateriels, onMaterielsChange, ensureSeeded as ensureMaterielSeeded } from './materiel.js';
import { initMateriel, renderMateriels } from './ui-materiel.js';
import { initRapports, setParcellesRapports } from './ui-rapports.js';
import { initParametresCultures } from './ui-parametres.js';

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
const parcellesListeEl = document.getElementById('parcelles-liste');
const assolementVueEl = document.getElementById('assolement-vue');
// Sous-vue de l'onglet Parcelles, retenue d'un passage à l'autre : revenir
// sur l'onglet doit ramener là où on travaillait.
let sousVueParcelles = 'liste';
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
const contourToolbar = document.getElementById('contour-toolbar');
const carteSecteurFiltreEl = document.getElementById('carte-secteur-filtre');
const listeSecteurFiltreEl = document.getElementById('liste-secteur-filtre');
let secteurFiltre = '';
let secteursDisponibles = false;

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

  const groupe = getVueLegende() === 'groupe';
  const enriched = latestParcelles.map((p) => ({
    ...p,
    _couleur: resolveCouleur(p, implantationsByParcelle, culturesById, groupe),
    _label: resolveLabel(p, implantationsByParcelle, culturesById, groupe)
  }));
  enrichedById = new Map(enriched.map((p) => [p.id, p]));

  const secteurs = Array.from(new Set(enriched.map((p) => p.secteur).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  if (secteurFiltre && !secteurs.includes(secteurFiltre)) secteurFiltre = '';
  setSecteursConnus(secteurs);
  peuplerFiltreSecteurs(secteurs);

  const derobees = Array.from(new Set(enriched.map((p) => p.derobee).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  setDerobeesConnues(derobees);
  // Le filtre ne restreint QUE l'affichage carte/liste : les autres écrans
  // (stocks, bâtiments, assolement, tunnel d'activité) doivent continuer à
  // voir TOUTES les parcelles, sinon une parcelle hors secteur filtré
  // deviendrait injoignable ailleurs dans l'appli.
  const affichees = secteurFiltre ? enriched.filter((p) => p.secteur === secteurFiltre) : enriched;

  renderParcelles(affichees);
  renderLegend(computeLegendItems(affichees));
  setParcellesDisponibles(enriched);
  setParcellesStocks(enriched);
  setParcellesBatiments(enriched);
  setParcellesMouvements(enriched);
  setParcellesAssolement(enriched);
  setParcellesRapports(enriched);

  majEtat({
    parcelles: enriched,
    cultures: latestCultures,
    implantations: latestImplantations,
    interventions: latestInterventions,
    typesIntervention: latestTypes,
    batiments: latestBatiments
  });
  if (currentView === 'ferme') renderFeed();
  if (currentView === 'liste') renderListView(affichees);

  centrerAuPremierChargement(enriched);
}

// Chips réutilisées au-dessus de la carte et de la liste : "Toutes" + une par
// secteur distinct rencontré sur les parcelles. N'apparaissent que s'il
// existe au moins un secteur renseigné — inutile de montrer un filtre à
// une seule position.
function peuplerFiltreSecteurs(secteurs) {
  secteursDisponibles = !!secteurs.length;
  if (!secteursDisponibles) {
    carteSecteurFiltreEl.hidden = true;
    listeSecteurFiltreEl.hidden = true;
    carteSecteurFiltreEl.innerHTML = '';
    listeSecteurFiltreEl.innerHTML = '';
    return;
  }
  const html = ['', ...secteurs]
    .map((s) => {
      const actif = s === secteurFiltre;
      return `<button type="button" class="filtre-chip ${actif ? 'is-active' : ''}" data-secteur="${escapeAttr(s)}">${escapeHtml(s || 'Toutes')}</button>`;
    })
    .join('');
  [carteSecteurFiltreEl, listeSecteurFiltreEl].forEach((el) => {
    el.innerHTML = html;
    el.querySelectorAll('[data-secteur]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.secteur === secteurFiltre) return;
        secteurFiltre = btn.dataset.secteur;
        recomputeAndRender();
      });
    });
  });
  carteSecteurFiltreEl.hidden = currentView !== 'carte';
  listeSecteurFiltreEl.hidden = !(currentView === 'liste' && sousVueParcelles === 'liste');
}

// Stocks et troupeau partagent la même agrégation par catégorie : c'est elle
// qui relie une récolte (« 2ᵉ coupe de luzerne en botte ») au stock sur lequel
// un lot d'animaux prélève. La calculer une fois évite qu'elles divergent.
// Les fourrages ont DEUX portes d'entrée : la récolte saisie à la main dans
// l'onglet Stocks, et l'entrée de stock créée par le tunnel d'activité. Une
// 1ʳᵉ coupe de luzerne est la même chose des deux côtés : on fond les deux
// sources dans un seul jeu de catégories, sinon il faudrait choisir laquelle
// regarder pour décider d'une ration.
function categoriesFusionnees() {
  return fusionnerCategories(
    agregerParCategorie(latestStocks),
    agregerMouvements(getMouvements())
  );
}

function recomputeStocksEtTroupeau() {
  const cats = categoriesFusionnees();
  setCategories(cats);
  setCategoriesStocks(cats);
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
  // Cumul d'hectares par libellé, dans l'ordre de première apparition — en
  // vue regroupée, _label vaut déjà "Prairie"/"Céréales"/... (cf.
  // vocation.js), donc les hectares s'additionnent naturellement sous UNE
  // seule entrée au lieu d'une par espèce.
  const seen = new Map(); // label -> {couleur, ha}
  enriched.forEach((p) => {
    const ha = Number(p.surfaceHa) || 0;
    if (!seen.has(p._label)) seen.set(p._label, { couleur: p._couleur, ha: 0 });
    seen.get(p._label).ha += ha;
  });
  const items = Array.from(seen.entries())
    .map(([label, v]) => ({ label, couleur: v.couleur, ha: Math.round(v.ha * 100) / 100 }));
  // Repère les parcelles en dérobée/couvert, tous groupes confondus : une
  // seule entrée de légende, à part, avec un liseré plutôt qu'un aplat
  // (cf. map.js — le remplissage reste celui de la culture principale).
  const enDerobee = enriched.filter((p) => p.derobee && String(p.derobee).trim());
  if (enDerobee.length) {
    items.push({
      label: `Dérobée / couvert (${enDerobee.length})`,
      couleur: '#8b5cf6',
      style: 'derobee'
    });
  }
  return items;
}

function openEditParcelle(parcelle) {
  openEdit(parcelle, implantationsByParcelle.get(parcelle.id) || null);
}

function renderListView(enriched) {
  parcellesListeEl.hidden = sousVueParcelles !== 'liste';
  listeSecteurFiltreEl.hidden = !(secteursDisponibles && sousVueParcelles === 'liste');
  assolementVueEl.hidden = sousVueParcelles !== 'previsionnel';
  listViewEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.sousvue === sousVueParcelles);
  });
  // rafraichirAssolement et non renderAssolement : ce rendu est aussi déclenché
  // par chaque modification de parcelle, y compris celle qu'on vient de faire
  // dans le tableau — le reconstruire ferait perdre la case suivante.
  if (sousVueParcelles === 'previsionnel') { rafraichirAssolement(); return; }
  if (!enriched.length) {
    parcellesListeEl.innerHTML = '<p class="list-empty">Aucune parcelle pour le moment.</p>';
    return;
  }
  // Gabarit repris de mockups/maquette parcelles appli.html (carte blanche,
  // numéro discret + nom en tête, liseré de couleur à gauche) : le numéro
  // remplace ici le "#01" de la maquette quand il a été renseigné (depuis
  // l'assolement prévisionnel), et le liseré reprend la couleur déjà
  // attribuée à la parcelle plutôt que d'ajouter une pastille séparée.
  parcellesListeEl.innerHTML = enriched
    .map((p) => {
      const impl = implantationsByParcelle.get(p.id);
      const depuis = impl ? ` · depuis le ${impl.dateSemis}` : '';
      const numero = p.numero ? `<span class="parcelle-card-numero">#${escapeHtml(p.numero)}</span>` : '';
      return `
    <div class="parcelle-card" data-id="${escapeAttr(p.id)}" style="border-left-color:${escapeAttr(p._couleur)}">
      <div class="parcelle-card-info">
        <div class="parcelle-card-nom">${numero}${escapeHtml(p.nom || 'Sans nom')}</div>
        <div class="parcelle-card-sub">${escapeHtml(p._label)} · ${formatSurface(p.surfaceHa)} ha${escapeHtml(depuis)}</div>
      </div>
    </div>`;
    })
    .join('');
  parcellesListeEl.querySelectorAll('.parcelle-card').forEach((card) => {
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

// --- Modification du contour d'une parcelle existante ---------------------
// Même principe que le placement d'un bâtiment ci-dessus : bascule en vue
// Carte, poignées de glisser-déposer sur le contour (map.js), puis retour à
// la vue et à la fiche d'origine, avec la géométrie et la surface à jour.
let contourEnCours = null;
let vueAvantContour = null;

function initModifContour() {
  document.getElementById('btn-contour-ok').addEventListener('click', () => terminerModifContour(true));
  document.getElementById('btn-contour-cancel').addEventListener('click', () => terminerModifContour(false));

  setOnDemanderModifContour((opts) => {
    contourEnCours = opts;
    vueAvantContour = currentView;
    setView('carte');
    fitToParcelles([{ coordonnees: opts.geometrieActuelle }]);
    startEditContour(opts.parcelleId);
    contourToolbar.hidden = false;
    fabCarte.hidden = true;
    afficherIndice('Fais glisser les poignées pour ajuster le contour, puis valide.', 0);
  });
}

function terminerModifContour(valider) {
  const resultat = stopEditContour(valider);
  contourToolbar.hidden = true;
  fabCarte.hidden = currentView !== 'carte';
  masquerIndice();
  const opts = contourEnCours;
  const retour = vueAvantContour;
  contourEnCours = null;
  vueAvantContour = null;
  if (retour && retour !== 'carte') setView(retour);
  if (!opts) return;
  if (valider && resultat) opts.onValider(resultat.geometry, resultat.surfaceHa);
  else opts.onAnnuler();
}

// --- Panneau Paramètres (compte + version) --------------------------------
// Le header ne garde que la marque et les indicateurs ; email et
// déconnexion vivent ici, à un tap de distance via la roue crantée.
function initParametres() {
  const panel = document.getElementById('parametres-panel');
  const v = window.__LOGISOL_VERSION || {};
  document.getElementById('parametres-version').textContent =
    v.build && v.build !== 'local' ? `${v.build}${v.date ? ' · ' + v.date : ''}` : 'Build local (dev)';
  document.getElementById('btn-parametres').addEventListener('click', () => { panel.hidden = false; });
  document.getElementById('parametres-fermer').addEventListener('click', () => { panel.hidden = true; });
  initParametresCultures();
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
  // Même précaution pour une édition de contour en cours.
  if (vue !== 'carte' && contourEnCours) terminerModifContour(false);

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
  carteSecteurFiltreEl.hidden = vue !== 'carte' || !secteursDisponibles;
  listeSecteurFiltreEl.hidden = !(vue === 'liste' && sousVueParcelles === 'liste' && secteursDisponibles);

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
    initModifContour();
    initRapports();
    initParametres();
    initSyncStatus();
    const syncStatusEl = document.getElementById('sync-status');
    onSyncStatusChange((etat) => {
      syncStatusEl.textContent = etat === 'synced' ? '🟢 Synchro à jour' : '🟠 Hors-ligne';
      syncStatusEl.title = etat === 'synced'
        ? 'Dernières données confirmées par le serveur.'
        : 'Pas de confirmation serveur récente — les données affichées peuvent dater du dernier passage en ligne.';
    });
    document.getElementById('alerte-regles-close').addEventListener('click', () => {
      document.getElementById('alerte-regles').hidden = true;
    });
    document.getElementById('alerte-regles-retest').addEventListener('click', revérifierRegles);
    initStocks({ onChange: recomputeStocksEtTroupeau });
    initAlimentation();
    initBatiments({ onChange: recomputeBatiments });
    initMateriel();
    initAssolement();
    listViewEl.querySelectorAll('[data-sousvue]').forEach((b) => {
      b.addEventListener('click', () => {
        sousVueParcelles = b.dataset.sousvue;
        renderListView(Array.from(enrichedById.values()));
      });
    });

    // Le tunnel de saisie peut créer un contenant à la volée, sans perdre la
    // récolte en cours. Branché ici plutôt qu'importé : ui-batiments.js
    // dépend déjà (via accueil.js) de ui-intervention.js.
    setCreateursDeContenant({
      batiment: (opts) => openCreateBatiment(opts),
      cellule: (batimentId, opts) => openCreateCellule(batimentId, opts),
      emplacement: (batimentId, opts) => openCreateEmplacement(batimentId, opts)
    });

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
    // Bascule Détaillée/Regroupée : partagée avec le bouton de la légende
    // carte (map.js) et celui du tableau d'assolement (ui-assolement.js) —
    // où qu'elle soit actionnée, la carte ET la légende doivent suivre.
    onVueLegendeChange(() => recomputeAndRender());

    onImplantationsChange((impl) => { latestImplantations = impl; recomputeAndRender(); });
    watchImplantations();

    onTypesChange((types) => { latestTypes = types; recomputeAndRender(); });
    watchTypes();

    watchInterventions((list) => {
      latestInterventions = list;
      setChauffeursConnus(list);
      recomputeAndRender();
    });
    watchParcelles((list) => { latestParcelles = list; recomputeAndRender(); });
    onPrevisionsChange(() => {
      if (currentView === 'liste' && sousVueParcelles === 'previsionnel') rafraichirAssolement();
    });
    watchPrevisions();

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
    onMouvementsChange(() => { recomputeBatiments(); recomputeStocksEtTroupeau(); });
    watchMouvements();
    onMaterielsChange(() => { if (currentView === 'batiments') renderMateriels(); });
    watchMateriels();

    await ensureCulturesSeeded();
    await ensureTypesSeeded();
    await ensureStadesSeeded();
    await ensureMaterielSeeded();

    const reprises = await migrerAnciensAssolements();
    if (reprises) log(reprises + ' ancien(s) assolement(s) repris en implantations');
    // Après ensureTypesSeeded() ci-dessus, qui vient de corriger les types
    // Moisson/Déchaumage/Labour/Vibroculteur mal reconnus (casse/espaces) :
    // reprend les clôtures d'implantation que ces activités auraient dû
    // faire à l'époque, sans jamais retoucher celles déjà fermées.
    const reprisesCloture = await migrerImplantationsNonCloturees();
    if (reprisesCloture) log(reprisesCloture + ' implantation(s) clôturée(s) a posteriori (interculture)');
    const reprisesPrairie = await migrerFamillesPrairie();
    if (reprisesPrairie) log(reprisesPrairie + ' culture(s) « prairie » reclassée(s) en PP/PT');
    if (await ensureColzaFourrager()) log('culture "Colza fourrager" (dérobée) ajoutée');
    const reprisesRGT0 = await migrerRGT0();
    if (reprisesRGT0) log(reprisesRGT0 + ' case(s) « RG trèfle 0 » reclassée(s) en RG trèfle 1');

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
