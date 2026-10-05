// Vue Stocks : synthèse d'exploitation + saisie d'une récolte.
import {
  CATEGORIES, CONSERVATIONS, COUPES, FOURRAGES,
  createStock, updateStock, deleteStock, calculerTonnes
} from './stocks.js';
import {
  stockDisponibleCanonique, entreesParCleFenetre, mouvementsDeAliment, tonnesDuMouvement, identiteDuMouvement
} from './fourrages.js';
import { getMouvements, deleteMouvement, typeMouvement } from './mouvements.js';
import { consommationCampagneParStock, lotsConsommateurs } from './rations-calc.js';
import { construireGroupes } from './groupes-stock.js';
import { getCampagneStockChoisie, bornesCampagneStock, dateReferenceCampagne } from './campagne-stock.js';
import { getInterventions } from './interventions.js';
import { openEditIntervention } from './ui-intervention.js';
import { openCreateMouvement, openEditMouvement } from './ui-mouvements.js';
import { ouvrirAjustement } from './ui-ajustement.js';
import { getCellules } from './cellules.js';
import { getEmplacements, getEmplacementById } from './emplacements.js';
import { getLots } from './lots.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { toastSucces, toastErreur } from './toast.js';
import { poidsBotteEffectif, setPoidsBotteStock } from './poids-bottes.js';

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
// Groupes dépliables (groupes-stock.js) : Luzerne, Foin de prairie (PT + PN),
// Enrubannage / ensilage, Céréales (+ Concentrés achetés), Paille. Tous les
// chiffres pour la campagne choisie dans l'en-tête (campagne-stock.js,
// 01/09-31/08) : reste à la date de référence (aujourd'hui, ou le 31/08 d'une
// campagne passée), récolté/acheté et consommé sur la fenêtre de la campagne.
const groupesOuverts = new Set(['luzerne']);
const mouvementsOuverts = new Set();
const menusOuverts = new Set();

function veille(dateIso) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function stockAuSoir(date) {
  return stockDisponibleCanonique(getMouvements(), getCellules(), getEmplacements(), getLots(), date);
}

// Stock théorique d'un aliment au soir d'une date — utilisé par
// l'ajustement (ui-ajustement.js) et, au commit suivant, par l'Inventaire.
export function stockTheoriqueAu(cle, date) {
  const g = stockAuSoir(date).find((x) => x.cle === cle);
  return g ? g.tonnes : 0;
}

function metaParCle() {
  const meta = new Map();
  categories.forEach((c) => meta.set(c.cle, { fourrage: c.fourrage || null, espece: c.espece || null }));
  // Enrubannage / ensilage : la clé ne le dit pas (stocké « en botte ») — on
  // le lit sur le type du hangar où l'aliment est entré.
  getMouvements().forEach((m) => {
    if (m.typeMouvement !== 'ENTREE_RECOLTE' && m.typeMouvement !== 'ENTREE_ACHAT') return;
    if (m.destinationType !== 'EMPLACEMENT_FOURRAGE') return;
    const e = getEmplacementById(m.destinationId);
    const id = identiteDuMouvement(m);
    if (!e || !id) return;
    if (e.typeFourrage === 'ENRUBANNAGE' || e.typeFourrage === 'SILAGE') {
      meta.set(id.cle, { ...(meta.get(id.cle) || {}), enrubannage: true });
    }
  });
  return meta;
}

function donneesCampagne() {
  const campagne = getCampagneStockChoisie();
  const b = bornesCampagneStock(campagne);
  const dateRef = dateReferenceCampagne(campagne);
  const lots = getLots();
  const reste = stockAuSoir(dateRef);
  const depart = new Map(stockAuSoir(veille(b.debut)).map((g) => [g.cle, g.tonnes]));
  const entrees = entreesParCleFenetre(getMouvements(), b.debut, dateRef);
  const conso = new Map(consommationCampagneParStock(lots, campagne, dateRef).map((c) => [c.cle, c.tonnes]));
  const mangeePar = lotsConsommateurs(lots, campagne, dateRef);
  return { campagne, b, dateRef, ...construireGroupes({ reste, depart, entrees, conso, meta: metaParCle(), mangeePar }) };
}

