// Vue Troupeau : lots d'animaux, rations par stade (multi-ingrédients :
// fourrage ferme + céréale ferme + aliments du commerce nommés à la main),
// plan de périodes par lot (stade × dates × effectif, y compris à l'avance),
// et le tableau croisant les stades physiologiques avec les stocks
// disponibles — l'objectif visuel du module : voir d'un coup d'œil ce que
// chaque stade tire sur quel stock, et combien de temps ça tient.
import { getStades, getStadeById, onStadesChange, setComposants, composantsDuStade, totalRation } from './stades.js';
import {
  getLots, getPrelevements, createLot, updateLot, deleteLot,
  planifierPeriode, supprimerPeriode, periodesLot, prelevementsActifs, stadeActifId,
  synchroniserStadeCache, joursNourris, besoinJournalierKg, tonnesConsommees, estActive
} from './lots.js';

import { construireTableau, lotsSansStock, autonomieLisible } from './alimentation.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import { getBatiments, accepteLots } from './batiments.js';

const panel = document.getElementById('lot-panel');
const form = document.getElementById('lot-form');
const titleEl = document.getElementById('lot-title');
const inputNom = document.getElementById('lot-nom');
const inputNb = document.getElementById('lot-nb');
const selectBatiment = document.getElementById('lot-batiment');
const inputNotes = document.getElementById('lot-notes');
const btnSave = document.getElementById('lot-save');
const btnDelete = document.getElementById('lot-delete');
const errorBanner = document.getElementById('lot-error-banner');
const errorText = document.getElementById('lot-error-text');

const periodesSection = document.getElementById('lot-periodes-section');
const periodesListeEl = document.getElementById('lot-periodes-liste');
const selectStadeP = document.getElementById('lot-p-stade');
const rationInfoP = document.getElementById('lot-p-ration-info');
const composantsPEl = document.getElementById('lot-p-composants');
const inputDebutP = document.getElementById('lot-p-debut');
const inputFinP = document.getElementById('lot-p-fin');
const inputEffectifP = document.getElementById('lot-p-effectif');
const besoinCalcP = document.getElementById('lot-p-besoin-calc');
const erreurP = document.getElementById('lot-p-erreur');
const btnAjouterPeriode = document.getElementById('lot-p-ajouter');

const alerteEl = document.getElementById('troupeau-alerte');
const totauxEl = document.getElementById('troupeau-totaux');
const tableauEl = document.getElementById('troupeau-tableau');
const lotsEl = document.getElementById('troupeau-lots');
const rationsEl = document.getElementById('troupeau-rations');
const sousVuesEl = document.getElementById('troupeau-sous-vues');
const vueActuelleEl = document.getElementById('troupeau-actuel');
const vueHistoriqueEl = document.getElementById('troupeau-historique');
const campagneEl = document.getElementById('troupeau-campagne');
const journalEl = document.getElementById('troupeau-journal');

// « Ration actuelle » : le contenu qui existait déjà (tuiles, tableau
// croisé, lots, rations). « Historique & bilan » : nouvelle sous-vue
// purement en lecture, dérivée du même historique de prélèvements — aucune
// saisie ne lui est propre.
let sousVueTroupeau = 'actuel';

let mode = null;
let editingId = null;
let editingLot = null;
let saveToken = 0;
let categories = [];     // sortie fusionnée stocks+journal (ferme uniquement)
let derniereVue = null;

class ErreurDeSaisie extends Error {}

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
document.getElementById('lot-error-close').addEventListener('click', hideError);

