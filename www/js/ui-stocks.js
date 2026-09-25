// Vue Stocks : synthèse d'exploitation + saisie d'une récolte.
import {
  CATEGORIES, CONSERVATIONS, COUPES, FOURRAGES, labelCoupe,
  createStock, updateStock, deleteStock, calculerTonnes, totauxParFamille
} from './stocks.js';
import { croiseCoupeFourrage } from './fourrages.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('stock-panel');
const form = document.getElementById('stock-form');
const titleEl = document.getElementById('stock-title');
const inputDate = document.getElementById('stock-date');
const selectParcelle = document.getElementById('stock-parcelle');
const selectCategorie = document.getElementById('stock-categorie');
const champFoin = document.getElementById('stock-champ-foin');
const champCereale = document.getElementById('stock-champ-cereale');
const champBotte = document.getElementById('stock-champ-botte');
const champGrange = document.getElementById('stock-champ-grange');
const selectConservation = document.getElementById('stock-conservation');
const selectCoupe = document.getElementById('stock-coupe');
const selectFourrage = document.getElementById('stock-fourrage');
const inputFourrageAutre = document.getElementById('stock-fourrage-autre');
const inputEspece = document.getElementById('stock-espece');
const inputSurface = document.getElementById('stock-surface');
const inputTonnes = document.getElementById('stock-tonnes');
const inputNbBottes = document.getElementById('stock-nbbottes');
const inputPoidsBotte = document.getElementById('stock-poidsbotte');
const inputNbRemorques = document.getElementById('stock-nbremorques');
const inputKgRemorque = document.getElementById('stock-kgremorque');
const aideGrange = document.getElementById('stock-aide-grange');
const tonnageCalc = document.getElementById('stock-tonnage-calc');
const inputNotes = document.getElementById('stock-notes');
const btnSave = document.getElementById('stock-save');
const btnDelete = document.getElementById('stock-delete');
const errorBanner = document.getElementById('stock-error-banner');
const errorText = document.getElementById('stock-error-text');

const totauxEl = document.getElementById('stocks-totaux');
const croiseEl = document.getElementById('stocks-croise');
const categoriesEl = document.getElementById('stocks-categories');
const lignesEl = document.getElementById('stocks-lignes');

const AUTRE = '__autre__';

let mode = null;
let editingId = null;
let saveToken = 0;
let parcelles = [];
let stocks = [];
// Catégories fusionnées (récoltes saisies + entrées du journal), fournies par
// main.js : le tableau croisé et la synthèse doivent montrer TOUT le fourrage,
// quelle que soit la porte par laquelle il est entré.
let categories = [];

export function setCategories(list) { categories = list || []; }
let onChangeExterne = () => {};

class ErreurDeSaisie extends Error {}

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { errorText.textContent = m; errorBanner.hidden = false; }
function hideError() { errorBanner.hidden = true; errorText.textContent = ''; }
document.getElementById('stock-error-close').addEventListener('click', hideError);

// --- Remplissage des listes fixes ---
selectCategorie.innerHTML = CATEGORIES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
selectConservation.innerHTML = CONSERVATIONS.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
selectCoupe.innerHTML = COUPES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');

