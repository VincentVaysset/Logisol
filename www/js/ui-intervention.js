// Tunnel de saisie d'une activité, en trois étapes.
//
// Objectif : qu'une saisie courante tienne en trois gestes — la cible,
// l'activité, valider. Tout ce qui n'est pas indispensable au champ est soit
// pré-rempli (date du jour, statut « Terminé »), soit replié (produit,
// matériel, temps, météo, photo). Aucune heure de début ni de fin n'est
// demandée : personne ne les note en bout de parcelle.
//
// L'étape 3 n'existe que pour les activités qui DÉPLACENT du stock : une
// fauche ou une moisson rentre du fourrage ou du grain quelque part, une
// distribution en sort. Dans ces cas, l'activité crée aussi le mouvement de
// stock correspondant — saisir les deux séparément serait le meilleur moyen
// d'en oublier un.
import {
  CATEGORIES, getTypes, getTypeById, onTypesChange, typeAffiche,
  typesPourCible, categorieDe, fluxDe, addType, TYPE_NOTE
} from './interventions-types.js';
import { getMateriels, getMaterielById, onMaterielsChange } from './materiel.js';
import { createIntervention, updateIntervention, deleteIntervention } from './interventions.js';
import { releverMeteo, resumeMeteo } from './meteo.js';
import { compresserPhoto, tailleLisible } from './photo.js';
import { aujourdhui } from './implantations.js';
import {
  TYPES_GRAIN, getBatiments, getBatimentById, accepteLots, labelGrain, labelFourrage
} from './batiments.js';
import { getCellules, getCelluleById } from './cellules.js';
import { getEmplacements, getEmplacementById } from './emplacements.js';
import { getLots } from './lots.js';
import { niveauContenant, createMouvement, updateMouvement, deleteMouvement, getMouvements } from './mouvements.js';

const panel = document.getElementById('intervention-panel');
const form = document.getElementById('itv-form');
const el = {};
[ 'title','back','steps','etape-1','etape-2','etape-3','cible','parcelles','pick-all',
  'pick-none','pick-count','activites','date','statut','notes','details','details-toggle',
  'champ-produit','produit','quantite','unite','champ-materiel','materiel','materiel-id','champ-duree',
  'newtype','newtype-toggle','newtype-nom','newtype-icone','newtype-cat','newtype-add',
  'duree','champ-meteo','meteo-text','meteo-refresh','photo-btn','photo-clear','photo-input',
  'photo-preview','photo-info','flux-intro','flux-source','flux-source-id','flux-dest',
  'flux-dest-id','flux-quantite','flux-quantite-label','flux-champ-poids','flux-poids',
  'flux-champ-grain','flux-grain',
  'flux-aide','next','save','cancel','delete','error-banner','error-text','error-close'
].forEach((k) => { el[k] = document.getElementById('itv-' + k); });

class ErreurDeSaisie extends Error {}

let mode = null;            // 'create' | 'edit'
let editingId = null;
let etape = 1;
let cible = 'PARCELLE';     // 'PARCELLE' | 'BERGERIE'
let typeChoisiId = null;
let statut = 'TERMINE';
let meteoCourante = null;
let photoCourante = null;
let selection = new Set();
let saveToken = 0;
let parcelles = [];
let mouvementLie = null;    // mouvement déjà créé par cette activité, en édition
let fluxEnregistre = null;  // intention de mouvement portée par l'activité

function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function showError(m) { el['error-text'].textContent = m; el['error-banner'].hidden = false; }
function hideError() { el['error-banner'].hidden = true; el['error-text'].textContent = ''; }
el['error-close'].addEventListener('click', hideError);

export function setParcellesDisponibles(list) {
  parcelles = list.map((p) => ({ id: p.id, nom: p.nom || 'Sans nom', surfaceHa: p.surfaceHa, couleur: p._couleur }));
  if (!panel.hidden && cible === 'PARCELLE') renderCibles();
}

onTypesChange(() => { if (!panel.hidden) renderActivites(); });

// Liste du parc, tenue à jour en direct : un matériel créé depuis l'onglet
// Bâtiments doit être proposé sans avoir à rouvrir le formulaire.
onMaterielsChange(() => peuplerMateriels(el['materiel-id'].value));