export function initAlimentation() {
  document.getElementById('btn-new-lot').addEventListener('click', () => openCreate());
  document.getElementById('lot-cancel').addEventListener('click', fermer);
  document.getElementById('btn-rations-toggle').addEventListener('click', () => {
    rationsEl.hidden = !rationsEl.hidden;
    document.getElementById('btn-rations-toggle').textContent =
      rationsEl.hidden ? 'Rations par stade ▾' : 'Rations par stade ▴';
  });
  selectStadeP.addEventListener('change', () => peuplerComposantsPeriode());
  inputEffectifP.addEventListener('input', majBesoinPeriode);
  btnAjouterPeriode.addEventListener('click', ajouterPeriode);
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
  onStadesChange(peuplerStades);
  // L'édition d'un composant (dose, ajout, suppression) réécrit le stade
  // dans Firestore : le snapshot revient ici et doit redessiner les cartes
  // de ration, sinon la ligne qu'on vient de modifier semble ne rien faire.
  onStadesChange(() => renderRations());
  sousVuesEl.querySelectorAll('[data-sousvue]').forEach((b) => {
    b.addEventListener('click', () => {
      sousVueTroupeau = b.dataset.sousvue;
      afficherSousVue();
    });
  });
}

function afficherSousVue() {
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

export function setCategories(list) {
  categories = list;
}

function peuplerStades(stades) {
  const valeur = selectStadeP.value;
  selectStadeP.innerHTML = stades
    .map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.nom)}</option>`)
    .join('');
  if (valeur && stades.some((s) => s.id === valeur)) selectStadeP.value = valeur;
  peuplerComposantsPeriode();
}

// Stocks fermiers d'une famille (fourrage -> récoltes de foin, céréale ->
// récoltes de céréales), avec le restant déjà calculé par le tableau croisé
// quand il est disponible, sinon le tonnage brut de la récolte.
function stocksPourFamille(origine) {
  const famille = origine === 'cereale' ? 'cereale' : 'foin';
  return categories.filter((c) => c.categorie === famille);
}

function resteStock(cle, fallbackTonnes) {
  const c = derniereVue ? derniereVue.colonnes.find((x) => x.cle === cle) : null;
  return c && c.restant != null ? c.restant : fallbackTonnes;
}

// Reconstruit la zone des composants pour le stade choisi dans le formulaire
// de nouvelle période : un fourrage/une céréale ferme demande un choix de
// stock (précoché sur celui de la période précédente du même composant s'il
// existe encore), un aliment du commerce n'en a pas besoin.
function peuplerComposantsPeriode(stocksPreselectionnes = {}) {
  const stade = getStadeById(selectStadeP.value);
  const composants = composantsDuStade(stade);
  rationInfoP.textContent = stade
    ? `Ration du stade : ${totalRation(composants)} kg/j par brebis${stade.precision ? ' — ' + stade.precision : ''}`
    : '';

  composantsPEl.innerHTML = composants.map((c) => {
    if (c.origine === 'commerce') {
      return `<div class="composant-ligne" data-composant="${escapeAttr(c.id)}">
        <div class="composant-info">
          <span class="composant-nom">🛒 ${escapeHtml(c.nom || 'Aliment du commerce')}</span>
          <span class="composant-dose">${c.doseKgParBrebis} kg/j — acheté au besoin</span>
        </div>
      </div>`;
    }
    const options = stocksPourFamille(c.origine);
    const preselection = stocksPreselectionnes[c.id] || '';
    return `<div class="composant-ligne" data-composant="${escapeAttr(c.id)}">
      <div class="composant-info">
        <span class="composant-nom">${c.origine === 'cereale' ? '🌽 Céréale' : '🌾 Fourrage'}</span>
        <span class="composant-dose">${c.doseKgParBrebis} kg/j</span>
      </div>
      <select class="composant-stock" data-composant="${escapeAttr(c.id)}">
        <option value="">— Choisir un stock —</option>
        ${options.map((o) => `<option value="${escapeAttr(o.cle)}">${escapeHtml(o.label)} — ${formatTonnes(resteStock(o.cle, o.tonnes))} t</option>`).join('')}
      </select>
    </div>`;
  }).join('');

  composantsPEl.querySelectorAll('.composant-stock').forEach((sel) => {
    const pre = stocksPreselectionnes[sel.dataset.composant];
    if (pre && Array.from(sel.options).some((o) => o.value === pre)) sel.value = pre;
  });

  majBesoinPeriode();
}

function majBesoinPeriode() {
  const stade = getStadeById(selectStadeP.value);
  const ration = stade ? totalRation(composantsDuStade(stade)) : 0;
  const nb = Number(inputEffectifP.value) || 0;
  besoinCalcP.textContent = Math.round(ration * nb) + ' kg/j';
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
  erreurP.hidden = true;
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
    periodesSection.hidden = true; // le plan de périodes n'a de sens qu'une fois le lot créé
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
    peuplerBatiments(lot.batimentId || '');

    periodesSection.hidden = false;
    peuplerStades(getStades());
    inputDebutP.value = aujourdhui();
    inputFinP.value = '';
    inputEffectifP.value = lot.nbBrebis != null ? lot.nbBrebis : '';
    const actif = stadeActifId(lot.id) || lot.stadeId;
    if (actif) selectStadeP.value = actif;
    // Préremplit les stocks avec ceux de la dernière période, composant par
    // composant : reconduire le même choix est le cas le plus fréquent.
    const derniereGroupe = periodesLot(lot.id)[0];
    const preselection = {};
    if (derniereGroupe) {
      derniereGroupe.lignes.forEach((p) => {
        if (p.composantId) preselection[p.composantId] = p.categorieCle;
      });
    }
    peuplerComposantsPeriode(preselection);
    renderPeriodes(lot);
  } catch (err) {
    showError('Impossible de charger ce lot : ' + ((err && err.message) || err));
  }
}

function renderPeriodes(lot) {
  const groupes = periodesLot(lot.id);
  periodesListeEl.innerHTML = groupes.length
    ? groupes.map((g) => {
        const active = g.lignes.some((p) => estActive(p));
        const dates = g.fin
          ? `${dateLisible(g.debut)} → ${dateLisible(g.fin)}`
          : `depuis le ${dateLisible(g.debut)}${active ? ' · en cours' : ''}`;
        const detail = g.lignes
          .map((p) => `${escapeHtml(p.categorieLabel || p.categorieCle)} : ${p.rationKgParBrebis} kg/j (${formatTonnes(tonnesConsommees(p))} t consommées)`)
          .join(' · ');
        return `<div class="apercu-activite">
          <div class="apercu-activite-corps">
            <span class="apercu-activite-nom">${escapeHtml(g.stadeNom || 'Stade non défini')} — ${g.nbBrebis || 0} brebis</span>
            <span class="apercu-activite-date">${escapeHtml(dates)}</span>
            <span class="apercu-activite-detail">${detail}</span>
          </div>
          <button type="button" class="btn-icone-suppr" data-groupe="${escapeAttr(g.groupeId)}" aria-label="Supprimer cette période">✕</button>
        </div>`;
      }).join('')
    : '<p class="list-empty">Aucune période planifiée pour ce lot.</p>';

  periodesListeEl.querySelectorAll('[data-groupe]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette période ? Cette action est irréversible.')) return;
      try {
        await supprimerPeriode(btn.dataset.groupe);
        await synchroniserStadeCache([lot], getPrelevements());
        renderPeriodes(lot);
      } catch (err) {
        showError('Suppression impossible : ' + ((err && err.message) || err));
      }
    });
  });
}

async function ajouterPeriode() {
  erreurP.hidden = true;
  if (!editingLot) return;
  btnAjouterPeriode.disabled = true;
  try {
    const stade = getStadeById(selectStadeP.value);
    if (!stade) throw new ErreurDeSaisie('Choisis un stade physiologique.');
    const nbBrebis = Number(inputEffectifP.value);
    if (!isFinite(nbBrebis) || nbBrebis <= 0) throw new ErreurDeSaisie("L'effectif doit être supérieur à 0.");
    const debut = inputDebutP.value || aujourdhui();
    const fin = inputFinP.value || null;
    if (fin && fin <= debut) throw new ErreurDeSaisie('La date de fin doit être postérieure à la date de début.');

    const stocksParComposant = {};
    composantsPEl.querySelectorAll('.composant-stock').forEach((sel) => {
      const cle = sel.value;
      if (!cle) return;
      const cat = categories.find((c) => c.cle === cle);
      stocksParComposant[sel.dataset.composant] = { cle, label: cat ? cat.label : cle };
    });
    const composantsFerme = composantsDuStade(stade).filter((c) => c.origine !== 'commerce');
    if (composantsFerme.length && composantsFerme.every((c) => !stocksParComposant[c.id])) {
      throw new ErreurDeSaisie('Choisis au moins un stock pour un composant de la ration (sinon rien ne sera compté).');
    }

    await planifierPeriode(editingLot, { stade, nbBrebis, debut, fin, stocksParComposant });
    log('période planifiée');
    inputDebutP.value = aujourdhui();
    inputFinP.value = '';
    renderPeriodes(editingLot);
  } catch (err) {
    erreurP.textContent = err instanceof ErreurDeSaisie
      ? err.message
      : `Erreur d'enregistrement : ${(err && err.message) || err}`;
    erreurP.hidden = false;
  } finally {
    btnAjouterPeriode.disabled = false;
  }
}

