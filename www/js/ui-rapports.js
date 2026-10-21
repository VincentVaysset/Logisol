// Vue "Rapports & Synthèses" : hub plein écran (voir index.html,
// #rapports-panel), lecture seule. Deux documents, un par onglet
// (maquette-charte-rapports.html / maquette-charte-rapports-realise.html) :
//  - Prévisionnel : assolement prévisionnel et fiches parcelles ;
//  - Réalisé : activités enregistrées et mouvements de stock uniquement — le
//    prévu n'y figure qu'en colonne de comparaison (CLAUDE.md : le réel et le
//    prévu ne se mélangent jamais).
// Auto-suffisant : s'abonne lui-même aux previsions plutôt que de dépendre
// d'un câblage supplémentaire dans main.js, à l'image de sync-status.js.
import { calendrierSemis, syntheseCategories, planFertilisation } from './rapports.js';
import {
  getPrevisions, onPrevisionsChange, campagneCourante, culturePrev
} from './assolement-previsionnel.js';
import { campagneDeActivite } from './calendrier-campagne.js';
import { syntheseStocks } from './realise-calc.js';
import { calculerSyntheses } from './syntheses-calc.js';
import { implantationEnCours } from './implantations.js';
import { getInterventions } from './interventions.js';
import { getTypeById, formulaireDe } from './interventions-types.js';
import { getCultureById } from './cultures-config.js';
import { bilanStocksCampagne } from './ui-stocks.js';
import { getNomExploitation } from './exploitation.js';
import { exporterPdf } from './pdf-export.js';
import { pdfCarnetPaturage, nomFichierCarnet } from './pdf-paturage.js';
import { donneesCarnet } from './ui-paturage.js';
import { bornesSaison } from './paturage-calc.js';
import { pdfPrevisionnel, pdfRealise, nomFichierPdf } from './pdf-rapports.js';
import { toastSucces, toastErreur } from './toast.js';

const panelEl = document.getElementById('rapports-panel');
const campagneLabelEl = document.getElementById('rap-campagne-label');
const docPrevEl = document.getElementById('rap-doc-previsionnel');
const docRealEl = document.getElementById('rap-doc-realise');
const exportStatutEl = document.getElementById('rapports-export-statut');
const btnTelechargerEl = document.getElementById('rapports-telecharger-pdf');
const carnetBtnEl = document.getElementById('rap-carnet-pdf');

let parcelles = [];
let campagneR = Number(campagneCourante());
let panelOuvert = false;
let vue = 'previsionnel';
let filtreFerti = 'tous';

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
    // Tableaux larges : affichés depuis leur début à l'ouverture (libellés
    // visibles), jamais au défilement laissé la fois précédente.
    panelEl.querySelectorAll('.table-scroll').forEach((c) => { c.scrollLeft = 0; });
  });
  document.getElementById('rapports-fermer').addEventListener('click', () => {
    panelOuvert = false;
    panelEl.hidden = true;
  });
  btnTelechargerEl.addEventListener('click', telechargerPdf);
  document.getElementById('rap-campagne-moins').addEventListener('click', () => { campagneR--; render(); });
  document.getElementById('rap-campagne-plus').addEventListener('click', () => { campagneR++; render(); });
  panelEl.querySelectorAll('[data-rapvue]').forEach((b) => b.addEventListener('click', () => { vue = b.dataset.rapvue; render(); }));
  docPrevEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filtre]');
    if (!b) return;
    filtreFerti = b.dataset.filtre;
    renderPrevisionnel();
  });
  docRealEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-synvue]');
    if (!b) return;
    const [cle, v] = b.dataset.synvue.split(':');
    vuesRealise[cle] = v;
    renderRealise();
  });

  // Rapport auto-alimenté : toute modification de l'assolement prévisionnel
  // (dose de fumier ajustée, culture changée...) doit se refléter au prochain
  // coup d'œil, sans revenir en arrière puis rouvrir le hub.
  onPrevisionsChange(() => { if (panelOuvert) render(); });

  // Carnet de pâturage : bornes = saison de l'année en cours (modifiables).
  carnetBtnEl.addEventListener('click', telechargerCarnet);
  document.addEventListener('logisol:carnet-paturage', (e) => {
    document.getElementById('btn-rapports').click();
    bornesCarnet(e.detail && e.detail.annee);
    document.getElementById('rap-carnet').scrollIntoView({ block: 'start' });
  });
  document.getElementById('btn-rapports').addEventListener('click', () => bornesCarnet());
}