function peuplerMateriels(valeur) {
  const liste = getMateriels();
  el['materiel-id'].innerHTML =
    '<option value="">— Aucun —</option>' +
    liste.map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.nom)}${m.largeurTravailMetres ? ' (' + m.largeurTravailMetres + ' m)' : ''}</option>`).join('');
  if (valeur && liste.some((m) => m.id === valeur)) el['materiel-id'].value = valeur;
}

// --- Action sur mesure ----------------------------------------------------
// Un chantier inhabituel ne doit pas obliger à se rabattre sur « Autre » :
// le type créé ici est immédiatement sélectionné et réutilisable ensuite.
el['newtype-cat'].innerHTML = CATEGORIES
  .map((c) => `<option value="${c.value}">${c.icone} ${escapeHtml(c.label)}</option>`).join('');

el['newtype-toggle'].addEventListener('click', () => {
  el.newtype.hidden = !el.newtype.hidden;
  el['newtype-toggle'].textContent = el.newtype.hidden ? '＋ Action sur mesure' : '− Annuler la création';
});

el['newtype-add'].addEventListener('click', async () => {
  const nom = el['newtype-nom'].value.trim();
  if (!nom) { showError("Donne un nom à l'action."); return; }
  el['newtype-add'].disabled = true;
  try {
    const id = await addType(nom, el['newtype-icone'].value.trim(), '#9a988f', {
      categorie: el['newtype-cat'].value,
      cible: cible,          // créée depuis la cible en cours : une action
                             // inventée pour une parcelle concerne les parcelles
      flux: null
    });
    typeChoisiId = id;
    el['newtype-nom'].value = '';
    el.newtype.hidden = true;
    el['newtype-toggle'].textContent = '＋ Action sur mesure';
    hideError();
    renderActivites();
    appliquerType();
    log('action sur mesure créée : ' + nom);
  } catch (err) {
    showError("Action non créée : " + ((err && err.message) || err));
  } finally {
    el['newtype-add'].disabled = false;
  }
});

// --- Navigation entre étapes ---------------------------------------------
function typeCourant() { return getTypeById(typeChoisiId); }
function fluxCourant() { return fluxDe(typeCourant()); }

// Le nombre d'étapes dépend de l'activité : trois pour une fauche, deux pour
// un pâturage. Afficher un jalon qui ne mènera nulle part serait trompeur.
function nbEtapes() { return fluxCourant() ? 3 : 2; }

function renderSteps() {
  const total = nbEtapes();
  el.steps.innerHTML = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    return `<span class="tunnel-step ${n === etape ? 'is-active' : ''} ${n < etape ? 'is-done' : ''}">${n}</span>`;
  }).join('');
}

function allerA(n) {
  etape = n;
  el['etape-1'].hidden = n !== 1;
  el['etape-2'].hidden = n !== 2;
  el['etape-3'].hidden = n !== 3;
  el.back.hidden = n === 1;
  const dernier = n === nbEtapes();
  el.next.hidden = dernier;
  el.save.hidden = !dernier;
  renderSteps();
  if (n === 3) preparerFlux();
}

el.back.addEventListener('click', () => { if (etape > 1) allerA(etape - 1); });
el.next.addEventListener('click', () => {
  try {
    validerEtape(etape);
    hideError();
    allerA(etape + 1);
  } catch (err) {
    showError(err.message);
  }
});

function validerEtape(n) {
  if (n === 1) {
    if (!selection.size) {
      throw new ErreurDeSaisie(cible === 'PARCELLE'
        ? 'Choisis au moins une parcelle.'
        : 'Choisis au moins une bergerie.');
    }
    if (!typeChoisiId) throw new ErreurDeSaisie('Choisis une activité.');
  }
  if (n === 2 && !el.date.value) throw new ErreurDeSaisie('La date est obligatoire.');
}

// --- Étape 1 : cible et activité ------------------------------------------
el.cible.querySelectorAll('[data-cible]').forEach((b) => {
  b.addEventListener('click', () => {
    if (cible === b.dataset.cible) return;
    cible = b.dataset.cible;
    // Changer de cible invalide la sélection ET l'activité : une bergerie ne
    // se fauche pas, une parcelle ne s'allotit pas.
    selection = new Set();
    typeChoisiId = null;
    majCibleBoutons();
    renderCibles();
    renderActivites();
    renderSteps();
  });
});

function majCibleBoutons() {
  el.cible.querySelectorAll('[data-cible]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.cible === cible);
  });
}

function ciblesDisponibles() {
  if (cible === 'PARCELLE') return parcelles;
  return getBatiments().filter(accepteLots).map((b) => ({
    id: b.id,
    nom: b.nom || 'Bergerie',
    surfaceHa: null,
    couleur: '#8a6d5c',
    sousTitre: getLots().filter((l) => l.batimentId === b.id).reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0) + ' brebis'
  }));
}

function renderCibles() {
  const dispo = ciblesDisponibles();
  if (!dispo.length) {
    el.parcelles.innerHTML = `<p class="list-empty">${cible === 'PARCELLE'
      ? 'Aucune parcelle enregistrée.'
      : 'Aucune bergerie enregistrée — crée-la dans l\'onglet Bâtiments.'}</p>`;
    majCompteur();
    return;
  }
  el.parcelles.innerHTML = dispo.map((p) => `
    <label class="parcelle-pick${selection.has(p.id) ? ' is-picked' : ''}" data-id="${escapeAttr(p.id)}">
      <input type="checkbox" ${selection.has(p.id) ? 'checked' : ''} data-id="${escapeAttr(p.id)}">
      <span class="parcelle-pick-swatch" style="background:${escapeAttr(p.couleur || '#c4c0b0')}"></span>
      <span class="parcelle-pick-nom">${escapeHtml(p.nom)}</span>
      <span class="parcelle-pick-surface">${p.sousTitre ? escapeHtml(p.sousTitre) : (p.surfaceHa != null ? p.surfaceHa + ' ha' : '')}</span>
    </label>`).join('');
  el.parcelles.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selection.add(cb.dataset.id); else selection.delete(cb.dataset.id);
      cb.closest('.parcelle-pick').classList.toggle('is-picked', cb.checked);
      majCompteur();
    });
  });
  majCompteur();
}

function majCompteur() {
  const n = selection.size;
  const mot = cible === 'PARCELLE' ? 'parcelle' : 'bergerie';
  el['pick-count'].textContent = `${n} ${mot}${n > 1 ? 's' : ''}`;
}

el['pick-all'].addEventListener('click', () => { ciblesDisponibles().forEach((p) => selection.add(p.id)); renderCibles(); });
el['pick-none'].addEventListener('click', () => { selection.clear(); renderCibles(); });

// Grands boutons tactiles groupés par catégorie : c'est l'écran qu'on regarde
// avec des gants, il ne doit rien demander d'autre que de viser.
function renderActivites() {
  const dispo = typesPourCible(cible);
  const groupes = CATEGORIES
    .map((c) => ({ ...c, types: dispo.filter((t) => categorieDe(t) === c.value) }))
    .filter((g) => g.types.length);
  el.activites.innerHTML = groupes.map((g) => `
    <div class="activite-groupe">
      <div class="activite-groupe-titre">${g.icone} ${escapeHtml(g.label)}</div>
      <div class="activite-grille">
        ${g.types.map((t) => `
          <button type="button" class="activite-btn${t.id === typeChoisiId ? ' is-active' : ''}"
                  data-id="${escapeAttr(t.id)}" style="--act-couleur:${escapeAttr(t.couleur || '#9a988f')}">
            <span class="activite-icone">${escapeHtml(t.icone || '🔧')}</span>
            <span class="activite-nom">${escapeHtml(t.nom)}</span>
            ${fluxDe(t) ? '<span class="activite-flux">stock</span>' : ''}
          </button>`).join('')}
      </div>
    </div>`).join('');
  el.activites.querySelectorAll('.activite-btn').forEach((b) => {
    b.addEventListener('click', () => {
      typeChoisiId = b.dataset.id;
      el.activites.querySelectorAll('.activite-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      appliquerType();
      renderSteps();
      // Une activité choisie signifie presque toujours « je passe à la suite » :
      // on enchaîne, un geste de moins.
      try { validerEtape(1); hideError(); allerA(2); } catch (err) { /* cible pas encore choisie */ }
    });
  });
}

function appliquerType() {
  const t = typeCourant();
  const montre = (champ) => typeAffiche(t, champ);
  el['champ-produit'].hidden = !montre('produit');
  el['champ-materiel'].hidden = !montre('materiel');
  el['champ-duree'].hidden = !montre('duree');
  const meteoEtaitMasquee = el['champ-meteo'].hidden;
  el['champ-meteo'].hidden = !montre('meteo');
  if (meteoEtaitMasquee && !el['champ-meteo'].hidden && !meteoCourante && mode === 'create') {
    relever(true);
  }
}

// --- Étape 2 : statut et détails ------------------------------------------
el.statut.querySelectorAll('[data-statut]').forEach((b) => {
  b.addEventListener('click', () => { statut = b.dataset.statut; majStatutBoutons(); });
});
function majStatutBoutons() {
  el.statut.querySelectorAll('[data-statut]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.statut === statut);
  });
}
el['details-toggle'].addEventListener('click', () => {
  el.details.hidden = !el.details.hidden;
  el['details-toggle'].textContent = el.details.hidden
    ? '＋ Détails (produit, matériel, temps, météo, photo)'
    : '− Masquer les détails';
});

// --- Météo ----------------------------------------------------------------
function afficherMeteo() { el['meteo-text'].textContent = meteoCourante ? resumeMeteo(meteoCourante) : '—'; }
async function relever(automatique) {
  if (!el.date.value) return;
  el['meteo-text'].textContent = 'Relevé en cours...';
  try {
    meteoCourante = await releverMeteo(el.date.value);
    afficherMeteo();
  } catch (err) {
    meteoCourante = null;
    el['meteo-text'].textContent = 'Indisponible (' + ((err && err.message) || err) + ')';
    if (!automatique) log('météo indisponible : ' + ((err && err.message) || err));
  }
}
el['meteo-refresh'].addEventListener('click', () => relever(false));
el.date.addEventListener('change', () => {
  if (meteoCourante && meteoCourante.date === el.date.value) return;
  meteoCourante = null;
  afficherMeteo();
  if (!el['champ-meteo'].hidden && el.date.value) relever(true);
});

// --- Photo ----------------------------------------------------------------
el['photo-btn'].addEventListener('click', () => el['photo-input'].click());
el['photo-clear'].addEventListener('click', () => setPhoto(null));
el['photo-input'].addEventListener('change', async () => {
  const f = el['photo-input'].files[0];
  el['photo-input'].value = '';
  if (!f) return;
  el['photo-info'].textContent = 'Compression...';
  try { setPhoto(await compresserPhoto(f)); }
  catch (err) { setPhoto(null); showError('Photo : ' + ((err && err.message) || err)); }
});
function setPhoto(dataUrl) {
  photoCourante = dataUrl;
  el['photo-preview'].hidden = !dataUrl;
  el['photo-clear'].hidden = !dataUrl;
  el['photo-preview'].src = dataUrl || '';
  el['photo-info'].textContent = dataUrl ? tailleLisible(dataUrl) : '';
}

// --- Étape 3 : mouvement de stock -----------------------------------------
function contenantsOptions() {
  const cels = getCellules().map((c) => {
    const b = getBatimentById(c.batimentId);
    const n = niveauContenant('CELLULE', c.id).quantite;
    return { value: 'CELLULE:' + c.id,
             label: `${b ? b.nom + ' — ' : ''}${c.nom} (${arrondi(n)} / ${arrondi(c.capaciteMaxTonnes)} t)` };
  });
  const emps = getEmplacements().map((e) => {
    const b = getBatimentById(e.batimentId);
    const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id).quantite;
    return { value: 'EMPLACEMENT_FOURRAGE:' + e.id,
             label: `${b ? b.nom + ' — ' : ''}${e.nom} (${n} bottes)` };
  });
  return cels.concat(emps);
}

function lotsOptions() {
  return getLots().map((l) => ({ value: 'LOT_BERGERIE:' + l.id, label: `${l.nom} (${l.nbBrebis} brebis)` }));
}

function remplirSelect(select, options, valeur) {
  select.innerHTML = options.length
    ? options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join('')
    : '<option value="">— rien à sélectionner —</option>';
  if (valeur && options.some((o) => o.value === valeur)) select.value = valeur;
}

function preparerFlux(prefill = {}) {
  const flux = fluxCourant();
  // Sans consigne explicite, on conserve ce qui est déjà sélectionné : revenir
  // en arrière puis ré-avancer ne doit pas effacer le choix de destination.
  if (!prefill.dest && el['flux-dest-id'].value) prefill.dest = el['flux-dest-id'].value;
  if (!prefill.source && el['flux-source-id'].value) prefill.source = el['flux-source-id'].value;
  const t = typeCourant();
  if (flux === 'ENTREE_STOCK') {
    el['flux-intro'].textContent = `Où est rentré le produit de « ${t ? t.nom : 'cette activité'} » ? L'entrée de stock sera enregistrée en même temps que l'activité.`;
    el['flux-source'].hidden = true;
    el['flux-dest'].hidden = false;
    remplirSelect(el['flux-dest-id'], contenantsOptions(), prefill.dest);
  } else if (flux === 'DISTRIBUTION') {
    el['flux-intro'].textContent = 'Quel stock a été distribué, et à quel lot ? La sortie de stock sera enregistrée en même temps.';
    el['flux-source'].hidden = false;
    el['flux-dest'].hidden = false;
    remplirSelect(el['flux-source-id'], contenantsOptions(), prefill.source);
    remplirSelect(el['flux-dest-id'], lotsOptions(), prefill.dest);
  }
  majUniteFlux();
}

function contenantVise() {
  const flux = fluxCourant();
  const brut = flux === 'DISTRIBUTION' ? el['flux-source-id'].value : el['flux-dest-id'].value;
  if (!brut || brut.indexOf(':') === -1) return null;
  const [type, id] = brut.split(':');
  return { type, id };
}

// L'unité suit le contenant : tonnes pour un silo, bottes pour un hangar.
// L'afficher à côté du champ évite de transformer 40 bottes en 40 tonnes.
function majUniteFlux() {
  const c = contenantVise();
  const fourrage = c && c.type === 'EMPLACEMENT_FOURRAGE';
  el['flux-quantite-label'].textContent = fourrage ? 'Nombre de bottes' : 'Quantité (tonnes)';
  el['flux-quantite'].step = fourrage ? '1' : '0.01';
  el['flux-champ-poids'].hidden = !(fourrage && fluxCourant() === 'ENTREE_STOCK');
  // Grain entrant : sans lui, un silo rempli par une moisson resterait
  // affiché « — » alors qu'on vient justement d'y mettre quelque chose.
  const cellule = c && c.type === 'CELLULE' && fluxCourant() === 'ENTREE_STOCK';
  el['flux-champ-grain'].hidden = !cellule;
  if (cellule) {
    const cel = getCelluleById(c.id);
    if (cel && cel.typeGrainActuel) el['flux-grain'].value = cel.typeGrainActuel;
  }

  if (c && c.type === 'CELLULE' && fluxCourant() === 'ENTREE_STOCK') {
    const cel = getCelluleById(c.id);
    if (cel) {
      const n = niveauContenant('CELLULE', cel.id).quantite;
      el['flux-aide'].textContent = `${cel.nom} : ${arrondi(n)} t sur ${arrondi(cel.capaciteMaxTonnes)} t — reste ${arrondi(Math.max(0, (Number(cel.capaciteMaxTonnes) || 0) - n))} t de place.`;
      el['flux-aide'].hidden = false;
      return;
    }
  }
  if (c && c.type === 'EMPLACEMENT_FOURRAGE' && fluxCourant() === 'DISTRIBUTION') {
    const e = getEmplacementById(c.id);
    if (e) {
      const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id).quantite;
      el['flux-aide'].textContent = `${e.nom} : ${n} bottes disponibles.`;
      el['flux-aide'].hidden = false;
      return;
    }
  }
  el['flux-aide'].hidden = true;
}
el['flux-grain'].innerHTML = TYPES_GRAIN.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
el['flux-source-id'].addEventListener('change', majUniteFlux);
el['flux-dest-id'].addEventListener('change', majUniteFlux);

// --- Ouverture ------------------------------------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  meteoCourante = null;
  setPhoto(null);
  selection = new Set();
  typeChoisiId = null;
  statut = 'TERMINE';
  mouvementLie = null;
  fluxEnregistre = null;
  ['produit', 'quantite', 'materiel', 'duree', 'notes', 'flux-quantite', 'flux-poids', 'newtype-nom']
    .forEach((k) => { el[k].value = ''; });
  peuplerMateriels('');
  el.newtype.hidden = true;
  el['newtype-toggle'].textContent = '＋ Action sur mesure';
  el.unite.value = '';
  el.details.hidden = true;
  el['details-toggle'].textContent = '＋ Détails (produit, matériel, temps, météo, photo)';
  afficherMeteo();
  majStatutBoutons();
  majCibleBoutons();
}

export function openCreateIntervention(opts = {}) {
  mode = 'create';
  editingId = null;
  panel.hidden = false;
  reinitialiser();
  log('tunnel activité ouvert (création)');
  try {
    el.title.textContent = opts.note ? 'Nouvelle note' : 'Nouvelle activité';
    el.delete.hidden = true;
    el.date.value = aujourdhui();
    cible = opts.cible || 'PARCELLE';
    majCibleBoutons();
    (opts.parcelleIds || []).forEach((id) => selection.add(id));
    renderCibles();
    renderActivites();
    if (opts.note) {
      const note = getTypes().find((t) => t.nom === TYPE_NOTE);
      if (note) { typeChoisiId = note.id; appliquerType(); renderActivites(); }
    }
    allerA(1);
  } catch (err) {
    showError('Impossible de préparer le formulaire : ' + ((err && err.message) || err));
  }
}

export function openEditIntervention(itv) {
  mode = 'edit';
  editingId = itv.id;
  panel.hidden = false;
  reinitialiser();
  log('tunnel activité ouvert (modification)');
  try {
    el.title.textContent = itv.typeNom ? 'Modifier — ' + itv.typeNom : "Modifier l'activité";
    el.delete.hidden = false;
    el.date.value = itv.date || aujourdhui();
    cible = itv.cibleType || 'PARCELLE';
    majCibleBoutons();
    (itv.parcelleIds || []).forEach((id) => selection.add(id));
    typeChoisiId = itv.typeId || null;
    statut = itv.statut || 'TERMINE';
    majStatutBoutons();
    renderCibles();
    renderActivites();
    appliquerType();
    el.produit.value = itv.produit || '';
    el.quantite.value = itv.quantite != null ? itv.quantite : '';
    el.unite.value = itv.unite || '';
    el.materiel.value = itv.materiel || '';
    peuplerMateriels(itv.materielId || '');
    el.duree.value = itv.dureeHeures != null ? itv.dureeHeures : '';
    el.notes.value = itv.notes || '';
    meteoCourante = itv.meteo || null;
    afficherMeteo();
    setPhoto(itv.photo || null);
    // Mouvement déjà créé par cette activité : on le retrouve pour le mettre à
    // jour plutôt que d'en créer un second à chaque modification.
    mouvementLie = itv.mouvementId
      ? getMouvements().find((m) => m.id === itv.mouvementId) || null
      : null;
    // On repart de l'intention enregistrée sur l'activité. Le mouvement ne
    // sert de secours que pour les activités saisies avant l'existence de ce
    // champ.
    fluxEnregistre = itv.flux || (mouvementLie ? {
      quantite: mouvementLie.quantite,
      poids: mouvementLie.poidsBotteKg,
      grain: mouvementLie.typeGrain,
      brutDest: mouvementLie.destinationId ? mouvementLie.destinationType + ':' + mouvementLie.destinationId : null,
      brutSource: mouvementLie.sourceId ? mouvementLie.sourceType + ':' + mouvementLie.sourceId : null
    } : null);
    if (fluxEnregistre) {
      el['flux-quantite'].value = fluxEnregistre.quantite != null ? fluxEnregistre.quantite : '';
      el['flux-poids'].value = fluxEnregistre.poids != null ? fluxEnregistre.poids : '';
    }
    // On entre directement à l'étape 2 : la cible et l'activité sont déjà
    // connues. Refaire tout le tunnel pour corriger une note serait un recul
    // par rapport à l'ancien formulaire d'un seul tenant — l'étape 1 reste
    // accessible par le bouton retour.
    allerA(2);
    if (fluxCourant() && fluxEnregistre) {
      preparerFlux({ source: fluxEnregistre.brutSource, dest: fluxEnregistre.brutDest });
      if (fluxEnregistre.grain) el['flux-grain'].value = fluxEnregistre.grain;
    }
  } catch (err) {
    showError('Impossible de charger cette activité : ' + ((err && err.message) || err));
  }
}

function fermer() { panel.hidden = true; mode = null; editingId = null; }
el.cancel.addEventListener('click', fermer);

// --- Enregistrement -------------------------------------------------------
const TIMEOUT_MS = 8000;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const monToken = ++saveToken;
  hideError();
  el.save.disabled = true; el.save.textContent = 'Enregistrement...';
  let fini = false;
  const minuteur = setTimeout(() => {
    if (!fini && monToken === saveToken) {
      showError('Aucune réponse du serveur après 8 s — vérifie ta connexion ou les règles Firestore.');
    }
  }, TIMEOUT_MS);

  try {
    validerEtape(1);
    validerEtape(2);

    // Tout est lu AVANT le premier await : écrire déclenche des snapshots
    // Firestore qui repeuplent les listes et réinitialiseraient les champs.
    const t = typeCourant();
    const flux = fluxCourant();
    const data = {
      date: el.date.value,
      typeId: typeChoisiId,
      typeNom: t ? t.nom : '',
      cibleType: cible,
      parcelleIds: Array.from(selection),
      statut,
      produit: el['champ-produit'].hidden ? '' : el.produit.value.trim(),
      quantite: el['champ-produit'].hidden ? null : el.quantite.value,
      unite: el['champ-produit'].hidden ? '' : el.unite.value,
      materiel: el['champ-materiel'].hidden ? '' : el.materiel.value.trim(),
      materielId: el['champ-materiel'].hidden ? null : (el['materiel-id'].value || null),
      // Nom figé : le fil reste lisible même si le matériel est renommé ou
      // sorti du parc plus tard.
      materielNom: el['champ-materiel'].hidden ? '' : nomMateriel(el['materiel-id'].value),
      dureeHeures: el['champ-duree'].hidden ? null : el.duree.value,
      meteo: el['champ-meteo'].hidden ? null : meteoCourante,
      photo: photoCourante,
      notes: el.notes.value
    };

    let fluxSaisi = null;
    if (flux) {
      const q = Number(el['flux-quantite'].value);
      const brutDest = el['flux-dest-id'].value;
      const brutSource = el['flux-source-id'].value;
      if (q > 0) {
        fluxSaisi = {
          flux, quantite: q,
          poids: el['flux-poids'].value === '' ? null : Number(el['flux-poids'].value),
          grain: el['flux-champ-grain'].hidden ? null : el['flux-grain'].value,
          brutDest: brutDest || null,
          brutSource: brutSource || null
        };
      }
    }
    // L'intention est enregistrée dans tous les cas, « à faire » compris.
    data.flux = fluxSaisi;

    // Une activité « À faire » n'a encore rien déplacé : créer son mouvement
    // ferait mentir les stocks sur du travail qui n'a pas eu lieu.
    const doitBougerLeStock = fluxSaisi && statut === 'TERMINE';

    let mouvementId = mouvementLie ? mouvementLie.id : null;
    if (doitBougerLeStock) {
      const mvt = construireMouvement(data, fluxSaisi);
      if (mouvementId) await updateMouvement(mouvementId, mvt);
      else mouvementId = (await createMouvement(mvt)).id;
    } else if (mouvementId) {
      // Repassée « à faire », ou flux effacé : le mouvement n'a plus lieu
      // d'être et les niveaux doivent revenir en arrière.
      await deleteMouvement(mouvementId);
      mouvementId = null;
    }
    data.mouvementId = mouvementId;

    if (mode === 'create') await createIntervention(data);
    else if (editingId) await updateIntervention(editingId, data);

    fini = true; clearTimeout(minuteur);
    if (monToken === saveToken) {
      log('activité enregistrée' + (mouvementId ? ' (+ mouvement de stock)' : ''));
      fermer();
    }
  } catch (err) {
    fini = true; clearTimeout(minuteur);
    if (monToken === saveToken) {
      if (err instanceof ErreurDeSaisie) showError(err.message);
      else {
        const code = err && err.code ? `${err.code} — ` : '';
        showError(`Erreur d'enregistrement : ${code}${(err && err.message) || err}`);
      }
    }
  } finally {
    fini = true;
    if (monToken === saveToken) { el.save.disabled = false; el.save.textContent = 'Enregistrer'; }
  }
});

