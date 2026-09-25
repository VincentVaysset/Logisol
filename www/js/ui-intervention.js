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
  typesPourCible, categorieDe, fluxDe, formulaireDe, fluxObligatoire,
  effetCultureDe, addType, TYPE_NOTE
} from './interventions-types.js';
import { getMaterielById, onMaterielsChange, materielsPourAction } from './materiel.js';
import {
  createIntervention, updateIntervention, deleteIntervention, quantiteDeSaisie
} from './interventions.js';
import { releverMeteo, resumeMeteo } from './meteo.js';
import { compresserPhoto, tailleLisible } from './photo.js';
import { aujourdhui } from './implantations.js';
import {
  TYPES_GRAIN, getBatiments, getBatimentById, accepteLots, accepteCellules,
  accepteFourrage, labelGrain, labelFourrage
} from './batiments.js';

// Formulaires de création des contenants, branchés depuis main.js. Un import
// direct de ui-batiments.js créerait un cycle (il importe accueil.js, qui
// importe ce module) : même branchement que pour le placement sur la carte.
let createurs = { batiment: null, cellule: null, emplacement: null };
export function setCreateursDeContenant(c) { createurs = { ...createurs, ...c }; }
import { getCellules, getCelluleById, contenuDe } from './cellules.js';
import { getEmplacements, getEmplacementById } from './emplacements.js';
import { getLots } from './lots.js';
import { niveauContenant, createMouvement, updateMouvement, deleteMouvement, getMouvements } from './mouvements.js';
import {
  implantationEnCours, historiqueParcelle, setImplantation, cloturerImplantation, deleteImplantation,
  campagneDeSemis
} from './implantations.js';
import { getCultureById, getCultures, onCulturesChange, addCulture } from './cultures-config.js';
import { COUPES, FOURRAGES, cleFoin, labelFoin, cleCereale, labelCereale } from './stocks.js';
import { conservationDuContenant } from './fourrages.js';
import { prevision, culturePrev } from './assolement-previsionnel.js';
import { toastSucces, toastErreur } from './toast.js';

const panel = document.getElementById('intervention-panel');
const form = document.getElementById('itv-form');
const el = {};
[ 'title','back','steps','etape-1','etape-2','etape-3','cible','parcelles','pick-all',
  'pick-none','pick-count','activites','date','campagne','chauffeur','chauffeurs','statut',
  'notes','details','details-toggle',
  'champ-produit','produit','quantite','unite','champ-materiel','materiel','materiel-id','champ-duree',
  'newtype','newtype-toggle','newtype-nom','newtype-icone','newtype-cat','newtype-add',
  'duree','champ-meteo','meteo-text','meteo-refresh','photo-btn','photo-clear','photo-input',
  'photo-preview','photo-info',
  'groupe','groupe-titre','groupe-total',
  'g-semis','culture','culture-aide','culture-toggle','culture-new','culture-nom','culture-add',
  'semence','melange','melange-toggle','melange-rows','melange-add','melange-total',
  'dose-semis','etiq-btn','etiq-clear','etiq-input','etiq-preview','etiq-info',
  'g-surface','surface','surface-tout','surface-aide',
  'g-fourrage','coupe','fourrage','fourrages','fourrage-aide',
  'g-pressage','nb-bottes','poids-botte',
  'g-sechage','nb-remorques','t-remorque',
  'g-moisson','nb-bennes','t-benne','ps',
  'g-fumier','nb-epandeurs','t-epandeur',
  'g-chaulage','dose-chaux',
  'flux-intro','flux-calcul','flux-source','flux-source-id','flux-dest',
  'flux-dest-id','flux-champ-quantite','flux-quantite','flux-quantite-label',
  'flux-champ-poids','flux-poids','flux-champ-grain','flux-grain','flux-grain-label',
  'effet-culture','flux-aide','flux-creer-toggle','flux-creer-wrap','flux-creer-titre','flux-creer-aide',
  'flux-creer-bat-wrap','flux-creer-bat','flux-creer',
  'next','save','cancel','delete','error-banner','error-text','error-close'
].forEach((k) => { el[k] = document.getElementById('itv-' + k); });

// Bloc de saisie propre à chaque groupe d'activité. La clé est la valeur du
// champ « formulaire » du type ; l'entrée porte le sous-bloc à montrer et son
// titre. Tout le reste du tunnel est commun.
const GROUPES = {
  SEMIS:    { bloc: 'g-semis',    titre: '🌱 Semis' },
  SURFACE:  { bloc: 'g-surface',  titre: '🌾 Surface travaillée' },
  PRESSAGE: { bloc: 'g-pressage', titre: '📦 Pressage' },
  SECHAGE:  { bloc: 'g-sechage',  titre: '📦 Séchage en grange' },
  MOISSON:  { bloc: 'g-moisson',  titre: '🌽 Moisson' },
  FUMIER:   { bloc: 'g-fumier',   titre: '💩 Épandage fumier' },
  CHAULAGE: { bloc: 'g-chaulage', titre: '⚙️ Chaulage' }
};

class ErreurDeSaisie extends Error {}

let mode = null;            // 'create' | 'edit'
let editingId = null;
let etape = 1;
let cible = 'PARCELLE';     // 'PARCELLE' | 'BERGERIE'
let typeChoisiId = null;
let statut = 'TERMINE';
let meteoCourante = null;
let photoCourante = null;
let etiquetteCourante = null;
let selection = new Set();
let saveToken = 0;
let parcelles = [];
let mouvementLie = null;    // mouvement déjà créé par cette activité, en édition
let fluxEnregistre = null;  // intention de mouvement portée par l'activité
let effetPrecedent = null;  // ce que cette activité avait déjà fait à la culture

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

