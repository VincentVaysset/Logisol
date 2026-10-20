// Troupeau > Pâturage : calendrier de pâturage (maquette
// docs/maquettes/maquette-calendrier-paturage.html). Traçabilité du cahier des
// charges AOP Roquefort (pâturage quotidien dès que le climat le permet) et
// suivi technique. Vue Mois (saisie) et vue Saison (lecture seule).
// Données : paturage.js ; calculs : paturage-calc.js. Les fauches et broyages
// du journal d'interventions s'affichent en lecture seule.
import {
  jourLot, caseParcelle, heuresLot, derniereSortie, joursAvecSortie, bornesSaison, bilanParcelle,
  ajouterJours, ecartJours, melangeAutorise, heureDecimale, HEURES_DEFAUT, MOTIFS
} from './paturage-calc.js';
import { getPeriodes, getExceptions, onPaturageChange, watchPaturage, entrerLot, noterException, retirerException, rattacherMeteo } from './paturage.js';
import { getLotsActifs, onLotsChange, typeAnimauxDe } from './lots.js';
import { getInterventions } from './interventions.js';
import { getTypeById } from './interventions-types.js';
import { releverMeteo, resumeMeteo } from './meteo.js';
import { toastSucces, toastErreur } from './toast.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const JC = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const p2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
const jourSemaine = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
const jjmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dateLongue = (d) => `${JC[jourSemaine(d)]} ${Number(d.slice(8, 10))} ${MOIS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const haFr = (v) => (Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const hFr = (v) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
function aujourdhui() { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const ICONE = {
  'Pluie': '<path d="M7 15a4 4 0 0 1 .5-8A6 6 0 0 1 19 9a3.5 3.5 0 0 1-1 6.8"/><path d="M9 18l-1 3M13 17l-1 3M17 18l-1 3"/>',
  'Neige / gel': '<path d="M12 2v20M4 7l16 10M20 7L4 17"/>',
  'Orage': '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  'Chaleur': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  'Sol trop humide': '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  'Autre': '<circle cx="12" cy="12" r="3"/>'
};
const svgMotif = (m) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE[m] || ICONE.Autre}</svg>`;

let parcelles = [];
const etat = { vue: 'mois', annee: Number(aujourdhui().slice(0, 4)), mois: Number(aujourdhui().slice(5, 7)) - 1, autresOuvertes: false };
const F = { parcelleId: null, date: null, lotId: null, mode: 'SANS_SORTIE', motif: 'Pluie', dansLaJournee: false };
let el = {};
let actif = false;

export function setParcellesPaturage(list) { parcelles = list || []; if (actif) render(); }

const rangLot = (l) => (l.type === 'BREBIS' && /lait/i.test(l.nom) ? 0 : l.type === 'AGNELLES' ? 1 : 2);
/** Lots qui sortent : laitières (brebis) et agnelles, lots actifs de lots_animaux. */
function lotsPaturage() {
  return getLotsActifs().filter((l) => ['BREBIS', 'AGNELLES'].includes(typeAnimauxDe(l)))
    .map((l) => ({ id: l.id, nom: l.nom || (typeAnimauxDe(l) === 'AGNELLES' ? 'Agnelles' : 'Laitières'), type: typeAnimauxDe(l), effectif: Number(l.nbBrebis) || 0 }))
    // Les laitières d'abord, puis les agnelles, puis les autres lots de brebis.
    .sort((a, b) => rangLot(a) - rangLot(b) || a.nom.localeCompare(b.nom, 'fr'));
}
function ctx() { return { lots: lotsPaturage(), periodes: getPeriodes(), exceptions: getExceptions(), aujourdhui: aujourdhui() }; }

/** Pour le carnet PDF (ui-rapports.js) : mêmes données que l'écran. */
export function donneesCarnet() { watchPaturage(); return { ctx: ctx(), parcelles, travaux: travauxJournal() }; }

// Fauches et broyages du journal (lecture seule) : parcelleId|date -> 'F' | 'B'
function travauxJournal() {
  const m = new Map();
  getInterventions().forEach((i) => {
    if (i.statut === 'A_FAIRE' || !i.date) return;
    const t = getTypeById(i.typeId);
    const nom = `${(t && t.nom) || ''} ${i.typeNom || ''}`;
    const lettre = /fauch/i.test(nom) ? 'F' : /broy/i.test(nom) ? 'B' : null;
    if (!lettre) return;
    (i.parcelleIds || []).forEach((p) => m.set(`${p}|${i.date}`, lettre));
  });
  return m;
}

