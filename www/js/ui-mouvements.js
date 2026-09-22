// Formulaire de mouvement de stock + rendu de la vue Bâtiments.
//
// Le formulaire s'adapte au type choisi : une entrée n'a pas de contenant de
// départ, une sortie n'a pas de contenant d'arrivée, un transfert a les deux.
// Montrer les quatre listes en permanence obligerait à comprendre le modèle
// avant de saisir — au champ, c'est le meilleur moyen de ne rien saisir.
import {
  TYPES_GRAIN, TYPES_FOURRAGE, typeBatiment, labelGrain, labelFourrage,
  getBatiments, getBatimentById
} from './batiments.js';
import { getCellules, getCelluleById, cellulesDuBatiment, tauxRemplissage, contenuDe } from './cellules.js';
import { getEmplacements, getEmplacementById, emplacementsDuBatiment } from './emplacements.js';
import {
  TYPES_MOUVEMENT, typeMouvement, getMouvements, niveauContenant,
  createMouvement, updateMouvement, deleteMouvement
} from './mouvements.js';
import { getLots } from './lots.js';
import { getStadeById } from './stades.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import {
  openCreateBatiment, openEditBatiment, messageErreur, esc, ErreurDeSaisie
} from './ui-batiments.js';

const panel = document.getElementById('mouvement-panel');
const form = document.getElementById('mvt-form');
const el = {};
[ 'title','date','type','champ-source','source-type','source-id','source-libre',
  'champ-destination','dest-type','dest-id','dest-libre','quantite','quantite-label',
  'champ-poids','poids','aide','champ-grain','grain','libelle','intervenant',
  'save','cancel','delete','error-banner','error-text','error-close'
].forEach((k) => { el[k] = document.getElementById('mvt-' + k); });

const listeEl = document.getElementById('batiments-liste');
const totauxEl = document.getElementById('batiments-totaux');
const mouvementsEl = document.getElementById('mouvements-liste');

const SOURCES = [
  { value: 'PARCELLE',             label: 'Parcelle' },
  { value: 'FOURNISSEUR',          label: 'Fournisseur' },
  { value: 'CELLULE',              label: 'Cellule à grain' },
  { value: 'EMPLACEMENT_FOURRAGE', label: 'Emplacement fourrage' }
];
const DESTINATIONS = [
  { value: 'CELLULE',              label: 'Cellule à grain' },
  { value: 'EMPLACEMENT_FOURRAGE', label: 'Emplacement fourrage' },
  { value: 'LOT_BERGERIE',         label: 'Lot de bergerie' },
  { value: 'AUTRE',                label: 'Autre' }
];

let editId = null;
let saveToken = 0;
let parcelles = [];
let onChangeExterne = () => {};

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { el['error-text'].textContent = m; el['error-banner'].hidden = false; }
function hideError() { el['error-banner'].hidden = true; }

el.type.innerHTML = TYPES_MOUVEMENT.map((t) => `<option value="${t.value}">${t.icone} ${t.label}</option>`).join('');
el['source-type'].innerHTML = SOURCES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
el['dest-type'].innerHTML = DESTINATIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
// Une cellule peut contenir du grain (silo) ou du fourrage (séchage en
// grange) : le libellé du contenu suit le type de la cellule.
function labelContenuCellule(c) {
  return contenuDe(c) === 'FOURRAGE' ? labelFourrage(c.typeGrainActuel) : labelGrain(c.typeGrainActuel);
}

el.grain.innerHTML = TYPES_GRAIN.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
el['error-close'].addEventListener('click', hideError);

export function setParcellesMouvements(list) { parcelles = list; }

export function initBatiments(opts = {}) {
  onChangeExterne = opts.onChange || (() => {});
  document.getElementById('btn-new-batiment').addEventListener('click', openCreateBatiment);
  document.getElementById('btn-new-mouvement').addEventListener('click', () => openCreateMouvement());
  el.cancel.addEventListener('click', fermer);
  el.type.addEventListener('change', appliquerType);
  el['source-type'].addEventListener('change', () => peuplerCible('source'));
  el['dest-type'].addEventListener('change', () => peuplerCible('dest'));
  el['source-id'].addEventListener('change', majUnite);
  el['dest-id'].addEventListener('change', majUnite);
  form.addEventListener('submit', enregistrer);
  el.delete.addEventListener('click', supprimer);
}