export function renderVue() {
  const groupesEl = document.getElementById('stocks-groupes');
  if (!groupesEl) return;
  const d = donneesCampagne();
  const enCours = d.dateRef !== d.b.fin;
  document.getElementById('stocks-sous-titre').textContent =
    `${formatTonnes(d.totaux.total)} t disponibles` + (enCours ? '' : ` au ${dateLisible(d.b.fin)}`);

  totauxEl.innerHTML = [
    ['🌿', 'Fourrages', d.totaux.fourrages],
    ['🌾', 'Céréales', d.totaux.cereales],
    ['🧺', 'Paille', d.totaux.paille]
  ].map(([ico, nom, t]) => `<div class="stk-ligne-total"><span><span class="stk-ico">${ico}</span>${nom}</span><strong>${formatTonnes(t)} t</strong></div>`).join('');

  groupesEl.innerHTML = d.groupes.length
    ? d.groupes.map((g) => carteGroupe(g, d)).join('')
    : '<p class="list-empty">Aucun stock sur cette campagne. Une récolte saisie dans une activité (pressage, séchage en grange, moisson) apparaît ici automatiquement.</p>';
  cablerGroupes(groupesEl, d);
}

function sousTitreGroupe(g) {
  const parts = [];
  if (g.depart > 0.001) parts.push(`départ ${formatTonnes(g.depart)} t`);
  parts.push(`récolté ${formatTonnes(g.recolte)} t`);
  if (g.achat > 0.001) parts.push(`acheté ${formatTonnes(g.achat)} t`);
  parts.push(g.id === 'paille' ? 'pas de suivi de consommation' : `consommé ${formatTonnes(g.conso)} t`);
  const t = parts.join(' · ');
  return t[0].toUpperCase() + t.slice(1);
}

function bottesDe(ligne) {
  if (!ligne.cle) return null;
  const poids = poidsBotteEffectif(categories, ligne.cle);
  const cat = categories.find((c) => c.cle === ligne.cle);
  if (!(poids > 0) || !(cat && cat.nbBottes > 0)) return null;
  return { poids, nb: Math.round((ligne.reste * 1000) / poids) };
}

function carteGroupe(g, d) {
  const ouvert = groupesOuverts.has(g.id);
  const lignes = g.lignes.map((l) => {
    const bottes = bottesDe(l);
    const detail = l.cle === null ? `<span class="stk-sous-ligne">${escapeHtml(l.produits.join(', '))}</span>` : '';
    const bot = bottes ? `<span class="stk-sous-ligne">≈ ${bottes.nb} bottes · <input type="number" class="stk-poids" data-cle="${escapeAttr(l.cle)}" value="${bottes.poids}" min="0" step="1" inputmode="numeric"> kg/botte</span>` : '';
    return `<div class="stk-detail-ligne"><span class="stk-detail-nom">${escapeHtml(l.libelle)}${detail}${bot}</span><strong>${formatTonnes(l.reste)} t</strong></div>`;
  }).join('');
  const mangee = g.id !== 'paille' && g.mangeePar.length
    ? `<button type="button" class="stk-lien-ligne" data-vers="troupeau"><span>Mangée par ${escapeHtml(g.mangeePar.join(', '))}</span><span class="stk-lien">Troupeau →</span></button>`
    : '';
  const menu = menusOuverts.has(g.id) ? `<div class="stk-menu">
      <button type="button" data-action="ENTREE_ACHAT">🛒 Achat</button>
      <button type="button" data-action="SORTIE_VENTE">💰 Vente</button>
      <button type="button" data-action="PERTE">🗑️ Perte</button>
      <button type="button" data-action="AJUSTEMENT">⚖️ Ajustement</button>
    </div>` : '';
  const mouvements = mouvementsOuverts.has(g.id) ? listeMouvements(g, d) : '';
  const jauge = g.jauge == null ? '' : `<div class="stk-jauge"><div class="stk-jauge-${g.id}" style="width:${g.jauge}%"></div></div>`;
  return `<details class="stk-groupe" data-groupe="${g.id}"${ouvert ? ' open' : ''}>
    <summary>
      <div class="stk-groupe-tete"><span class="stk-groupe-nom">${escapeHtml(g.nom)}${g.precision ? ` <small>(${escapeHtml(g.precision)})</small>` : ''}</span>
        <span class="stk-groupe-val">${formatTonnes(g.reste)} t <span class="stk-chev">▾</span></span></div>
      <p class="stk-groupe-sous">${escapeHtml(sousTitreGroupe(g))}</p>
      ${jauge}
    </summary>
    ${lignes}
    ${mangee}
    <div class="stk-actions">
      <button type="button" class="stk-lien" data-menu="${g.id}">＋ Achat / ajustement</button>
      <button type="button" class="stk-lien-gris" data-mouvements="${g.id}">Mouvements ${mouvementsOuverts.has(g.id) ? '▴' : '▾'}</button>
    </div>
    ${menu}
    ${mouvements}
  </details>`;
}