function peuplerFourrages() {
  // Les trois fourrages de l'exploitation, plus la possibilité d'en nommer un
  // autre : figer la liste obligerait à repasser par un build pour un essai.
  const connus = Array.from(new Set(FOURRAGES.concat(
    stocks.filter((s) => s.categorie === 'foin' && s.fourrage).map((s) => s.fourrage)
  )));
  connus.sort((a, b) => a.localeCompare(b, 'fr'));
  const valeur = selectFourrage.value;
  selectFourrage.innerHTML =
    connus.map((f) => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join('') +
    `<option value="${AUTRE}">+ Autre fourrage</option>`;
  if (valeur && (connus.includes(valeur) || valeur === AUTRE)) selectFourrage.value = valeur;
}

export function setParcelles(list) {
  parcelles = list;
  const valeur = selectParcelle.value;
  selectParcelle.innerHTML =
    '<option value="">— Aucune parcelle —</option>' +
    list.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.nom || 'Sans nom')}</option>`).join('');
  if (valeur) selectParcelle.value = valeur;
}

export function setStocks(list) {
  stocks = list;
  peuplerFourrages();
  renderVue();
}

export function initStocks(opts = {}) {
  onChangeExterne = opts.onChange || (() => {});
  document.getElementById('btn-new-stock').addEventListener('click', () => openCreate());
  document.getElementById('stock-cancel').addEventListener('click', fermer);
  [selectCategorie, selectConservation].forEach((el) => el.addEventListener('change', appliquerCategorie));
  selectFourrage.addEventListener('change', () => {
    inputFourrageAutre.hidden = selectFourrage.value !== AUTRE;
  });
  [inputNbBottes, inputPoidsBotte, inputNbRemorques, inputKgRemorque, inputTonnes]
    .forEach((el) => el.addEventListener('input', majTonnage));
  form.addEventListener('submit', enregistrer);
  btnDelete.addEventListener('click', supprimer);
}

// --- Formulaire -----------------------------------------------------------
function appliquerCategorie() {
  const cat = selectCategorie.value;
  const foin = cat === 'foin';
  champFoin.hidden = !foin;
  champCereale.hidden = cat !== 'cereale';
  // La paille se compte exactement comme le foin en botte.
  const enBotte = cat === 'paille' || (foin && selectConservation.value === 'botte');
  champBotte.hidden = !enBotte;
  champGrange.hidden = !(foin && selectConservation.value === 'grange');
  majAideGrange();
  majTonnage();
}

// Rappel de la dernière valeur saisie, sans la pré-remplir : une estimation de
// matière sèche par remorque n'est pas une constante, mais repartir de la
// dernière évite de chercher son carnet.
function majAideGrange() {
  const dernier = stocks.find((s) => s.categorie === 'foin' && s.conservation === 'grange' && s.kgMSParRemorque);
  if (dernier) {
    aideGrange.textContent = `Dernière estimation saisie : ${dernier.kgMSParRemorque} kg de matière sèche par remorque.`;
    aideGrange.hidden = false;
  } else {
    aideGrange.hidden = true;
  }
}

function lireFormulaire() {
  const cat = selectCategorie.value;
  const fourrage = selectFourrage.value === AUTRE ? inputFourrageAutre.value.trim() : selectFourrage.value;
  const parcelle = parcelles.find((p) => p.id === selectParcelle.value);
  return {
    date: inputDate.value,
    parcelleId: selectParcelle.value || null,
    parcelleNom: parcelle ? parcelle.nom || 'Sans nom' : '',
    categorie: cat,
    conservation: cat === 'foin' ? selectConservation.value : (cat === 'paille' ? 'botte' : null),
    coupe: cat === 'foin' ? selectCoupe.value : null,
    fourrage: cat === 'foin' ? fourrage : null,
    espece: cat === 'cereale' ? inputEspece.value.trim() : null,
    nbBottes: champBotte.hidden ? null : inputNbBottes.value,
    poidsBotteKg: champBotte.hidden ? null : inputPoidsBotte.value,
    nbRemorques: champGrange.hidden ? null : inputNbRemorques.value,
    kgMSParRemorque: champGrange.hidden ? null : inputKgRemorque.value,
    surfaceHa: cat === 'cereale' ? inputSurface.value : null,
    tonnesSaisies: cat === 'cereale' ? inputTonnes.value : null,
    notes: inputNotes.value
  };
}

// Le tonnage s'affiche pendant la frappe : c'est le chiffre que Vincent veut
// vérifier avant d'enregistrer, pas après.
function majTonnage() {
  const t = calculerTonnes(lireFormulaire());
  tonnageCalc.textContent = formatTonnes(t) + ' t';
}

function reinitialiser() {
  saveToken++;
  hideError();
  btnSave.disabled = false;
  btnSave.textContent = 'Enregistrer';
  [inputNbBottes, inputPoidsBotte, inputNbRemorques, inputKgRemorque,
   inputSurface, inputTonnes, inputEspece, inputFourrageAutre].forEach((el) => { el.value = ''; });
  inputNotes.value = '';
  inputFourrageAutre.hidden = true;
}

export function openCreate() {
  mode = 'create';
  editingId = null;
  panel.hidden = false;
  reinitialiser();
  log('formulaire récolte ouvert');
  try {
    titleEl.textContent = 'Nouvelle récolte';
    btnDelete.hidden = true;
    inputDate.value = aujourdhui();
    selectCategorie.value = 'foin';
    selectConservation.value = 'botte';
    selectCoupe.value = '1';
    peuplerFourrages();
    selectParcelle.value = '';
    appliquerCategorie();
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + ((err && err.message) || err));
  }
}

export function openEdit(s) {
  mode = 'edit';
  editingId = s.id;
  panel.hidden = false;
  reinitialiser();
  try {
    titleEl.textContent = 'Modifier la récolte';
    btnDelete.hidden = false;
    inputDate.value = s.date || aujourdhui();
    selectParcelle.value = s.parcelleId || '';
    selectCategorie.value = s.categorie || 'foin';
    selectConservation.value = s.conservation || 'botte';
    selectCoupe.value = String(s.coupe || 1);
    peuplerFourrages();
    if (s.fourrage && !Array.from(selectFourrage.options).some((o) => o.value === s.fourrage)) {
      selectFourrage.value = AUTRE;
      inputFourrageAutre.value = s.fourrage;
      inputFourrageAutre.hidden = false;
    } else if (s.fourrage) {
      selectFourrage.value = s.fourrage;
    }
    inputEspece.value = s.espece || '';
    inputSurface.value = s.surfaceHa != null ? s.surfaceHa : '';
    inputTonnes.value = s.tonnesSaisies != null ? s.tonnesSaisies : '';
    inputNbBottes.value = s.nbBottes != null ? s.nbBottes : '';
    inputPoidsBotte.value = s.poidsBotteKg != null ? s.poidsBotteKg : '';
    inputNbRemorques.value = s.nbRemorques != null ? s.nbRemorques : '';
    inputKgRemorque.value = s.kgMSParRemorque != null ? s.kgMSParRemorque : '';
    inputNotes.value = s.notes || '';
    appliquerCategorie();
  } catch (err) {
    showError('Impossible de charger cette récolte : ' + ((err && err.message) || err));
  }
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
    const data = lireFormulaire();
    if (data.categorie === 'foin' && !data.fourrage) {
      throw new ErreurDeSaisie('Indique le type de fourrage (ray-grass, luzerne, prairie naturelle...).');
    }
    if (data.categorie === 'cereale' && !data.espece) {
      throw new ErreurDeSaisie("Indique l'espèce récoltée.");
    }
    if (calculerTonnes(data) <= 0) {
      throw new ErreurDeSaisie('Le tonnage calculé est nul : vérifie les quantités saisies.');
    }
    if (mode === 'create') await createStock(data);
    else if (editingId) await updateStock(editingId, data);
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) { log('récolte enregistrée'); toastSucces('Récolte enregistrée.'); fermer(); onChangeExterne(); }
  } catch (err) {
    fini = true;
    clearTimeout(minuteur);
    if (monToken === saveToken) {
      const msg = err instanceof ErreurDeSaisie
        ? err.message
        : `Erreur d'enregistrement : ${err && err.code ? err.code + ' — ' : ''}${(err && err.message) || err}`;
      showError(msg);
      toastErreur(`Échec de l'enregistrement de la récolte : ${msg}`);
    }
  } finally {
    fini = true;
    if (monToken === saveToken) { btnSave.disabled = false; btnSave.textContent = 'Enregistrer'; }
  }
}