export function initPaturage() {
  ['paturage', 'pat-kpi', 'pat-annee', 'pat-annee-moins', 'pat-annee-plus', 'pat-vue-mois', 'pat-vue-saison', 'pat-mois', 'pat-mois-moins',
    'pat-mois-plus', 'pat-auj', 'pat-grille', 'pat-saison', 'pat-feuille', 'pat-feuille-corps', 'pat-carnet']
    .forEach((k) => { el[k] = document.getElementById(k === 'paturage' ? 'troupeau-paturage' : k); });
  if (!el.paturage) return;
  el.paturage.querySelectorAll('[data-patvue]').forEach((b) => b.addEventListener('click', () => { etat.vue = b.dataset.patvue; render(); }));
  el['pat-annee-moins'].addEventListener('click', () => { etat.annee--; render(); });
  el['pat-annee-plus'].addEventListener('click', () => { if (etat.annee < Number(aujourdhui().slice(0, 4))) { etat.annee++; render(); } });
  el['pat-mois-moins'].addEventListener('click', () => { if (etat.mois > 0) { etat.mois--; render(); } });
  el['pat-mois-plus'].addEventListener('click', () => { if (etat.mois < 11) { etat.mois++; render(); } });
  el['pat-auj'].addEventListener('click', () => { const a = aujourdhui(); etat.annee = Number(a.slice(0, 4)); etat.mois = Number(a.slice(5, 7)) - 1; etat.vue = 'mois'; render(true); });
  el['pat-grille'].addEventListener('click', (e) => {
    const autres = e.target.closest('[data-autres]');
    if (autres) { etat.autresOuvertes = !etat.autresOuvertes; render(); return; }
    const b = e.target.closest('.pat-cell');
    if (b) ouvrirFeuille(b.dataset.p, b.dataset.d);
  });
  el['pat-saison'].addEventListener('click', (e) => { const b = e.target.closest('[data-mois]'); if (b) { etat.mois = Number(b.dataset.mois); etat.vue = 'mois'; render(true); } });
  el['pat-feuille'].addEventListener('click', (e) => { if (e.target === el['pat-feuille']) fermerFeuille(); });
  el['pat-feuille-corps'].addEventListener('click', clicFeuille);
  el['pat-carnet'].addEventListener('click', () => document.dispatchEvent(new CustomEvent('logisol:carnet-paturage', { detail: { annee: etat.annee } })));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el['pat-feuille'].hidden) fermerFeuille(); });
  onPaturageChange(() => { if (actif) render(); });
  onLotsChange(() => { if (actif) render(); });
}

/** Appelé par ui-alimentation à l'affichage / masquage de la sous-vue. */
export function afficherPaturage(visible) {
  actif = visible;
  if (!visible) return;
  watchPaturage();
  render(true);
}

function render(centrer = false) {
  const c = ctx();
  const anneeCourante = Number(c.aujourdhui.slice(0, 4));
  el['pat-annee'].textContent = etat.annee;
  el['pat-annee-plus'].disabled = etat.annee >= anneeCourante;
  el.paturage.querySelectorAll('[data-patvue]').forEach((b) => b.classList.toggle('is-active', b.dataset.patvue === etat.vue));
  el['pat-vue-mois'].hidden = etat.vue !== 'mois';
  el['pat-vue-saison'].hidden = etat.vue !== 'saison';
  const js = joursAvecSortie(etat.annee, c);
  el['pat-kpi'].innerHTML = `<div class="pat-kpi"><span class="lb">Jours avec sortie en ${etat.annee}</span><span class="n">${js.BREBIS} <small>j · laitières</small></span><span class="s">Agnelles : ${js.AGNELLES} j</span></div>`;
  if (etat.vue === 'mois') renderMois(c, centrer); else renderSaison(c);
}

// Parcelles affichées : celles des laitières, puis des agnelles (dernier lot
// entré dans l'année), puis les autres, repliées.
function groupesParcelles(c) {
  const fin = `${etat.annee}-12-31`;
  const dernier = new Map();
  c.periodes.filter((p) => p.debut <= fin && (p.fin || c.aujourdhui) >= `${etat.annee}-01-01`)
    .sort((a, b) => (a.debut < b.debut ? -1 : 1))
    .forEach((p) => { const lot = c.lots.find((l) => l.id === p.lotId); if (lot) dernier.set(p.parcelleId, lot.type); });
  const tri = (a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true });
  const L = parcelles.filter((p) => dernier.get(p.id) === 'BREBIS').sort(tri);
  const A = parcelles.filter((p) => dernier.get(p.id) === 'AGNELLES').sort(tri);
  const autres = parcelles.filter((p) => !dernier.has(p.id)).sort(tri);
  return { L, A, autres };
}