// L'outil qui va avec l'action est remonté en tête : à l'ouverture d'un
// fanage, la pirouette est le premier choix. Rien n'est filtré pour autant —
// un chantier sort souvent de l'usage prévu, et masquer le reste du parc
// obligerait à ressortir du formulaire pour saisir la réalité.
function peuplerMateriels(valeur) {
  const t = typeCourant();
  const { conseilles, autres } = materielsPourAction(t ? t.nom : '');
  const opt = (m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.nom)}${m.largeurTravailMetres ? ' (' + m.largeurTravailMetres + ' m)' : ''}</option>`;
  let html = '<option value="">— Aucun —</option>';
  if (conseilles.length) {
    html += `<optgroup label="Conseillé pour « ${escapeAttr(t.nom)} »">${conseilles.map(opt).join('')}</optgroup>`;
    html += `<optgroup label="Tout le parc">${autres.map(opt).join('')}</optgroup>`;
  } else {
    html += autres.map(opt).join('');
  }
  el['materiel-id'].innerHTML = html;
  const tous = conseilles.concat(autres);
  if (valeur && tous.some((m) => m.id === valeur)) el['materiel-id'].value = valeur;
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
  if (n === 2) {
    if (!el.date.value) throw new ErreurDeSaisie('La date est obligatoire.');
    if (effetCultureDe(typeCourant()) === 'IMPLANTE' && statut === 'TERMINE' && !el.culture.value) {
      throw new ErreurDeSaisie("Choisis la culture implantée : c'est elle qui remplace la précédente sur la parcelle.");
    }
    exigerQuantiteRecolte();
  }
  if (n === 3) exigerDestinationRecolte();
}

// Règle métier : une récolte TERMINÉE doit rentrer son produit quelque part.
// C'est ce qui garantit que les tonnages saisis au champ arrivent bien dans
// l'onglet Stocks, puis dans les rations. Une activité « à faire » y échappe :
// on ne connaît ni le tonnage ni la cellule avant d'avoir récolté.
function exigerQuantiteRecolte() {
  const t = typeCourant();
  if (!fluxObligatoire(t) || statut !== 'TERMINE') return;
  const f = formulaireDe(t);
  // Sans coupe ni type, le fourrage entre en stock sans identité : il
  // n'apparaîtrait ni dans le croisement coupe × type, ni dans le choix des
  // rations. C'est précisément ce qu'on cherche à tracer.
  if (f === 'PRESSAGE' || f === 'SECHAGE') {
    if (!el.coupe.value) throw new ErreurDeSaisie('Indique le numéro de coupe : c\'est lui qui identifie le fourrage jusqu\'à la ration.');
    if (!el.fourrage.value.trim()) throw new ErreurDeSaisie('Indique le type de fourrage (luzerne, prairie, RGA...) : sans lui, le stock ne peut pas être rattaché à une ration.');
  }
  // Une activité saisie avant l'existence du comptage (bottes, bennes,
  // remorques) porte déjà une quantité à l'étape 3 : la refuser bloquerait
  // le passage « à faire » → « terminé » d'une récolte pourtant chiffrée.
  if (Number(el['flux-quantite'].value) > 0) return;
  const q = quantiteDeSaisie(f, lireSaisie());
  if (!(q > 0)) {
    throw new ErreurDeSaisie(f === 'PRESSAGE'
      ? 'Indique le nombre de bottes : une récolte doit rentrer en stock.'
      : f === 'SECHAGE'
        ? 'Indique le nombre de remorques et leur poids : une récolte doit rentrer en stock.'
        : 'Indique le nombre de bennes et leur tonnage : une récolte doit rentrer en stock.');
  }
}

function exigerDestinationRecolte() {
  const t = typeCourant();
  if (!fluxObligatoire(t) || statut !== 'TERMINE') return;
  if (!el['flux-dest-id'].value) {
    throw new ErreurDeSaisie(formulaireDe(t) === 'MOISSON'
      ? 'Choisis la cellule à grain où la récolte est rentrée.'
      : "Choisis le bâtiment et l'emplacement où la récolte est rentrée.");
  }
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
      if (groupeCourant()) appliquerGroupe();
      majEffetCulture();
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
  peuplerMateriels(el['materiel-id'].value);
  appliquerGroupe();
  majEffetCulture();
}

// --- Bloc de saisie propre au groupe --------------------------------------
function groupeCourant() { return GROUPES[formulaireDe(typeCourant())] || null; }

function appliquerGroupe() {
  const g = groupeCourant();
  Object.values(GROUPES).forEach((x) => { el[x.bloc].hidden = true; });
  el.groupe.hidden = !g;
  const f = formulaireDe(typeCourant());
  const fourrage = f === 'PRESSAGE' || f === 'SECHAGE';
  el['g-fourrage'].hidden = !fourrage;
  if (fourrage) injecterFourrageDeLaParcelle();
  if (f === 'SEMIS') injecterCultureSemisDeLaParcelle();
  if (!g) { el['groupe-total'].hidden = true; return; }
  el[g.bloc].hidden = false;
  el['groupe-titre'].textContent = g.titre;
  if (formulaireDe(typeCourant()) === 'SURFACE') majAideSurface();
  majTotalGroupe();
}

// Surface par défaut : celle des parcelles cochées. Une fauche partielle se
// corrige d'un chiffre, mais le cas courant — on a fauché la parcelle
// entière — ne demande alors aucune saisie.
function surfaceSelectionnee() {
  return arrondi(Array.from(selection).reduce((somme, id) => {
    const p = parcelles.find((x) => x.id === id);
    return somme + (Number(p && p.surfaceHa) || 0);
  }, 0));
}

function majAideSurface() {
  const totale = surfaceSelectionnee();
  el['surface-aide'].textContent = totale > 0
    ? `Surface des parcelles cochées : ${totale} ha`
    : 'Surface des parcelles inconnue.';
  el['surface-tout'].hidden = !(totale > 0);
}
el['surface-tout'].addEventListener('click', () => {
  el.surface.value = surfaceSelectionnee() || '';
  majTotalGroupe();
});

// Total calculé, affiché en clair sous le bloc : c'est lui qui partira en
// stock, il ne doit pas être une surprise découverte à l'étape 3.
function majTotalGroupe() {
  const f = formulaireDe(typeCourant());
  const s = lireSaisie();
  const q = quantiteDeSaisie(f, s);
  let texte = '';
  if (f === 'PRESSAGE' && q) {
    const kg = Number(s.poidsBotteKg) || 0;
    texte = `${q} botte${q > 1 ? 's' : ''}` + (kg ? ` · ${arrondi(q * kg / 1000)} t estimées` : '');
  } else if (f === 'SECHAGE' && q) {
    texte = `${q} t (${s.nbRemorques || 0} remorque${(s.nbRemorques || 0) > 1 ? 's' : ''})`;
  } else if (f === 'MOISSON' && q) {
    texte = `${q} t (${s.nbBennes || 0} benne${(s.nbBennes || 0) > 1 ? 's' : ''})`;
  } else if (f === 'FUMIER' && q) {
    const ha = surfaceSelectionnee();
    texte = `${q} t épandues` + (ha ? ` · ${arrondi(q / ha)} t/ha` : '');
  } else if (f === 'CHAULAGE' && s && s.doseTonnesHa) {
    const ha = surfaceSelectionnee();
    texte = ha ? `${s.doseTonnesHa} t/ha · ${arrondi(s.doseTonnesHa * ha)} t au total` : `${s.doseTonnesHa} t/ha`;
  } else if (f === 'SEMIS' && s && s.doseKgHa) {
    const ha = surfaceSelectionnee();
    texte = ha ? `${s.doseKgHa} kg/ha · ${arrondi(s.doseKgHa * ha)} kg au total` : `${s.doseKgHa} kg/ha`;
  }
  el['groupe-total'].textContent = texte;
  el['groupe-total'].hidden = !texte;
  if (etape === 3) majCalculFlux();
}

['nb-bottes','poids-botte','nb-remorques','t-remorque','nb-bennes','t-benne',
 'nb-epandeurs','t-epandeur','dose-chaux','dose-semis','surface']
  .forEach((k) => el[k].addEventListener('input', majTotalGroupe));

/** Lit le bloc de groupe. Toujours appelé AVANT le premier await. */
function lireSaisie() {
  const f = formulaireDe(typeCourant());
  if (!f) return null;
  const n = (k) => (el[k].value === '' ? null : Number(el[k].value));
  if (f === 'SEMIS') {
    return { semence: el.semence.value.trim(), melange: lireMelange(),
             doseKgHa: n('dose-semis'), cultureId: el.culture.value || null };
  }
  // Coupe et type de fourrage accompagnent les deux récoltes de fourrage :
  // ce sont eux qui suivent le fourrage jusqu'à la ration.
  if (f === 'PRESSAGE') {
    return { nbBottes: n('nb-bottes'), poidsBotteKg: n('poids-botte'),
             numeroCoupe: n('coupe'), typeFourrage: el.fourrage.value.trim() };
  }
  if (f === 'SECHAGE') {
    return { nbRemorques: n('nb-remorques'), tonnesParRemorque: n('t-remorque'),
             numeroCoupe: n('coupe'), typeFourrage: el.fourrage.value.trim() };
  }
  if (f === 'SURFACE')  return { surfaceHa: n('surface') };
  if (f === 'MOISSON')  return { nbBennes: n('nb-bennes'), tonnageBenne: n('t-benne'), poidsSpecifique: n('ps') };
  if (f === 'FUMIER')   return { nbEpandeurs: n('nb-epandeurs'), tonnageEpandeur: n('t-epandeur') };
  if (f === 'CHAULAGE') return { doseTonnesHa: n('dose-chaux') };
  return null;
}

function ecrireSaisie(s) {
  s = s || {};
  const v = (k, val) => { el[k].value = val == null ? '' : val; };
  v('semence', s.semence);
  peuplerCultures(s.cultureId || '');
  delete el.culture.dataset.saisi;
  if (s.cultureId) el.culture.dataset.saisi = '1';
  v('dose-semis', s.doseKgHa);
  v('surface', s.surfaceHa);
  v('nb-bottes', s.nbBottes);
  v('poids-botte', s.poidsBotteKg);
  v('nb-remorques', s.nbRemorques);
  v('t-remorque', s.tonnesParRemorque);
  v('nb-bennes', s.nbBennes);
  v('t-benne', s.tonnageBenne);
  v('ps', s.poidsSpecifique);
  v('nb-epandeurs', s.nbEpandeurs);
  v('t-epandeur', s.tonnageEpandeur);
  v('dose-chaux', s.doseTonnesHa);
  v('coupe', s.numeroCoupe);
  el.fourrage.value = s.typeFourrage || '';
  delete el.fourrage.dataset.saisi;
  if (s.typeFourrage) el.fourrage.dataset.saisi = '1';
  ecrireMelange(Array.isArray(s.melange) ? s.melange : []);
}

// --- Effet sur la culture en place ----------------------------------------
// Un déchaumage, un labour ou un vibroculteur retournent le sol : la culture
// qui était là n'y est plus. Un semis fait la même chose ET démarre la
// suivante. C'est annoncé AVANT d'enregistrer : clôturer un assolement en
// silence serait irrattrapable, et l'exploitant doit pouvoir corriger la
// date ou la sélection s'il ne l'avait pas prévu.
onCulturesChange(() => peuplerCultures(el.culture.value));

function peuplerCultures(valeur) {
  const liste = getCultures();
  el.culture.innerHTML = '<option value="">— Choisir la culture —</option>' +
    liste.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nom)}</option>`).join('');
  if (valeur && liste.some((c) => c.id === valeur)) el.culture.value = valeur;
}