const SUPPRIMABLES = ['ENTREE_ACHAT', 'SORTIE_VENTE', 'PERTE', 'AJUSTEMENT'];

function mouvementsDuGroupe(g, d) {
  const mvts = getMouvements().filter((m) => m.typeMouvement !== 'SORTIE_ALIMENTATION');
  const parId = new Map();
  g.cles.forEach((cle) => mouvementsDeAliment(cle, mvts).forEach((m) => parId.set(m.id, m)));
  return Array.from(parId.values())
    .filter((m) => m.date >= d.b.debut && m.date <= d.b.fin)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function listeMouvements(g, d) {
  const mvts = mouvementsDuGroupe(g, d);
  const anciennes = stocks.filter((s) => g.cles.includes(s.categorieCle) && s.date >= d.b.debut && s.date <= d.b.fin);
  if (!mvts.length && !anciennes.length) return '<p class="stk-vide">Aucun mouvement sur cette campagne.</p>';
  const itv = getInterventions();
  const lignesMvt = mvts.map((m) => {
    const t = typeMouvement(m.typeMouvement);
    const q = m.typeMouvement === 'AJUSTEMENT'
      ? `${m.quantite > 0 ? '+' : ''}${formatTonnes(m.quantite)} t`
      : `${t.sens === -1 ? '−' : t.sens === 1 ? '+' : ''}${formatTonnes(m.unite === 'bottes' ? tonnesDuMouvement(m) : m.quantite)} t`;
    const activite = m.typeMouvement === 'ENTREE_RECOLTE' ? itv.find((i) => i.mouvementId === m.id) : null;
    const action = activite
      ? `<button type="button" class="stk-lien" data-activite="${escapeAttr(activite.id)}">Activité →</button>`
      : SUPPRIMABLES.includes(m.typeMouvement)
        ? `<button type="button" class="stk-suppr" data-supprimer="${escapeAttr(m.id)}">Supprimer</button>`
        : `<button type="button" class="stk-lien-gris" data-modifier="${escapeAttr(m.id)}">Modifier</button>`;
    const quoi = m.typeMouvement === 'AJUSTEMENT' ? (m.categorieLabel || '') : [m.sourceNom, m.destinationNom].filter(Boolean).join(' → ');
    return `<div class="stk-mvt"><div><span class="stk-mvt-nom">${t.icone} ${escapeHtml(t.label)} · ${escapeHtml(dateLisible(m.date))}</span>
      <span class="stk-sous-ligne">${escapeHtml(quoi || m.libelle || '')}</span></div>
      <div class="stk-mvt-droite"><strong>${q}</strong>${action}</div></div>`;
  }).join('');
  const lignesAnciennes = anciennes.map((s) => `<div class="stk-mvt"><div><span class="stk-mvt-nom">🌾 Récolte saisie à la main · ${escapeHtml(dateLisible(s.date))}</span>
      <span class="stk-sous-ligne">${escapeHtml(s.parcelleNom || 'sans parcelle')} · ancienne saisie, hors stock</span></div>
      <div class="stk-mvt-droite"><strong>${formatTonnes(s.tonnes)} t</strong><button type="button" class="stk-lien-gris" data-ancienne="${escapeAttr(s.id)}">Modifier</button></div></div>`).join('');
  return `<div class="stk-mvts">${lignesMvt}${lignesAnciennes}</div>`;
}

function cablerGroupes(racine, d) {
  racine.querySelectorAll('details.stk-groupe').forEach((det) => {
    det.addEventListener('toggle', () => {
      if (det.open) groupesOuverts.add(det.dataset.groupe); else groupesOuverts.delete(det.dataset.groupe);
    });
  });
  const groupe = (id) => d.groupes.find((g) => g.id === id);
  racine.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.menu;
    if (menusOuverts.has(id)) menusOuverts.delete(id); else menusOuverts.add(id);
    renderVue();
  }));
  racine.querySelectorAll('[data-mouvements]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.mouvements;
    if (mouvementsOuverts.has(id)) mouvementsOuverts.delete(id); else mouvementsOuverts.add(id);
    renderVue();
  }));
  racine.querySelectorAll('.stk-menu [data-action]').forEach((b) => b.addEventListener('click', () => {
    const g = groupe(b.closest('details').dataset.groupe);
    const action = b.dataset.action;
    menusOuverts.delete(g.id);
    if (action === 'AJUSTEMENT') {
      ouvrirAjustement({
        lignes: g.cles.map((cle) => ({ cle, libelle: libelleLigneGroupe(g, cle), label: libelleLigneGroupe(g, cle) })),
        date: d.dateRef,
        theoriqueAu: stockTheoriqueAu
      });
    } else {
      openCreateMouvement({ typeMouvement: action });
    }
    renderVue();
  }));
  racine.querySelectorAll('[data-vers="troupeau"]').forEach((b) => b.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('logisol:vue', { detail: 'troupeau' }));
  }));
  racine.querySelectorAll('[data-activite]').forEach((b) => b.addEventListener('click', () => {
    const itv = getInterventions().find((i) => i.id === b.dataset.activite);
    if (itv) openEditIntervention(itv);
  }));
  racine.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', () => {
    const m = getMouvements().find((x) => x.id === b.dataset.modifier);
    if (m) openEditMouvement(m);
  }));
  racine.querySelectorAll('[data-ancienne]').forEach((b) => b.addEventListener('click', () => {
    const st = stocks.find((x) => x.id === b.dataset.ancienne);
    if (st) openEdit(st);
  }));
  racine.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
    const m = getMouvements().find((x) => x.id === b.dataset.supprimer);
    if (!m) return;
    const t = typeMouvement(m.typeMouvement);
    if (!confirm(`Supprimer ${t.label.toLowerCase()} du ${dateLisible(m.date)} (${formatTonnes(m.quantite)} ${m.unite === 'bottes' ? 'bottes' : 't'}) ? Le stock sera recalculé.`)) return;
    b.disabled = true;
    try { await deleteMouvement(m.id); toastSucces('Mouvement supprimé.'); }
    catch (err) { toastErreur('Suppression impossible : ' + ((err && err.message) || err)); b.disabled = false; }
  }));
  racine.querySelectorAll('.stk-poids').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', async () => {
      try { await setPoidsBotteStock(input.dataset.cle, input.value); toastSucces('Poids de botte enregistré.'); }
      catch (err) { toastErreur('Enregistrement impossible : ' + ((err && err.message) || err)); }
    });
  });
}

function libelleLigneGroupe(g, cle) {
  const l = g.lignes.find((x) => x.cle === cle);
  if (l) return l.libelle;
  const cat = categories.find((c) => c.cle === cle);
  return (cat && cat.label) || cle;
}

export function formatTonnes(v) {
  const n = Number(v) || 0;
  return (Math.round(n * 100) / 100).toLocaleString('fr-FR');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