function renderMois(c, centrer) {
  el['pat-mois'].textContent = `${MOIS[etat.mois]} ${etat.annee}`;
  el['pat-mois-moins'].disabled = etat.mois === 0;
  el['pat-mois-plus'].disabled = etat.mois === 11;
  const nb = new Date(Date.UTC(etat.annee, etat.mois + 1, 0)).getUTCDate();
  const jours = [...Array(nb)].map((_, i) => iso(etat.annee, etat.mois, i + 1));
  const we = (d) => [0, 6].includes(jourSemaine(d));
  const auj = c.aujourdhui;
  const travaux = travauxJournal();
  const g = groupesParcelles(c);
  let h = `<table class="pat-g"><thead><tr><th class="pn">Parcelle</th>${jours.map((d) => `<th class="dh${we(d) ? ' we' : ''}${d === auj ? ' td' : ''}"><small>${JL[jourSemaine(d)]}</small><b>${Number(d.slice(8))}</b></th>`).join('')}</tr></thead><tbody>`;
  const ligne = (p) => {
    const ds = derniereSortie(p.id, c);
    const sous = ds === auj ? '<span class="pns oc">Occupée</span>'
      : `<span class="pns">${haFr(p.surfaceHa)} ha · ${ds ? `repos ${ecartJours(ds, auj)} j` : 'pas encore pâturée'}</span>`;
    let r = `<tr><td class="pn"><span class="pnm">${esc(p.nom || 'Sans nom')}</span>${sous}</td>`;
    jours.forEach((d, i) => {
      const t = travaux.get(`${p.id}|${d}`);
      let f = '';
      if (t) f = `<span class="f fau">${t}</span>`;
      else if (d <= auj) {
        const k = caseParcelle(p.id, d, c);
        if (k.k) {
          let cls = `f ${k.k}${k.k === 'np' && k.npType === 'a' ? ' a' : ''}`;
          if (k.k !== 'np') {
            if (k.demi) cls += k.demi === 'g' ? ' demi-g' : ' demi-d';
            const prev = i > 0 ? caseParcelle(p.id, jours[i - 1], c).k : caseParcelle(p.id, ajouterJours(d, -1), c).k;
            const suiv = jours[i + 1] && jours[i + 1] <= auj ? caseParcelle(p.id, jours[i + 1], c).k : '';
            if (prev !== k.k || k.demi === 'd') cls += ' rs';
            if (suiv !== k.k || k.demi === 'g') cls += ' re';
          }
          f = `<span class="${cls}"></span>`;
        }
      }
      r += `<td class="c${we(d) ? ' we' : ''}${d === auj ? ' td' : ''}${d > auj ? ' fut' : ''}"><button type="button" class="pat-cell" data-p="${esc(p.id)}" data-d="${d}" aria-label="${esc(p.nom)}, ${dateLongue(d)}">${f}</button></td>`;
    });
    return r + '</tr>';
  };
  const groupe = (titre, liste) => (liste.length ? `<tr class="grp"><td class="pn">${titre}</td><td colspan="${nb}"></td></tr>${liste.map(ligne).join('')}` : '');
  h += groupe('Parcelles des laitières', g.L) + groupe('Parcelles des agnelles', g.A);
  if (g.autres.length) {
    h += `<tr class="grp"><td class="pn"><button type="button" class="pat-autres" data-autres>${etat.autresOuvertes ? '▾' : '▸'} Autres parcelles (${g.autres.length})</button></td><td colspan="${nb}"></td></tr>`;
    if (etat.autresOuvertes || (!g.L.length && !g.A.length)) h += g.autres.map(ligne).join('');
  }
  h += '</tbody><tfoot><tr><td class="pn">Effectif dehors</td>';
  jours.forEach((d) => { const e = c.lots.reduce((t, l) => t + ((jourLot(l.id, d, c) || {}).sorti ? l.effectif : 0), 0); h += `<td>${e || ''}</td>`; });
  h += '</tr><tr><td class="pn">Heures dehors</td>';
  jours.forEach((d) => { const x = Math.max(0, ...c.lots.map((l) => heuresLot(l.id, d, c))); h += `<td>${x ? hFr(x) : ''}</td>`; });
  h += '</tr><tr><td class="pn">Météo / motif</td>';
  jours.forEach((d) => {
    const ex = c.exceptions.find((e) => e.date === d && c.lots.some((l) => l.id === e.lotId));
    const titre = ex ? `${ex.motif} · ${ex.type === 'HORAIRE' ? `sortie ${ex.heureDebut}–${ex.heureFin}` : 'pas de sortie'}${ex.meteo ? ' · ' + resumeMeteo(ex.meteo) : ''}` : '';
    h += `<td>${ex ? `<span class="ev${ex.type === 'HORAIRE' ? ' h' : ''}" title="${esc(titre)}">${svgMotif(ex.motif)}</span>` : ''}</td>`;
  });
  h += '</tr></tfoot></table>';
  const gw = el['pat-grille'];
  const sl = gw.scrollLeft;
  gw.innerHTML = h;
  gw.scrollLeft = sl;
  if (centrer) requestAnimationFrame(() => { const td = gw.querySelector('th.td'); gw.scrollLeft = td ? Math.max(0, td.offsetLeft - gw.clientWidth / 2) : 0; });
}

