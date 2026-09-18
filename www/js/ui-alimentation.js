// Vue Troupeau : lots d'animaux, rations par stade, et le tableau croisant
// les stades physiologiques avec les stocks disponibles — l'objectif visuel
// du module : voir d'un coup d'œil ce que chaque stade tire sur quel stock,
// et combien de temps ça tient.
import { getStades, getStadeById, onStadesChange, setRation } from './stades.js';
import {
  getLots, getPrelevements, createLot, updateLot, deleteLot, affecterStock,
  prelevementEnCours, historiqueLot, joursNourris, besoinJournalierKg, tonnesConsommees
} from './lots.js';

import { construireTableau, lotsSansStock, autonomieLisible } from './alimentation.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';

const panel = document.getElementById('lot-panel');
const form = document.getElementById('lot-form');
const titleEl = document.getElementById('lot-title');
const inputNom = document.getElementById('lot-nom');
const inputNb = document.getElementById('lot-nb');
const selectStade = document.getElementById('lot-stade');
const rationInfo = document.getElementById('lot-ration-info');
const selectStock = document.getElementById('lot-stock');
const inputDebut = document.getElementById('lot-debut');
const besoinCalc = document.getElementById('lot-besoin-calc');
const inputNotes = document.getElementById('lot-notes');
const histoEl = document.getElementById('lot-historique');
const btnSave = document.getElementById('lot-save');
const btnDelete = document.getElementById('lot-delete');
const errorBanner = document.getElementById('lot-error-banner');
const errorText = document.getElementById('lot-error-text');

const alerteEl = document.getElementById('troupeau-alerte');
const totauxEl = document.getElementById('troupeau-totaux');
const tableauEl = document.getElementById('troupeau-tableau');
const lotsEl = document.getElementById('troupeau-lots');
const rationsEl = document.getElementById('troupeau-rations');

const SANS_STOCK = '';

let mode = null;
let editingId = null;
let saveToken = 0;
let categories = [];     // sortie de stocks.agregerParCategorie()
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
  selectStade.addEventListener('change', majRationEtBesoin);
  inputNb.addEventListener('input', majRationEtBesoin);
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
  onStadesChange(peuplerStades);
}

export function setCategories(list) {
  categories = list;
  peuplerStocks(selectStock.value);
}

function peuplerStades(stades) {
  const valeur = selectStade.value;
  selectStade.innerHTML = stades
    .map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.nom)}</option>`)
    .join('');
  if (valeur && stades.some((s) => s.id === valeur)) selectStade.value = valeur;
  majRationEtBesoin();
}

function peuplerStocks(valeurCourante) {
  selectStock.innerHTML =
    `<option value="${SANS_STOCK}">— Aucun (à l'herbe, lot en attente) —</option>` +
    categories
      .map((c) => {
        const reste = derniereVue
          ? (derniereVue.colonnes.find((x) => x.cle === c.cle) || {}).restant
          : c.tonnes;
        return `<option value="${escapeAttr(c.cle)}">${escapeHtml(c.label)} — ${formatTonnes(reste != null ? reste : c.tonnes)} t</option>`;
      })
      .join('');
  if (valeurCourante && Array.from(selectStock.options).some((o) => o.value === valeurCourante)) {
    selectStock.value = valeurCourante;
  }
}

function majRationEtBesoin() {
  const stade = getStadeById(selectStade.value);
  const ration = stade ? Number(stade.rationKgParBrebis) || 0 : 0;
  rationInfo.textContent = stade
    ? `Ration du stade : ${ration} kg/j par brebis${stade.precision ? ' — ' + stade.precision : ''}`
    : '';
  const nb = Number(inputNb.value) || 0;
  besoinCalc.textContent = Math.round(ration * nb) + ' kg/j';
}

// --- Formulaire -----------------------------------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  inputNom.value = '';
  inputNb.value = '';
  inputNotes.value = '';
  histoEl.innerHTML = '';
}

export function openCreate() {
  mode = 'create';
  editingId = null;
  panel.hidden = false;
  reinitialiser();
  log('formulaire lot ouvert (création)');
  try {
    titleEl.textContent = 'Nouveau lot';
    btnDelete.hidden = true;
    peuplerStades(getStades());
    peuplerStocks(SANS_STOCK);
    inputDebut.value = aujourdhui();
    majRationEtBesoin();
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + ((err && err.message) || err));
  }
}

