// Vue Bâtiments : bergeries, cellules à grain, emplacements de fourrage, et
// le journal des mouvements qui fait varier leurs niveaux.
import {
  TYPES_BATIMENT, TYPES_GRAIN, TYPES_FOURRAGE, typeBatiment, labelGrain, labelFourrage,
  accepteCellules, accepteFourrage, accepteLots,
  getBatiments, getBatimentById, createBatiment, updateBatiment, deleteBatiment
} from './batiments.js';
import {
  getCellules, getCelluleById, cellulesDuBatiment, tauxRemplissage,
  createCellule, updateCellule, deleteCellule,
  CONTENUS_CELLULE, contenuDe
} from './cellules.js';
import {
  getEmplacements, getEmplacementById, emplacementsDuBatiment, tonnes as tonnesFourrage,
  createEmplacement, updateEmplacement, deleteEmplacement
} from './emplacements.js';
import {
  TYPES_MOUVEMENT, typeMouvement, getMouvements, niveauContenant, mouvementsDuContenant,
  createMouvement, updateMouvement, deleteMouvement
} from './mouvements.js';
import { getLots } from './lots.js';
import { openEditLot } from './ui-alimentation.js';
import { getStadeById } from './stades.js';
import { aujourdhui } from './implantations.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import {
  centrerSurMaPosition, getMap, demarrerPlacement, arreterPlacement, positionPlacement
} from './map.js';
import { messagePermission } from './diagnostic-regles.js';

