// Vue "Rapports & Synthèses" : hub plein écran (voir index.html,
// #rapports-panel) qui restitue en lecture seule ce qui est déjà saisi dans
// l'assolement prévisionnel et les fiches parcelles — aucune écriture ici.
// Auto-suffisant : s'abonne lui-même aux previsions plutôt que de dépendre
// d'un câblage supplémentaire dans main.js, à l'image de sync-status.js.
import {
  calendrierSemis, syntheseCategories, planFertilisation
} from './rapports.js';
import {
  getPrevisions, onPrevisionsChange, campagneCourante
} from './assolement-previsionnel.js';

const panelEl = document.getElementById('rapports-panel');
const campagneLabelEl = document.getElementById('rap-campagne-label');
const semisKpisEl = document.getElementById('rap-semis-kpis');
const syntheseEl = document.getElementById('rap-synthese');
const fertiKpisEl = document.getElementById('rap-ferti-kpis');
const fertiFiltreEl = document.getElementById('rap-ferti-filtre');
const fertiTableauEl = document.getElementById('rap-ferti-tableau');

let parcelles = [];
let campagneR = Number(campagneCourante());
let panelOuvert = false;
let filtreFerti = 'tous';
let triFerti = { champ: 'nom', dir: 1 };

export function setParcellesRapports(list) {
  parcelles = list.slice().sort((a, b) => {
    const na = numeroTri(a.numero), nb = numeroTri(b.numero);
    if (na !== nb) return na - nb;
    return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true });
  });
  if (panelOuvert) render();
}
function numeroTri(n) {
  const v = parseFloat(n);
  return isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
}

export function initRapports() {
  document.getElementById('btn-rapports').addEventListener('click', () => {
    panelOuvert = true;
    panelEl.hidden = false;
    render();
  });
  document.getElementById('rapports-fermer').addEventListener('click', () => {
    panelOuvert = false;
    panelEl.hidden = true;
  });
  document.getElementById('rapports-imprimer').addEventListener('click', () => window.print());
  document.getElementById('rap-campagne-moins').addEventListener('click', () => { campagneR--; render(); });
  document.getElementById('rap-campagne-plus').addEventListener('click', () => { campagneR++; render(); });

  fertiFiltreEl.innerHTML = [
    { v: 'tous', l: 'Tout' }, { v: 'fumier', l: '💩 Fumier' }, { v: 'chaux', l: '🪨 Chaux' }
  ].map((f) => `<button type="button" class="filtre-chip" data-filtre="${f.v}">${f.l}</button>`).join('');
  fertiFiltreEl.querySelectorAll('[data-filtre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filtreFerti = btn.dataset.filtre;
      renderFertilisation();
    });
  });

  // Rapport auto-alimenté : toute modification de l'assolement prévisionnel
  // (dose de fumier ajustée, culture changée...) doit se refléter au prochain
  // coup d'œil, sans revenir en arrière puis rouvrir le hub.
  onPrevisionsChange(() => { if (panelOuvert) render(); });
}

function render() {
  campagneLabelEl.textContent = `Campagne ${campagneR}`;
  renderSemis();
  renderFertilisation();
}

// --- Assolement & calendrier des semis --------------------------------------
function renderSemis() {
  const liste = getPrevisions();
  const cal = calendrierSemis(parcelles, String(campagneR), liste);
  const cat = syntheseCategories(parcelles, String(campagneR), liste);

  const detailTxt = (details) => details.length
    ? details.map((d) => `${esc(d.label)} : ${formatHa(d.ha)} ha`).join(' · ')
    : 'Rien de renseigné pour l\'instant.';

  semisKpisEl.innerHTML = `
    <div class="rapport-kpi">
      <div class="rapport-kpi-valeur">${formatHa(cal.automne.ha)} ha</div>
      <div class="rapport-kpi-label">🍂 Semis d'automne</div>
      <div class="rapport-kpi-detail">${detailTxt(cal.automne.details)}</div>
    </div>
    <div class="rapport-kpi">
      <div class="rapport-kpi-valeur">${formatHa(cal.printemps.ha)} ha</div>
      <div class="rapport-kpi-label">🌱 Semis de printemps</div>
      <div class="rapport-kpi-detail">${detailTxt(cal.printemps.details)}</div>
    </div>
    <div class="rapport-kpi">
      <div class="rapport-kpi-valeur">${formatHa(cal.derobees.ha)} ha</div>
      <div class="rapport-kpi-label">🟣 Dérobées / couverts en place (réel)</div>
      <div class="rapport-kpi-detail">${cal.derobees.parcelles.length
        ? cal.derobees.parcelles.map((p) => `${esc(p.nom)} : ${esc(p.derobee)}`).join(' · ')
        : 'Aucune actuellement.'}</div>
    </div>`;

  const groupe = (g) => cat.parGroupe.get(g) || 0;
  const lignes = [
    ['Prairie permanente', groupe('PRAIRIE_PERMANENTE')],
    ['Prairie temporaire', groupe('PRAIRIE_TEMPORAIRE')],
    ['&nbsp;&nbsp;dont Luzerne (Luz 0 à 5)', cat.luzerneHa, true],
    ['Céréales', cat.cerealesHa],
    ['Dérobées / couverts (réel)', cal.derobees.ha],
    ['Autre', groupe('AUTRE')]
  ].map(([label, ha, sousLigne]) =>
    `<tr class="${sousLigne ? 'detail' : ''}"><th>${label}</th><td class="${ha ? '' : 'zero'}">${ha ? formatHa(ha) : '—'}</td></tr>`
  ).join('');
  const nonRenseigne = cat.nonRenseigneHa
    ? `<tr class="non-renseigne"><th>Culture non renseignée</th><td>${formatHa(cat.nonRenseigneHa)}</td></tr>` : '';
  const validation = cat.coherent
    ? `<tr class="rapport-validation-ok"><th colspan="2">✅ Total conforme à la surface enregistrée sur les fiches parcelles (${formatHa(cat.totalEnregistre)} ha).</th></tr>`
    : `<tr class="rapport-validation-ko"><th colspan="2">⚠️ Écart de ${formatHa(Math.abs(cat.totalEnregistre - cat.totalPrevisionnel))} ha avec la surface enregistrée (${formatHa(cat.totalEnregistre)} ha) — vérifier les parcelles sans culture ${campagneR} renseignée.</th></tr>`;

  syntheseEl.innerHTML = `
    <thead><tr><th>Catégorie</th><th>${campagneR} (ha)</th></tr></thead>
    <tbody>${lignes}${nonRenseigne}</tbody>
    <tfoot>
      <tr><th>Total prévisionnel</th><td>${formatHa(cat.totalPrevisionnel)}</td></tr>
      ${validation}
    </tfoot>`;
}