// --- Formulaire -----------------------------------------------------------
function optionsPour(type) {
  if (type === 'PARCELLE') {
    return parcelles.map((p) => ({ value: p.id, label: p.nom || 'Sans nom' }));
  }
  if (type === 'CELLULE') {
    return getCellules().map((c) => {
      const b = getBatimentById(c.batimentId);
      const n = niveauContenant('CELLULE', c.id).quantite;
      return { value: c.id, label: `${b ? b.nom + ' — ' : ''}${c.nom} (${formatTonnes(n)} / ${formatTonnes(c.capaciteMaxTonnes)} t)` };
    });
  }
  if (type === 'EMPLACEMENT_FOURRAGE') {
    return getEmplacements().map((e) => {
      const b = getBatimentById(e.batimentId);
      const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id).quantite;
      return { value: e.id, label: `${b ? b.nom + ' — ' : ''}${e.nom} (${n} bottes)` };
    });
  }
  if (type === 'LOT_BERGERIE') {
    return getLots().map((l) => ({ value: l.id, label: `${l.nom} (${l.nbBrebis} brebis)` }));
  }
  return [];
}

function peuplerCible(quel, valeur) {
  const type = el[quel === 'source' ? 'source-type' : 'dest-type'].value;
  const select = el[quel === 'source' ? 'source-id' : 'dest-id'];
  const libre = el[quel === 'source' ? 'source-libre' : 'dest-libre'];
  const options = optionsPour(type);
  // FOURNISSEUR et AUTRE ne désignent rien d'enregistré : on saisit un nom.
  const saisieLibre = type === 'FOURNISSEUR' || type === 'AUTRE';
  select.hidden = saisieLibre;
  libre.hidden = !saisieLibre;
  select.innerHTML = options.length
    ? options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
    : '<option value="">— rien à sélectionner —</option>';
  if (valeur && options.some((o) => o.value === valeur)) select.value = valeur;
  majUnite();
}

// L'unité dépend du contenant réellement visé : tonnes pour un silo, bottes
// pour un hangar. L'afficher à côté du champ évite la confusion qui
// transformerait 40 bottes en 40 tonnes.
function majUnite() {
  const t = typeMouvement(el.type.value);
  const fourrage =
    (!el['champ-destination'].hidden && el['dest-type'].value === 'EMPLACEMENT_FOURRAGE') ||
    (!el['champ-source'].hidden && el['source-type'].value === 'EMPLACEMENT_FOURRAGE');
  const grain =
    (!el['champ-destination'].hidden && el['dest-type'].value === 'CELLULE') ||
    (!el['champ-source'].hidden && el['source-type'].value === 'CELLULE');

  el['quantite-label'].textContent = fourrage ? 'Nombre de bottes' : 'Quantité (tonnes)';
  el.quantite.step = fourrage ? '1' : '0.01';
  // Le poids d'une botte n'est demandé que lorsqu'il entre du fourrage : il
  // sert à convertir le stock en tonnes, et il change à chaque récolte.
  el['champ-poids'].hidden = !(fourrage && t.sens >= 0);
  el['champ-grain'].hidden = !(grain && t.sens >= 0);

  const cible = cibleContenant();
  if (cible && cible.type === 'CELLULE') {
    const c = getCelluleById(cible.id);
    if (c) {
      const n = niveauContenant('CELLULE', c.id).quantite;
      const reste = (Number(c.capaciteMaxTonnes) || 0) - n;
      el.aide.textContent = `${c.nom} : ${formatTonnes(n)} t sur ${formatTonnes(c.capaciteMaxTonnes)} t — reste ${formatTonnes(Math.max(0, reste))} t de place.`;
      el.aide.hidden = false;
      return;
    }
  }
  el.aide.hidden = true;
}

function cibleContenant() {
  const t = typeMouvement(el.type.value);
  if (t.sens >= 0 && !el['champ-destination'].hidden) {
    const type = el['dest-type'].value;
    if (type === 'CELLULE' || type === 'EMPLACEMENT_FOURRAGE') return { type, id: el['dest-id'].value };
  }
  return null;
}