class ErreurDeSaisie extends Error {}
function log(m) { if (window.__logisolDebug) window.__logisolDebug(m); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fabrique un petit contrôleur de panneau : même squelette pour les quatre
// formulaires (bâtiment, cellule, emplacement, mouvement), donc une seule
// implémentation du bandeau d'erreur, du jeton anti-course et du timeout.
function panneau(prefix, ids) {
  const el = {};
  ids.forEach((id) => { el[id] = document.getElementById(`${prefix}-${id}`); });
  return el;
}

const listeEl = document.getElementById('batiments-liste');
const totauxEl = document.getElementById('batiments-totaux');
const mouvementsEl = document.getElementById('mouvements-liste');

let parcelles = [];
export function setParcellesBatiments(list) { parcelles = list; }

// ==========================================================================
// Bâtiment
// ==========================================================================
const bat = {
  panel: document.getElementById('batiment-panel'),
  form: document.getElementById('bat-form'),
  ...panneau('bat', ['title', 'nom', 'type', 'position', 'locate', 'placer', 'position-clear',
                     'remarques', 'contenants', 'contenants-wrap', 'add-cellule',
                     'add-emplacement', 'save', 'cancel', 'delete',
                     'error-banner', 'error-text', 'error-close'])
};
let batEditId = null;
let batLat = null;
let batLon = null;

bat.type.innerHTML = TYPES_BATIMENT.map((t) => `<option value="${t.value}">${t.icone} ${t.label}</option>`).join('');
bat['error-close'].addEventListener('click', () => { bat['error-banner'].hidden = true; });

function batError(m) { bat['error-text'].textContent = m; bat['error-banner'].hidden = false; }

function majPosition() {
  bat.position.textContent = (batLat != null && batLon != null)
    ? `${batLat.toFixed(5)}, ${batLon.toFixed(5)}`
    : 'Non renseignée';
}

// Rappels posés par le tunnel de saisie : après la création, il reprend la
// main avec le contenant tout neuf déjà sélectionné, au lieu de renvoyer
// l'exploitant se débrouiller dans l'onglet Bâtiments.
let apresBatiment = null;
let apresCellule = null;
let apresEmplacement = null;

export function openCreateBatiment(opts = {}) {
  apresBatiment = opts.onCree || null;
  batEditId = null;
  batLat = null; batLon = null;
  bat.panel.hidden = false;
  bat['error-banner'].hidden = true;
  bat.title.textContent = 'Nouveau bâtiment';
  bat.delete.hidden = true;
  bat.nom.value = '';
  bat.type.value = 'MIXTE';
  bat.remarques.value = '';
  majPosition();
  // Les contenants ne peuvent être rattachés qu'à un bâtiment déjà
  // enregistré : sans id, une cellule n'aurait nulle part où aller.
  bat['contenants-wrap'].hidden = true;
  log('formulaire bâtiment ouvert (création)');
}

export function openEditBatiment(b) {
  batEditId = b.id;
  batLat = b.latitude != null ? Number(b.latitude) : null;
  batLon = b.longitude != null ? Number(b.longitude) : null;
  bat.panel.hidden = false;
  bat['error-banner'].hidden = true;
  bat.title.textContent = b.nom || 'Bâtiment';
  bat.delete.hidden = false;
  bat.nom.value = b.nom || '';
  bat.type.value = b.type || 'MIXTE';
  bat.remarques.value = b.remarques || '';
  majPosition();
  bat['contenants-wrap'].hidden = false;
  renderContenantsDuBatiment(b);
}

function renderContenantsDuBatiment(b) {
  const cels = cellulesDuBatiment(b.id);
  const emps = emplacementsDuBatiment(b.id);
  const lots = getLots().filter((l) => l.batimentId === b.id);
  // Une cellule se compte en tonnes : c'est un silo à grain, MAIS AUSSI une
  // cellule de séchage en grange. Un bâtiment de stockage fourrage doit donc
  // pouvoir en recevoir — sans quoi le séchage en grange n'a nulle part où
  // rentrer, et la saisie de récolte reste bloquée.
  bat['add-cellule'].hidden = !(accepteCellules(b) || accepteFourrage(b));
  bat['add-cellule'].textContent = accepteCellules(b) ? '➕ Cellule' : '➕ Cellule (séchage)';
  bat['add-emplacement'].hidden = !accepteFourrage(b);

  const blocs = [];
  cels.forEach((c) => {
    const n = niveauContenant('CELLULE', c.id).quantite;
    const fourrage = contenuDe(c) === 'FOURRAGE';
    const label = fourrage ? labelFourrage(c.typeGrainActuel) : labelGrain(c.typeGrainActuel);
    blocs.push(ligneContenant(fourrage ? '🌿' : '🌾', c.nom, `${formatTonnes(n)} / ${formatTonnes(c.capaciteMaxTonnes)} t · ${label}`, 'cellule', c.id, tauxRemplissage(c, n)));
  });
  emps.forEach((e) => {
    const n = niveauContenant('EMPLACEMENT_FOURRAGE', e.id);
    blocs.push(ligneContenant('🧻', e.nom, `${n.quantite} bottes · ${labelFourrage(e.typeFourrage)}${n.poidsMoyenBotteKg ? ' · ~' + n.poidsMoyenBotteKg + ' kg/botte' : ''}`, 'emplacement', e.id, null));
  });
  lots.forEach((l) => {
    const st = getStadeById(l.stadeId);
    // Un lot se touche comme une cellule : c'est le seul endroit où on le
    // voit depuis la bergerie, et il n'y avait aucun moyen de l'ouvrir — donc
    // aucun moyen de le modifier ni de le supprimer depuis ici.
    blocs.push(ligneContenant('🐑', l.nom, `${l.nbBrebis} brebis · ${st ? st.nom : 'stade non défini'}`, 'lot', l.id, null));
  });
  bat.contenants.innerHTML = blocs.length ? blocs.join('') : '<p class="list-empty">Aucun contenu pour l\'instant.</p>';
  bat.contenants.querySelectorAll('[data-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.kind === 'cellule') openEditCellule(getCelluleById(el.dataset.id));
      else if (el.dataset.kind === 'lot') {
        const lot = getLots().find((l) => l.id === el.dataset.id);
        if (lot) { bat.panel.hidden = true; openEditLot(lot); }
      } else openEditEmplacement(getEmplacementById(el.dataset.id));
    });
  });
}

function ligneContenant(icone, nom, detail, kind, id, taux) {
  const attrs = kind ? ` data-kind="${kind}" data-id="${esc(id)}" style="cursor:pointer"` : '';
  const jauge = taux != null
    ? `<div class="jauge"><div class="jauge-barre ${taux > 100 ? 'jauge-trop' : ''}" style="width:${Math.min(100, taux)}%"></div></div>`
    : '';
  return `<div class="contenant-ligne"${attrs}>
    <span class="contenant-icone">${icone}</span>
    <div class="contenant-body">
      <div class="contenant-nom">${esc(nom)}</div>
      <div class="contenant-detail">${esc(detail)}</div>
      ${jauge}
    </div>
    ${taux != null ? `<div class="contenant-taux ${taux > 100 ? 'urgent' : ''}">${taux}%</div>` : ''}
  </div>`;
}