async function supprimer() {
  if (!editingId) return;
  if (!confirm('Supprimer cette récolte ? Cette action est irréversible.')) return;
  btnDelete.disabled = true;
  try {
    await deleteStock(editingId);
    toastSucces('Récolte supprimée.');
    fermer();
    onChangeExterne();
  } catch (err) {
    const msg = 'Erreur de suppression : ' + ((err && err.message) || err);
    showError(msg);
    toastErreur(msg);
  } finally {
    btnDelete.disabled = false;
  }
}

// --- Vue ------------------------------------------------------------------
export function renderVue() {
  // Les totaux de familles se recomposent depuis les catégories fusionnées :
  // totauxParFamille ne voit que la collection « stocks », donc pas les
  // récoltes entrées par le tunnel d'activité.
  const t = totauxParFamille(stocks);
  const tf = { foin: 0, cereale: 0, paille: 0 };
  categories.forEach((c) => {
    const fam = c.categorie || 'foin';
    tf[fam] = Math.round(((tf[fam] || 0) + (Number(c.tonnes) || 0)) * 1000) / 1000;
  });
  if (categories.length) { t.foin = tf.foin; t.cereale = tf.cereale; t.paille = tf.paille; }
  totauxEl.innerHTML = [
    tuile('Foin', t.foin, 'foin'),
    tuile('Céréales', t.cereale, 'cereale'),
    tuile('Paille', t.paille, 'paille')
  ].join('');

  // Le croisement se construit sur les catégories FUSIONNÉES : un pressage
  // saisi dans le tunnel d'activité y apparaît au même titre qu'une récolte
  // saisie ici. Seules les coupes réellement rencontrées sont affichées, pour
  // ne pas montrer quatre lignes vides sur une exploitation qui en fait deux.
  const { fourrages, coupes, valeur } = croiseCoupeFourrage(categories);
  if (!fourrages.length) {
    croiseEl.innerHTML = '<p class="list-empty">Aucune récolte de foin enregistrée. Une récolte saisie dans une activité (pressage, séchage en grange) apparaît ici automatiquement.</p>';
  } else {
    const lignesCoupes = coupes.length ? coupes : COUPES.map((c) => c.value);
    const totalLigne = (c) => fourrages.reduce((n, f) => n + valeur(c, f), 0);
    const totalCol = (f) => lignesCoupes.reduce((n, c) => n + valeur(c, f), 0);
    croiseEl.innerHTML = `
      <table class="tableau">
        <thead><tr><th></th>${fourrages.map((f) => `<th>${escapeHtml(f)}</th>`).join('')}<th class="total">Total</th></tr></thead>
        <tbody>
          ${lignesCoupes.map((c) => `
            <tr>
              <th>${escapeHtml(c ? labelCoupe(c) : 'coupe non précisée')}</th>
              ${fourrages.map((f) => cellule(valeur(c, f))).join('')}
              <td class="total">${formatTonnes(totalLigne(c))}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><th>Total</th>${fourrages.map((f) => `<td class="total">${formatTonnes(totalCol(f))}</td>`).join('')}
          <td class="total">${formatTonnes(fourrages.reduce((n, f) => n + totalCol(f), 0))}</td></tr></tfoot>
      </table>`;
  }

  const cats = categories;
  categoriesEl.innerHTML = cats.length
    ? cats.map((c) => `
      <div class="cat-card">
        <div class="cat-card-nom">${escapeHtml(c.label)}</div>
        <div class="cat-card-detail">${detailCategorie(c)}</div>
        <div class="cat-card-tonnes">${formatTonnes(c.tonnes)} t</div>
      </div>`).join('')
    : '<p class="list-empty">Aucune récolte saisie.</p>';

  lignesEl.innerHTML = stocks.length
    ? stocks.map((s) => `
      <div class="stock-ligne" data-id="${escapeAttr(s.id)}">
        <div class="stock-ligne-body">
          <div class="stock-ligne-nom">${escapeHtml(s.categorieLabel || '')}</div>
          <div class="stock-ligne-sub">${escapeHtml(s.parcelleNom || 'sans parcelle')} · ${escapeHtml(dateLisible(s.date))}${detailSaisie(s)}</div>
        </div>
        <div class="stock-ligne-tonnes">${formatTonnes(s.tonnes)} t</div>
      </div>`).join('')
    : '<p class="list-empty">Aucune récolte saisie.</p>';
  lignesEl.querySelectorAll('.stock-ligne').forEach((el) => {
    el.addEventListener('click', () => {
      const s = stocks.find((x) => x.id === el.dataset.id);
      if (s) openEdit(s);
    });
  });
}

function detailCategorie(c) {
  const bouts = [`${c.nbRecoltes} récolte${c.nbRecoltes > 1 ? 's' : ''}`];
  if (c.nbBottes) bouts.push(`${Math.round(c.nbBottes)} bottes`);
  if (c.nbRemorques) bouts.push(`${c.nbRemorques} remorques`);
  if (c.surfaceHa) bouts.push(`${c.surfaceHa} ha`);
  // D'où vient le chiffre : saisi ici, remonté du journal des activités, ou
  // les deux. Sans ça, un total qui bouge tout seul serait inexplicable.
  if (c.origine === 'journal') bouts.push('depuis les activités');
  else if (c.origine === 'mixte') bouts.push('saisies + activités');
  return escapeHtml(bouts.join(' · '));
}

function detailSaisie(s) {
  if (s.nbBottes) return ` · ${s.nbBottes} × ${s.poidsBotteKg || '?'} kg`;
  if (s.nbRemorques) return ` · ${s.nbRemorques} rem. × ${s.kgMSParRemorque || '?'} kg MS`;
  if (s.surfaceHa) return ` · ${s.surfaceHa} ha`;
  return '';
}

function tuile(nom, tonnes, cls) {
  return `<div class="tuile tuile-${cls}"><div class="tuile-val">${formatTonnes(tonnes)}<small> t</small></div><div class="tuile-nom">${nom}</div></div>`;
}

function cellule(v) {
  return v > 0 ? `<td>${formatTonnes(v)}</td>` : '<td class="vide">—</td>';
}

export function formatTonnes(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 100) / 100).toLocaleString('fr-FR');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