export function openEditLot(lot) {
  mode = 'edit';
  editingId = lot.id;
  panel.hidden = false;
  reinitialiser();
  try {
    titleEl.textContent = 'Modifier — ' + (lot.nom || 'lot');
    btnDelete.hidden = false;
    inputNom.value = lot.nom || '';
    inputNb.value = lot.nbBrebis != null ? lot.nbBrebis : '';
    peuplerStades(getStades());
    if (lot.stadeId) selectStade.value = lot.stadeId;
    const prel = prelevementEnCours(lot.id);
    peuplerStocks(prel ? prel.categorieCle : SANS_STOCK);
    inputDebut.value = prel ? prel.debut : aujourdhui();
    inputNotes.value = lot.notes || '';
    majRationEtBesoin();
    renderHistorique(lot);
  } catch (err) {
    showError('Impossible de charger ce lot : ' + ((err && err.message) || err));
  }
}

function renderHistorique(lot) {
  const h = historiqueLot(lot.id);
  histoEl.innerHTML = h.length
    ? h
        .map((p) => {
          const j = joursNourris(p);
          return `<div class="apercu-activite">
            <span class="apercu-activite-nom">${escapeHtml(p.categorieLabel || p.categorieCle)}</span>
            <span class="apercu-activite-date">${escapeHtml(dateLisible(p.debut))}${p.fin ? ' → ' + escapeHtml(dateLisible(p.fin)) : ' → en cours'} · ${j} j · ${formatTonnes(tonnesConsommees(p))} t</span>
          </div>`;
        })
        .join('')
    : '<p class="list-empty">Aucun prélèvement enregistré.</p>';
}

function fermer() {
  panel.hidden = true;
  mode = null;
  editingId = null;
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
    // Tout est lu AVANT le premier await : écrire déclenche des snapshots
    // Firestore qui repeuplent les listes déroulantes, et relire les champs
    // après coup renverrait des valeurs réinitialisées.
    const nom = inputNom.value.trim();
    const nbBrebis = inputNb.value;
    const stadeId = selectStade.value;
    const stade = getStadeById(stadeId);
    const categorieCle = selectStock.value || null;
    const categorie = categories.find((c) => c.cle === categorieCle) || null;
    const debut = inputDebut.value || aujourdhui();
    const notes = inputNotes.value;

    if (!nom) throw new ErreurDeSaisie('Donne un nom au lot.');
    const n = Number(nbBrebis);
    if (!isFinite(n) || n <= 0) throw new ErreurDeSaisie('Le nombre de brebis doit être supérieur à 0.');
    if (!stade) throw new ErreurDeSaisie('Choisis un stade physiologique.');
    if (categorieCle && !categorie) throw new ErreurDeSaisie('Ce stock n\'existe plus — choisis-en un autre.');

    let lotId = editingId;
    if (mode === 'create') {
      lotId = await createLot({ nom, nbBrebis: n, stadeId, notes });
    } else {
      await updateLot(lotId, { nom, nbBrebis: n, stadeId, notes });
    }

    await affecterStock(
      { id: lotId, nom, nbBrebis: n },
      {
        categorieCle,
        categorieLabel: categorie ? categorie.label : '',
        stade,
        debut
      }
    );

    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) { log('lot enregistré'); fermer(); }
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
  peuplerStocks(selectStock.value);
}