function appliquerType() {
  const t = typeMouvement(el.type.value);
  const entree = t.sens === 1;
  const sortie = t.sens === -1;
  const transfert = el.type.value === 'TRANSFERT';
  const inventaire = el.type.value === 'INVENTAIRE';

  el['champ-source'].hidden = entree === false && sortie === false && inventaire ? true : false;
  el['champ-destination'].hidden = false;

  if (entree) {
    el['champ-source'].hidden = false;
    limiter('source-type', el.type.value === 'ENTREE_RECOLTE' ? ['PARCELLE'] : ['FOURNISSEUR']);
    limiter('dest-type', ['CELLULE', 'EMPLACEMENT_FOURRAGE']);
  } else if (sortie) {
    el['champ-source'].hidden = false;
    limiter('source-type', ['CELLULE', 'EMPLACEMENT_FOURRAGE']);
    limiter('dest-type', el.type.value === 'SORTIE_ALIMENTATION' ? ['LOT_BERGERIE', 'AUTRE'] : ['AUTRE']);
  } else if (transfert) {
    el['champ-source'].hidden = false;
    limiter('source-type', ['CELLULE', 'EMPLACEMENT_FOURRAGE']);
    limiter('dest-type', ['CELLULE', 'EMPLACEMENT_FOURRAGE']);
  } else if (inventaire) {
    // Un inventaire ne vient de nulle part : il constate ce qui est là.
    el['champ-source'].hidden = true;
    limiter('dest-type', ['CELLULE', 'EMPLACEMENT_FOURRAGE']);
  }
  peuplerCible('source');
  peuplerCible('dest');
  el.aide.hidden = el.aide.hidden && true;
  if (inventaire) {
    el.aide.textContent = 'Saisis la quantité RÉELLEMENT constatée : elle remplace le niveau calculé, et l\'écart reste visible dans l\'historique.';
    el.aide.hidden = false;
  }
}

function limiter(champ, valeurs) {
  const select = el[champ];
  const source = champ === 'source-type' ? SOURCES : DESTINATIONS;
  const garde = select.value;
  select.innerHTML = source
    .filter((s) => valeurs.includes(s.value))
    .map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
  if (valeurs.includes(garde)) select.value = garde;
}

export function openCreateMouvement(prefill = {}) {
  editId = null;
  panel.hidden = false;
  saveToken++;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  log('formulaire mouvement ouvert (création)');
  try {
    el.title.textContent = 'Nouveau mouvement';
    el.delete.hidden = true;
    el.date.value = aujourdhui();
    el.type.value = prefill.typeMouvement || 'ENTREE_RECOLTE';
    el.quantite.value = '';
    el.poids.value = '';
    el.libelle.value = '';
    el.intervenant.value = '';
    appliquerType();
    if (prefill.destinationType) {
      el['dest-type'].value = prefill.destinationType;
      peuplerCible('dest', prefill.destinationId);
    }
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + messageErreur(err));
  }
}

export function openEditMouvement(m) {
  editId = m.id;
  panel.hidden = false;
  saveToken++;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  try {
    el.title.textContent = 'Modifier — ' + typeMouvement(m.typeMouvement).label;
    el.delete.hidden = false;
    el.date.value = m.date || aujourdhui();
    el.type.value = m.typeMouvement;
    appliquerType();
    if (m.sourceType) { el['source-type'].value = m.sourceType; peuplerCible('source', m.sourceId); }
    if (m.sourceType === 'FOURNISSEUR') el['source-libre'].value = m.sourceNom || '';
    if (m.destinationType) { el['dest-type'].value = m.destinationType; peuplerCible('dest', m.destinationId); }
    if (m.destinationType === 'AUTRE') el['dest-libre'].value = m.destinationNom || '';
    el.quantite.value = m.quantite != null ? m.quantite : '';
    el.poids.value = m.poidsBotteKg != null ? m.poidsBotteKg : '';
    if (m.typeGrain) el.grain.value = m.typeGrain;
    el.libelle.value = m.libelle || '';
    el.intervenant.value = m.intervenant || '';
    majUnite();
  } catch (err) {
    showError('Impossible de charger ce mouvement : ' + messageErreur(err));
  }
}