function renderSaison(c) {
  const sw = el['pat-saison'];
  const b = bornesSaison(etat.annee, c);
  if (!b) {
    sw.innerHTML = `<div class="pat-vide"><b>Aucune sortie enregistrée en ${etat.annee}</b>La saison s'affichera de la première à la dernière sortie.</div>`;
    return;
  }
  const travaux = travauxJournal();
  const jours = [];
  for (let d = b.debut; d <= b.fin; d = ajouterJours(d, 1)) jours.push(d);
  let h = '<div class="srow shead"><div class="slab">Parcelle</div><div class="strack sm">';
  let i = 0;
  while (i < jours.length) {
    const m = Number(jours[i].slice(5, 7)) - 1;
    let n = 0;
    while (i + n < jours.length && Number(jours[i + n].slice(5, 7)) - 1 === m) n++;
    h += `<button type="button" class="smo" data-mois="${m}" style="width:${n * 5}px">${n * 5 > 30 ? MOIS[m] : ''}</button>`;
    i += n;
  }
  h += '</div></div>';
  const g = groupesParcelles(c);
  [...g.L, ...g.A].forEach((p) => {
    const bl = bilanParcelle(p.id, b.debut, b.fin, c);
    h += `<div class="srow"><div class="slab"><span class="pnm">${esc(p.nom)}</span><span class="pns">${hFr(bl.heures)} h · ${bl.passages} passage${bl.passages > 1 ? 's' : ''}</span></div><div class="strack">`;
    jours.forEach((d) => {
      const t = travaux.get(`${p.id}|${d}`);
      const k = t ? 'fau' : (d <= c.aujourdhui ? caseParcelle(p.id, d, c).k : '');
      h += `<span class="sd ${k}${d.endsWith('-01') ? ' m1' : ''}${d === c.aujourdhui ? ' td' : ''}"></span>`;
    });
    h += '</div></div>';
  });
  sw.innerHTML = h;
  const iAuj = jours.indexOf(c.aujourdhui);
  if (iAuj >= 0) sw.scrollLeft = Math.max(0, iAuj * 5 - sw.clientWidth + 220);
}

// --- Feuille de saisie -------------------------------------------------------
function ouvrirFeuille(parcelleId, date) {
  const c = ctx();
  F.parcelleId = parcelleId; F.date = date; F.mode = 'SANS_SORTIE'; F.motif = 'Pluie'; F.dansLaJournee = false;
  const g = groupesParcelles(c);
  const prefere = g.A.some((p) => p.id === parcelleId) ? 'AGNELLES' : 'BREBIS';
  F.lotId = (c.lots.find((l) => l.type === prefere) || c.lots[0] || {}).id || null;
  dessinerFeuille();
  el['pat-feuille'].hidden = false;
}
function fermerFeuille() { el['pat-feuille'].hidden = true; }