el.culture.addEventListener('change', () => {
  el.culture.dataset.saisi = '1';
  // La campagne dépend de la culture choisie (dérobée = campagne en cours,
  // toute autre = campagne visée par campagneDeSemis) : un changement manuel
  // doit la recalculer, sauf si l'exploitant l'a lui-même déjà corrigée.
  if (el.campagne.dataset.auto !== 'non') el.campagne.value = campagneDeLaDate();
});

el['culture-toggle'].addEventListener('click', () => {
  el['culture-new'].hidden = !el['culture-new'].hidden;
  el['culture-toggle'].textContent = el['culture-new'].hidden ? '＋ Nouvelle culture' : '− Annuler';
});
el['culture-add'].addEventListener('click', async () => {
  const nom = el['culture-nom'].value.trim();
  if (!nom) { showError('Donne un nom à la culture.'); return; }
  el['culture-add'].disabled = true;
  try {
    const id = await addCulture(nom, '#5b8c5a', '');
    peuplerCultures(id);
    el.culture.dataset.saisi = '1';
    el['culture-nom'].value = '';
    el['culture-new'].hidden = true;
    el['culture-toggle'].textContent = '＋ Nouvelle culture';
    hideError();
  } catch (err) {
    showError('Culture non créée : ' + ((err && err.message) || err));
  } finally { el['culture-add'].disabled = false; }
});