function fermer() {
  panel.hidden = true;
  mode = null;
  editingId = null;
  editingLot = null;
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

    if (!nom) throw new ErreurDeSaisie('Donne un nom au lot.');
    const n = Number(nbBrebis);
    if (!isFinite(n) || n <= 0) throw new ErreurDeSaisie('Le nombre de brebis doit être supérieur à 0.');

    if (mode === 'create') {
      const lotId = await createLot({ nom, nbBrebis: n, batimentId, notes });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) {
        log('lot créé — prêt pour la planification des périodes');
        openEditLot({ id: lotId, nom, nbBrebis: n, batimentId, notes, stadeId: null });
      }
    } else {
      await updateLot(editingId, { nom, nbBrebis: n, batimentId, notes });
      fini = true;
      clearTimeout(minuteur);
      if (monToken === saveToken) { log('lot mis à jour'); fermer(); }
    }
  } catch (err) {
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      if (err instanceof ErreurDeSaisie) showError(err.message);
      else showError(`Erreur d'enregistrement : ${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`);
    }
  } finally {
    fini = true;
    if (monToken === saveToken) { btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; }
  }
}

async function supprimer() {
  if (!editingId) return;
  if (!confirm('Supprimer ce lot et tout son historique de prélèvements ? Cette action est irréversible.')) return;
  btnDelete.disabled = true;
  try {
    await deleteLot(editingId);
    fermer();
  } catch (err) {
    showError('Erreur de suppression : ' + ((err && err.message) || err));
  } finally {
    btnDelete.disabled = false;
  }
}

