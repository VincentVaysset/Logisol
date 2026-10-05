// Vue Troupeau : lots d'animaux, fiche lot (identité + section "Ration
// distribuée", cf. ui-rations.js) et rendu des sous-vues Ration actuelle /
// Historique & bilan (le contenu propre à Prévisionnel et au bilan vit dans
// ui-rations.js, rattaché ici via renderTroupeauRations()). Ce fichier ne
// calcule plus ce qu'un lot consomme réellement, ça vient exclusivement des
// distributions (cf. totauxDistribution/lotsSansDistribution).
//
// L'ancien système par stade (périodes de prélèvement, table croisée
// stades × stocks, "Rations par stade") a été retiré de l'UI (refactor
// Prévisionnel/Distribué) : rien n'écrivait plus dedans depuis l'existence
// des distributions, et il faisait doublon. La collection Firestore
// "prelevements" n'est PAS supprimée pour autant (lots.js garde ses
// fonctions de lecture/écriture, inutilisées ici mais intactes) — seule
// l'UI qui l'affichait/l'alimentait a disparu.
import { getLots, createLot, updateLot, deleteLot, typeAnimauxDe } from './lots.js';
import {
  ouvrirSectionRationsLot, fermerSectionRationsLot,
  initTroupeauRations, renderTroupeauRations,
  lotsSansDistribution, resumeComposants, ouvrirEditionPeriode
} from './ui-rations.js';
import {
  affectationEnCours, composantsAffectation, historiqueAffectations, affectationsLot,
  supprimerAffectation, rouvrirAffectation, precedenteFermeePar, tonnesComposant, reporterComposant
} from './affectations.js';
import { epuisementsDuLot } from './plafond-conso.js';
import { lireCle } from './groupes-stock.js';
import { besoinJournalierParStock } from './rations-calc.js';
import { rationParAnimal } from './groupes-stock.js';
import { stockAuSoir } from './clotures-stock.js';
import { getClotures } from './verrou-campagne.js';
import { campagneStockSuivante } from './campagne-stock.js';
import { getStadeById } from './stades.js';
import { aujourdhui } from './implantations.js';
import { formatTonnes } from './ui-stocks.js';
import { getBatiments, accepteLots } from './batiments.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('lot-panel');
const form = document.getElementById('lot-form');
const titleEl = document.getElementById('lot-title');
const inputNom = document.getElementById('lot-nom');
const inputNb = document.getElementById('lot-nb');
const selectType = document.getElementById('lot-type');
const selectBatiment = document.getElementById('lot-batiment');
const inputNotes = document.getElementById('lot-notes');
const btnSave = document.getElementById('lot-save');
const btnDelete = document.getElementById('lot-delete');
const errorBanner = document.getElementById('lot-error-banner');
const errorText = document.getElementById('lot-error-text');

const alerteEl = document.getElementById('troupeau-alerte');
const lotsEl = document.getElementById('troupeau-lots');
const historiquesOuverts = new Set();
let reportOuvert = null;   // « lotId|affId|cle » dont le choix de remplacement est déplié
const sousVuesEl = document.getElementById('troupeau-sous-vues');
const vuePrevisionnelEl = document.getElementById('troupeau-previsionnel');
const vueActuelleEl = document.getElementById('troupeau-actuel');
const vueHistoriqueEl = document.getElementById('troupeau-historique');

// « Distribué » : alerte et cartes de lots. « Bilan campagne » : lecture seule
// (ui-rations.js). « Prévisionnel » : inchangé.
let sousVueTroupeau = 'actuel';

let mode = null;
let editingId = null;
let editingLot = null;
let saveToken = 0;

class ErreurDeSaisie extends Error {}

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
document.getElementById('lot-error-close').addEventListener('click', hideError);