function construireMouvement(data, f) {
  const [destType, destId] = (f.brutDest || '').split(':');
  const [srcType, srcId] = (f.brutSource || '').split(':');
  const nomContenant = (type, id) => {
    if (type === 'CELLULE') { const c = getCelluleById(id); return c ? c.nom : ''; }
    if (type === 'EMPLACEMENT_FOURRAGE') { const e = getEmplacementById(id); return e ? e.nom : ''; }
    if (type === 'LOT_BERGERIE') { const l = getLots().find((x) => x.id === id); return l ? l.nom : ''; }
    return '';
  };
  const premiereParcelle = parcelles.find((p) => p.id === data.parcelleIds[0]);

  if (f.flux === 'ENTREE_STOCK') {
    if (!destId) throw new ErreurDeSaisie('Choisis où le produit est rentré.');
    return {
      date: data.date,
      typeMouvement: 'ENTREE_RECOLTE',
      sourceType: 'PARCELLE',
      sourceId: data.parcelleIds[0] || null,
      sourceNom: premiereParcelle ? premiereParcelle.nom : '',
      destinationType: destType,
      destinationId: destId,
      destinationNom: nomContenant(destType, destId),
      quantite: f.quantite,
      poidsBotteKg: destType === 'EMPLACEMENT_FOURRAGE' ? f.poids : null,
      typeGrain: destType === 'CELLULE' ? f.grain : null,
      unite: destType === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't',
      libelle: `${data.typeNom}${premiereParcelle ? ' — ' + premiereParcelle.nom : ''}`
    };
  }
  if (!srcId) throw new ErreurDeSaisie('Choisis le stock distribué.');
  return {
    date: data.date,
    typeMouvement: 'SORTIE_ALIMENTATION',
    sourceType: srcType,
    sourceId: srcId,
    sourceNom: nomContenant(srcType, srcId),
    destinationType: destId ? 'LOT_BERGERIE' : 'AUTRE',
    destinationId: destId || null,
    destinationNom: destId ? nomContenant('LOT_BERGERIE', destId) : '',
    quantite: f.quantite,
    poidsBotteKg: null,
    unite: srcType === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't',
    libelle: `${data.typeNom}${destId ? ' — ' + nomContenant('LOT_BERGERIE', destId) : ''}`
  };
}

el.delete.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Supprimer cette activité ? Cette action est irréversible.')) return;
  el.delete.disabled = true;
  try {
    // Le mouvement créé par l'activité part avec elle : le laisser
    // continuerait à amputer un stock au nom d'un travail effacé.
    if (mouvementLie) await deleteMouvement(mouvementLie.id);
    await deleteIntervention(editingId);
    fermer();
  } catch (err) {
    showError('Erreur de suppression : ' + ((err && err.message) || err));
  } finally { el.delete.disabled = false; }
});

function nomMateriel(id) {
  const m = id ? getMaterielById(id) : null;
  return m ? m.nom : '';
}
function arrondi(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