// --- Vue ------------------------------------------------------------------
export function renderVue() {
  // Recale le cache stadeId de chaque lot sur le journal AVANT de calculer le
  // tableau : une période planifiée à l'avance dont la date de début vient
  // d'être atteinte doit se refléter sans aucune action manuelle.
  synchroniserStadeCache(getLots(), getPrelevements());

  const vue = construireTableau({
    categories,
    lots: getLots(),
    stades: getStades(),
    prelevements: getPrelevements()
  });
  derniereVue = vue;

  const orphelins = lotsSansStock(getLots(), getPrelevements());
  if (orphelins.length) {
    alerteEl.innerHTML =
      `⚠️ ${orphelins.length} lot${orphelins.length > 1 ? 's' : ''} sans stock affecté : ` +
      escapeHtml(orphelins.map((l) => l.nom).join(', ')) +
      ' — leur consommation n\'est comptée nulle part.';
    alerteEl.hidden = false;
  } else {
    alerteEl.hidden = true;
  }

  totauxEl.innerHTML = [
    tuile('Brebis', vue.totaux.nbBrebis, '', 'brebis'),
    tuile('Besoin / jour', Math.round(vue.totaux.besoinJourKg), ' kg', 'besoin'),
    tuile('Tiré des stocks', Math.round(vue.totaux.tireJourKg), ' kg/j', 'tire'),
    tuile('Stock restant', formatTonnes(vue.totaux.restant), ' t', 'restant'),
    tuile('Déjà consommé', formatTonnes(vue.totaux.consomme), ' t', 'consomme')
  ].join('');

  renderTableau(vue);
  renderLots(vue);
  renderRations();
  renderCampagne(vue);
  renderJournal();
  afficherSousVue();
}