// --- Plan de fertilisation ----------------------------------------------------
const COLONNES_FERTI = [
  { champ: 'nom', label: 'Parcelle' },
  { champ: 'surfaceHa', label: 'Surface (ha)' },
  { champ: 'fumierTHa', label: 'Fumier (t/ha)' },
  { champ: 'fumierT', label: 'Fumier (t)' },
  { champ: 'chauxTHa', label: 'Chaux (t/ha)' },
  { champ: 'chauxT', label: 'Chaux (t)' }
];

function renderFertilisation() {
  const plan = planFertilisation(parcelles, String(campagneR), getPrevisions());

  fertiKpisEl.innerHTML = `
    <div class="rapport-kpi">
      <div class="rapport-kpi-valeur">${formatHa(plan.totalFumierT)} t</div>
      <div class="rapport-kpi-label">💩 Fumier à épandre</div>
    </div>
    <div class="rapport-kpi">
      <div class="rapport-kpi-valeur">${formatHa(plan.totalChauxT)} t</div>
      <div class="rapport-kpi-label">🪨 Chaux à épandre</div>
    </div>`;

  fertiFiltreEl.querySelectorAll('[data-filtre]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.filtre === filtreFerti);
  });

  let lignes = plan.lignes.filter((l) => {
    if (filtreFerti === 'fumier') return l.fumierTHa > 0;
    if (filtreFerti === 'chaux') return l.chauxTHa > 0;
    return true;
  });
  lignes = lignes.slice().sort((a, b) => {
    const va = a[triFerti.champ], vb = b[triFerti.champ];
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'fr', { numeric: true }) : va - vb;
    return cmp * triFerti.dir;
  });

  if (!lignes.length) {
    fertiTableauEl.innerHTML = `<tbody><tr><td class="list-empty">Aucune dose de fumier ou de chaux renseignée pour ${campagneR}.</td></tr></tbody>`;
    return;
  }

  const totSurf = lignes.reduce((n, l) => n + l.surfaceHa, 0);
  const totFumierT = lignes.reduce((n, l) => n + l.fumierT, 0);
  const totChauxT = lignes.reduce((n, l) => n + l.chauxT, 0);

  fertiTableauEl.innerHTML = `
    <thead><tr>${COLONNES_FERTI.map((c) => {
      const actif = c.champ === triFerti.champ;
      const fleche = actif ? (triFerti.dir === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="th-tri${actif ? ' is-active' : ''}" data-champ="${c.champ}">${c.label}${fleche}</th>`;
    }).join('')}</tr></thead>
    <tbody>${lignes.map((l) => `<tr>
      <th>${esc(l.nom)}</th>
      <td>${formatHa(l.surfaceHa)}</td>
      <td>${l.fumierTHa ? formatHa(l.fumierTHa) : '—'}</td>
      <td>${l.fumierTHa ? formatHa(l.fumierT) : '—'}</td>
      <td>${l.chauxTHa ? formatHa(l.chauxTHa) : '—'}</td>
      <td>${l.chauxTHa ? formatHa(l.chauxT) : '—'}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr>
      <th>Total (${lignes.length} parcelle${lignes.length > 1 ? 's' : ''})</th>
      <td>${formatHa(totSurf)}</td><td></td>
      <td>${formatHa(totFumierT)}</td><td></td>
      <td>${formatHa(totChauxT)}</td>
    </tr></tfoot>`;

  fertiTableauEl.querySelectorAll('.th-tri').forEach((th) => {
    th.addEventListener('click', () => {
      const champ = th.dataset.champ;
      triFerti = champ === triFerti.champ ? { champ, dir: -triFerti.dir } : { champ, dir: 1 };
      renderFertilisation();
    });
  });
}

// --- Utilitaires --------------------------------------------------------------
function formatHa(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