function fermer() { panel.hidden = true; editId = null; }

function nomDe(type, id, libre) {
  if (type === 'FOURNISSEUR' || type === 'AUTRE') return libre;
  if (type === 'PARCELLE') { const p = parcelles.find((x) => x.id === id); return p ? p.nom : ''; }
  if (type === 'CELLULE') { const c = getCelluleById(id); return c ? c.nom : ''; }
  if (type === 'EMPLACEMENT_FOURRAGE') { const e = getEmplacementById(id); return e ? e.nom : ''; }
  if (type === 'LOT_BERGERIE') { const l = getLots().find((x) => x.id === id); return l ? l.nom : ''; }
  return '';
}

async function enregistrer(e) {
  e.preventDefault();
  const monToken = ++saveToken;
  hideError();
  el.save.disabled = true; el.save.textContent = 'Enregistrement...';
  let fini = false;
  const minuteur = setTimeout(() => {
    if (!fini && monToken === saveToken) {
      showError('Aucune réponse du serveur après 8 s — vérifie ta connexion ou les règles Firestore.');
    }
  }, 8000);
  try {
    // Tout est lu avant le premier await : les écritures déclenchent des
    // snapshots qui repeuplent les listes déroulantes.
    const sourceType = el['champ-source'].hidden ? null : el['source-type'].value;
    const destType = el['dest-type'].value;
    const sourceId = sourceType && !el['source-id'].hidden ? el['source-id'].value : null;
    const destId = !el['dest-id'].hidden ? el['dest-id'].value : null;
    const fourrage = destType === 'EMPLACEMENT_FOURRAGE' || sourceType === 'EMPLACEMENT_FOURRAGE';
    const data = {
      date: el.date.value,
      typeMouvement: el.type.value,
      sourceType,
      sourceId,
      sourceNom: nomDe(sourceType, sourceId, el['source-libre'].value.trim()),
      destinationType: destType,
      destinationId: destId,
      destinationNom: nomDe(destType, destId, el['dest-libre'].value.trim()),
      quantite: el.quantite.value,
      poidsBotteKg: el['champ-poids'].hidden ? null : el.poids.value,
      typeGrain: el['champ-grain'].hidden ? null : el.grain.value,
      unite: fourrage ? 'bottes' : 't',
      libelle: el.libelle.value,
      intervenant: el.intervenant.value
    };
    if (!data.libelle) {
      data.libelle = typeMouvement(data.typeMouvement).label +
        (data.sourceNom ? ' depuis ' + data.sourceNom : '') +
        (data.destinationNom ? ' vers ' + data.destinationNom : '');
    }
    if (editId) await updateMouvement(editId, data);
    else await createMouvement(data);
    fini = true; clearTimeout(minuteur);
    if (monToken === saveToken) { log('mouvement enregistré'); fermer(); onChangeExterne(); }
  } catch (err) {
    fini = true; clearTimeout(minuteur);
    if (monToken === saveToken) showError(messageErreur(err, 'lgs_mouvements_stock'));
  } finally {
    fini = true;
    if (monToken === saveToken) { el.save.disabled = false; el.save.textContent = 'Enregistrer'; }
  }
}

async function supprimer() {
  if (!editId) return;
  if (!confirm('Supprimer ce mouvement ? Les niveaux seront recalculés.')) return;
  el.delete.disabled = true;
  try { await deleteMouvement(editId); fermer(); onChangeExterne(); }
  catch (err) { showError(messageErreur(err)); }
  finally { el.delete.disabled = false; }
}