function renderTableau(vue) {
  if (!vue.colonnes.length) {
    tableauEl.innerHTML = '<p class="list-empty">Aucun stock saisi. Commence par l\'onglet Stocks.</p>';
    return;
  }
  const entetes = vue.colonnes
    .map(
      (c) => `<th>
        <div class="col-nom">${escapeHtml(c.label)}${c.commerce ? ' <span class="col-commerce">achat</span>' : ''}</div>
        <div class="col-reste ${!c.commerce && c.restant <= 0 ? 'col-vide' : ''}">${c.commerce ? 'illimité' : formatTonnes(c.restant) + ' t restants'}</div>
        <div class="col-auto">${c.commerce ? '—' : (c.besoinJourKg > 0 ? autonomieLisible(c.autonomieJours) : '—')}</div>
      </th>`
    )
    .join('');

  const corps = vue.lignes
    .map((l) => {
      const actif = l.besoinJourKg > 0;
      return `<tr class="${actif ? '' : 'ligne-inactive'}">
        <th>
          <span class="pastille" style="background:${escapeAttr(l.stade.couleur || '#9a988f')}"></span>
          <span class="stade-nom">${escapeHtml(l.stade.nom)}</span>
          <span class="stade-sub">${l.nbBrebis} brebis · ${l.stade.rationKgParBrebis} kg/j</span>
        </th>
        ${vue.colonnes
          .map((c) => {
            const kg = l.parCategorie[c.cle];
            return kg
              ? `<td class="cell-active">${Math.round(kg)}<small> kg/j</small></td>`
              : '<td class="vide">—</td>';
          })
          .join('')}
        <td class="total">${l.besoinJourKg ? Math.round(l.besoinJourKg) + ' kg/j' : '—'}</td>
      </tr>`;
    })
    .join('');

  tableauEl.innerHTML = `
    <table class="tableau tableau-croise">
      <thead><tr><th class="coin">Stade</th>${entetes}<th class="total">Total</th></tr></thead>
      <tbody>${corps}</tbody>
      <tfoot>
        <tr><th>Tiré par jour</th>
          ${vue.colonnes.map((c) => `<td class="total">${c.besoinJourKg ? Math.round(c.besoinJourKg) + ' kg' : '—'}</td>`).join('')}
          <td class="total">${Math.round(vue.totaux.tireJourKg)} kg</td></tr>
        <tr><th>Épuisement estimé</th>
          ${vue.colonnes.map((c) => `<td class="${!c.commerce && c.autonomieJours != null && c.autonomieJours < 30 ? 'urgent' : ''}">${c.commerce ? '—' : (c.dateEpuisement ? escapeHtml(dateLisible(c.dateEpuisement)) : '—')}</td>`).join('')}
          <td></td></tr>
      </tfoot>
    </table>`;
}

