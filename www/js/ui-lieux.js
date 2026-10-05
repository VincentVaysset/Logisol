// Onglet Bâtiments (maquette bâtiments v2) : sous-onglets Bâtiments /
// Matériel, et les bâtiments regroupés Fourrage / Grain et aliments /
// Bergeries / Mixtes. Le contenu n'est jamais saisi ici : il vient de Stocks
// (cf. lieux.js), réparti par cellule. Les formulaires (bâtiment, cellule,
// emplacement, mouvement, lot) restent ceux d'avant.
import { getBatiments, getBatimentById } from './batiments.js';
import { getCellules, getCelluleById, contenuDe } from './cellules.js';
import { getEmplacements, getEmplacementById } from './emplacements.js';
import { getMouvements, typeMouvement } from './mouvements.js';
import { getLots } from './lots.js';
import { getMateriels } from './materiel.js';
import { getInterventions } from './interventions.js';
import { labelCoupe } from './stocks.js';
import { tonnesDuMouvement } from './fourrages.js';
import { contenuDesLieux } from './lieux.js';
import { groupeBatiment, GROUPES_BATIMENTS, fmt1, taux } from './contenu-lieux.js';
import { dateLisible } from './accueil.js';
import { openEditBatiment, openEditCellule, openEditEmplacement } from './ui-batiments.js';
import { openCreateMouvement, openEditMouvement } from './ui-mouvements.js';
import { openEditLot } from './ui-alimentation.js';
import { openEditIntervention } from './ui-intervention.js';

const listeEl = document.getElementById('batiments-liste');
const sousTitreEl = document.getElementById('batiments-sous-titre');
const ongletsEl = document.getElementById('batiments-sous-vues');
const panneaux = { lieux: document.getElementById('batiments-lieux'), materiel: document.getElementById('batiments-materiel') };
const actions = { lieux: document.getElementById('bat-actions-lieux'), materiel: document.getElementById('bat-actions-materiel') };

let sousVue = 'lieux';
const ouverts = new Set();
const historiques = new Set();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function initLieux() {
  ongletsEl.querySelectorAll('[data-batvue]').forEach((b) => b.addEventListener('click', () => {
    sousVue = b.dataset.batvue;
    renderLieux();
  }));
}