export function initAlimentation() {
  document.getElementById('btn-new-lot').addEventListener('click', () => openCreate());
  document.getElementById('lot-cancel').addEventListener('click', fermer);
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
  sousVuesEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.addEventListener('click', () => {
      sousVueTroupeau = b.dataset.sousvue;
      afficherSousVue();
    });
  });
  initTroupeauRations();
}

function afficherSousVue() {
  vuePrevisionnelEl.hidden = sousVueTroupeau !== 'previsionnel';
  vueActuelleEl.hidden = sousVueTroupeau !== 'actuel';
  vueHistoriqueEl.hidden = sousVueTroupeau !== 'historique';
  sousVuesEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.sousvue === sousVueTroupeau);
  });
}

// Seuls les bâtiments qui hébergent des animaux sont proposés : rattacher un
// lot à un silo n'aurait aucun sens.
function peuplerBatiments(valeur) {
  const dispo = getBatiments().filter(accepteLots);
  selectBatiment.innerHTML =
    '<option value="">— Aucune bergerie —</option>' +
    dispo.map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.nom)}</option>`).join('');
  if (valeur && dispo.some((b) => b.id === valeur)) selectBatiment.value = valeur;
}

// --- Formulaire du lot (identité seulement) --------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  inputNom.value = '';
  inputNb.value = '';
  inputNotes.value = '';
  selectType.value = 'BREBIS';
}

export function openCreate() {
  mode = 'create';
  editingId = null;
  editingLot = null;
  panel.hidden = false;
  reinitialiser();
  log('formulaire lot ouvert (création)');
  try {
    titleEl.textContent = 'Nouveau lot';
    btnDelete.hidden = true;
    peuplerBatiments('');
    fermerSectionRationsLot(); // la ration distribuée n'a de sens qu'une fois le lot créé
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + ((err && err.message) || err));
  }
}

export function openEditLot(lot) {
  mode = 'edit';
  editingId = lot.id;
  editingLot = lot;
  panel.hidden = false;
  reinitialiser();
  try {
    titleEl.textContent = 'Modifier — ' + (lot.nom || 'lot');
    btnDelete.hidden = false;
    inputNom.value = lot.nom || '';
    inputNb.value = lot.nbBrebis != null ? lot.nbBrebis : '';
    selectType.value = typeAnimauxDe(lot);
    peuplerBatiments(lot.batimentId || '');
    ouvrirSectionRationsLot(lot);
  } catch (err) {
    showError('Impossible de charger ce lot : ' + ((err && err.message) || err));
  }
}

function fermer() {
  panel.hidden = true;
  mode = null;
  editingId = null;
  editingLot = null;
  fermerSectionRationsLot();
}

async function enregistrer(e) {
  e.preventDefault();
  const monToken = ++saveToken;
  hideError();
  btnSave.disabled = true;
  btnSave.textContent = 'Enregistrement...';
  let fini = false;
  const minuteur = setTimeout(() => {
    if (!fini && monToken === saveToken) {
      showError('Aucune réponse du serveur après 8 s — vérifie ta connexion ou les règles Firestore.');
    }
  }, 8000);
  try {
    const nom = inputNom.value.trim();
    const nbBrebis = inputNb.value;
    const batimentId = selectBatiment.value || null;
    const notes = inputNotes.value;
    const typeAnimaux = selectType.value;

    if (!nom) throw new ErreurDeSaisie('Donne un nom au lot.');
    const n = Number(nbBrebis);
    if (!isFinite(n) || n <= 0) throw new ErreurDeSaisie("L'effectif doit être supérieur à 0.");

    if (mode === 'create') {
      const lotId = await createLot({ nom, nbBrebis: n, batimentId, notes, typeAnimaux });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) {
        log('lot créé — prêt pour la distribution');
        toastSucces('Lot créé.');
        openEditLot({ id: lotId, nom, nbBrebis: n, batimentId, notes, typeAnimaux });
      }
    } else {
      await updateLot(editingId, { nom, nbBrebis: n, batimentId, notes, typeAnimaux });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) { log('lot mis à jour'); toastSucces('Lot enregistré.'); fermer(); }
    }
  } catch (err) {
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      const msg = err instanceof ErreurDeSaisie
        ? err.message
        : `Erreur d'enregistrement : ${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`;
      showError(msg);
      toastErreur(`Échec de l'enregistrement du lot : ${msg}`);
    }
  } finally {
    fini = true;
    if (monToken === saveToken) { btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; }
  }
}