function bornesCarnet(annee = Number(aujourdhuiIso().slice(0, 4))) {
  const { ctx } = donneesCarnet();
  const b = bornesSaison(annee, ctx) || { debut: `${annee}-01-01`, fin: aujourdhuiIso() < `${annee}-12-31` ? aujourdhuiIso() : `${annee}-12-31` };
  document.getElementById('rap-carnet-du').value = b.debut;
  document.getElementById('rap-carnet-au').value = b.fin;
}

async function telechargerCarnet() {
  const statut = document.getElementById('rap-carnet-statut');
  const debut = document.getElementById('rap-carnet-du').value;
  const fin = document.getElementById('rap-carnet-au').value;
  if (!debut || !fin || fin < debut) { statut.textContent = '⚠️ Choisis une date de début et une date de fin (fin après le début).'; return; }
  carnetBtnEl.disabled = true;
  statut.textContent = 'Génération du PDF...';
  try {
    const { ctx, parcelles: ps, travaux } = donneesCarnet();
    const doc = pdfCarnetPaturage({ ctx, parcelles: ps, debut, fin, travaux, exploitation: getNomExploitation(), aujourdhui: aujourdhuiIso() });
    const nom = nomFichierCarnet(debut, fin);
    const r = await exporterPdf(doc, nom);
    if (!r.ok) { statut.textContent = '⚠️ ' + r.erreur; toastErreur('PDF non enregistré : ' + r.erreur); }
    else if (r.methode === 'annule') statut.textContent = '';
    else { statut.textContent = r.methode === 'partage' ? '✅ PDF prêt — choisis où l\'enregistrer ou l\'ouvrir.' : '✅ PDF téléchargé (' + nom + ').'; toastSucces('Carnet de pâturage généré.'); }
  } catch (err) {
    statut.textContent = '⚠️ Génération impossible : ' + ((err && err.message) || err);
  } finally {
    carnetBtnEl.disabled = false;
  }
}

