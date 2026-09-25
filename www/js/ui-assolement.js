// Vue « Assolement prévisionnel » de l'onglet Parcelles : tableau éditable en
// place, puis synthèse des surfaces par famille.
//
// Chaque case s'enregistre seule, au changement : au bureau comme au champ,
// on ajuste une ligne à la fois, et un bouton « Enregistrer » global serait
// le meilleur moyen de perdre dix modifications en quittant l'écran.
import {
  FAMILLES, CULTURES_PREV, culturePrev, prevision, getPrevisions,
  setPrevision, syntheseSurfaces, campagneCourante, suiteNaturelle,
  GROUPE_DE_FAMILLE, LABEL_GROUPE, estSemisDeLAnnee
} from './assolement-previsionnel.js';
import { updateParcelle } from './parcelles.js';
import { implantationEnCours } from './implantations.js';
import { getCultureById } from './cultures-config.js';
import { messagePermission } from './diagnostic-regles.js';
import { getVueLegende, toggleVueLegende, onVueLegendeChange } from './vue-legende.js';

const tableEl = document.getElementById('prev-tableau');
const syntheseEl = document.getElementById('prev-synthese');
const anneesEl = document.getElementById('prev-annees');
const etatEl = document.getElementById('prev-etat');
const toggleVueBtn = document.getElementById('prev-toggle-vue');
const derobeesBloc = document.getElementById('prev-derobees-bloc');
const derobeesEl = document.getElementById('prev-derobees');

let campagneN = Number(campagneCourante());
let parcelles = [];
// Filtre "semis de l'année" (indice 0) : masque les autres lignes sans
// reconstruire le tableau, pour ne jamais couper une saisie en cours.
let filtreSemis0 = false;

export function setParcellesAssolement(list) {
  // Tri par numéro de parcelle quand il existe (c'est l'ordre du dossier),
  // puis par nom.
  parcelles = list.slice().sort((a, b) => {
    const na = numeroTri(a.numero), nb = numeroTri(b.numero);
    if (na !== nb) return na - nb;
    return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true });
  });
}
function numeroTri(n) {
  const v = parseFloat(n);
  return isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
}

export function initAssolement() {
  document.getElementById('prev-annee-moins').addEventListener('click', () => { campagneN--; renderAssolement(); });
  document.getElementById('prev-annee-plus').addEventListener('click', () => { campagneN++; renderAssolement(); });
  document.getElementById('prev-reconduire').addEventListener('click', reconduire);
  document.getElementById('prev-filtre-semis0').addEventListener('click', (e) => {
    filtreSemis0 = !filtreSemis0;
    e.currentTarget.classList.toggle('is-active', filtreSemis0);
    appliquerFiltreSemis0();
  });
  toggleVueBtn.addEventListener('click', toggleVueLegende);
  // Bascule partagée avec la légende de la carte (map.js) : actionnée d'un
  // côté ou de l'autre, les deux doivent refléter le même mode.
  onVueLegendeChange((mode) => {
    toggleVueBtn.textContent = mode === 'groupe' ? '🌐 Regroupée' : '🔍 Détaillée';
    renderSynthese();
  });
}