async function supprimer() {
  if (!editingId) return;
  if (!confirm('Supprimer ce lot ? Cette action est irréversible.')) return;
  btnDelete.disabled = true;
  try {
    await deleteLot(editingId);
    toastSucces('Lot supprimé.');
    fermer();
  } catch (err) {
    const msg = 'Erreur de suppression : ' + ((err && err.message) || err);
    showError(msg);
    toastErreur(msg);
  } finally {
    btnDelete.disabled = false;
  }
}

// --- Vue ------------------------------------------------------------------
function jjmm(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''; }
function kg(v) { return (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('fr-FR'); }
function effectifLisible(n, type) {
  const nb = Number(n) || 0;
  if (type === 'AGNELLES') return `${nb} agnelle${nb > 1 ? 's' : ''}`;
  if (type === 'BELIERS') return `${nb} bélier${nb > 1 ? 's' : ''}`;
  return `${nb} brebis`;
}
const PAR_ANIMAL = { BREBIS: 'brebis', AGNELLES: 'agnelle', BELIERS: 'bélier' };

export function renderVue() {
  const lots = getLots();
  const parType = { BREBIS: 0, AGNELLES: 0, BELIERS: 0 };
  lots.forEach((l) => { parType[typeAnimauxDe(l)] += Number(l.nbBrebis) || 0; });
  document.getElementById('troupeau-sous-titre').textContent =
    [effectifLisible(parType.BREBIS, 'BREBIS'), effectifLisible(parType.AGNELLES, 'AGNELLES'),
     parType.BELIERS ? effectifLisible(parType.BELIERS, 'BELIERS') : null].filter(Boolean).join(' · ');

  const bandeau = document.getElementById('troupeau-reouverte');
  const reouvertes = getClotures().filter((c) => c.statut === 'reouverte').map((c) => c.id).sort();
  bandeau.hidden = !reouvertes.length;
  bandeau.textContent = reouvertes.map((c) => `Campagne ${c} réouverte : le stock de départ ${campagneStockSuivante(c)} sera recalculé à la clôture.`).join(' ');

  // Sans ration distribuée ACTUELLEMENT : leur consommation n'est comptée nulle part.
  const orphelins = lotsSansDistribution();
  alerteEl.hidden = !orphelins.length;
  alerteEl.textContent = orphelins.length
    ? `⚠️ ${orphelins.length} lot${orphelins.length > 1 ? 's' : ''} sans ration distribuée : ${orphelins.map((l) => l.nom).join(', ')} — leur consommation n'est comptée nulle part.`
    : '';

  renderLots();
  renderTroupeauRations();
  afficherSousVue();
}

// « Stock restant X t · ~N j » : l'aliment de la ration qui s'épuise le
// premier, au besoin journalier de TOUS les lots qui le mangent — même stock
// que l'onglet Stocks (clotures-stock.js/stockAuSoir), jamais un autre calcul.
function stockRestantLot(composants, stock, besoin) {
  let pire = null;
  composants.forEach((c) => {
    const t = stock.has(c.stockCle) ? stock.get(c.stockCle) : 0;
    const kgJ = besoin.get(c.stockCle) || 0;
    if (!(kgJ > 0)) return;
    const jours = Math.max(0, Math.floor((t * 1000) / kgJ));
    if (!pire || jours < pire.jours) pire = { label: c.stockLabel, tonnes: t, jours };
  });
  return pire;
}

function renderLots() {
  const lots = getLots();
  if (!lots.length) {
    lotsEl.innerHTML = '<p class="list-empty">Aucun lot. Utilise « ➕ Lot » pour en créer un.</p>';
    return;
  }
  const auj = aujourdhui();
  const stock = new Map(stockAuSoir(auj).map((g) => [g.cle, g.tonnes]));
  const besoin = new Map(besoinJournalierParStock(lots).map((b) => [b.cle, b.kgParJour]));
  lotsEl.innerHTML = lots.map((lot) => {
    const aff = affectationEnCours(lot);
    const composants = aff ? composantsAffectation(aff) : [];
    const type = typeAnimauxDe(lot);
    const stade = lot.stadeId ? getStadeById(lot.stadeId) : null;
    const sous = [effectifLisible(lot.nbBrebis, type), stade && stade.nom ? stade.nom.toLowerCase() : null,
      aff ? `depuis le ${jjmm(aff.dateDebut)}` : 'aucune ration distribuée'].filter(Boolean).join(' · ');
    const badge = !aff ? '<span class="trp-badge trp-badge-sans">Sans ration</span>'
      : composants.length ? '<span class="trp-badge">En cours</span>' : '<span class="trp-badge">Pâturage</span>';
    const lignes = composants.map((c) => `<div class="stk-detail-ligne"><span class="stk-detail-nom">${escapeHtml(c.stockLabel)}</span><strong>${kg(c.kgParAnimalJour)} kg/j</strong></div>`).join('');
    // Par animal, fourrages et concentrés séparés (vigilance acidose) : kg
    // bruts, informatif, aucun seuil ni couleur.
    const pa = rationParAnimal(composants);
    const total = composants.length
      ? `<div class="stk-detail-ligne trp-total-lot"><span>Par ${PAR_ANIMAL[type] || 'brebis'}</span><strong>${kg(pa.total)} kg/j</strong></div>
         <div class="trp-par-animal">Fourrages ${kg(pa.fourrages)} kg · Concentrés ${kg(pa.concentres)} kg${pa.pctConcentres != null ? ` · ${pa.pctConcentres} % de concentrés` : ''}</div>`
      : '';
    const r = stockRestantLot(composants, stock, besoin);
    const restant = r
      ? `<button type="button" class="stk-lien-ligne" data-vers="stocks"><span>${r.tonnes > 0
          ? `Stock restant : ${formatTonnes(r.tonnes)} t${composants.length > 1 ? ` (${escapeHtml(r.label)})` : ''} · environ ${r.jours} j`
          : `<span class="trp-epuise">Stock épuisé : ${escapeHtml(r.label)}</span>`}</span><span class="stk-lien">Stocks →</span></button>`
      : '';
    const ouvert = historiquesOuverts.has(lot.id);
    // Aliment épuisé : la consommation est plafonnée au stock (plafond-conso.js)
    // et rien ne bascule tout seul — l'alerte reste jusqu'au report.
    const alertes = epuisementsDuLot(lot).map((e) => alerteEpuisement(lot, e, stock)).join('');
    return `<div class="stk-carte trp-lot" data-id="${escapeAttr(lot.id)}">
      <div class="trp-lot-tete">
        <div class="stk-groupe-tete"><span class="stk-groupe-nom">${escapeHtml(lot.nom || 'Lot')}</span>${badge}</div>
        <p class="stk-groupe-sous">${escapeHtml(sous)}</p>
      </div>
      ${alertes}${lignes}${total}${restant}
      <div class="stk-actions">
        <button type="button" class="stk-lien" data-changer="${escapeAttr(lot.id)}">🔄 Changer la ration</button>
        <button type="button" class="stk-lien-gris" data-historique="${escapeAttr(lot.id)}">Historique ${ouvert ? '▴' : '▾'}</button>
      </div>
      ${ouvert ? historiqueLot(lot) : ''}
    </div>`;
  }).join('');

  lotsEl.querySelectorAll('.trp-lot-tete').forEach((el) => {
    el.addEventListener('click', () => {
      const lot = getLots().find((l) => l.id === el.closest('.trp-lot').dataset.id);
      if (lot) openEditLot(lot);
    });
  });
  lotsEl.querySelectorAll('[data-changer]').forEach((b) => b.addEventListener('click', () => {
    const lot = getLots().find((l) => l.id === b.dataset.changer);
    if (lot) openEditLot(lot);
  }));
  lotsEl.querySelectorAll('[data-historique]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.historique;
    if (historiquesOuverts.has(id)) historiquesOuverts.delete(id); else historiquesOuverts.add(id);
    renderLots();
  }));
  lotsEl.querySelectorAll('[data-vers="stocks"]').forEach((b) => b.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('logisol:vue', { detail: 'stocks' }));
  }));
  lotsEl.querySelectorAll('[data-reporter]').forEach((b) => b.addEventListener('click', () => {
    reportOuvert = reportOuvert === b.dataset.reporter ? null : b.dataset.reporter;
    renderLots();
  }));
  lotsEl.querySelectorAll('[data-report-choix]').forEach((sel) => sel.addEventListener('change', () => {
    const opt = sel.selectedOptions[0];
    sel.closest('.trp-report').querySelector('[data-report-valider]').disabled = !opt || !opt.value;
  }));
  lotsEl.querySelectorAll('[data-report-annuler]').forEach((b) => b.addEventListener('click', () => { reportOuvert = null; renderLots(); }));
  lotsEl.querySelectorAll('[data-report-valider]').forEach((b) => b.addEventListener('click', async () => {
    const bloc = b.closest('.trp-alerte');
    const [lotId, affId, cle, date] = [bloc.dataset.lot, bloc.dataset.aff, bloc.dataset.cle, bloc.dataset.date];
    const lot = getLots().find((l) => l.id === lotId);
    const sel = bloc.querySelector('[data-report-choix]');
    const kgJ = Number(String(bloc.querySelector('[data-report-kg]').value).replace(',', '.'));
    if (!lot || !sel.value) return;
    b.disabled = true;
    try {
      await reporterComposant(lot, affId, cle, date, { stockCle: sel.value, stockLabel: sel.selectedOptions[0].dataset.label, kgParAnimalJour: kgJ });
      reportOuvert = null;
      toastSucces(`Reporté sur ${sel.selectedOptions[0].dataset.label} à partir du ${jjmm(date)}.`);
    } catch (err) {
      toastErreur('Report impossible : ' + ((err && err.message) || err));
      b.disabled = false;
    }
  }));
  lotsEl.querySelectorAll('[data-modifier-ration]').forEach((b) => b.addEventListener('click', () => {
    const lot = getLots().find((l) => l.id === b.dataset.lot);
    if (lot) ouvrirEditionPeriode(lot, b.dataset.modifierRation);
  }));
  lotsEl.querySelectorAll('[data-suppr-ration]').forEach((b) => b.addEventListener('click', async () => {
    const lot = getLots().find((l) => l.id === b.dataset.lot);
    if (!lot || !confirm('Supprimer cette ration ? Sa consommation sera retirée du stock et du bilan.')) return;
    const supprimee = affectationsLot(lot).find((a) => a.id === b.dataset.supprRation);
    const precedente = precedenteFermeePar(lot, supprimee);
    b.disabled = true;
    try {
      await supprimerAffectation(lot, supprimee.id);
      if (precedente && confirm(`Rouvrir la ration précédente (${resumeComposants(composantsAffectation(precedente))}) ?`)) {
        await rouvrirAffectation(lot, precedente.id);
      }
      toastSucces('Ration supprimée.');
    } catch (err) {
      toastErreur('Suppression impossible : ' + ((err && err.message) || err));
      b.disabled = false;
    }
  }));
}