function render() {
  campagneLabelEl.textContent = `Campagne ${campagneR}`;
  panelEl.querySelectorAll('[data-rapvue]').forEach((b) => {
    const on = b.dataset.rapvue === vue;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  docPrevEl.hidden = vue !== 'previsionnel';
  docRealEl.hidden = vue !== 'realise';
  exportStatutEl.textContent = '';
  if (vue === 'previsionnel') renderPrevisionnel(); else renderRealise();
}

// --- Export PDF ---------------------------------------------------------------
// Génère le PDF (jsPDF, 100% local) puis le remet à l'utilisateur par la
// méthode la plus fiable disponible (partage natif, sinon téléchargement
// direct — cf. pdf-export.js). Toujours un retour explicite : bouton
// désactivé + statut pendant la génération, toast de confirmation ou
// d'erreur à la fin — jamais un échec silencieux.
async function telechargerPdf() {
  btnTelechargerEl.disabled = true;
  exportStatutEl.textContent = 'Génération du PDF...';
  try {
    const camp = String(campagneR);
    const jour = aujourdhuiIso();
    const commun = { camp, exploitation: getNomExploitation(), aujourdhui: jour };
    let doc;
    if (vue === 'realise') {
      const d = donneesRealise(camp);
      doc = pdfRealise({ ...commun, ...d, arreteLe: arreteAu(d.stocks) });
    } else {
      const liste = getPrevisions();
      doc = pdfPrevisionnel({ ...commun, cal: calendrierSemis(parcelles, camp, liste), cat: syntheseCategories(parcelles, camp, liste),
        plan: planFertilisation(parcelles, camp, liste) });
    }
    const nomFichier = nomFichierPdf(vue, camp, jour);
    const resultat = await exporterPdf(doc, nomFichier);
    if (!resultat.ok) {
      exportStatutEl.textContent = '⚠️ ' + resultat.erreur;
      toastErreur('PDF non enregistré : ' + resultat.erreur);
    } else if (resultat.methode === 'annule') {
      exportStatutEl.textContent = '';
    } else {
      exportStatutEl.textContent = resultat.methode === 'partage'
        ? '✅ PDF prêt — choisis où l\'enregistrer ou l\'ouvrir.'
        : '✅ PDF téléchargé (' + nomFichier + ').';
      toastSucces('PDF généré.');
    }
  } catch (err) {
    const message = (err && err.message) || 'Erreur inconnue.';
    exportStatutEl.textContent = '⚠️ Génération impossible : ' + message;
    toastErreur('PDF non généré : ' + message);
  } finally {
    btnTelechargerEl.disabled = false;
  }
}

// --- Briques du document (maquette .doc) --------------------------------------
function entete(titre, droite, source) {
  const nom = getNomExploitation();
  return `<div class="doc-hd">
    <h3 class="doc-t">${esc(titre)}</h3>
    <div class="doc-m"><span>${esc(nom)}</span><span>${esc(droite)}</span></div>
    <p class="note">${esc(source)}</p>
  </div>`;
}
const section = (n, titre, corps, id = '') =>
  `<section class="s"${id ? ` id="${id}"` : ''}><h4 class="s-t"><span class="num">${n}.</span>${esc(titre)}</h4>${corps}</section>`;
const kpi = (classe, valeur, label) =>
  `<div class="kpi${classe ? ' ' + classe : ''}"><span class="n">${valeur}</span><span class="l">${esc(label)}</span></div>`;
const kpis = (liste) => `<div class="kpis${liste.length === 3 ? ' c3' : ''}">${liste.join('')}</div>`;
// Tableau 4 colonnes max : défile horizontalement plutôt que de déborder.
const tableau = (cap, tete, corps, id = '') => `<div class="table-scroll"><table${id ? ` id="${id}"` : ''}>${cap ? `<caption>${cap}</caption>` : ''}
  <thead><tr>${tete.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${corps}</tbody></table></div>`;
const note = (t) => `<p class="note">${t}</p>`;
const NOTE_ESTIMEE = note('* surface déduite des parcelles, non saisie');
const pied = (t) => `<div class="foot">${esc(t)}</div>`;
function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }
const jourMois = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
function aujourdhuiIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Prévisionnel ---------------------------------------------------------------
const GROUPES_SEMIS = [
  { label: 'Céréales / annuelles', familles: ['CEREALES'] },
  { label: 'Prairies temporaires & fourrages', familles: ['PRAIRIE_COURTE', 'SEMIS_PRAIRIE'] }
];
const PRODUITS_FERTI = [
  { id: 'fumier', label: 'Fumier', dose: 'fumierTHa', total: 'fumierT' },
  { id: 'chaux', label: 'Chaux', dose: 'chauxTHa', total: 'chauxT' }
];

function renderPrevisionnel() {
  const liste = getPrevisions();
  const camp = String(campagneR);
  const cal = calendrierSemis(parcelles, camp, liste);
  const cat = syntheseCategories(parcelles, camp, liste);
  const plan = planFertilisation(parcelles, camp, liste);

  // 1. Assolement & semis : cultures semées dans la campagne, par chantier.
  const cultures = [
    ...cal.automne.details.map((d) => ({ ...d, periode: 'Automne' })),
    ...cal.printemps.details.map((d) => ({ ...d, periode: 'Printemps' }))
  ].map((d) => ({ ...d, famille: culturePrev(d.code).famille }));
  let lignesSemis = '';
  let totalSeme = 0;
  GROUPES_SEMIS.forEach((g) => {
    const l = cultures.filter((c) => g.familles.includes(c.famille));
    if (!l.length) return;
    const st = l.reduce((n, c) => n + c.ha, 0);
    totalSeme += st;
    lignesSemis += `<tr class="grp"><td colspan="3">${esc(g.label)}</td></tr>`
      + l.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.periode}</td><td>${ha2(c.ha)}</td></tr>`).join('')
      + `<tr class="tot"><td>Sous-total</td><td></td><td>${ha2(st)}</td></tr>`;
  });
  if (lignesSemis) lignesSemis += `<tr class="tot"><td>Total semé</td><td></td><td>${ha2(totalSeme)}</td></tr>`;
  if (cal.derobees.parcelles.length) {
    lignesSemis += '<tr class="grp"><td colspan="3">Dérobées / couverts (réel, hors total)</td></tr>'
      + cal.derobees.parcelles.map((p) => `<tr><td>${esc(p.derobee)} · ${esc(p.nom)}</td><td>En place</td><td>${ha2(p.ha)}</td></tr>`).join('');
  }
  const semis = kpis([
    kpi('ambre', `${ha2(cal.automne.ha)} ha`, 'Semis d\'automne'),
    kpi('vert', `${ha2(cal.printemps.ha)} ha`, 'Semis printemps'),
    kpi('bleu', `${ha2(cal.derobees.ha)} ha`, 'Dérobées')
  ]) + (lignesSemis ? tableau('', ['Culture', 'Période', 'ha'], lignesSemis, 'rap-semis-prev')
    : note(`Aucun semis prévu pour ${camp} dans l'assolement prévisionnel.`))
    + (cat.coherent ? '' : note(`Écart de ${ha(Math.abs(cat.totalEnregistre - cat.totalPrevisionnel))} ha entre l'assolement ${camp} (${ha(cat.totalPrevisionnel)} ha) et les fiches parcelles (${ha(cat.totalEnregistre)} ha) : vérifier les parcelles sans culture renseignée.`));

  // 2. Plan de fertilisation : un tableau par produit, jamais de dose moyenne.
  const produits = PRODUITS_FERTI.filter((pr) => filtreFerti === 'tous' || filtreFerti === pr.id);
  const ferti = kpis([
    kpi('ambre', `${ha(plan.totalFumierT)} t`, 'Fumier à épandre'),
    kpi('', `${ha(plan.totalChauxT)} t`, 'Chaux à épandre')
  ]) + `<div class="chips no-print">${[['tous', 'Tout'], ['fumier', 'Fumier'], ['chaux', 'Chaux']].map(([v, l]) =>
    `<button type="button" class="chip${filtreFerti === v ? ' on' : ''}" data-filtre="${v}">${l}</button>`).join('')}</div>`
    + produits.map((pr) => {
      const l = plan.lignes.filter((x) => x[pr.dose] > 0).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
      if (!l.length) return note(`${pr.label} : aucune parcelle prévue sur la campagne.`);
      const doses = new Set(l.map((x) => x[pr.dose]));
      const cap = `${pr.label}${doses.size === 1 ? ` · ${ha([...doses][0])} t/ha` : ''}`;
      const surf = l.reduce((n, x) => n + x.surfaceHa, 0);
      const t = l.reduce((n, x) => n + x[pr.total], 0);
      return tableau(cap, ['Parcelle', 'ha', 't/ha', 't'],
        l.map((x) => `<tr><td>${esc(x.nom)}</td><td>${ha2(x.surfaceHa)}</td><td>${ha(x[pr.dose])}</td><td>${ha2(x[pr.total])}</td></tr>`).join('')
        + `<tr class="tot"><td>Total · ${l.length} parcelle${l.length > 1 ? 's' : ''}</td><td>${ha2(surf)}</td><td></td><td>${ha2(t)}</td></tr>`, `rap-ferti-${pr.id}`);
    }).join('');

  docPrevEl.innerHTML = entete(`Bilan de campagne ${camp}`, `Édité le ${dateFr(aujourdhuiIso())}`, 'Source : assolement prévisionnel et fiches parcelles.')
    + section(1, 'Assolement & semis', semis)
    + section(2, 'Plan de fertilisation', ferti)
    + section(3, 'Bilan stocks', note('Tonnages récoltés, consommés et restants : voir l\'onglet Réalisé.'))
    + pied(`Logisol · Campagne ${camp}`);
}

// --- Réalisé --------------------------------------------------------------------
// maquette-syntheses-app.html : totaux par groupe, détail au toucher (<details>) ;
// fourrages et travaux basculent entre deux vues (chips). Le PDF (pdf-rapports.js)
// reprend les mêmes données, tout déplié.
function activitesCampagne(camp) {
  return getInterventions().filter((i) => i.statut !== 'A_FAIRE' && campagneDeActivite(i) === camp && (i.cibleType || 'PARCELLE') !== 'BERGERIE');
}

function cultureA(parcelleId, date) {
  const impl = implantationEnCours(parcelleId, date);
  const c = impl && impl.cultureId ? getCultureById(impl.cultureId) : null;
  return c ? c.nom : null;
}

export function donneesRealise(camp = String(campagneR)) {
  const activites = activitesCampagne(camp).map((i) => {
    const t = getTypeById(i.typeId);
    const s = i.saisie || {};
    const culture = s.cultureId ? getCultureById(s.cultureId) : null;
    return { id: i.id, date: i.date, typeNom: i.typeNom || (t && t.nom) || '', formulaire: formulaireDe(t),
      categorie: t ? t.categorie : null, parcelleIds: i.parcelleIds || [], s, cultureNom: culture ? culture.nom : null,
      tracteurNom: i.tracteurNom || '', materielNom: i.materielNom || i.materiel || '', chauffeur: i.chauffeur || '' };
  });
  const syn = calculerSyntheses({ parcelles, activites, cultureA });
  // Campagne culturale N = campagne de stock (N-1)-N (01/09 → 31/08).
  const stocks = bilanStocksCampagne(`${Number(camp) - 1}-${camp}`);
  return { camp, syn, stocks };
}

// Arrêté au : aujourd'hui, ou le 31/08 d'une campagne terminée.
const arreteAu = (stocks) => (stocks.dateRef < stocks.b.debut ? aujourdhuiIso() : stocks.dateRef);
const ORDINAL = (n) => (n == null ? 'coupe ?' : n === 1 ? '1ʳᵉ coupe' : `${n}ᵉ coupe`);
const vuesRealise = { fourrages: 'coupe', travaux: 'type' };

// Une ligne repliable : nom + sous-titre à gauche, valeur + sous-valeur à droite.
const repli = (nom, sousNom, val, sousVal, detail, ouvert = false) =>
  `<details class="syn"${ouvert ? ' open' : ''}><summary><span class="syn-nm">${esc(nom)}${sousNom ? `<small>${esc(sousNom)}</small>` : ''}</span>`
  + `<span class="syn-val">${val}${sousVal ? `<small>${sousVal}</small>` : ''}</span></summary><div class="syn-det">${detail}</div></details>`;
const ln = (g, gs, d, ds) => `<div class="syn-ln"><span>${esc(g)}${gs ? `<small>${esc(gs)}</small>` : ''}</span><span>${d}${ds ? `<small>${ds}</small>` : ''}</span></div>`;
const chips = (cle, options) => `<div class="syn-chips">${options.map(([v, l]) =>
  `<button type="button" class="chip${vuesRealise[cle] === v ? ' on' : ''}" data-synvue="${cle}:${v}">${l}</button>`).join('')}</div>`;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const sep = (...xs) => xs.filter((x) => x != null && x !== '').join(' · ');

function renderRealise() {
  const { camp, syn, stocks } = donneesRealise();
  const { semis: se, epandages: ep, fourrages: fo, cereales: ce, travaux: tr } = syn;
  const et = (x) => (x ? '*' : '');
  const vide = (t) => note(t);

  // 1. Semis : par culture
  const s1 = se.groupes.length ? kpis([
    kpi('vert', `${ha2(se.ha)}${et(se.estimee)} <small>ha</small>`, 'Surface semée'),
    kpi('', se.kg == null ? '—' : `${entier(se.kg)} <small>kg</small>`, se.kgPartiel && se.kg != null ? 'Semence (partiel)' : 'Semence utilisée')
  ]) + se.groupes.map((g, i) => repli(g.nom, pluriel(g.nbParcelles, 'parcelle'), `${ha2(g.ha)} ha`,
    sep(g.dose != null ? `${ha(g.dose)} kg/ha` : '', g.kg != null ? `${entier(g.kg)} kg` : ''),
    g.lignes.map((l) => ln(l.parcelle, sep(jourMois(l.date), l.semence), `${ha2(l.ha)}${et(l.estimee)} ha`,
      sep(l.dose != null ? `${ha(l.dose)} kg/ha` : 'dose non saisie', l.kg != null ? `${entier(l.kg)} kg` : ''))).join(''), i === 0)).join('')
    : vide(`Aucun semis enregistré pour ${camp}.`);

  // 2. Épandages : par parcelle + totaux exploitation par produit
  const s2 = ep.parcelles.length ? kpis([
    ...ep.parProduit.map((p) => kpi('ambre', `${t1(p.t)} <small>t</small>`, p.produit)),
    kpi('', `${ha2(ep.ha)} <small>ha</small>`, 'Épandus')
  ].slice(0, 3)) + ep.parcelles.map((p, i) => repli(p.parcelle, sep(`${ha2(p.ha)} ha`, p.culture), `${t1(p.t)} t`,
    p.lignes.length > 1 ? `${p.lignes.length} apports` : (p.tHa != null ? `${t1(p.tHa)} t/ha` : ''),
    p.lignes.map((l) => ln(l.produit, jourMois(l.date), l.t == null ? '—' : `${t1(l.t)} t`, l.tHa != null ? `${t1(l.tHa)} t/ha` : '')).join(''), i === 0)).join('')
    : vide(`Aucun épandage enregistré pour ${camp}.`);

  // 3. Fourrages : par fourrage · coupe ↔ par parcelle
  let s3 = vide(`Aucune récolte de fourrage enregistrée pour ${camp}.`);
  if (fo.parCoupe.length) {
    const vueA = fo.parCoupe.map((g, i) => repli(`${g.fourrage} · ${ORDINAL(g.coupe)}`,
      sep(g.mode, g.bottes ? `${entier(g.bottes)} bottes` : '', pluriel(g.nbParcelles, 'parcelle')), `${t1(g.t)} t`,
      sep(`${ha2(g.ha)}${et(g.estimee)} ha`, g.tHa != null ? `${t1(g.tHa)} t/ha` : ''),
      g.lignes.map((l) => ln(l.parcelle, sep(jourMois(l.date), l.unites != null ? `${ha(l.unites)} ${l.seche ? 'remorques' : 'bottes'}` : ''),
        l.t == null ? '—' : `${t1(l.t)} t`, l.ha > 0 && l.t != null ? `${t1(l.t / l.ha)} t/ha` : '')).join(''), i === 0)).join('');
    const vueB = fo.parParcelle.map((p, i) => repli(p.parcelle, sep(`${ha2(p.ha)} ha`, p.culture), `${t1(p.t)} t`,
      sep(p.tHa != null ? `${t1(p.tHa)} t/ha` : '', pluriel(p.nbCoupes, 'coupe')),
      p.lignes.map((l) => ln(`${ORDINAL(l.coupe)} · ${l.mode}`, sep(jourMois(l.date), l.fourrage), l.t == null ? '—' : `${t1(l.t)} t`, '')).join(''), i === 0)).join('');
    s3 = kpis([
      kpi('vert', `${t1(fo.t)} <small>t</small>`, 'Récolté'),
      kpi('', `${t1(fo.tSeche)} <small>t</small>`, 'Séché grange'),
      kpi('', `${t1(fo.tBottes)} <small>t</small>`, fo.nbBottes ? `En bottes · ${entier(fo.nbBottes)}` : 'En bottes')
    ]) + chips('fourrages', [['coupe', 'Par fourrage · coupe'], ['parcelle', 'Par parcelle']])
      + (vuesRealise.fourrages === 'coupe' ? vueA : vueB);
  }

  // 4. Céréales & paille : par culture
  const s4 = ce.groupes.length ? kpis([
    kpi('bleu', ce.grainT == null ? '—' : `${t1(ce.grainT)} <small>t</small>`, 'Grain'),
    kpi('ambre', ce.pailleT == null ? '—' : `${t1(ce.pailleT)} <small>t</small>`, ce.bottes ? `Paille · ${entier(ce.bottes)} bottes` : 'Paille')
  ]) + ce.groupes.map((g, i) => repli(g.nom, `${ha2(g.ha)} ha`, g.grainT == null ? 'paille seule' : `${t1(g.grainT)} t grain`,
    sep(g.qHa != null ? `${ha(Math.round(g.qHa))} q/ha` : '', g.pailleT != null ? `paille ${t1(g.pailleT)} t` : ''),
    g.lignes.map((l) => ln(l.parcelle, l.date ? `moisson ${jourMois(l.date)}` : '', l.grainT == null ? '—' : `${t1(l.grainT)} t`,
      sep(l.qHa != null ? `${ha(Math.round(l.qHa))} q/ha` : '', l.bottes != null ? `${entier(l.bottes)} bottes` : ''))).join(''), i === 0)).join('')
    : vide(`Aucune moisson ni paille enregistrée pour ${camp}.`);

  // 5. Travaux : par type ↔ par parcelle
  let s5 = vide(`Aucun travail enregistré pour ${camp}.`);
  if (tr.parParcelle.length) {
    const vueA = tr.parType.length ? tr.parType.map((g, i) => repli(g.type, pluriel(g.nbParcelles, 'parcelle'), `${ha2(g.ha)} ha`, '',
      g.lignes.map((l) => ln(l.parcelle, '', jourMois(l.date), `${ha2(l.ha)} ha`)).join(''), i === 0)).join('')
      : note('Pas d\'autre travail que semis, épandages et récoltes.');
    const vueB = tr.parParcelle.map((p, i) => repli(p.parcelle, sep(`${ha2(p.ha)} ha`, p.culture), pluriel(p.lignes.length, 'travail').replace('travails', 'travaux'), '',
      p.lignes.map((l) => ln(l.type, sep(l.tracteur, l.outil, l.chauffeur), jourMois(l.date), '')).join(''), i === 0)).join('');
    s5 = chips('travaux', [['type', 'Par type'], ['parcelle', 'Par parcelle']]) + (vuesRealise.travaux === 'type' ? vueA : vueB);
  }

  // 6. Bilan stocks : dérivé du journal de mouvements, jamais saisi.
  const { lignes: lst, tot } = syntheseStocks(stocks.groupes);
  const lignesStock = lst.map((g) => {
    const origine = [g.depart > 0 ? 'départ' : '', g.recolte > 0 ? 'récolte' : '', g.achat > 0 ? 'achats' : ''].filter(Boolean).join(' + ');
    return `<tr><td>${esc(g.nom)}${origine ? `<small>${origine}</small>` : ''}</td><td>${t1(g.entrees)}</td><td>${t1(g.sorties)}</td><td>${t1(g.reste)}</td></tr>`;
  }).join('');
  const ajust = tot.sorties - tot.conso;
  const s6 = kpis([
    kpi('vert', `${t1(tot.entrees)} t`, 'Disponible'),
    kpi('ambre', `${t1(tot.sorties)} t`, 'Consommé'),
    kpi('bleu', `${t1(tot.reste)} t`, 'En stock')
  ]) + (lignesStock
    ? tableau('', ['Catégorie', 'Entrées', 'Sorties', 'Stock'], lignesStock + `<tr class="tot"><td>Total (t)</td><td>${t1(tot.entrees)}</td><td>${t1(tot.sorties)}</td><td>${t1(tot.reste)}</td></tr>`, 'rap-stocks-reel')
    : note('Aucun stock ni mouvement sur la campagne.'))
    + (lignesStock && Math.abs(ajust) >= 0.05 ? note(`Sorties : ${t1(tot.conso)} t distribuées aux lots, ${t1(ajust)} t d'ajustements d'inventaire.`) : '');

  const estimee = se.estimee || fo.estimee;
  docRealEl.innerHTML = entete(`Bilan réalisé — campagne ${camp}`, `Arrêté au ${dateFr(arreteAu(stocks))}`,
    'Source : activités enregistrées (campagne de chaque activité) et mouvements de stock. Toucher une ligne pour le détail.')
    + section(1, 'Semis', s1, 'rap-syn-semis')
    + section(2, 'Épandages', s2, 'rap-syn-epandages')
    + section(3, 'Fourrages récoltés', s3, 'rap-syn-fourrages')
    + section(4, 'Céréales & paille', s4, 'rap-syn-cereales')
    + section(5, 'Travaux', s5, 'rap-syn-travaux')
    + section(6, 'Bilan stocks', s6, 'rap-syn-stocks')
    + (estimee ? NOTE_ESTIMEE : '')
    + pied(`Logisol · Réalisé ${camp}`);
}

// --- Utilitaires --------------------------------------------------------------
function ha(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
const fixe = (d) => (v) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const ha2 = fixe(2);
const t1 = fixe(1);
const entier = fixe(0);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