bat.locate.addEventListener('click', () => {
  bat.position.textContent = 'Recherche...';
  // Pointer un bâtiment se fait sur place : on relève la position de
  // l'appareil plutôt que de demander des coordonnées à taper.
  centrerSurMaPosition({
    zoom: 18,
    onSuccess: () => {
      const map = getMap();
      if (map) { const c = map.getCenter(); batLat = c.lat; batLon = c.lng; }
      majPosition();
    },
    onError: (m) => { bat.position.textContent = 'Position indisponible : ' + m; }
  });
});
bat['position-clear'].addEventListener('click', () => { batLat = null; batLon = null; majPosition(); });

// --- Placement par tap sur la carte ---------------------------------------
// Le panneau doit s'effacer le temps du placement : il couvre tout l'écran,
// donc la carte en dessous. On mémorise l'état saisi pour le restaurer
// ensuite — perdre un nom déjà tapé parce qu'on va placer le bâtiment serait
// exactement le genre de détail qui fait abandonner une saisie.
let etatAvantPlacement = null;
let onDemanderPlacement = () => {};
export function setOnDemanderPlacement(cb) { onDemanderPlacement = cb || (() => {}); }

bat.placer.addEventListener('click', () => {
  etatAvantPlacement = {
    editId: batEditId,
    nom: bat.nom.value,
    type: bat.type.value,
    remarques: bat.remarques.value,
    lat: batLat,
    lon: batLon
  };
  bat.panel.hidden = true;
  onDemanderPlacement({
    depart: (batLat != null && batLon != null) ? { lat: batLat, lng: batLon } : null,
    onValider: (pos) => {
      restaurerApresPlacement();
      if (pos) { batLat = pos.lat; batLon = pos.lng; }
      majPosition();
    },
    onAnnuler: () => { restaurerApresPlacement(); majPosition(); }
  });
});

function restaurerApresPlacement() {
  if (!etatAvantPlacement) return;
  batEditId = etatAvantPlacement.editId;
  bat.panel.hidden = false;
  bat.nom.value = etatAvantPlacement.nom;
  bat.type.value = etatAvantPlacement.type;
  bat.remarques.value = etatAvantPlacement.remarques;
  batLat = etatAvantPlacement.lat;
  batLon = etatAvantPlacement.lon;
  bat['contenants-wrap'].hidden = !batEditId;
  if (batEditId) {
    const b = getBatimentById(batEditId);
    if (b) renderContenantsDuBatiment(b);
  }
  etatAvantPlacement = null;
}
bat.cancel.addEventListener('click', () => {
  bat.panel.hidden = true;
  if (apresBatiment) { const cb = apresBatiment; apresBatiment = null; cb(null); }
});

bat['add-cellule'].addEventListener('click', () => { if (batEditId) openCreateCellule(batEditId); });
bat['add-emplacement'].addEventListener('click', () => { if (batEditId) openCreateEmplacement(batEditId); });

bat.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  bat['error-banner'].hidden = true;
  bat.save.disabled = true; bat.save.textContent = 'Enregistrement...';
  try {
    const data = {
      nom: bat.nom.value, type: bat.type.value, remarques: bat.remarques.value,
      latitude: batLat, longitude: batLon
    };
    let nouveauId = batEditId;
    if (batEditId) await updateBatiment(batEditId, data);
    else nouveauId = (await createBatiment(data)).id;
    bat.panel.hidden = true;
    log('bâtiment enregistré');
    if (apresBatiment) { const cb = apresBatiment; apresBatiment = null; cb(nouveauId, data.type); }
  } catch (err) {
    batError(messageErreur(err, 'lgs_batiments'));
  } finally {
    bat.save.disabled = false; bat.save.textContent = 'Enregistrer';
  }
});

bat.delete.addEventListener('click', async () => {
  if (!batEditId) return;
  const cels = cellulesDuBatiment(batEditId);
  const emps = emplacementsDuBatiment(batEditId);
  if (cels.length || emps.length) {
    batError(`Ce bâtiment contient encore ${cels.length} cellule(s) et ${emps.length} emplacement(s). Supprime-les d'abord — sinon leurs mouvements resteraient rattachés à un bâtiment disparu.`);
    return;
  }
  if (!confirm('Supprimer ce bâtiment ? Cette action est irréversible.')) return;
  bat.delete.disabled = true;
  try { await deleteBatiment(batEditId); bat.panel.hidden = true; }
  catch (err) { batError(messageErreur(err)); }
  finally { bat.delete.disabled = false; }
});