// « [Aliment] épuisé le JJ/MM. Choisir un autre aliment » + Reporter : la
// ration d'origine se termine ce jour-là, une nouvelle démarre avec
// l'aliment choisi parmi ceux en stock (même kg/j par défaut).
function alerteEpuisement(lot, e, stock) {
  const id = `${lot.id}|${e.aff.id}|${e.composant.stockCle}`;
  const ouvert = reportOuvert === id;
  const choix = ouvert ? stockAuSoir(aujourdhui())
    .filter((g) => g.tonnes > 0.001 && g.cle !== e.composant.stockCle && lireCle(g.cle).type !== 'paille')
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr')) : [];
  return `<div class="trp-alerte" data-lot="${escapeAttr(lot.id)}" data-aff="${escapeAttr(e.aff.id)}" data-cle="${escapeAttr(e.composant.stockCle)}" data-date="${escapeAttr(e.date)}">
    <div class="trp-alerte-tete"><span>⚠️ ${escapeHtml(e.composant.stockLabel)} épuisé le ${jjmm(e.date)}. Choisir un autre aliment</span>
      <button type="button" class="trp-alerte-btn" data-reporter="${escapeAttr(id)}">Reporter</button></div>
    ${ouvert ? `<div class="trp-report">
      <select data-report-choix><option value="">— Aliment en stock —</option>${choix.map((g) =>
        `<option value="${escapeAttr(g.cle)}" data-label="${escapeAttr(g.label)}">${escapeHtml(g.label)} (${formatTonnes(g.tonnes)} t)</option>`).join('')}</select>
      <span class="trp-report-kg"><input type="number" data-report-kg min="0" step="0.01" inputmode="decimal" value="${escapeAttr(e.composant.kgParAnimalJour)}"> kg/j</span>
      <span class="trp-report-actions"><button type="button" class="stk-btn-sombre" data-report-valider disabled>Reporter à partir du ${jjmm(e.date)}</button>
        <button type="button" class="stk-lien-gris" data-report-annuler>Annuler</button></span>
    </div>` : ''}
  </div>`;
}