// --- Tableau ----------------------------------------------------------------
function optionsCultures(valeur) {
  const groupes = FAMILLES.map((f) => {
    const cs = CULTURES_PREV.filter((c) => c.famille === f.value);
    if (!cs.length) return '';
    return `<optgroup label="${esc(f.label)}">${cs.map((c) =>
      `<option value="${c.code}"${c.code === valeur ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<option value="">—</option>${groupes}`;
}

function nombre(v) { return v == null ? '' : v; }

export function renderAssolement() {
  const N = String(campagneN);
  const N1 = String(campagneN + 1);
  anneesEl.textContent = `Campagnes ${N} → ${N1}`;

  if (!parcelles.length) {
    tableEl.innerHTML = '<tbody><tr><td class="list-empty">Aucune parcelle enregistrée.</td></tr></tbody>';
    renderSynthese();
    return;
  }

  const lignes = parcelles.map((p) => {
    const prevN = prevision(p.id, N) || {};
    const prevN1 = prevision(p.id, N1) || {};
    const reel = cultureReelle(p.id, N);
    const cN = culturePrev(prevN.cultureCode);
    // Le réel est rappelé sous le prévu : une luzerne retournée plus tôt que
    // prévu doit se voir ici, pas seulement sur le terrain.
    const ecart = reel && cN && !correspond(cN, reel.nom);
    const suggestion = !prevN1.cultureCode ? suiteNaturelle(prevN.cultureCode) : null;
    const semis0 = estSemisDeLAnnee(prevN.cultureCode);
    return `<tr data-id="${esc(p.id)}"${semis0 ? ' data-semis0="1"' : ''}>
      <td><input type="text" class="in-numero" data-champ="numero" value="${esc(p.numero || '')}" inputmode="numeric" aria-label="N° de parcelle"></td>
      <th class="col-nom-parcelle">${esc(p.nom || 'Sans nom')}</th>
      <td>${formatHa(p.surfaceHa)}</td>
      <td>
        <select data-champ="cultureN" aria-label="Culture ${N}">${optionsCultures(prevN.cultureCode)}</select>
        ${semis0 ? '<span class="badge-semis0">🌱 semis de l\'année</span>' : ''}
        ${reel ? `<span class="reel${ecart ? ' ecart' : ''}">${ecart ? '⚠ ' : ''}en place : ${esc(reel.nom)}</span>` : ''}
      </td>
      <td><input type="number" step="any" min="0" inputmode="decimal" data-champ="fumierTHa" value="${nombre(prevN.fumierTHa)}" aria-label="Prévision fumier (t/ha)"></td>
      <td><input type="number" step="any" min="0" inputmode="decimal" data-champ="chauxTHa" value="${nombre(prevN.chauxTHa)}" aria-label="Prévision chaux (t/ha)"></td>
      <td class="${suggestion ? 'suggestion' : ''}">
        <select data-champ="cultureN1" aria-label="Culture ${N1}">${optionsCultures(prevN1.cultureCode)}</select>
        ${suggestion ? `<span class="reel">proposé : ${esc(culturePrev(suggestion).label)}</span>` : ''}
      </td>
    </tr>`;
  }).join('');

  tableEl.innerHTML = `
    <thead><tr>
      <th>N°</th><th class="col-nom-parcelle">Parcelle</th><th>Surface<br>(ha)</th>
      <th>Culture<br>${N}</th><th>Prévision<br>fumier (t/ha)</th><th>Prévision<br>chaux (t/ha)</th>
      <th>Culture<br>${N1}</th>
    </tr></thead>
    <tbody>${lignes}</tbody>
    <tfoot></tfoot>`;

  tableEl.querySelectorAll('[data-champ]').forEach((ctrl) => {
    ctrl.addEventListener('change', () => enregistrerCase(ctrl));
  });
  appliquerFiltreSemis0();
  renderTotaux();
  renderSynthese();
}

// Masque les lignes sans semis de l'année plutôt que reconstruire le
// tableau : appelable à tout moment (y compris pendant une saisie) sans
// risque pour le focus en cours.
function appliquerFiltreSemis0() {
  tableEl.classList.toggle('prev-filtre-semis0-actif', filtreSemis0);
}

function renderTotaux() {
  const tfoot = tableEl.querySelector('tfoot');
  if (!tfoot) return;
  const N = String(campagneN);
  const totHa = parcelles.reduce((n, p) => n + (Number(p.surfaceHa) || 0), 0);
  // Fumier et chaux : une dose par hectare chacun. Le total utile, c'est le
  // tonnage à épandre — dose × surface, parcelle par parcelle.
  const totFumier = parcelles.reduce((n, p) => {
    const d = Number((prevision(p.id, N) || {}).fumierTHa) || 0;
    return n + d * (Number(p.surfaceHa) || 0);
  }, 0);
  const totChaux = parcelles.reduce((n, p) => {
    const d = Number((prevision(p.id, N) || {}).chauxTHa) || 0;
    return n + d * (Number(p.surfaceHa) || 0);
  }, 0);
  tfoot.innerHTML = `<tr>
      <th></th><th class="col-nom-parcelle">Total</th><td>${formatHa(totHa)}</td><td></td>
      <td>${arrondi(totFumier)} t à épandre</td><td>${arrondi(totChaux)} t à épandre</td><td></td>
    </tr>`;
}

/**
 * Appelé à chaque modification venue de Firestore. Si l'exploitant est en
 * train de saisir dans le tableau, on NE le reconstruit PAS : il perdrait la
 * case sur laquelle il vient de passer. Seuls les totaux et la synthèse, qui
 * sont en lecture seule, sont rafraîchis ; le tableau entier le sera au
 * prochain affichage de la vue.
 */
let rafraichissementPrevu = false;
export function rafraichirAssolement() {
  // Différé d'un tour : une case validée par Tab déclenche l'enregistrement
  // PENDANT la perte de focus, avant que la case suivante ne l'ait reçu. À cet
  // instant précis, rien n'a le focus — on reconstruirait le tableau sous les
  // doigts de l'exploitant. Au tour suivant, le focus est arrivé à destination.
  if (rafraichissementPrevu) return;
  rafraichissementPrevu = true;
  setTimeout(() => {
    rafraichissementPrevu = false;
    if (tableEl.contains(document.activeElement)) {
      renderTotaux();
      renderSynthese();
    } else {
      renderAssolement();
    }
  }, 0);
}

// Insensible aux accents : "Fétuque" (culture réelle) et "fétuque" (fourrage
// prévisionnel) doivent se reconnaître même si l'un des deux a été tapé sans
// accent — sinon une espèce spécifique correctement choisie déclenche quand
// même une fausse alerte d'écart.
function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function correspond(culture, nomReel) {
  const n = normaliser(nomReel);
  const ref = normaliser(culture.fourrage || culture.label).split(' ')[0];
  return !!ref && n.indexOf(ref) !== -1;
}

function cultureReelle(parcelleId, campagne) {
  // Pour la campagne en cours : aujourd'hui. Pour une autre : le 1er juin,
  // milieu de saison, qui tombe sur la culture qui fait l'année.
  const date = String(campagne) === campagneCourante()
    ? new Date().toISOString().slice(0, 10)
    : `${campagne}-06-01`;
  const impl = implantationEnCours(parcelleId, date);
  const c = impl ? getCultureById(impl.cultureId) : null;
  return c ? { nom: c.nom } : null;
}

async function enregistrerCase(ctrl) {
  const tr = ctrl.closest('tr');
  const parcelleId = tr.dataset.id;
  const champ = ctrl.dataset.champ;
  const td = ctrl.closest('td');
  etatEl.textContent = 'Enregistrement…';
  try {
    if (champ === 'numero') {
      await updateParcelle(parcelleId, { numero: ctrl.value.trim() });
    } else if (champ === 'cultureN') {
      await setPrevision(parcelleId, campagneN, { cultureCode: ctrl.value });
    } else if (champ === 'cultureN1') {
      await setPrevision(parcelleId, campagneN + 1, { cultureCode: ctrl.value });
    } else {
      await setPrevision(parcelleId, campagneN, { [champ]: ctrl.value });
    }
    etatEl.textContent = 'Enregistré.';
    if (td) { td.classList.remove('saved'); void td.offsetWidth; td.classList.add('saved'); }
  } catch (err) {
    etatEl.textContent = messagePermission(err, champ === 'numero' ? 'parcelles' : 'lgs_assolement_previsionnel');
  }
}

/**
 * Remplit la colonne N+1 là où elle est vide, avec la suite logique de N :
 * Luz 2 → Luz 3, RG trèfle 1 → RG trèfle 2, PN → PN. Ne touche JAMAIS une
 * case déjà renseignée : un choix fait à la main (retourner une luzerne en
 * Luz 4 pour semer un blé) prime sur toute déduction.
 */
async function reconduire() {
  const N = String(campagneN);
  const N1 = String(campagneN + 1);
  const aFaire = parcelles
    .map((p) => {
      const pn1 = prevision(p.id, N1);
      if (pn1 && pn1.cultureCode) return null;
      const s = suiteNaturelle((prevision(p.id, N) || {}).cultureCode);
      return s ? { p, s } : null;
    })
    .filter(Boolean);
  if (!aFaire.length) { etatEl.textContent = `Rien à reconduire : la colonne ${N1} est déjà remplie ou sans suite évidente.`; return; }
  etatEl.textContent = 'Reconduction…';
  try {
    for (const { p, s } of aFaire) await setPrevision(p.id, N1, { cultureCode: s });
    etatEl.textContent = `${aFaire.length} parcelle${aFaire.length > 1 ? 's' : ''} reconduite${aFaire.length > 1 ? 's' : ''} en ${N1}. Les céréales restent à choisir.`;
  } catch (err) {
    etatEl.textContent = messagePermission(err, 'lgs_assolement_previsionnel');
  }
}

// --- Synthèse ---------------------------------------------------------------
// Structure fixe du dossier : les âges de luzerne et de RG trèfle sont
// toujours listés, même à zéro — c'est la pyramide des âges qu'on lit.
// Les céréales, elles, ne montrent que celles présentes sur l'une des deux
// campagnes : huit lignes vides sur une exploitation qui fait blé et orge
// noieraient le reste.
const STRUCTURE = [
  { famille: 'CEREALES',       codes: 'presents', total: 'Total céréales' },
  { famille: 'LUZERNE',        codes: ['LUZ1', 'LUZ2', 'LUZ3', 'LUZ4', 'LUZ5'], total: 'Total luzerne' },
  { famille: 'PRAIRIE_COURTE', codes: ['RGT1', 'RGT2', 'RGT3'], total: 'Total prairie courte durée' },
  { famille: 'FETUQUE',        codes: ['FET'], total: null },
  { famille: 'PN',             codes: ['PN'], total: null },
  { famille: 'SEMIS_PRAIRIE',  codes: ['LUZ0', 'RGT0'], total: 'Total semis de prairies' },
  { famille: 'AUTRE',          codes: 'presents', total: null }
];

// Parcelles portant un code de culture donné sur une campagne — c'est ce que
// le tableau de synthèse résume en hectares ; ici on remonte à la liste
// nominative, dépliée au clic sur la ligne concernée.
function parcellesDuCode(campagne, code) {
  return parcelles.filter((p) => {
    const prev = prevision(p.id, campagne);
    return prev && prev.cultureCode === code;
  });
}

function listeParcelles(campagne, code) {
  const l = parcellesDuCode(campagne, code);
  return l.length ? l.map((p) => `${esc(p.nom || 'Sans nom')} (${formatHa(p.surfaceHa)} ha)`).join(', ') : '—';
}

// Même chose, mais tous codes d'un GROUPE confondus (vue regroupée) — une
// prairie plantée en RG trèfle et une autre en fétuque/trèfle tombent toutes
// deux dans la liste "Prairie".
function parcellesDuGroupe(campagne, groupe) {
  return parcelles.filter((p) => {
    const prev = prevision(p.id, campagne);
    const c = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    return c && (GROUPE_DE_FAMILLE[c.famille] || 'AUTRE') === groupe;
  });
}
function listeParcellesGroupe(campagne, groupe) {
  const l = parcellesDuGroupe(campagne, groupe);
  return l.length ? l.map((p) => `${esc(p.nom || 'Sans nom')} (${formatHa(p.surfaceHa)} ha)`).join(', ') : '—';
}

function renderSynthese() {
  const N = String(campagneN);
  const N1 = String(campagneN + 1);
  const liste = getPrevisions();
  const sN = syntheseSurfaces(parcelles, N, liste);
  const sN1 = syntheseSurfaces(parcelles, N1, liste);

  const cell = (v) => `<td class="${v ? '' : 'zero'}">${v ? formatHa(v) : '—'}</td>`;
  const lignes = [];

  if (getVueLegende() === 'groupe') {
    // Vue macro / PAC : une seule ligne cliquable par groupe (Prairie,
    // Céréales, Autre), le détail des espèces disparaît des colonnes mais
    // reste accessible dans la liste nominative dépliée.
    Object.keys(LABEL_GROUPE).forEach((groupe) => {
      const haN = sN.parGroupe.get(groupe);
      const haN1 = sN1.parGroupe.get(groupe);
      if (!haN && !haN1) return;
      const detailId = `syn-groupe-${groupe}-${campagneN}`;
      lignes.push(`<tr class="sous-total detail-cliquable" data-detail="${detailId}"><th>${esc(LABEL_GROUPE[groupe])}</th>${cell(haN)}${cell(haN1)}</tr>`);
      lignes.push(`<tr class="detail-parcelles" id="${detailId}" hidden><td colspan="3">
        <strong>${N} :</strong> ${listeParcellesGroupe(N, groupe)}<br>
        <strong>${N1} :</strong> ${listeParcellesGroupe(N1, groupe)}
      </td></tr>`);
    });
  } else {
    STRUCTURE.forEach((bloc) => {
      const fam = FAMILLES.find((f) => f.value === bloc.famille);
      let codes = bloc.codes;
      if (codes === 'presents') {
        codes = CULTURES_PREV
          .filter((c) => c.famille === bloc.famille && (sN.parCode.get(c.code) || sN1.parCode.get(c.code)))
          .map((c) => c.code);
        if (!codes.length && bloc.famille === 'AUTRE') return;
      }
      lignes.push(`<tr class="famille"><th colspan="3">${esc(fam.label)}</th></tr>`);
      codes.forEach((code) => {
        const haN = sN.parCode.get(code);
        const haN1 = sN1.parCode.get(code);
        const cliquable = haN || haN1;
        const detailId = `syn-detail-${code}-${campagneN}`;
        lignes.push(`<tr class="detail${cliquable ? ' detail-cliquable' : ''}"${cliquable ? ` data-detail="${detailId}"` : ''}><th>${esc(culturePrev(code).label)}</th>${cell(haN)}${cell(haN1)}</tr>`);
        if (cliquable) {
          lignes.push(`<tr class="detail-parcelles" id="${detailId}" hidden><td colspan="3">
            <strong>${N} :</strong> ${listeParcelles(N, code)}<br>
            <strong>${N1} :</strong> ${listeParcelles(N1, code)}
          </td></tr>`);
        }
      });
      if (bloc.total) {
        lignes.push(`<tr class="sous-total"><th>${esc(bloc.total)}</th>${cell(sN.parFamille.get(bloc.famille))}${cell(sN1.parFamille.get(bloc.famille))}</tr>`);
      }
    });
  }

  if (sN.nonRenseigne || sN1.nonRenseigne) {
    // Sans cette ligne, le total général ne collerait pas à la surface de
    // l'exploitation, et on chercherait où sont passés les hectares.
    lignes.push(`<tr class="non-renseigne"><th>Culture non renseignée</th>${cell(sN.nonRenseigne)}${cell(sN1.nonRenseigne)}</tr>`);
  }

  syntheseEl.innerHTML = `
    <thead><tr><th>Famille</th><th>${N} (ha)</th><th>${N1} (ha)</th></tr></thead>
    <tbody>${lignes.join('')}</tbody>
    <tfoot><tr><th>Total général</th><td>${formatHa(sN.total)}</td><td>${formatHa(sN1.total)}</td></tr></tfoot>`;

  syntheseEl.querySelectorAll('.detail-cliquable').forEach((tr) => {
    tr.addEventListener('click', () => {
      const el = document.getElementById(tr.dataset.detail);
      if (el) el.hidden = !el.hidden;
    });
  });

  renderDerobees();
}

// Dérobées/couverts : champ vivant de la fiche parcelle (pas une prévision
// par campagne, cf. CLAUDE.md — réel et prévu ne se mélangent jamais), donc
// à part du reste de ce tableau plutôt que fondu dans les colonnes N/N+1.
function renderDerobees() {
  const enDerobee = parcelles.filter((p) => p.derobee && String(p.derobee).trim());
  derobeesBloc.hidden = !enDerobee.length;
  if (!enDerobee.length) { derobeesEl.innerHTML = ''; return; }
  const totalHa = enDerobee.reduce((n, p) => n + (Number(p.surfaceHa) || 0), 0);
  derobeesEl.innerHTML = `
    <div class="cat-card">
      <div class="cat-card-nom">${enDerobee.length} parcelle${enDerobee.length > 1 ? 's' : ''}</div>
      <div class="cat-card-detail">${enDerobee.map((p) => `${esc(p.nom || 'Sans nom')} : ${esc(p.derobee)}`).join(' · ')}</div>
      <div class="cat-card-tonnes">${formatHa(totalHa)} ha</div>
    </div>`;
}

// --- Utilitaires ------------------------------------------------------------
function arrondi(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function formatHa(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