// ==========================================================================
// Cellule à grain
// ==========================================================================
const cel = {
  panel: document.getElementById('cellule-panel'),
  form: document.getElementById('cel-form'),
  ...panneau('cel', ['title', 'nom', 'capacite', 'contenu', 'grain', 'grain-label', 'etat', 'niveau',
                     'save', 'cancel', 'delete', 'error-banner', 'error-text', 'error-close'])
};
let celEditId = null;
let celBatimentId = null;

cel.contenu.innerHTML = CONTENUS_CELLULE
  .map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
cel.contenu.addEventListener('change', () => majOptionsContenu(cel.grain.value));

// Une cellule se compte en tonnes, qu'elle contienne du grain ou du foin
// séché en grange : seul le vocabulaire du contenu change.
function majOptionsContenu(valeur) {
  const fourrage = cel.contenu.value === 'FOURRAGE';
  const liste = fourrage ? TYPES_FOURRAGE : TYPES_GRAIN;
  cel['grain-label'].textContent = fourrage ? 'Fourrage actuellement stocké' : 'Grain actuellement stocké';
  cel.grain.innerHTML = '<option value="">— Vide —</option>' +
    liste.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
  if (valeur && liste.some((t) => t.value === valeur)) cel.grain.value = valeur;
}
majOptionsContenu('');
cel['error-close'].addEventListener('click', () => { cel['error-banner'].hidden = true; });
cel.cancel.addEventListener('click', () => {
  cel.panel.hidden = true;
  if (apresCellule) { const cb = apresCellule; apresCellule = null; cb(null); }
});

export function openCreateCellule(batimentId, opts = {}) {
  apresCellule = opts.onCree || null;
  celEditId = null; celBatimentId = batimentId;
  cel.panel.hidden = false;
  cel['error-banner'].hidden = true;
  cel.title.textContent = 'Nouvelle cellule';
  cel.delete.hidden = true;
  cel.nom.value = ''; cel.capacite.value = '';
  // Contenu proposé d'après le bâtiment : un hangar à fourrage n'accueille
  // pas du grain, et le redemander à chaque fois serait une question dont la
  // réponse est déjà connue.
  const b = getBatimentById(batimentId);
  cel.contenu.value = opts.contenu
    || (b && b.type === 'STOCKAGE_FOURRAGE' ? 'FOURRAGE' : 'GRAIN');
  majOptionsContenu('');
  cel.etat.hidden = true;
}

export function openEditCellule(c) {
  if (!c) return;
  celEditId = c.id; celBatimentId = c.batimentId;
  cel.panel.hidden = false;
  cel['error-banner'].hidden = true;
  cel.title.textContent = c.nom || 'Cellule';
  cel.delete.hidden = false;
  cel.nom.value = c.nom || '';
  cel.capacite.value = c.capaciteMaxTonnes != null ? c.capaciteMaxTonnes : '';
  cel.contenu.value = contenuDe(c);
  majOptionsContenu(c.typeGrainActuel || '');
  const n = niveauContenant('CELLULE', c.id);
  cel.niveau.textContent = formatTonnes(n.quantite) + ' t';
  cel.etat.hidden = false;
}

cel.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  cel['error-banner'].hidden = true;
  cel.save.disabled = true; cel.save.textContent = 'Enregistrement...';
  try {
    const data = {
      batimentId: celBatimentId, nom: cel.nom.value,
      capaciteMaxTonnes: cel.capacite.value,
      contenu: cel.contenu.value,
      typeGrainActuel: cel.grain.value || null
    };
    let nouveauId = celEditId;
    if (celEditId) await updateCellule(celEditId, data);
    else nouveauId = (await createCellule(data)).id;
    cel.panel.hidden = true;
    const b = getBatimentById(celBatimentId);
    if (b && !bat.panel.hidden) renderContenantsDuBatiment(b);
    if (apresCellule) { const cb = apresCellule; apresCellule = null; cb(nouveauId); }
  } catch (err) {
    cel['error-text'].textContent = messageErreur(err, 'lgs_cellules_grain'); cel['error-banner'].hidden = false;
  } finally {
    cel.save.disabled = false; cel.save.textContent = 'Enregistrer';
  }
});

cel.delete.addEventListener('click', async () => {
  if (!celEditId) return;
  const n = mouvementsDuContenant('CELLULE', celEditId).length;
  if (!confirm(n
    ? `Cette cellule porte ${n} mouvement(s) qui resteraient orphelins. Supprimer quand même ?`
    : 'Supprimer cette cellule ?')) return;
  cel.delete.disabled = true;
  try {
    await deleteCellule(celEditId);
    cel.panel.hidden = true;
    const b = getBatimentById(celBatimentId);
    if (b && !bat.panel.hidden) renderContenantsDuBatiment(b);
  } catch (err) {
    cel['error-text'].textContent = messageErreur(err); cel['error-banner'].hidden = false;
  } finally { cel.delete.disabled = false; }
});