function renderLots(vue) {
  const lots = getLots();
  if (!lots.length) {
    lotsEl.innerHTML = '<p class="list-empty">Aucun lot. Utilise « ➕ Lot » pour en créer un.</p>';
    return;
  }
  lotsEl.innerHTML = lots
    .map((lot) => {
      const stade = getStadeById(stadeActifId(lot.id) || lot.stadeId);
      const actifs = prelevementsActifs(lot.id, getPrelevements());
      const besoinTotal = actifs.reduce((n, p) => n + besoinJournalierKg(p), 0);
      const detail = actifs.length
        ? actifs.map((p) => {
            const colonne = vue.colonnes.find((c) => c.cle === p.categorieCle);
            return `🌾 ${escapeHtml(p.categorieLabel || p.categorieCle)}` +
              (colonne && !colonne.commerce && colonne.autonomieJours != null ? ` · reste ${autonomieLisible(colonne.autonomieJours)}` : '');
          }).join(' · ')
        : '<span class="sans-stock">aucun stock affecté</span>';
      return `
      <div class="lot-card" data-id="${escapeAttr(lot.id)}">
        <span class="pastille" style="background:${escapeAttr(stade ? stade.couleur : '#9a988f')}"></span>
        <div class="lot-card-body">
          <div class="lot-card-nom">${escapeHtml(lot.nom || 'Lot')} <span class="lot-card-nb">${lot.nbBrebis} brebis</span></div>
          <div class="lot-card-sub">${escapeHtml(stade ? stade.nom : 'stade non défini')}${actifs.length ? ' · ' + Math.round(besoinTotal) + ' kg/j' : ''}</div>
          <div class="lot-card-stock">${detail}</div>
        </div>
      </div>`;
    })
    .join('');
  lotsEl.querySelectorAll('.lot-card').forEach((el) => {
    el.addEventListener('click', () => {
      const lot = getLots().find((l) => l.id === el.dataset.id);
      if (lot) openEditLot(lot);
    });
  });
}

// Les rations sont ajustables sur place, composant par composant : elles
// changent d'une année à l'autre, et passer par un build pour ajouter un
// ingrédient serait absurde.
function renderRations() {
  const stades = getStades();
  rationsEl.innerHTML = stades
    .map((s) => {
      const composants = composantsDuStade(s);
      return `
    <div class="ration-stade-card" data-stade="${escapeAttr(s.id)}">
      <div class="ration-stade-entete">
        <span class="pastille" style="background:${escapeAttr(s.couleur || '#9a988f')}"></span>
        <span class="ration-stade-nom">${escapeHtml(s.nom)}${s.precision ? `<span class="ration-precision">${escapeHtml(s.precision)}</span>` : ''}</span>
        <span class="ration-stade-total">${totalRation(composants)} kg/j</span>
      </div>
      <div class="ration-composants">
        ${composants.map((c) => ligneComposantRation(s.id, c)).join('')}
      </div>
      <button type="button" class="btn btn-secondary btn-mini ration-ajouter" data-stade="${escapeAttr(s.id)}">➕ Ingrédient</button>
    </div>`;
    })
    .join('');

  rationsEl.querySelectorAll('.ration-composants').forEach((wrap) => {
    cablerLigneComposant(wrap);
  });
  rationsEl.querySelectorAll('.ration-ajouter').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const stade = getStadeById(btn.dataset.stade);
      const composants = composantsDuStade(stade).concat([{ origine: 'fourrage', doseKgParBrebis: 0 }]);
      try { await appliquerNouvelleRation(btn.dataset.stade, composants); }
      catch (err) { alert('Ingrédient non ajouté : ' + ((err && err.message) || err)); }
    });
  });
}