// ==========================================================================
// Rendu de la vue Bâtiments
// ==========================================================================
export function renderVue() {
  const batiments = getBatiments();
  const cellules = getCellules();
  const emplacements = getEmplacements();

  const tGrain = cellules.reduce((n, c) => n + niveauContenant('CELLULE', c.id).quantite, 0);
  const capaciteGrain = cellules.reduce((n, c) => n + (Number(c.capaciteMaxTonnes) || 0), 0);
  let bottes = 0;
  let tFourrage = 0;
  emplacements.forEach((e) => {
    const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id);
    bottes += n.quantite;
    tFourrage += (n.quantite * n.poidsMoyenBotteKg) / 1000;
  });
  const brebis = getLots().reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0);

  totauxEl.innerHTML = [
    tuile('Bâtiments', batiments.length, '', ''),
    tuile('Grain stocké', formatTonnes(tGrain), ' t', 'cereale'),
    tuile('Remplissage', capaciteGrain ? Math.round((tGrain / capaciteGrain) * 100) : 0, ' %', 'tire'),
    tuile('Bottes', Math.round(bottes), '', 'paille'),
    tuile('Fourrage', formatTonnes(tFourrage), ' t', ''),
    tuile('Brebis', brebis, '', 'brebis')
  ].join('');

  listeEl.innerHTML = batiments.length
    ? batiments.map((b) => carteBatiment(b, cellules, emplacements)).join('')
    : '<p class="list-empty">Aucun bâtiment. Utilise « ➕ Bâtiment » pour commencer.</p>';
  listeEl.querySelectorAll('.bat-card').forEach((card) => {
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-contenant]')) return;
      const b = getBatimentById(card.dataset.id);
      if (b) openEditBatiment(b);
    });
  });
  listeEl.querySelectorAll('[data-contenant]').forEach((node) => {
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openCreateMouvement({
        typeMouvement: node.dataset.contenant === 'CELLULE' ? 'ENTREE_RECOLTE' : 'ENTREE_RECOLTE',
        destinationType: node.dataset.contenant,
        destinationId: node.dataset.id
      });
    });
  });

  const mvts = getMouvements().slice(0, 30);
  mouvementsEl.innerHTML = mvts.length
    ? mvts.map(ligneMouvement).join('')
    : '<p class="list-empty">Aucun mouvement enregistré.</p>';
  mouvementsEl.querySelectorAll('.mvt-ligne').forEach((node) => {
    node.addEventListener('click', () => {
      const m = getMouvements().find((x) => x.id === node.dataset.id);
      if (m) openEditMouvement(m);
    });
  });
}

function carteBatiment(b, cellules, emplacements) {
  const t = typeBatiment(b.type);
  const cels = cellules.filter((c) => c.batimentId === b.id);
  const emps = emplacements.filter((e) => e.batimentId === b.id);
  const lots = getLots().filter((l) => l.batimentId === b.id);

  const contenus = [];
  cels.forEach((c) => {
    const n = niveauContenant('CELLULE', c.id).quantite;
    const taux = tauxRemplissage(c, n);
    contenus.push(`<div class="contenant-ligne" data-contenant="CELLULE" data-id="${esc(c.id)}">
      <span class="contenant-icone">${contenuDe(c) === 'FOURRAGE' ? '🌿' : '🌾'}</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(c.nom)}</div>
        <div class="contenant-detail">${formatTonnes(n)} / ${formatTonnes(c.capaciteMaxTonnes)} t · ${esc(labelContenuCellule(c))}</div>
        <div class="jauge"><div class="jauge-barre ${taux > 100 ? 'jauge-trop' : ''}" style="width:${Math.min(100, taux || 0)}%"></div></div>
      </div>
      <div class="contenant-taux ${taux > 100 ? 'urgent' : ''}">${taux != null ? taux + '%' : ''}</div>
    </div>`);
  });
  emps.forEach((e) => {
    const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id);
    contenus.push(`<div class="contenant-ligne" data-contenant="EMPLACEMENT_FOURRAGE" data-id="${esc(e.id)}">
      <span class="contenant-icone">🧻</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(e.nom)}</div>
        <div class="contenant-detail">${n.quantite} botte${n.quantite > 1 ? 's' : ''} · ${esc(labelFourrage(e.typeFourrage))}${n.poidsMoyenBotteKg ? ' · ~' + n.poidsMoyenBotteKg + ' kg' : ''}</div>
      </div>
      <div class="contenant-taux">${n.poidsMoyenBotteKg ? formatTonnes((n.quantite * n.poidsMoyenBotteKg) / 1000) + ' t' : ''}</div>
    </div>`);
  });
  lots.forEach((l) => {
    const st = getStadeById(l.stadeId);
    contenus.push(`<div class="contenant-ligne">
      <span class="contenant-icone">🐑</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(l.nom)}</div>
        <div class="contenant-detail">${l.nbBrebis} brebis · ${esc(st ? st.nom : 'stade non défini')}</div>
      </div>
    </div>`);
  });

  return `<div class="bat-card" data-id="${esc(b.id)}">
    <div class="bat-card-head">
      <span class="bat-icone" style="background:${esc(t.couleur)}">${t.icone}</span>
      <div class="bat-card-body">
        <div class="bat-card-nom">${esc(b.nom || 'Bâtiment')}</div>
        <div class="bat-card-sub">${esc(t.label)}${b.latitude != null ? ' · 📍 localisé' : ''}${b.remarques ? ' · ' + esc(b.remarques) : ''}</div>
      </div>
    </div>
    ${contenus.length ? `<div class="bat-contenus">${contenus.join('')}</div>` : '<p class="list-empty bat-vide">Aucun contenu — touche pour en ajouter.</p>'}
  </div>`;
}