// Le référentiel réel (cultures_config, coloré sur la carte) et le
// référentiel prévisionnel (assolement-previsionnel.js, indexé par âge —
// « RG trèfle 1 », « Blé 2 »...) restent deux catalogues séparés, comme
// l'exige CLAUDE.md (réel et prévu ne se mélangent jamais) : l'un n'a pas de
// notion d'âge, l'autre en vit. Le point de rupture n'était pas l'existence
// de deux catalogues, mais la SAISIE : rien ne reliait "RGA trèfle" (tapé un
// jour dans la liste réelle) à "RG trèfle 1" (choisi au prévisionnel), donc
// le badge Prévu ne passait jamais à Semé (cf. ui-assolement.js/correspond).
// La proposition automatique ci-dessous ferme cet écart à la source.
function normaliserNom(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function memeCulture(nomReel, nomAttendu) {
  const n = normaliserNom(nomReel);
  const ref = normaliserNom(nomAttendu).split(' ')[0];
  return !!ref && n.indexOf(ref) !== -1;
}

/** Culture attendue par l'assolement prévisionnel de la campagne en cours
 * (celle de la date du semis — cf. campagneDeLaDate, qui bascule déjà en
 * N+1 pour un semis d'automne), pour la première parcelle cochée qui en
 * porte une. */
function cultureAttendueDuSemis() {
  const campagne = el.campagne.value || campagneDeLaDate();
  for (const id of selection) {
    const p = parcelles.find((x) => x.id === id);
    const prev = prevision(id, campagne);
    const cp = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    if (!cp) continue;
    // Le nom "de fond" — Luzerne, RG trèfle, Fétuque trèfle — plutôt que le
    // libellé indexé : un semis n'a pas d'âge, c'est le prévisionnel qui en
    // tient le compte, pas l'implantation réelle.
    const nomAttendu = cp.fourrage || String(cp.label).replace(/\s*\d+$/, '').trim();
    if (!nomAttendu) continue;
    return { nomAttendu, label: cp.label, campagne, parcelleNom: p ? p.nom : 'la parcelle' };
  }
  return null;
}

function injecterCultureSemisDeLaParcelle() {
  const attendue = cultureAttendueDuSemis();
  if (!attendue) { el['culture-aide'].hidden = true; return; }
  const correspond = getCultures().find((c) => memeCulture(c.nom, attendue.nomAttendu));
  if (correspond && !el.culture.dataset.saisi) {
    el.culture.value = correspond.id;
  }
  if (!correspond && !el['culture-nom'].value.trim()) {
    // Prêt à créer la culture manquante d'un tap, avec le nom exact attendu
    // par le prévisionnel — c'est ça, "harmoniser" la liste, plutôt que
    // deviner dans des libellés qui ont pu dériver au fil des saisies.
    el['culture-nom'].value = attendue.nomAttendu;
  }
  el['culture-aide'].textContent = correspond
    ? `Proposé d'après l'assolement ${attendue.campagne} de ${attendue.parcelleNom} : ${attendue.label}. Modifiable.`
    : `L'assolement ${attendue.campagne} de ${attendue.parcelleNom} prévoit « ${attendue.label} » — crée la culture « ${attendue.nomAttendu} » ci-dessous pour que le semis soit reconnu automatiquement.`;
  el['culture-aide'].hidden = false;
}

/** Implantations ouvertes que cette activité va clôturer. */
function implantationsTouchees() {
  const effet = effetCultureDe(typeCourant());
  if (!effet || cible !== 'PARCELLE') return [];
  const d = el.date.value || aujourdhui();
  const out = [];
  selection.forEach((id) => {
    const impl = implantationEnCours(id, d);
    if (!impl) return;
    const p = parcelles.find((x) => x.id === id);
    const culture = getCultureById(impl.cultureId);
    out.push({ implantation: impl, parcelleId: id,
               parcelleNom: p ? p.nom : 'parcelle',
               cultureNom: culture ? culture.nom : 'culture' });
  });
  return out;
}

function majEffetCulture() {
  // La campagne suit le type d'activité ET la sélection de parcelles, pas
  // seulement la date (cf. campagneDeLaDate : bascule vers N+1 pour un
  // fumier/chaux/travail du sol fait en interculture) — recalculée à chaque
  // fois que l'un des deux change, tant que l'exploitant ne l'a pas corrigée
  // lui-même. majEffetCulture() est déjà appelée à ces quatre moments (type,
  // sélection, statut, date) : un seul endroit pour rester synchronisé.
  if (!el.campagne.value || el.campagne.dataset.auto !== 'non') el.campagne.value = campagneDeLaDate();
  const effet = effetCultureDe(typeCourant());
  if (!effet || statut !== 'TERMINE') { el['effet-culture'].hidden = true; return; }
  const touchees = implantationsTouchees();
  const suite = effet === 'IMPLANTE' ? ' La nouvelle culture démarre à cette date.' : '';
  el['effet-culture'].textContent = touchees.length
    ? `🌱 Cette activité met fin à la culture en place : ` +
      touchees.map((t) => `${t.cultureNom} sur ${t.parcelleNom}`).join(', ') + '.' + suite
    : (effet === 'IMPLANTE'
        ? '🌱 Aucune culture en place sur la sélection : le semis démarre la première.'
        : '🌱 Aucune culture en place sur la sélection — rien à clôturer.');
  el['effet-culture'].hidden = false;
}

// --- Identité du fourrage récolté -----------------------------------------
el.coupe.innerHTML = '<option value="">— Choisir —</option>' +
  COUPES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');

// La culture en place sur la parcelle est PROPOSÉE, jamais imposée : le RPG
// dit « Prairie temporaire » là où l'exploitant récolte un RGA/trèfle, et
// c'est lui qui sait ce qu'il vient de presser.
function injecterFourrageDeLaParcelle() {
  majListeFourrages();
  const culture = cultureDeLaSelection();
  if (culture && !el.fourrage.value.trim() && !el.fourrage.dataset.saisi) {
    el.fourrage.value = culture.nom;
  }
  el['fourrage-aide'].textContent = culture
    ? `Proposé d'après ${culture.source} de ${culture.parcelleNom} : ${culture.detail || culture.nom}. Modifiable.`
    : "Aucune culture renseignée sur la parcelle (ni au prévisionnel, ni en place) — saisis le type de fourrage.";
  el['fourrage-aide'].hidden = false;
}

el.fourrage.addEventListener('input', () => { el.fourrage.dataset.saisi = '1'; });

// Les types déjà rencontrés s'ajoutent aux libellés de référence : après une
// saison, la liste est celle de l'exploitation.
function majListeFourrages() {
  const dejaVus = getMouvements()
    .map((m) => String(m.typeFourrage || '').trim())
    .filter(Boolean);
  const noms = Array.from(new Set(FOURRAGES.concat(getCultures().map((c) => c.nom)).concat(dejaVus)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  el.fourrages.innerHTML = noms.map((n) => `<option value="${escapeAttr(n)}"></option>`).join('');
}

/** Culture en place sur la première parcelle cochée qui en porte une. */
// Ordre de lecture : l'assolement PRÉVISIONNEL de la campagne de l'activité
// d'abord — c'est la culture que l'exploitant a choisie pour l'année, dans
// son propre vocabulaire (« Luz 3 » donne « Luzerne ») —, puis, à défaut, la
// culture réellement en place.
function cultureDeLaSelection() {
  const campagne = el.campagne.value || campagneDeLaDate();
  for (const id of selection) {
    const p = parcelles.find((x) => x.id === id);
    const nomParcelle = p ? p.nom : 'la parcelle';
    const prev = prevision(id, campagne);
    const cp = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    if (cp && cp.fourrage) {
      return { nom: cp.fourrage, detail: `${cp.label} (${cp.fourrage})`,
               source: `l'assolement ${campagne}`, parcelleNom: nomParcelle };
    }
  }
  for (const id of selection) {
    const impl = implantationEnCours(id, el.date.value || aujourdhui());
    const culture = impl ? getCultureById(impl.cultureId) : null;
    if (culture) {
      const p = parcelles.find((x) => x.id === id);
      return { nom: culture.nom, source: 'la culture en place', parcelleNom: p ? p.nom : 'la parcelle' };
    }
  }
  return null;
}

// --- Mélange de semences ---------------------------------------------------
// Un mélange prairial se note « RGI 60 % / TV 40 % ». Le pourcentage n'est
// pas imposé : un semis pur se saisit en une ligne de texte sans jamais
// ouvrir ce bloc.
el['melange-toggle'].addEventListener('click', () => {
  el.melange.hidden = !el.melange.hidden;
  el['melange-toggle'].textContent = el.melange.hidden ? '＋ Détailler un mélange (%)' : '− Masquer le détail';
  if (!el.melange.hidden && !el['melange-rows'].children.length) ajouterLigneMelange();
});
el['melange-add'].addEventListener('click', () => ajouterLigneMelange());

function ajouterLigneMelange(nom = '', pourcentage = '') {
  const ligne = document.createElement('div');
  ligne.className = 'melange-ligne';
  ligne.innerHTML = `
    <input type="text" class="melange-nom" placeholder="Espèce / variété" value="${escapeAttr(nom)}">
    <input type="number" class="melange-pct" step="1" min="0" max="100" inputmode="numeric" placeholder="%" value="${escapeAttr(pourcentage)}">
    <button type="button" class="btn btn-secondary btn-mini melange-del" aria-label="Retirer">✕</button>`;
  ligne.querySelector('.melange-del').addEventListener('click', () => { ligne.remove(); majTotalMelange(); });
  ligne.querySelectorAll('input').forEach((i) => i.addEventListener('input', majTotalMelange));
  el['melange-rows'].appendChild(ligne);
  majTotalMelange();
}

function lireMelange() {
  return Array.from(el['melange-rows'].querySelectorAll('.melange-ligne')).map((l) => ({
    nom: l.querySelector('.melange-nom').value.trim(),
    pourcentage: Number(l.querySelector('.melange-pct').value) || 0
  })).filter((x) => x.nom || x.pourcentage);
}

function ecrireMelange(liste) {
  el['melange-rows'].innerHTML = '';
  liste.forEach((x) => ajouterLigneMelange(x.nom || '', x.pourcentage != null ? x.pourcentage : ''));
  const ouvert = liste.length > 0;
  el.melange.hidden = !ouvert;
  el['melange-toggle'].textContent = ouvert ? '− Masquer le détail' : '＋ Détailler un mélange (%)';
  majTotalMelange();
}

// Le total est affiché, jamais corrigé d'office : un mélange se sème parfois
// à 105 % de dose et forcer la somme à 100 effacerait une saisie voulue.
function majTotalMelange() {
  const total = lireMelange().reduce((n, x) => n + (Number(x.pourcentage) || 0), 0);
  el['melange-total'].textContent = total ? `Total : ${arrondi(total)} %` : '';
}

// --- Photo d'étiquette de semence -----------------------------------------
el['etiq-btn'].addEventListener('click', () => el['etiq-input'].click());
el['etiq-clear'].addEventListener('click', () => setEtiquette(null));
el['etiq-input'].addEventListener('change', async () => {
  const f = el['etiq-input'].files[0];
  el['etiq-input'].value = '';
  if (!f) return;
  el['etiq-info'].textContent = 'Compression...';
  try { setEtiquette(await compresserPhoto(f)); }
  catch (err) { setEtiquette(null); showError('Étiquette : ' + ((err && err.message) || err)); }
});
function setEtiquette(dataUrl) {
  etiquetteCourante = dataUrl;
  el['etiq-preview'].hidden = !dataUrl;
  el['etiq-clear'].hidden = !dataUrl;
  el['etiq-preview'].src = dataUrl || '';
  el['etiq-info'].textContent = dataUrl ? tailleLisible(dataUrl) : '';
}

// --- Étape 2 : statut et détails ------------------------------------------
el.statut.querySelectorAll('[data-statut]').forEach((b) => {
  b.addEventListener('click', () => {
    statut = b.dataset.statut; majStatutBoutons(); preparerFluxSiVisible(); majEffetCulture();
  });
});
function preparerFluxSiVisible() { if (etape === 3) preparerFlux(); }
function majStatutBoutons() {
  el.statut.querySelectorAll('[data-statut]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.statut === statut);
  });
}
el['details-toggle'].addEventListener('click', () => {
  el.details.hidden = !el.details.hidden;
  el['details-toggle'].textContent = el.details.hidden
    ? '＋ Détails (météo, photo)'
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
el.campagne.addEventListener('input', () => {
  el.campagne.dataset.auto = 'non';
  if (!el['g-fourrage'].hidden && !el.fourrage.dataset.saisi) {
    el.fourrage.value = '';
    injecterFourrageDeLaParcelle();
  }
  if (!el['g-semis'].hidden) injecterCultureSemisDeLaParcelle();
});
el.date.addEventListener('change', () => {
  // majEffetCulture() resynchronise déjà la campagne (cf. sa définition) —
  // mais silencieusement (écriture directe de .value, sans évènement
  // "input"), donc la proposition de culture doit être recalculée ici.
  majEffetCulture();
  if (!el['g-semis'].hidden) injecterCultureSemisDeLaParcelle();
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
// Destinations proposées à l'étape 3. Elles dépendent du chantier : une
// moisson rentre en cellule à grain, un séchage en grange dans une cellule à
// fourrage, un pressage sur un emplacement où les bottes se comptent. Proposer
// les trois à chaque fois, c'est proposer trois occasions de se tromper.
//
// Filtre d'abord sur le bon contenu (GRAIN / FOURRAGE) pour ne pas mélanger
// les deux dans la même liste. Mais si ce filtre strict ne renvoie AUCUNE
// cellule alors qu'il en existe (ex. une cellule créée « Fourrage » par
// erreur, ou avant que la distinction grain/séchage existe), retomber sur
// TOUTES les cellules plutôt que de laisser « Vers » vide et forcer la
// création d'un doublon : l'exploitant choisit la bonne, et peut corriger son
// contenu depuis la fiche bâtiment ensuite.
function contenantsPour(formulaire) {
  if (formulaire === 'MOISSON') {
    const strict = contenantsOptions({ cellules: 'GRAIN', emplacements: false });
    return strict.length ? strict : contenantsOptions({ cellules: 'TOUS', emplacements: false });
  }
  if (formulaire === 'SECHAGE') {
    const strict = contenantsOptions({ cellules: 'FOURRAGE', emplacements: false });
    return strict.length ? strict : contenantsOptions({ cellules: 'TOUS', emplacements: false });
  }
  if (formulaire === 'PRESSAGE') return contenantsOptions({ cellules: null, emplacements: true });
  return contenantsOptions();
}

function contenantsOptions({ cellules = 'TOUS', emplacements = true } = {}) {
  const cels = (cellules === null ? [] : getCellules()
    .filter((c) => cellules === 'TOUS' || contenuDe(c) === cellules)).map((c) => {
    const b = getBatimentById(c.batimentId);
    const n = niveauContenant('CELLULE', c.id).quantite;
    return { value: 'CELLULE:' + c.id,
             label: `${b ? b.nom + ' — ' : ''}${c.nom} (${arrondi(n)} / ${arrondi(c.capaciteMaxTonnes)} t)` };
  });
  const emps = (emplacements ? getEmplacements() : []).map((e) => {
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
  if (valeur && options.some((o) => o.value === valeur)) {
    select.value = valeur;
  } else if (options.length === 1) {
    // Une seule destination possible (ex. une seule cellule à grain déjà
    // créée) : pas de raison de la faire choisir explicitement, c'est déjà
    // la seule case cochable.
    select.value = options[0].value;
  }
}

function preparerFlux(prefill = {}) {
  const flux = fluxCourant();
  // Sans consigne explicite, on conserve ce qui est déjà sélectionné : revenir
  // en arrière puis ré-avancer ne doit pas effacer le choix de destination.
  if (!prefill.dest && el['flux-dest-id'].value) prefill.dest = el['flux-dest-id'].value;
  if (!prefill.source && el['flux-source-id'].value) prefill.source = el['flux-source-id'].value;
  const t = typeCourant();
  if (flux === 'ENTREE_STOCK') {
    const obligatoire = fluxObligatoire(t) && statut === 'TERMINE';
    el['flux-intro'].textContent = obligatoire
      ? `Où est rentrée la récolte de « ${t ? t.nom : 'cette activité'} » ? L'entrée de stock est obligatoire : c'est elle qui alimente les stocks puis les rations.`
      : `Où sera rentrée la récolte de « ${t ? t.nom : 'cette activité'} » ? Rien ne bougera tant que l'activité est « à faire ».`;
    el['flux-source'].hidden = true;
    el['flux-dest'].hidden = false;
    const options = contenantsPour(formulaireDe(t));
    remplirSelect(el['flux-dest-id'], options, prefill.dest);
    majBlocCreation(options.length);
  } else if (flux === 'DISTRIBUTION') {
    el['flux-intro'].textContent = 'Quel stock a été distribué, et à quel lot ? La sortie de stock sera enregistrée en même temps.';
    el['flux-source'].hidden = false;
    el['flux-dest'].hidden = false;
    remplirSelect(el['flux-source-id'], contenantsOptions(), prefill.source);
    remplirSelect(el['flux-dest-id'], lotsOptions(), prefill.dest);
    majBlocCreation(-1);
  }
  majUniteFlux();
  majCalculFlux();
}

// Quand le tonnage se déduit de l'étape 2 (bennes × tonnage, remorques ×
// poids, nombre de bottes), le champ libre disparaît : deux endroits où
// saisir la même quantité, c'est deux valeurs qui finissent par diverger.
function majCalculFlux() {
  const f = formulaireDe(typeCourant());
  const q = quantiteDeSaisie(f, lireSaisie());
  const calcule = q != null && (f === 'PRESSAGE' || f === 'SECHAGE' || f === 'MOISSON');
  el['flux-champ-quantite'].hidden = calcule;
  el['flux-calcul'].hidden = !calcule;
  if (calcule) {
    el['flux-calcul'].textContent = f === 'PRESSAGE'
      ? `${q} botte${q > 1 ? 's' : ''} à rentrer (saisi à l'étape précédente).`
      : `${q} t à rentrer (saisi à l'étape précédente).`;
    el['flux-quantite'].value = q;
  }
  if (formulaireDe(typeCourant()) === 'MOISSON') majUniteFlux();
}

// Espèce moissonnée : déduite de l'implantation en cours sur la parcelle
// plutôt que redemandée. Elle sert à étiqueter la cellule ; si la parcelle
// n'a pas d'implantation renseignée, la cellule garde ce qu'elle avait.
function especeDeduite() {
  if (formulaireDe(typeCourant()) !== 'MOISSON') return null;
  // Même ordre que pour le fourrage : le prévisionnel de la campagne, puis le
  // réel. « Blé 1 » au prévisionnel suffit à étiqueter la cellule en blé.
  const campagne = el.campagne.value || campagneDeLaDate();
  for (const id of selection) {
    const prev = prevision(id, campagne);
    const cp = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    if (cp && cp.grain) {
      const g = TYPES_GRAIN.find((x) => x.value === cp.grain);
      return { label: g ? g.label : cp.label, valeur: cp.grain };
    }
  }
  for (const id of selection) {
    const impl = implantationEnCours(id, el.date.value || aujourdhui());
    const culture = impl ? getCultureById(impl.cultureId) : null;
    if (culture) {
      const nom = String(culture.nom || '').toUpperCase();
      const connu = TYPES_GRAIN.find((g) => nom.indexOf(g.label.toUpperCase()) !== -1);
      return { label: culture.nom, valeur: connu ? connu.value : 'AUTRE' };
    }
  }
  return null;
}

// --- Créer le contenant sans quitter la saisie ---------------------------
// Ce qu'il faut créer se déduit du chantier, comme la liste des destinations.
function besoinDeContenant() {
  const f = formulaireDe(typeCourant());
  if (f === 'MOISSON') {
    return { genre: 'CELLULE', contenu: 'GRAIN', quoi: 'une cellule à grain', toggle: '＋ Nouvelle cellule à grain',
             batimentOk: accepteCellules,
             typeBatiment: 'un bâtiment de stockage grain (ou mixte)' };
  }
  if (f === 'SECHAGE') {
    return { genre: 'CELLULE', contenu: 'FOURRAGE', quoi: 'une cellule de séchage en grange', toggle: '＋ Nouvelle cellule de séchage',
             batimentOk: accepteFourrage,
             typeBatiment: 'un bâtiment de stockage fourrage (ou mixte)' };
  }
  return { genre: 'EMPLACEMENT', contenu: null, quoi: 'un emplacement de fourrage (en bottes)', toggle: '＋ Nouvel emplacement de fourrage',
           batimentOk: accepteFourrage,
           typeBatiment: 'un bâtiment de stockage fourrage (ou mixte)' };
}

function batimentsUtilisables() {
  const b = besoinDeContenant();
  return getBatiments().filter(b.batimentOk);
}

/**
 * @param {number} nbOptions nombre de destinations déjà disponibles,
 *                           ou -1 quand le bloc n'a pas lieu d'être.
 */
function majBlocCreation(nbOptions) {
  if (nbOptions < 0) {
    el['flux-creer-toggle'].hidden = true;
    el['flux-creer-wrap'].hidden = true;
    return;
  }
  const besoin = besoinDeContenant();
  const batiments = batimentsUtilisables();
  remplirSelect(el['flux-creer-bat'],
    batiments.map((b) => ({ value: b.id, label: b.nom || 'Bâtiment' })),
    el['flux-creer-bat'].value);
  el['flux-creer-bat-wrap'].hidden = !batiments.length;

  if (batiments.length) {
    el['flux-creer-titre'].textContent = 'Créer ' + besoin.quoi;
    el['flux-creer-aide'].textContent = nbOptions
      ? ''
      : `Aucun contenant du bon type n'existe encore. Crée-le ici, sans perdre ta saisie : tu reviens aussitôt à cette étape avec le nouveau contenant déjà choisi.`;
    el['flux-creer'].textContent = '➕ Créer ' + besoin.quoi;
  } else {
    el['flux-creer-titre'].textContent = 'Créer le bâtiment de stockage';
    el['flux-creer-aide'].textContent =
      `Il faut d'abord ${besoin.typeBatiment}. Crée-le ici : on enchaînera sur ${besoin.quoi}, et tu reviendras à cette étape sans rien avoir perdu.`;
    el['flux-creer'].textContent = '➕ Créer le bâtiment';
  }

  // Liste vide : le bloc est ouvert d'office, c'est la seule chose à faire.
  // Liste garnie : un simple lien discret, pour que « Vers » reste le choix
  // principal et que créer un contenant ne soit jamais la seule option visible.
  const vide = nbOptions === 0;
  el['flux-creer-wrap'].hidden = !vide;
  el['flux-creer-toggle'].hidden = vide;
  el['flux-creer-toggle'].textContent = besoin.toggle;
}

el['flux-creer-toggle'].addEventListener('click', () => {
  el['flux-creer-wrap'].hidden = !el['flux-creer-wrap'].hidden;
  el['flux-creer-toggle'].textContent = el['flux-creer-wrap'].hidden
    ? '＋ Nouvel emplacement de stockage' : '− Annuler la création';
});

// Le tunnel s'efface le temps de la création (les deux panneaux couvrent
// l'écran) puis revient tel quel, avec le contenant tout neuf sélectionné.
function eclipserTunnel() { panel.hidden = true; }
function rouvrirTunnel(brutDest) {
  panel.hidden = false;
  preparerFlux(brutDest ? { dest: brutDest } : {});
  if (brutDest) hideError();
}

el['flux-creer'].addEventListener('click', () => {
  const besoin = besoinDeContenant();
  const batimentId = el['flux-creer-bat'].value;
  if (!batimentId) {
    if (!createurs.batiment) { showError("Création de bâtiment indisponible."); return; }
    eclipserTunnel();
    createurs.batiment({
      onCree: (id) => {
        if (!id) { rouvrirTunnel(null); return; }
        // Enchaînement immédiat : un bâtiment sans contenant ne débloquerait
        // rien, et renvoyer l'exploitant le créer lui-même serait le même
        // cul-de-sac qu'avant.
        creerContenant(id, besoin);
      }
    });
    return;
  }
  creerContenant(batimentId, besoin);
});

function creerContenant(batimentId, besoin) {
  const suite = (id) => rouvrirTunnel(id ? besoin.genre === 'CELLULE' ? 'CELLULE:' + id : 'EMPLACEMENT_FOURRAGE:' + id : null);
  eclipserTunnel();
  if (besoin.genre === 'CELLULE') {
    if (!createurs.cellule) { rouvrirTunnel(null); showError('Création de cellule indisponible.'); return; }
    createurs.cellule(batimentId, { contenu: besoin.contenu, onCree: suite });
  } else {
    if (!createurs.emplacement) { rouvrirTunnel(null); showError("Création d'emplacement indisponible."); return; }
    createurs.emplacement(batimentId, { onCree: suite });
  }
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
  // Le poids de botte est saisi à l'étape 2 pour un pressage : le redemander
  // ici ouvrirait la porte à deux valeurs différentes pour la même récolte.
  el['flux-champ-poids'].hidden =
    !(fourrage && fluxCourant() === 'ENTREE_STOCK') || formulaireDe(typeCourant()) === 'PRESSAGE';
  // Grain entrant : sans lui, un silo rempli par une moisson resterait
  // affiché « — » alors qu'on vient justement d'y mettre quelque chose.
  // Sur une moisson, l'espèce n'est plus demandée dès lors qu'on peut la
  // déduire de l'implantation de la parcelle. On ne la masque QUE dans ce
  // cas : sans implantation renseignée, la cellule resterait étiquetée « — »
  // et plus rien n'indiquerait ce qu'elle contient.
  const cellule = c && c.type === 'CELLULE' && fluxCourant() === 'ENTREE_STOCK';
  const f = formulaireDe(typeCourant());
  const deduite = f === 'MOISSON' ? especeDeduite() : null;
  el['flux-champ-grain'].hidden = !cellule || f === 'SECHAGE' || (f === 'MOISSON' && !!deduite);
  el['flux-grain-label'].textContent = f === 'MOISSON'
    ? "Espèce récoltée (la parcelle n'a pas d'implantation renseignée)"
    : 'Grain';
  if (cellule) {
    const cel = getCelluleById(c.id);
    if (cel && cel.typeGrainActuel) el['flux-grain'].value = cel.typeGrainActuel;
    // Le séchage en grange rentre du foin : le contenu de la cellule est
    // connu d'avance, il n'y a rien à demander (cf. construireMouvement).
  }
  if (deduite) el['flux-grain'].value = deduite.valeur;

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
// Première option vide : quand l'espèce n'a pas pu être déduite, le champ
// réapparaît et ne doit rien préjuger — étiqueter un silo « Orge » parce que
// c'est la première ligne de la liste serait pire que de le laisser vide.
el['flux-grain'].innerHTML = '<option value="">— Non précisé —</option>' +
  TYPES_GRAIN.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
el['flux-source-id'].addEventListener('change', majUniteFlux);
el['flux-dest-id'].addEventListener('change', majUniteFlux);

// --- Ouverture ------------------------------------------------------------
function reinitialiser() {
  saveToken++;
  hideError();
  el.save.disabled = false; el.save.textContent = 'Enregistrer';
  meteoCourante = null;
  setPhoto(null);
  setEtiquette(null);
  selection = new Set();
  typeChoisiId = null;
  statut = 'TERMINE';
  mouvementLie = null;
  fluxEnregistre = null;
  effetPrecedent = null;
  el['effet-culture'].hidden = true;
  el['culture-new'].hidden = true;
  el['culture-toggle'].textContent = '＋ Nouvelle culture';
  el['culture-nom'].value = '';
  peuplerCultures('');
  ['produit', 'quantite', 'materiel', 'duree', 'chauffeur', 'notes',
   'flux-quantite', 'flux-poids', 'newtype-nom']
    .forEach((k) => { el[k].value = ''; });
  ecrireSaisie(null);
  delete el.campagne.dataset.auto;
  appliquerGroupe();
  peuplerMateriels('');
  el.newtype.hidden = true;
  el['newtype-toggle'].textContent = '＋ Action sur mesure';
  el.unite.value = '';
  el.details.hidden = true;
  el['details-toggle'].textContent = '＋ Détails (météo, photo)';
  afficherMeteo();
  majStatutBoutons();
  majCibleBoutons();
}

// Une parcelle qui n'a plus d'implantation active mais en a déjà porté une
// est en INTERCULTURE (chaumes) — ni "vide", ni encore sur l'ancienne
// culture (cf. accueil.js/ouvrirApercu et ui-assolement.js/statutReel, même
// logique). Sert ici à savoir si un travail fait sur cette parcelle prépare
// la campagne suivante plutôt que de clore la précédente.
function enInterculture(parcelleId, date) {
  if (implantationEnCours(parcelleId, date)) return false;
  return historiqueParcelle(parcelleId).length > 0;
}

// Campagne agricole : l'année de la date saisie, proposée d'office. Une
// récolte de juillet appartient à la campagne en cours, et corriger l'année à
// la main reste possible pour un cas particulier.
//
// Deux exceptions automatiques, toutes deux réservées à une activité sur
// PARCELLE :
//   1) Fumier, chaux et travail du sol (déchaumage, labour, vibroculteur,
//      moisson — effetCulture 'DETRUIT') faits PENDANT l'interculture d'une
//      parcelle sélectionnée sont déjà de la préparation pour le prochain
//      semis, pas un geste de fin de campagne — rattachés d'office à la
//      campagne SUIVANTE. Une activité qui vient elle-même de clore la
//      culture en place (ex. la moisson qui déclenche la clôture) ne
//      bascule pas : au moment du calcul, l'implantation est encore active.
//   2) Un Semis (effetCulture 'IMPLANTE') vise la campagne où sa culture
//      sera récoltée/pâturée, jamais celle où on l'a semée — même règle que
//      campagneDeSemis() (implantations.js), qui tague déjà l'implantation
//      elle-même : un semis d'automne (août-décembre) appartient à l'année
//      suivante, y compris pour le champ "campagne" de l'ACTIVITÉ. Seule une
//      dérobée/CIPAN (culture de famille "derobee") fait exception : elle
//      reste rattachée à la campagne EN COURS, en interculture — ce n'est
//      pas la culture N+1 elle-même, juste une étape avant elle.
function campagneDeLaDate() {
  const d = el.date.value || aujourdhui();
  const annee = d.slice(0, 4);
  const t = typeCourant();
  const effet = effetCultureDe(t);
  if (cible === 'PARCELLE' && effet === 'IMPLANTE') {
    const culture = getCultureById(el.culture.value);
    if (culture && culture.famille === 'derobee') return annee;
    return campagneDeSemis(d) || annee;
  }
  const preparationInterculture = cible === 'PARCELLE' &&
    (formulaireDe(t) === 'FUMIER' || formulaireDe(t) === 'CHAULAGE' || effet === 'DETRUIT') &&
    Array.from(selection).some((id) => enInterculture(id, d));
  return preparationInterculture ? String(Number(annee) + 1) : annee;
}

// Liste des chauffeurs déjà saisis, construite depuis le journal : aucune
// table à tenir à jour, et le nom proposé est forcément un nom déjà utilisé
// sur l'exploitation.
export function setChauffeursConnus(interventions) {
  const noms = Array.from(new Set(
    (interventions || []).map((i) => String(i.chauffeur || '').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'fr'));
  el.chauffeurs.innerHTML = noms.map((n) => `<option value="${escapeAttr(n)}"></option>`).join('');
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
    el.campagne.value = campagneDeLaDate();
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
    el.campagne.value = itv.campagneId || campagneDeLaDate();
    cible = itv.cibleType || 'PARCELLE';
    majCibleBoutons();
    (itv.parcelleIds || []).forEach((id) => selection.add(id));
    typeChoisiId = itv.typeId || null;
    statut = itv.statut || 'TERMINE';
    majStatutBoutons();
    renderCibles();
    renderActivites();
    ecrireSaisie(itv.saisie);
    appliquerType();
    el.chauffeur.value = itv.chauffeur || '';
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
    setEtiquette(itv.photoEtiquette || null);
    // Mouvement déjà créé par cette activité : on le retrouve pour le mettre à
    // jour plutôt que d'en créer un second à chaque modification.
    effetPrecedent = itv.effetCulture || null;
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

/**
 * Applique l'effet sur la culture en place et retourne la trace de ce qui a
 * été fait, pour pouvoir le défaire.
 *
 * Une activité « à faire » ne touche à rien : prévoir un labour ne détruit
 * pas la luzerne qui pousse encore. Repasser une activité de « terminé » à
 * « à faire » annule donc l'effet, comme pour le mouvement de stock.
 */
async function appliquerEffetCulture(data, precedent) {
  const effet = effetCultureDe(typeCourant());
  const actif = effet && data.statut === 'TERMINE' && data.cibleType === 'PARCELLE';

  // On défait d'abord ce que cette activité avait fait : sans ça, corriger la
  // date d'un labour laisserait la première clôture en place.
  if (precedent) await defaireEffetCulture(precedent);
  if (!actif) return null;

  const trace = { cloturees: [], creees: [] };
  const cultureId = (data.saisie && data.saisie.cultureId) || null;

  for (const parcelleId of data.parcelleIds) {
    if (effet === 'IMPLANTE' && cultureId) {
      const precedente = implantationEnCours(parcelleId, data.date);
      if (precedente && precedente.dateSemis !== data.date) {
        trace.cloturees.push({ id: precedente.id, finPrecedente: precedente.dateFin || null });
      }
      // setImplantation clôture la précédente la veille et ouvre la nouvelle ;
      // la campagne (prévisionnel) se déduit seule de la date de semis.
      const id = await setImplantation(
        { parcelleId, cultureId, dateSemis: data.date, notes: '' },
        { cloturerPrecedente: true }
      );
      trace.creees.push(id);
    } else if (effet === 'DETRUIT') {
      const impl = implantationEnCours(parcelleId, data.date);
      if (!impl) continue;
      trace.cloturees.push({ id: impl.id, finPrecedente: impl.dateFin || null });
      await cloturerImplantation(impl.id, data.date);
    }
  }
  return trace.cloturees.length || trace.creees.length ? trace : null;
}

/** Remet l'assolement dans l'état où il était avant cette activité. */
async function defaireEffetCulture(trace) {
  if (!trace) return;
  for (const id of trace.creees || []) {
    await deleteImplantation(id);
  }
  for (const c of trace.cloturees || []) {
    // finPrecedente vaut null quand l'implantation était ouverte : la
    // rouvrir, c'est lui remettre exactement cette valeur.
    await cloturerImplantation(c.id, c.finPrecedente || null);
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
    if (fluxCourant()) validerEtape(3);

    // Tout est lu AVANT le premier await : écrire déclenche des snapshots
    // Firestore qui repeuplent les listes et réinitialiseraient les champs.
    const t = typeCourant();
    const flux = fluxCourant();
    const formulaire = formulaireDe(t);
    const saisie = lireSaisie();
    const data = {
      date: el.date.value,
      campagneId: el.campagne.value || campagneDeLaDate(),
      typeId: typeChoisiId,
      typeNom: t ? t.nom : '',
      cibleType: cible,
      parcelleIds: Array.from(selection),
      statut,
      saisie,
      chauffeur: el.chauffeur.value,
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
      photoEtiquette: formulaire === 'SEMIS' ? etiquetteCourante : null,
      notes: el.notes.value
    };

    let fluxSaisi = null;
    if (flux) {
      // Pour une récolte, la quantité vient du comptage de l'étape 2 (bottes,
      // remorques, bennes) : c'est le chiffre réellement relevé au champ.
      const calculee = quantiteDeSaisie(formulaire, saisie);
      const q = calculee != null ? calculee : Number(el['flux-quantite'].value);
      const brutDest = el['flux-dest-id'].value;
      const brutSource = el['flux-source-id'].value;
      if (q > 0) {
        fluxSaisi = {
          flux, quantite: q,
          poids: formulaire === 'PRESSAGE'
            ? (saisie && saisie.poidsBotteKg != null ? saisie.poidsBotteKg : null)
            : (el['flux-poids'].value === '' ? null : Number(el['flux-poids'].value)),
          // Séchage en grange : c'est du foin, rien à demander. Moisson :
          // l'espèce est déduite de l'implantation de la parcelle.
          grain: formulaire === 'SECHAGE' ? 'FOIN'
            : formulaire === 'MOISSON'
              ? ((especeDeduite() || {}).valeur || el['flux-grain'].value || null)
              : (el['flux-champ-grain'].hidden ? null : el['flux-grain'].value),
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

    // L'effet sur la culture est appliqué AVANT l'écriture de l'activité, et
    // la trace de ce qu'il a fait part avec elle : c'est ce qui permet de
    // revenir en arrière si l'activité est supprimée.
    data.effetCulture = await appliquerEffetCulture(data, effetPrecedent);

    if (mode === 'create') await createIntervention(data);
    else if (editingId) await updateIntervention(editingId, data);

    fini = true; clearTimeout(minuteur);
    if (monToken === saveToken) {
      log('activité enregistrée' + (mouvementId ? ' (+ mouvement de stock)' : ''));
      toastSucces('Activité enregistrée.');
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
      toastErreur(`Échec de l'enregistrement de l'activité : ${(err && err.message) || err}`);
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
    const mvt = {
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
    // Identité du lot, figée sur le mouvement : c'est elle qui le fait
    // apparaître dans le croisement coupe × type, dans le détail du
    // contenant, et dans le choix de ration.
    const s = data.saisie || {};
    if (s.numeroCoupe || s.typeFourrage) {
      const conservation = conservationDuContenant(destType, destId)
        || (destType === 'EMPLACEMENT_FOURRAGE' ? 'botte' : 'grange');
      mvt.typeFourrage = s.typeFourrage || null;
      mvt.numeroCoupe = s.numeroCoupe || null;
      mvt.conservation = conservation;
      mvt.categorieCle = cleFoin(conservation, s.numeroCoupe, s.typeFourrage);
      mvt.categorieLabel = labelFoin(conservation, s.numeroCoupe, s.typeFourrage);
    } else if (destType === 'CELLULE' && f.grain) {
      // Le libellé plutôt que le code : « Blé » et non « BLE », pour que la
      // colonne de ration se lise comme le reste de l'application.
      const espece = labelGrain(f.grain);
      mvt.typeFourrage = espece;
      mvt.categorieCle = cleCereale(espece);
      mvt.categorieLabel = labelCereale(espece);
    }
    return mvt;
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
    // La culture détruite par cette activité est remise en place : effacer un
    // labour saisi par erreur ne doit pas laisser l'assolement amputé.
    await defaireEffetCulture(effetPrecedent);
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