// Historique des rations d'un lot (ex-journal des distributions) : dates,
// composants, consommé ; chaque ration est supprimable.
function historiqueLot(lot) {
  const liste = historiqueAffectations(lot);
  if (!liste.length) return '<p class="stk-vide">Aucune ration distribuée à ce lot.</p>';
  return `<div class="stk-mvts">${liste.map((a) => {
    const comp = composantsAffectation(a);
    const conso = comp.reduce((n, c) => n + tonnesComposant(a, c), 0);
    const dates = a.dateFin ? `${jjmm(a.dateDebut)}/${a.dateDebut.slice(2, 4)} → ${jjmm(a.dateFin)}/${a.dateFin.slice(2, 4)}` : `depuis le ${jjmm(a.dateDebut)}/${a.dateDebut.slice(2, 4)}`;
    return `<div class="stk-mvt"><div><span class="stk-mvt-nom">${escapeHtml(dates)} · ${a.nbBrebis || 0} têtes</span>
      <span class="stk-sous-ligne">${comp.length ? escapeHtml(comp.map((c) => `${c.stockLabel} ${kg(c.kgParAnimalJour)} kg/j`).join(' · ')) : 'Pâturage'}</span></div>
      <div class="stk-mvt-droite"><strong>${formatTonnes(conso)} t</strong>
        <span class="trp-histo-actions"><button type="button" class="stk-lien" data-lot="${escapeAttr(lot.id)}" data-modifier-ration="${escapeAttr(a.id)}">Modifier</button>
        <button type="button" class="stk-suppr" data-lot="${escapeAttr(lot.id)}" data-suppr-ration="${escapeAttr(a.id)}">Supprimer</button></span></div></div>`;
  }).join('')}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