function ligneMouvement(m) {
  const t = typeMouvement(m.typeMouvement);
  const unite = m.unite === 'bottes' ? 'bottes' : 't';
  const trajet = [m.sourceNom, m.destinationNom].filter(Boolean).join(' → ');
  return `<div class="mvt-ligne" data-id="${esc(m.id)}">
    <span class="mvt-icone">${t.icone}</span>
    <div class="mvt-body">
      <div class="mvt-nom">${esc(m.libelle || t.label)}</div>
      <div class="mvt-sub">${esc(dateLisible(m.date))}${trajet ? ' · ' + esc(trajet) : ''}${m.intervenant ? ' · ' + esc(m.intervenant) : ''}</div>
    </div>
    <div class="mvt-qte ${t.sens === -1 ? 'mvt-sortie' : t.sens === 1 ? 'mvt-entree' : ''}">${t.sens === -1 ? '−' : t.sens === 1 ? '+' : ''}${formatTonnes(m.quantite)} ${unite}</div>
  </div>`;
}

function tuile(nom, val, unite, cls) {
  return `<div class="tuile tuile-${cls}"><div class="tuile-val">${val}<small>${unite || ''}</small></div><div class="tuile-nom">${nom}</div></div>`;
}

// ==========================================================================
// Aperçu d'un bâtiment (ouvert depuis la carte) et bloc « Stockage par
// bâtiment » de l'onglet Stocks. Les deux réutilisent le même rendu de
// contenu : un bâtiment doit se lire pareil partout.
// ==========================================================================
const apercuPanel = document.getElementById('batapercu-panel');
const apercuNom = document.getElementById('batapercu-nom');
const apercuType = document.getElementById('batapercu-type');
const apercuContenu = document.getElementById('batapercu-contenu');
const stocksBatimentsEl = document.getElementById('stocks-batiments');
let batimentAffiche = null;

document.getElementById('batapercu-fermer').addEventListener('click', fermerApercuBatiment);
document.getElementById('batapercu-modifier').addEventListener('click', () => {
  const b = batimentAffiche;
  fermerApercuBatiment();
  if (b) openEditBatiment(b);
});
document.getElementById('batapercu-mouvement').addEventListener('click', () => {
  const b = batimentAffiche;
  fermerApercuBatiment();
  // Pré-cibler le premier contenant du bâtiment : depuis sa fiche, c'est
  // presque toujours sur lui qu'on veut enregistrer un mouvement.
  const c = b ? getCellules().find((x) => x.batimentId === b.id) : null;
  const e = !c && b ? getEmplacements().find((x) => x.batimentId === b.id) : null;
  openCreateMouvement(c
    ? { typeMouvement: 'ENTREE_RECOLTE', destinationType: 'CELLULE', destinationId: c.id }
    : e
      ? { typeMouvement: 'ENTREE_RECOLTE', destinationType: 'EMPLACEMENT_FOURRAGE', destinationId: e.id }
      : {});
});