// « Luzerne 1ʳᵉ coupe », « Orge » : le vocabulaire de Stocks, sans le
// préfixe technique de la clé.
function libelleLot(l) {
  if (l.typeFourrage) return `${l.typeFourrage} ${labelCoupe(l.numeroCoupe)}`;
  const t = String(l.label || '').replace(/^Céréale\s*—\s*/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;   // « Orge », comme dans Stocks
}

function contenuBatiment(b, rep) {
  const cels = getCellules().filter((c) => c.batimentId === b.id).map((c) => {
    const v = rep.get(`CELLULE|${c.id}`) || { tonnes: 0, lots: [] };
    const t = taux(v.tonnes, c.capaciteMaxTonnes);
    return { c, v, taux: t, depasse: t != null && t > 100 };
  });
  const emps = getEmplacements().filter((e) => e.batimentId === b.id).map((e) => ({
    e, v: rep.get(`EMPLACEMENT_FOURRAGE|${e.id}`) || { tonnes: 0, quantite: 0, lots: [] }
  }));
  const lots = getLots().filter((l) => l.batimentId === b.id);
  return { cels, emps, lots };
}

function ligneCellule({ c, v, taux: t, depasse }, interactif) {
  const cap = Number(c.capaciteMaxTonnes) || 0;
  const vide = !v.lots.length;
  const valeur = cap ? `${fmt1(v.tonnes)} / ${fmt1(cap)} t` : `${fmt1(v.tonnes)} t`;
  return `<div class="lieu-ligne"${interactif ? ` data-cellule="${esc(c.id)}"` : ''}>
    <div class="lieu-ligne-tete"><span class="stk-detail-nom">${esc(c.nom || 'Cellule')}${vide ? ' · vide' : ''}</span>
      <strong class="${vide ? 'lieu-zero' : ''}">${valeur}</strong></div>
    ${vide ? '' : `<span class="stk-sous-ligne">${v.lots.map((l) => `${esc(libelleLot(l))} ${fmt1(l.tonnes)} t`).join(' · ')}</span>`}
    ${t != null && !vide ? `<div class="stk-jauge"><div class="${depasse ? 'lieu-jauge-depasse' : contenuDe(c) === 'FOURRAGE' ? '' : 'stk-jauge-cereales'}" style="width:${Math.max(0, Math.min(100, t))}%"></div></div>` : ''}
    ${depasse ? '<span class="lieu-pastille">Capacité dépassée : à vérifier</span>' : ''}
  </div>`;
}

function ligneEmplacement({ e, v }, interactif) {
  const bottes = Math.round(v.quantite);
  const vide = !v.lots.length;
  return `<div class="lieu-ligne"${interactif ? ` data-emplacement="${esc(e.id)}"` : ''}>
    <div class="lieu-ligne-tete"><span class="stk-detail-nom">${esc(e.nom || 'Emplacement')}${vide ? ' · vide' : ''}</span>
      <strong class="${vide ? 'lieu-zero' : ''}">${pluriel(bottes, 'botte')}${v.tonnes > 0.05 ? ` · ${fmt1(v.tonnes)} t` : ''}</strong></div>
    ${vide ? '' : `<span class="stk-sous-ligne">${v.lots.map((l) => `${pluriel(Math.round(l.quantite), 'botte')} ${esc(libelleLot(l))}`).join(' · ')}${v.poidsMoyenBotteKg ? ` · ~${Math.round(v.poidsMoyenBotteKg)} kg` : ''}</span>`}
  </div>`;
}

function ligneLot(l, interactif) {
  return `<div class="lieu-ligne"${interactif ? ` data-lot="${esc(l.id)}"` : ''}>
    <div class="lieu-ligne-tete"><span class="stk-detail-nom">${esc(l.nom || 'Lot')}</span><strong>${Number(l.nbBrebis) || 0}</strong></div>
  </div>`;
}

/** Lignes du contenu d'un bâtiment : aussi l'aperçu ouvert depuis la carte. */
export function htmlContenuBatiment(b, { interactif = false, rep = contenuDesLieux() } = {}) {
  const { cels, emps, lots } = contenuBatiment(b, rep);
  return cels.map((x) => ligneCellule(x, interactif)).join('') +
    emps.map((x) => ligneEmplacement(x, interactif)).join('') +
    lots.map((l) => ligneLot(l, interactif)).join('');
}

function resume({ cels, emps, lots }) {
  const bouts = [];
  if (cels.length) {
    const caps = cels.map((x) => Number(x.c.capaciteMaxTonnes) || 0);
    const capTotal = caps.reduce((n, c) => n + c, 0);
    const memeCap = caps[0] > 0 && caps.every((c) => c === caps[0]);
    bouts.push(cels.length > 1 && memeCap ? `${cels.length} cellules de ${fmt1(caps[0])} t` : pluriel(cels.length, 'cellule'));
    if (capTotal > 0) bouts.push(`${taux(cels.reduce((n, x) => n + x.v.tonnes, 0), capTotal)} % rempli`);
    const aVerifier = cels.filter((x) => x.depasse).length;
    if (aVerifier) bouts.push(`${aVerifier} à vérifier`);
  }
  if (emps.length) {
    const bottes = Math.round(emps.reduce((n, x) => n + x.v.quantite, 0));
    const tonnes = emps.reduce((n, x) => n + x.v.tonnes, 0);
    bouts.push(pluriel(bottes, 'botte'));
    if (bottes > 0 && tonnes > 0) bouts.push(`~${Math.round((tonnes * 1000) / bottes)} kg`);
  }
  if (lots.length) {
    bouts.push(lots.length > 1 ? `${lots.length} lots hébergés` : '1 lot hébergé');
    if (cels.length || emps.length) bouts.push(`${lots.reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0)} têtes`);
  }
  return bouts.join(' · ');
}

function mouvementsDuBatiment({ cels, emps }) {
  const cles = new Set([...cels.map((x) => `CELLULE|${x.c.id}`), ...emps.map((x) => `EMPLACEMENT_FOURRAGE|${x.e.id}`)]);
  return getMouvements()
    .filter((m) => cles.has(`${m.sourceType}|${m.sourceId}`) || cles.has(`${m.destinationType}|${m.destinationId}`))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function historique(contenu) {
  const mvts = mouvementsDuBatiment(contenu);
  if (!mvts.length) return '<p class="stk-vide">Aucun mouvement pour ce lieu.</p>';
  const itv = getInterventions();
  return `<div class="stk-mvts">${mvts.map((m) => {
    const t = typeMouvement(m.typeMouvement);
    const tonnes = m.unite === 'bottes' ? tonnesDuMouvement(m) : Number(m.quantite) || 0;
    const q = m.unite === 'bottes'
      ? `${t.sens === -1 ? '−' : t.sens === 1 ? '+' : ''}${pluriel(Math.round(Number(m.quantite) || 0), 'botte')}`
      : `${t.sens === -1 ? '−' : t.sens === 1 ? '+' : ''}${fmt1(tonnes)} t`;
    const activite = m.typeMouvement === 'ENTREE_RECOLTE' ? itv.find((i) => i.mouvementId === m.id) : null;
    const action = activite
      ? `<button type="button" class="stk-lien" data-activite="${esc(activite.id)}">Activité →</button>`
      : `<button type="button" class="stk-lien-gris" data-modifier="${esc(m.id)}">Modifier</button>`;
    return `<div class="stk-mvt"><div><span class="stk-mvt-nom">${t.icone} ${esc(t.label)} · ${esc(dateLisible(m.date))}</span>
      <span class="stk-sous-ligne">${esc([m.sourceNom, m.destinationNom].filter(Boolean).join(' → ') || m.libelle || '')}</span></div>
      <div class="stk-mvt-droite"><strong>${q}</strong>${action}</div></div>`;
  }).join('')}</div>`;
}

function carte(b, groupe, rep) {
  const contenu = contenuBatiment(b, rep);
  const { cels, emps, lots } = contenu;
  const stockage = cels.length + emps.length > 0;
  if (!stockage && !lots.length) {
    return `<div class="stk-carte lieu-statique" data-batiment="${esc(b.id)}">
      <span class="stk-groupe-nom">${esc(b.nom || 'Bâtiment')}</span><span class="lieu-vide">Vide</span></div>`;
  }
  const tonnes = cels.reduce((n, x) => n + x.v.tonnes, 0) + emps.reduce((n, x) => n + x.v.tonnes, 0);
  const tetes = lots.reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0);
  const capTotal = cels.reduce((n, x) => n + (Number(x.c.capaciteMaxTonnes) || 0), 0);
  const pct = capTotal > 0 ? taux(cels.reduce((n, x) => n + x.v.tonnes, 0), capTotal) : null;
  const jauge = pct != null
    ? `<div class="stk-jauge"><div class="${pct > 100 ? 'lieu-jauge-depasse' : groupe === 'grain' ? 'stk-jauge-cereales' : ''}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`
    : '';
  const ouvert = ouverts.has(b.id);
  const histo = historiques.has(b.id);
  return `<details class="stk-groupe" data-batiment="${esc(b.id)}"${ouvert ? ' open' : ''}>
    <summary>
      <div class="stk-groupe-tete"><span class="stk-groupe-nom">${esc(b.nom || 'Bâtiment')}</span>
        <span><span class="stk-groupe-val">${stockage ? `${fmt1(tonnes)} t` : `${tetes} têtes`}</span> <span class="stk-chev">▼</span></span></div>
      <p class="stk-groupe-sous">${esc(resume(contenu))}</p>
      ${jauge}
    </summary>
    ${htmlContenuBatiment(b, { interactif: true, rep })}
    <div class="stk-actions">
      ${stockage ? '<button type="button" class="stk-lien" data-mouvement>🔁 Mouvement</button>' : '<span></span>'}
      <span class="lieu-actions-droite">
        ${stockage ? `<button type="button" class="stk-lien-gris" data-historique>${histo ? 'Masquer l\'historique' : 'Historique'}</button>` : ''}
        <button type="button" class="stk-lien-gris" data-modifier-batiment>Modifier</button>
      </span>
    </div>
    ${histo ? historique(contenu) : ''}
  </details>`;
}

export function renderLieux() {
  ongletsEl.querySelectorAll('[data-batvue]').forEach((b) => b.classList.toggle('is-active', b.dataset.batvue === sousVue));
  Object.entries(panneaux).forEach(([k, el]) => { el.hidden = k !== sousVue; });
  Object.entries(actions).forEach(([k, el]) => { el.hidden = k !== sousVue; });
  if (sousVue === 'materiel') {
    const n = getMateriels().length;
    sousTitreEl.textContent = pluriel(n, 'machine');
    return;
  }
  const batiments = getBatiments();
  sousTitreEl.textContent = batiments.length ? `${pluriel(batiments.length, 'bâtiment')} · contenu calculé depuis Stocks` : '';
  if (!batiments.length) {
    listeEl.innerHTML = '<p class="stk-note">Aucun bâtiment. Utilise « ➕ Bâtiment » pour commencer.</p>';
    return;
  }
  const rep = contenuDesLieux();
  const parGroupe = new Map(GROUPES_BATIMENTS.map((g) => [g.id, []]));
  batiments.forEach((b) => {
    const cels = getCellules().filter((c) => c.batimentId === b.id);
    const g = groupeBatiment(b.type, {
      fourrage: getEmplacements().some((e) => e.batimentId === b.id) || cels.some((c) => contenuDe(c) === 'FOURRAGE'),
      grain: cels.some((c) => contenuDe(c) !== 'FOURRAGE'),
      lots: getLots().some((l) => l.batimentId === b.id)
    });
    parGroupe.get(g).push(carte(b, g, rep));
  });
  listeEl.innerHTML = GROUPES_BATIMENTS
    .filter((g) => parGroupe.get(g.id).length)
    .map((g) => `<h3 class="stk-section">${g.nom}</h3><div class="stk-groupes lieu-groupe">${parGroupe.get(g.id).join('')}</div>`)
    .join('');
  cabler();
}

function cabler() {
  listeEl.querySelectorAll('details[data-batiment]').forEach((det) => {
    det.addEventListener('toggle', () => {
      if (det.open) ouverts.add(det.dataset.batiment); else ouverts.delete(det.dataset.batiment);
    });
  });
  const batimentDe = (node) => getBatimentById(node.closest('[data-batiment]').dataset.batiment);
  listeEl.querySelectorAll('[data-cellule]').forEach((n) => n.addEventListener('click', () => openEditCellule(getCelluleById(n.dataset.cellule))));
  listeEl.querySelectorAll('[data-emplacement]').forEach((n) => n.addEventListener('click', () => openEditEmplacement(getEmplacementById(n.dataset.emplacement))));
  listeEl.querySelectorAll('[data-lot]').forEach((n) => n.addEventListener('click', () => {
    const lot = getLots().find((l) => l.id === n.dataset.lot);
    if (lot) openEditLot(lot);
  }));
  listeEl.querySelectorAll('[data-modifier-batiment], .lieu-statique').forEach((n) => n.addEventListener('click', () => {
    const b = batimentDe(n);
    if (b) openEditBatiment(b);
  }));
  listeEl.querySelectorAll('[data-historique]').forEach((n) => n.addEventListener('click', () => {
    const id = n.closest('[data-batiment]').dataset.batiment;
    if (historiques.has(id)) historiques.delete(id); else historiques.add(id);
    renderLieux();
  }));
  listeEl.querySelectorAll('[data-mouvement]').forEach((n) => n.addEventListener('click', () => {
    const b = batimentDe(n);
    if (b) ouvrirMouvementSur(b);
  }));
  listeEl.querySelectorAll('[data-activite]').forEach((n) => n.addEventListener('click', () => {
    const itv = getInterventions().find((i) => i.id === n.dataset.activite);
    if (itv) openEditIntervention(itv);
  }));
  listeEl.querySelectorAll('[data-modifier]').forEach((n) => n.addEventListener('click', () => {
    const m = getMouvements().find((x) => x.id === n.dataset.modifier);
    if (m) openEditMouvement(m);
  }));
}

/** Nouveau mouvement pré-ciblé sur le premier contenant du bâtiment. */
export function ouvrirMouvementSur(b) {
  const c = getCellules().find((x) => x.batimentId === b.id);
  const e = !c ? getEmplacements().find((x) => x.batimentId === b.id) : null;
  openCreateMouvement(c
    ? { typeMouvement: 'ENTREE_RECOLTE', destinationType: 'CELLULE', destinationId: c.id }
    : e
      ? { typeMouvement: 'ENTREE_RECOLTE', destinationType: 'EMPLACEMENT_FOURRAGE', destinationId: e.id }
      : {});
}