function ligneComposantRation(stadeId, c) {
  return `<div class="ration-composant-ligne" data-stade="${escapeAttr(stadeId)}" data-composant="${escapeAttr(c.id)}">
    <select class="rc-origine">
      <option value="fourrage" ${c.origine === 'fourrage' ? 'selected' : ''}>Fourrage ferme</option>
      <option value="cereale" ${c.origine === 'cereale' ? 'selected' : ''}>Céréale ferme</option>
      <option value="commerce" ${c.origine === 'commerce' ? 'selected' : ''}>Aliment du commerce</option>
    </select>
    <input type="text" class="rc-nom" placeholder="Nom de l'aliment" value="${escapeAttr(c.nom || '')}" ${c.origine === 'commerce' ? '' : 'hidden'}>
    <input type="number" class="rc-dose" step="0.1" min="0" inputmode="decimal" value="${c.doseKgParBrebis != null ? c.doseKgParBrebis : ''}">
    <span class="rc-unite">kg/j</span>
    <button type="button" class="rc-suppr" aria-label="Retirer cet ingrédient">✕</button>
  </div>`;
}

function cablerLigneComposant(wrap) {
  wrap.querySelectorAll('.ration-composant-ligne').forEach((ligne) => {
    const origineSel = ligne.querySelector('.rc-origine');
    const nomInput = ligne.querySelector('.rc-nom');
    origineSel.addEventListener('change', () => {
      nomInput.hidden = origineSel.value !== 'commerce';
    });
    const appliquer = async () => {
      const stadeId = ligne.dataset.stade;
      const stade = getStadeById(stadeId);
      const composants = composantsDuStade(stade).map((c) => {
        if (c.id !== ligne.dataset.composant) return c;
        return {
          id: c.id,
          origine: origineSel.value,
          nom: origineSel.value === 'commerce' ? nomInput.value.trim() : null,
          doseKgParBrebis: Number(ligne.querySelector('.rc-dose').value) || 0
        };
      });
      try { await appliquerNouvelleRation(stadeId, composants); }
      catch (err) { alert('Ration non enregistrée : ' + ((err && err.message) || err)); }
    };
    ligne.querySelector('.rc-dose').addEventListener('change', appliquer);
    nomInput.addEventListener('change', appliquer);
    origineSel.addEventListener('change', appliquer);
    ligne.querySelector('.rc-suppr').addEventListener('click', async () => {
      const stadeId = ligne.dataset.stade;
      const stade = getStadeById(stadeId);
      const composants = composantsDuStade(stade).filter((c) => c.id !== ligne.dataset.composant);
      try { await appliquerNouvelleRation(stadeId, composants); }
      catch (err) { alert('Suppression impossible : ' + ((err && err.message) || err)); }
    });
  });
}

// Changer la ration d'un stade doit produire DEUX effets, et pas un seul :
//   * ce qui a déjà été consommé ne bouge pas — chaque période de prélèvement
//     a figé sa ration au moment où elle a été créée, et réécrire le passé
//     rendrait les stocks faux ;
//   * mais le rythme de consommation À PARTIR D'AUJOURD'HUI doit suivre la
//     nouvelle ration, sinon corriger un chiffre n'a aucun effet visible tant
//     qu'on n'a pas rouvert chaque lot pour le réenregistrer.
// On referme donc la période en cours des lots à ce stade et on en rouvre
// une aujourd'hui avec les nouveaux composants, sur les mêmes stocks déjà
// choisis pour les composants qui existaient déjà.
async function appliquerNouvelleRation(stadeId, composants) {
  await setComposants(stadeId, composants);
  const stadeMaj = { ...(getStadeById(stadeId) || { id: stadeId }), composants };
  for (const lot of getLots().filter((l) => (stadeActifId(l.id) || l.stadeId) === stadeId)) {
    const actifs = prelevementsActifs(lot.id, getPrelevements());
    if (!actifs.length) continue;
    const stocksParComposant = {};
    actifs.forEach((p) => {
      if (p.composantId) stocksParComposant[p.composantId] = { cle: p.categorieCle, label: p.categorieLabel };
    });
    await planifierPeriode(lot, {
      stade: stadeMaj, nbBrebis: lot.nbBrebis, debut: aujourdhui(), fin: null, stocksParComposant
    });
  }
}