export function ouvrirApercuBatiment(batiment) {
  if (!batiment) return;
  batimentAffiche = batiment;
  apercuPanel.hidden = false;   // affiché d'abord, rempli ensuite
  try {
    const t = typeBatiment(batiment.type);
    apercuNom.textContent = batiment.nom || 'Bâtiment';
    apercuType.textContent = `${t.icone} ${t.label}${batiment.remarques ? ' — ' + batiment.remarques : ''}`;
    apercuContenu.innerHTML = contenuBatiment(batiment) ||
      '<p class="list-empty">Aucun contenu enregistré pour ce bâtiment.</p>';
  } catch (err) {
    apercuContenu.innerHTML = '<p class="list-empty">Détails indisponibles : ' + esc((err && err.message) || err) + '</p>';
  }
}

export function fermerApercuBatiment() {
  apercuPanel.hidden = true;
  batimentAffiche = null;
}

// Rendu commun : jauges de remplissage des cellules, bottes par travée, lots
// présents et leur stade physiologique.
function contenuBatiment(b) {
  const blocs = [];
  getCellules().filter((c) => c.batimentId === b.id).forEach((c) => {
    const n = niveauContenant('CELLULE', c.id).quantite;
    const taux = tauxRemplissage(c, n);
    blocs.push(`<div class="contenant-ligne">
      <span class="contenant-icone">🌾</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(c.nom)}</div>
        <div class="contenant-detail">${formatTonnes(n)} / ${formatTonnes(c.capaciteMaxTonnes)} t · ${esc(labelContenuCellule(c))}</div>
        <div class="jauge"><div class="jauge-barre ${taux > 100 ? 'jauge-trop' : ''}" style="width:${Math.min(100, taux || 0)}%"></div></div>
      </div>
      <div class="contenant-taux ${taux > 100 ? 'urgent' : ''}">${taux != null ? taux + '%' : ''}</div>
    </div>`);
  });
  getEmplacements().filter((e) => e.batimentId === b.id).forEach((e) => {
    const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id);
    blocs.push(`<div class="contenant-ligne">
      <span class="contenant-icone">🧻</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(e.nom)}</div>
        <div class="contenant-detail">${n.quantite} botte${n.quantite > 1 ? 's' : ''} · ${esc(labelFourrage(e.typeFourrage))}${n.poidsMoyenBotteKg ? ' · ~' + n.poidsMoyenBotteKg + ' kg/botte' : ''}</div>
      </div>
      <div class="contenant-taux">${n.poidsMoyenBotteKg ? formatTonnes((n.quantite * n.poidsMoyenBotteKg) / 1000) + ' t' : ''}</div>
    </div>`);
  });
  getLots().filter((l) => l.batimentId === b.id).forEach((l) => {
    const st = getStadeById(l.stadeId);
    blocs.push(`<div class="contenant-ligne">
      <span class="contenant-icone">🐑</span>
      <div class="contenant-body">
        <div class="contenant-nom">${esc(l.nom)}</div>
        <div class="contenant-detail">${l.nbBrebis} brebis · ${esc(st ? st.nom : 'stade non défini')}</div>
      </div>
      ${st ? `<span class="pastille" style="background:${esc(st.couleur || '#9a988f')}"></span>` : ''}
    </div>`);
  });
  return blocs.join('');
}

// Bloc « Stockage par bâtiment » de l'onglet Stocks : les mêmes jauges, pour
// répondre à « où en sont mes silos » sans changer d'onglet.
export function renderStockageParBatiment() {
  if (!stocksBatimentsEl) return;
  const avecStockage = getBatiments().filter(
    (b) => getCellules().some((c) => c.batimentId === b.id) ||
           getEmplacements().some((e) => e.batimentId === b.id)
  );
  if (!avecStockage.length) {
    stocksBatimentsEl.innerHTML =
      '<p class="list-empty">Aucun bâtiment de stockage. Crée-les dans l\'onglet Bâtiments.</p>';
    return;
  }
  stocksBatimentsEl.innerHTML = avecStockage.map((b) => {
    const t = typeBatiment(b.type);
    return `<div class="bat-card bat-card-statique">
      <div class="bat-card-head">
        <span class="bat-icone" style="background:${esc(t.couleur)}">${t.icone}</span>
        <div class="bat-card-body">
          <div class="bat-card-nom">${esc(b.nom || 'Bâtiment')}</div>
          <div class="bat-card-sub">${esc(t.label)}</div>
        </div>
      </div>
      <div class="bat-contenus">${contenuBatiment(b)}</div>
    </div>`;
  }).join('');
}