// ==========================================================================
// Emplacement de fourrage
// ==========================================================================
const emp = {
  panel: document.getElementById('emplacement-panel'),
  form: document.getElementById('emp-form'),
  ...panneau('emp', ['title', 'nom', 'type', 'etat', 'niveau',
                     'save', 'cancel', 'delete', 'error-banner', 'error-text', 'error-close'])
};
let empEditId = null;
let empBatimentId = null;

emp.type.innerHTML = TYPES_FOURRAGE.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
emp['error-close'].addEventListener('click', () => { emp['error-banner'].hidden = true; });
emp.cancel.addEventListener('click', () => {
  emp.panel.hidden = true;
  if (apresEmplacement) { const cb = apresEmplacement; apresEmplacement = null; cb(null); }
});

export function openCreateEmplacement(batimentId, opts = {}) {
  apresEmplacement = opts.onCree || null;
  empEditId = null; empBatimentId = batimentId;
  emp.panel.hidden = false;
  emp['error-banner'].hidden = true;
  emp.title.textContent = 'Nouvel emplacement';
  emp.delete.hidden = true;
  emp.nom.value = ''; emp.type.value = 'FOIN';
  emp.etat.hidden = true;
}

export function openEditEmplacement(e2) {
  if (!e2) return;
  empEditId = e2.id; empBatimentId = e2.batimentId;
  emp.panel.hidden = false;
  emp['error-banner'].hidden = true;
  emp.title.textContent = e2.nom || 'Emplacement';
  emp.delete.hidden = false;
  emp.nom.value = e2.nom || '';
  emp.type.value = e2.typeFourrage || 'FOIN';
  const n = niveauContenant('EMPLACEMENT_FOURRAGE', e2.id);
  emp.niveau.textContent = `${n.quantite} botte${n.quantite > 1 ? 's' : ''}` +
    (n.poidsMoyenBotteKg ? ` · ${formatTonnes((n.quantite * n.poidsMoyenBotteKg) / 1000)} t` : '');
  emp.etat.hidden = false;
}

emp.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  emp['error-banner'].hidden = true;
  emp.save.disabled = true; emp.save.textContent = 'Enregistrement...';
  try {
    const data = { batimentId: empBatimentId, nom: emp.nom.value, typeFourrage: emp.type.value };
    let nouveauId = empEditId;
    if (empEditId) await updateEmplacement(empEditId, data);
    else nouveauId = (await createEmplacement(data)).id;
    emp.panel.hidden = true;
    const b = getBatimentById(empBatimentId);
    if (b && !bat.panel.hidden) renderContenantsDuBatiment(b);
    if (apresEmplacement) { const cb = apresEmplacement; apresEmplacement = null; cb(nouveauId); }
  } catch (err) {
    emp['error-text'].textContent = messageErreur(err, 'lgs_emplacements_fourrage'); emp['error-banner'].hidden = false;
  } finally {
    emp.save.disabled = false; emp.save.textContent = 'Enregistrer';
  }
});

emp.delete.addEventListener('click', async () => {
  if (!empEditId) return;
  const n = mouvementsDuContenant('EMPLACEMENT_FOURRAGE', empEditId).length;
  if (!confirm(n
    ? `Cet emplacement porte ${n} mouvement(s) qui resteraient orphelins. Supprimer quand même ?`
    : 'Supprimer cet emplacement ?')) return;
  emp.delete.disabled = true;
  try {
    await deleteEmplacement(empEditId);
    emp.panel.hidden = true;
    const b = getBatimentById(empBatimentId);
    if (b && !bat.panel.hidden) renderContenantsDuBatiment(b);
  } catch (err) {
    emp['error-text'].textContent = messageErreur(err); emp['error-banner'].hidden = false;
  } finally { emp.delete.disabled = false; }
});

// Collection visée par chaque formulaire, pour nommer la bonne dans un refus.
let collectionCourante = 'lgs_batiments';
function messageErreur(err, collection) {
  if (err instanceof ErreurDeSaisie) return err.message;
  return messagePermission(err, collection || collectionCourante);
}

export { messageErreur, esc, ErreurDeSaisie, renderContenantsDuBatiment };