// --- Historique & bilan -----------------------------------------------------
// Bannière de cumul de campagne : le total déjà consommé, par stock
// d'origine, avec une barre proportionnelle au total — gabarit repris de
// mockups/maquette troupeau appli.html. Entièrement dérivé de vue.colonnes
// (déjà calculé par construireTableau pour le tableau croisé) : aucun
// nouveau calcul, seulement un second affichage des mêmes chiffres.
function renderCampagne(vue) {
  const sources = vue.colonnes
    .filter((c) => c.consomme > 0)
    .sort((a, b) => b.consomme - a.consomme);

  if (!sources.length) {
    campagneEl.innerHTML = '<p class="list-empty">Aucune consommation enregistrée pour le moment.</p>';
    return;
  }

  const total = vue.totaux.consomme || 0;
  const lignes = sources
    .map((c) => {
      const pct = total > 0 ? Math.round((c.consomme / total) * 100) : 0;
      return `
      <div class="campagne-source">
        <span>${escapeHtml(c.label)}${c.commerce ? ' <span class="col-commerce">achat</span>' : ''}</span>
        <span class="campagne-source-val">${formatTonnes(c.consomme)} t</span>
      </div>
      <div class="campagne-barre"><div class="campagne-barre-remplie" style="width:${pct}%"></div></div>`;
    })
    .join('');

  campagneEl.innerHTML = `
    <div class="campagne-entete">
      <div>
        <span class="campagne-label">Total consommé (campagne)</span>
        <span class="campagne-total">${formatTonnes(total)} tonnes</span>
      </div>
      <span class="campagne-brebis">${vue.totaux.nbBrebis} brebis</span>
    </div>
    <div class="campagne-detail">${lignes}</div>`;
}

// Journal de toutes les périodes de prélèvement, tous lots confondus, la
// plus récente d'abord — les périodes actives aujourd'hui passent devant,
// quelle que soit leur date de début : c'est ce qu'on regarde en premier.
function renderJournal() {
  const periodes = getPrelevements()
    .slice()
    .sort((a, b) => {
      const aActif = estActive(a), bActif = estActive(b);
      if (aActif && !bActif) return -1;
      if (!aActif && bActif) return 1;
      return a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : 0;
    });

  if (!periodes.length) {
    journalEl.innerHTML = '<p class="list-empty">Aucune période de consommation enregistrée.</p>';
    return;
  }

  journalEl.innerHTML = periodes
    .map((p) => {
      const actif = estActive(p);
      const badge = p.fin
        ? `${dateLisible(p.debut)} au ${dateLisible(p.fin)} (${joursNourris(p)} j)`
        : `En cours (depuis le ${dateLisible(p.debut)})`;
      const ration = p.rationKgParBrebis
        ? `Ration : ${p.rationKgParBrebis} kg/j (${p.categorieLabel || p.categorieCle || '—'})`
        : `Stock : ${p.categorieLabel || p.categorieCle || '—'}`;
      return `
      <div class="periode-card">
        <div class="periode-entete">
          <div>
            <span class="periode-badge ${actif ? 'periode-badge-encours' : ''}">${escapeHtml(badge)}</span>
            <h3 class="periode-titre">${escapeHtml(p.stadeNom || 'Stade non défini')} — ${p.nbBrebis || 0} brebis</h3>
          </div>
          <span class="periode-tonnage">${formatTonnes(tonnesConsommees(p))} t</span>
        </div>
        <p class="periode-sub">${escapeHtml(ration)}${actif ? ` · ${joursNourris(p)} jours consommés` : ''}</p>
      </div>`;
    })
    .join('');
}

function tuile(nom, val, unite, cls) {
  return `<div class="tuile tuile-${cls}"><div class="tuile-val">${val}<small>${unite || ''}</small></div><div class="tuile-nom">${nom}</div></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