function dessinerFeuille() {
  const c = ctx();
  const p = parcelles.find((x) => x.id === F.parcelleId) || {};
  const d = F.date;
  const fut = d > c.aujourdhui;
  const travaux = travauxJournal().get(`${F.parcelleId}|${d}`);
  const nomP = (id) => (parcelles.find((x) => x.id === id) || {}).nom || 'parcelle';
  const ici = [];
  const ailleurs = [];
  c.lots.forEach((l) => {
    const j = jourLot(l.id, d, c);
    if (!j) return;
    if (j.sorti) j.items.forEach((it) => (it.parcelleId === F.parcelleId ? ici : ailleurs).push(`${esc(l.nom)} sur ${esc(nomP(it.parcelleId))}, ${it.heures.debut}–${it.heures.fin}`));
    else (j.periodes.some((x) => x.parcelleId === F.parcelleId) ? ici : ailleurs).push(`${esc(l.nom)} : pas de sortie (${esc(j.exception.motif.toLowerCase())})`);
  });
  const lotChoisi = c.lots.find((l) => l.id === F.lotId);
  const jChoisi = lotChoisi ? jourLot(lotChoisi.id, d, c) : null;
  const ailleursCeJour = jChoisi && jChoisi.sorti && jChoisi.items.some((i) => i.parcelleId !== F.parcelleId);
  const exs = c.exceptions.filter((e) => e.date === d && c.lots.some((l) => l.id === e.lotId));
  let h = `<div class="pat-sh-t"><div><h2>${esc(p.nom || 'Parcelle')}</h2><p>${dateLongue(d)} · ${haFr(p.surfaceHa)} ha${travaux ? ` · ${travaux === 'F' ? 'fauche' : 'broyage'} ce jour` : ''}</p></div>
    <button type="button" class="pat-rnd" data-act="fermer" aria-label="Fermer">✕</button></div>
    <div class="pat-stat">${fut ? 'Jour à venir.' : ici.length ? ici.join('<br>') : 'Aucun lot sur cette parcelle ce jour-là.'}${ailleurs.length ? `<br><span class="pat-s2">${ailleurs.join('<br>')}</span>` : ''}</div>`;
  h += `<div class="pat-blk"><h3>Faire entrer un lot ici</h3>`;
  if (!c.lots.length) h += '<p class="pat-hint">Aucun lot de laitières ou d\'agnelles actif : crée-le dans Troupeau > Distribué (« ＋ Lot »).</p>';
  else {
    h += `<div class="chips">${c.lots.map((l) => `<button type="button" class="chip${F.lotId === l.id ? ' on' : ''}" data-lot="${esc(l.id)}"><i class="sw ${l.type === 'AGNELLES' ? 'a' : 'l'}"></i>${esc(l.nom)} · ${l.effectif}</button>`).join('')}</div>
      <div class="pat-times"><label>Sortie <input type="time" id="pat-in-h0" value="${HEURES_DEFAUT.debut}"></label><label>Rentrée <input type="time" id="pat-in-h1" value="${HEURES_DEFAUT.fin}"></label></div>
      ${ailleursCeJour ? `<label class="pat-coche"><input type="checkbox" id="pat-dans-journee"${F.dansLaJournee ? ' checked' : ''}> Changement de parcelle dans la journée (le lot quitte l'autre parcelle à l'heure de sortie)</label>` : ''}
      <button type="button" class="btn btn-primary btn-mini" data-act="entrer">Entrer à partir du ${jjmm(d)}</button>
      <p class="pat-hint">Le lot quitte automatiquement sa parcelle précédente. Il reste ici tant que vous ne le changez pas.</p>`;
  }
  h += '</div>';
  if (!fut) {
    h += `<div class="pat-blk"><h3>Ce jour-là, pour les lots dehors</h3>
      <div class="chips"><button type="button" class="chip${F.mode === 'SANS_SORTIE' ? ' on' : ''}" data-mode="SANS_SORTIE">Pas de sortie</button><button type="button" class="chip${F.mode === 'HORAIRE' ? ' on' : ''}" data-mode="HORAIRE">Horaire différent</button></div>
      ${F.mode === 'HORAIRE' ? '<div class="pat-times"><label>Sortie <input type="time" id="pat-ex-h0" value="07:00"></label><label>Rentrée <input type="time" id="pat-ex-h1" value="10:00"></label></div>' : ''}
      <div class="chips">${MOTIFS.map((m) => `<button type="button" class="chip${F.motif === m ? ' on' : ''}" data-motif="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <button type="button" class="btn btn-secondary btn-mini" data-act="exception">Noter pour le ${jjmm(d)}</button>
      ${exs.length ? `<button type="button" class="pat-lnk" data-act="retirer">Retirer l'exception du ${jjmm(d)} (${esc(exs[0].motif.toLowerCase())})</button>` : ''}
      ${exs.length && exs[0].meteo ? `<p class="pat-hint">Météo : ${esc(resumeMeteo(exs[0].meteo))}</p>` : ''}</div>`;
  }
  el['pat-feuille-corps'].innerHTML = h;
}

const heuresValides = (h) => heureDecimale(h.fin) > heureDecimale(h.debut);

async function clicFeuille(e) {
  const b = e.target.closest('button, input[type=checkbox]');
  if (!b) return;
  if (b.id === 'pat-dans-journee') { F.dansLaJournee = b.checked; return; }
  if (b.dataset.lot) { F.lotId = b.dataset.lot; F.dansLaJournee = false; dessinerFeuille(); return; }
  if (b.dataset.mode) { F.mode = b.dataset.mode; dessinerFeuille(); return; }
  if (b.dataset.motif) { F.motif = b.dataset.motif; dessinerFeuille(); return; }
  const act = b.dataset.act;
  if (act === 'fermer') { fermerFeuille(); return; }
  const c = ctx();
  const d = F.date;
  try {
    if (act === 'entrer') {
      const lot = c.lots.find((l) => l.id === F.lotId);
      if (!lot) return;
      const heures = { debut: document.getElementById('pat-in-h0').value || HEURES_DEFAUT.debut, fin: document.getElementById('pat-in-h1').value || HEURES_DEFAUT.fin };
      if (!heuresValides(heures)) { toastErreur('L\'heure de rentrée doit être après l\'heure de sortie.'); return; }
      // Agnelles séparées des laitières, sauf en septembre-octobre.
      const autreType = lot.type === 'AGNELLES' ? 'BREBIS' : 'AGNELLES';
      const melange = c.lots.some((l) => l.type === autreType && (jourLot(l.id, d, c) || { items: [] }).items.some((i) => i.parcelleId === F.parcelleId));
      if (melange && !melangeAutorise(d) && !confirm('Hors septembre-octobre, les agnelles sont séparées des laitières.\nLes mettre quand même sur la même parcelle ?')) return;
      const plan = await entrerLot({ lotId: lot.id, parcelleId: F.parcelleId, date: d, heures, dansLaJournee: F.dansLaJournee });
      fermerFeuille();
      const nomP = (parcelles.find((x) => x.id === F.parcelleId) || {}).nom || 'la parcelle';
      toastSucces(plan.memeParcelle ? `${lot.nom} déjà sur ${nomP} : horaires mis à jour.` : `${lot.nom} sur ${nomP} à partir du ${jjmm(d)}.`);
    }
    if (act === 'exception') {
      const heures = F.mode === 'HORAIRE' ? { debut: document.getElementById('pat-ex-h0').value, fin: document.getElementById('pat-ex-h1').value } : null;
      if (heures && !heuresValides(heures)) { toastErreur('L\'heure de rentrée doit être après l\'heure de sortie.'); return; }
      const concernes = c.lots.filter((l) => jourLot(l.id, d, c));
      if (!concernes.length) { toastErreur('Aucun lot dehors ce jour-là.'); return; }
      await Promise.all(concernes.map((l) => noterException({ lotId: l.id, date: d, type: F.mode, motif: F.motif, heures })));
      fermerFeuille();
      toastSucces(F.mode === 'HORAIRE' ? `Horaire ${heures.debut}–${heures.fin} noté le ${jjmm(d)}.` : `Pas de sortie le ${jjmm(d)} (${F.motif.toLowerCase()}).`);
      meteoDuJour(d, concernes.map((l) => l.id));
    }
    if (act === 'retirer') {
      const exs = c.exceptions.filter((x) => x.date === d && c.lots.some((l) => l.id === x.lotId));
      await Promise.all(exs.map((x) => retirerException(x.lotId, d)));
      fermerFeuille();
      toastSucces(`Exception du ${jjmm(d)} retirée.`);
    }
  } catch (err) {
    toastErreur('Non enregistré : ' + ((err && err.message) || err));
  }
}

// Météo Open-Meteo rattachée au jour, au centre de la parcelle (sinon à la
// position de l'appareil) ; jamais bloquante.
function meteoDuJour(date, lotIds) {
  const p = parcelles.find((x) => x.id === F.parcelleId);
  const anneau = p && p.coordonnees && p.coordonnees.coordinates && p.coordonnees.coordinates[0];
  const coords = anneau && anneau.length
    ? { lat: anneau.reduce((t, s) => t + s[1], 0) / anneau.length, lon: anneau.reduce((t, s) => t + s[0], 0) / anneau.length } : undefined;
  releverMeteo(date, coords)
    .then((m) => Promise.all(lotIds.map((id) => rattacherMeteo(id, date, m))))
    .catch(() => { /* hors ligne ou trop ancien : sans météo */ });
}