function renderTableau(vue) {
  if (!vue.colonnes.length) {
    tableauEl.innerHTML = '<p class="list-empty">Aucun stock saisi. Commence par l\'onglet Stocks.</p>';
    return;
  }
  const entetes = vue.colonnes
    .map(
      (c) => `<th>
        <div class="col-nom">${escapeHtml(c.label)}</div>
        <div class="col-reste ${c.restant <= 0 ? 'col-vide' : ''}">${formatTonnes(c.restant)} t restants</div>
        <div class="col-auto">${c.besoinJourKg > 0 ? autonomieLisible(c.autonomieJours) : '—'}</div>
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
          ${vue.colonnes.map((c) => `<td class="${c.autonomieJours != null && c.autonomieJours < 30 ? 'urgent' : ''}">${c.dateEpuisement ? escapeHtml(dateLisible(c.dateEpuisement)) : '—'}</td>`).join('')}
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
      const stade = getStadeById(lot.stadeId);
      const prel = prelevementEnCours(lot.id);
      const colonne = prel ? vue.colonnes.find((c) => c.cle === prel.categorieCle) : null;
      return `
      <div class="lot-card" data-id="${escapeAttr(lot.id)}">
        <span class="pastille" style="background:${escapeAttr(stade ? stade.couleur : '#9a988f')}"></span>
        <div class="lot-card-body">
          <div class="lot-card-nom">${escapeHtml(lot.nom || 'Lot')} <span class="lot-card-nb">${lot.nbBrebis} brebis</span></div>
          <div class="lot-card-sub">${escapeHtml(stade ? stade.nom : 'stade non défini')}${prel ? ' · ' + Math.round(besoinJournalierKg(prel)) + ' kg/j' : ''}</div>
          <div class="lot-card-stock">${
            prel
              ? '🌾 ' + escapeHtml(prel.categorieLabel || prel.categorieCle) +
                ` · depuis ${joursNourris(prel)} j` +
                (colonne && colonne.autonomieJours != null ? ` · reste ${autonomieLisible(colonne.autonomieJours)}` : '')
              : '<span class="sans-stock">aucun stock affecté</span>'
          }</div>
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

// Les rations sont ajustables sur place : elles changent d'une année à
// l'autre, et passer par un build pour corriger un chiffre serait absurde.
function renderRations() {
  const stades = getStades();
  rationsEl.innerHTML = stades
    .map(
      (s) => `
    <div class="ration-ligne">
      <span class="pastille" style="background:${escapeAttr(s.couleur || '#9a988f')}"></span>
      <div class="ration-nom">
        ${escapeHtml(s.nom)}
        ${s.precision ? `<span class="ration-precision">${escapeHtml(s.precision)}</span>` : ''}
      </div>
      <input type="number" class="ration-input" data-id="${escapeAttr(s.id)}"
             value="${s.rationKgParBrebis != null ? s.rationKgParBrebis : ''}" step="0.1" min="0" inputmode="decimal">
      <span class="ration-unite">kg/j</span>
    </div>`
    )
    .join('');
  rationsEl.querySelectorAll('.ration-input').forEach((el) => {
    el.addEventListener('change', async () => {
      try {
        await appliquerNouvelleRation(el.dataset.id, el.value);
        log('ration mise à jour');
      } catch (err) {
        alert('Ration non enregistrée : ' + ((err && err.message) || err));
      }
    });
  });
}

// Changer la ration d'un stade doit produire DEUX effets, et pas un seul :
//   * ce qui a déjà été consommé ne bouge pas — chaque période de prélèvement
//     a figé la ration en vigueur à l'époque, et réécrire le passé rendrait
//     les stocks faux ;
//   * mais le rythme de consommation À PARTIR D'AUJOURD'HUI doit suivre la
//     nouvelle ration, sinon corriger un chiffre n'a aucun effet visible tant
//     qu'on n'a pas rouvert chaque lot pour le réenregistrer.
// On clôture donc les prélèvements en cours des lots à ce stade et on en
// rouvre un aujourd'hui avec la nouvelle ration — sur le même stock.
async function appliquerNouvelleRation(stadeId, valeur) {
  await setRation(stadeId, valeur);
  const stadeMaj = { ...(getStadeById(stadeId) || { id: stadeId }), rationKgParBrebis: Number(valeur) };
  for (const lot of getLots().filter((l) => l.stadeId === stadeId)) {
    const prel = prelevementEnCours(lot.id);
    if (!prel) continue;
    await affecterStock(lot, {
      categorieCle: prel.categorieCle,
      categorieLabel: prel.categorieLabel,
      stade: stadeMaj,
      debut: aujourdhui()
    });
  }
}

function tuile(nom, val, unite, cls) {
  return `<div class="tuile tuile-${cls}"><div class="tuile-val">${val}<small>${unite || ''}</small></div><div class="tuile-nom">${nom}</div></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
