// Vue "Rapports & Synthèses" : hub plein écran (voir index.html,
// #rapports-panel), lecture seule. Deux documents, un par onglet
// (maquette-charte-rapports.html / maquette-charte-rapports-realise.html) :
//  - Prévisionnel : assolement prévisionnel et fiches parcelles ;
//  - Réalisé : activités enregistrées et mouvements de stock uniquement — le
//    prévu n'y figure qu'en colonne de comparaison (CLAUDE.md : le réel et le
//    prévu ne se mélangent jamais).
// Auto-suffisant : s'abonne lui-même aux previsions plutôt que de dépendre
// d'un câblage supplémentaire dans main.js, à l'image de sync-status.js.
import { calendrierSemis, syntheseCategories, planFertilisation, SAISON_PAR_FAMILLE } from './rapports.js';
import {
  getPrevisions, onPrevisionsChange, campagneCourante, prevision, culturePrev, estSemisDeLAnnee
} from './assolement-previsionnel.js';
import { campagneDeActivite } from './calendrier-campagne.js';
import { semisRealises, fertilisationRealisee, syntheseStocks, noteAVerifier } from './realise-calc.js';
import { getInterventions, quantiteDeSaisie } from './interventions.js';
import { getTypeById, formulaireDe } from './interventions-types.js';
import { getCultureById } from './cultures-config.js';
import { bilanStocksCampagne, recoltesParCoupe } from './ui-stocks.js';
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
function activitesCampagne(camp) {
  return getInterventions().filter((i) => i.statut !== 'A_FAIRE' && campagneDeActivite(i) === camp)
    .map((i) => ({ i, f: formulaireDe(getTypeById(i.typeId)), s: i.saisie || {} }));
}

export function donneesRealise(camp = String(campagneR)) {
  const liste = getPrevisions();
  const acts = activitesCampagne(camp);

  const prevus = new Map();
  parcelles.forEach((p) => {
    const pv = prevision(p.id, camp, liste);
    const c = pv && pv.cultureCode ? culturePrev(pv.cultureCode) : null;
    if (!c || !estSemisDeLAnnee(c.code) || !SAISON_PAR_FAMILLE[c.famille]) return;
    prevus.set(p.id, { code: c.code, label: c.label, saison: SAISON_PAR_FAMILLE[c.famille], famille: c.famille, grain: c.grain });
  });
  const semis = semisRealises({ parcelles, prevus, semis: acts.filter((a) => a.f === 'SEMIS').map(({ i, s }) => {
    const culture = s.cultureId ? getCultureById(s.cultureId) : null;
    return { id: i.id, date: i.date, parcelleIds: i.parcelleIds || [], surfaceHa: s.surfaceHa != null ? s.surfaceHa : null,
      surfaceEstimee: !!s.surfaceEstimee, doseKgHa: s.doseKgHa, semence: s.semence, cultureNom: culture && culture.nom,
      derobee: !!culture && culture.famille === 'derobee' };
  }) });

  const prevu = new Map(parcelles.map((p) => [p.id, prevision(p.id, camp, liste) || {}]));
  const epandages = acts.filter((a) => a.f === 'FUMIER' || a.f === 'CHAULAGE').map(({ i, f, s }) => (f === 'FUMIER'
    ? { date: i.date, parcelleIds: i.parcelleIds || [], produit: 'fumier', tonnes: quantiteDeSaisie('FUMIER', s) || 0 }
    : { date: i.date, parcelleIds: i.parcelleIds || [], produit: 'chaux', doseTHa: s.doseTonnesHa }));
  const ferti = fertilisationRealisee({ parcelles, prevu, epandages });

  // Campagne culturale N = campagne de stock (N-1)-N (01/09 → 31/08).
  const stocks = bilanStocksCampagne(`${Number(camp) - 1}-${camp}`);
  const coupes = recoltesParCoupe(stocks.b);
  return { camp, semis, ferti, stocks, coupes };
}

// Arrêté au : aujourd'hui, ou le 31/08 d'une campagne terminée.
const arreteAu = (stocks) => (stocks.dateRef < stocks.b.debut ? aujourdhuiIso() : stocks.dateRef);
const ORDINAL = (n) => (n === 1 ? '1ʳᵉ coupe' : `${n}ᵉ coupe`);

function renderRealise() {
  const { camp, semis, ferti, stocks, coupes } = donneesRealise();
  const et = (x) => (x ? '*' : '');
  let estimee = semis.estimee;

  // 1. Semis réalisés : une ligne par parcelle, puis le récapitulatif par
  // culture (achats de semence).
  const kgTxt = (kg, partiel, est) => (kg == null ? '—' : entier(kg) + et(est) + (partiel ? ' (partiel)' : ''));
  const na = (t) => `<td class="na">${t}</td>`;
  const ligneSemee = (l) => `<tr><td>${esc(l.parcelle)}</td><td class="cult">${esc(l.culture)}${l.semence ? `<small>${esc(l.semence)}</small>` : ''}${l.prevuDifferent ? `<small>prévu : ${esc(l.prevuDifferent)}</small>` : ''}</td><td>${jourMois(l.date)}</td>
      <td>${ha2(l.ha)}${et(l.estimee)}</td>${l.dose == null ? na('—') : `<td>${ha(l.dose)}</td>`}${l.kg == null ? na('—') : `<td>${entier(l.kg)}${et(l.estimee)}</td>`}</tr>`;
  const lignesSemis = semis.lignes.map((l) => (l.aSemer
    ? `<tr><td>${esc(l.parcelle)}</td><td class="na">${esc(l.culture)}</td><td></td>${na(ha2(l.ha))}${na('—')}${na('À semer')}</tr>`
    : ligneSemee(l))).join('');
  const s1 = kpis([
    kpi('vert', `${ha2(semis.seme)}${et(semis.estimee)} <small>/ ${ha2(semis.prevu)} ha</small>`, 'Surface semée'),
    kpi('', `${ha2(semis.reste)} ha`, 'Reste à semer')
  ]) + (lignesSemis || semis.derobees.length
    ? (lignesSemis ? tableau('', ['Parcelle', 'Culture', 'Date', 'ha', 'kg/ha', 'kg'], lignesSemis
      + `<tr class="tot"><td>Total semé</td><td></td><td></td><td>${ha2(semis.seme)}${et(semis.estimee)}</td><td></td><td>${semis.kg == null ? '' : kgTxt(semis.kg, semis.kgPartiel, semis.estimee)}</td></tr>`, 'rap-semis-reel') : '')
      + (semis.derobees.length ? tableau('Dérobées et couverts', ['Parcelle', 'Culture', 'Date', 'ha', 'kg/ha', 'kg'], semis.derobees.map(ligneSemee).join('')
        + `<tr class="tot"><td>Total</td><td></td><td></td><td>${ha2(semis.derobeesHa)}</td><td></td><td>${semis.derobeesKg == null ? '' : kgTxt(semis.derobeesKg, semis.derobeesKgPartiel, false)}</td></tr>`, 'rap-semis-derobees')
        + note('Hors total semé et hors reste à semer.') : '')
      + (semis.sansDose.length ? note(`Dose non saisie : ${semis.sansDose.map(esc).join(', ')}.`) : '')
      + (semis.parCulture.length ? tableau('Semence par culture', ['Culture', 'ha', 'kg'],
        semis.parCulture.map((c) => `<tr><td>${esc(c.culture)}</td><td>${ha2(c.ha)}</td>${c.kg == null ? na('—') : `<td>${kgTxt(c.kg, c.kgPartiel, false)}</td>`}</tr>`).join(''), 'rap-semis-cultures') : '')
    : note(`Aucun semis enregistré ni prévu pour ${camp}.`));

  // 2. Fertilisation réalisée
  const [fu] = ferti;
  const s2 = kpis([
    kpi('ambre', `${ha(fu.realiseT)} t`, 'Fumier épandu'),
    kpi('', `${ha(fu.prevuT)} t`, 'Prévu'),
    kpi('', fu.pct == null ? '—' : `${fu.pct} %`, 'Réalisé')
  ]) + ferti.map((pr) => {
    const nom = pr.produit === 'fumier' ? 'Fumier' : 'Chaux';
    if (!pr.lignes.length) return note(`${nom} : rien de prévu, rien d'épandu.`);
    const cap = `${nom}${pr.doseUnique != null ? ` · prévu ${ha(pr.doseUnique)} t/ha` : ''}`;
    const ecart = (v) => (v == null ? '<td class="na">À faire</td>' : `<td class="${v >= 0 ? 'ec-p' : 'ec-m'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${ha2(Math.abs(v))}</td>`);
    const lignes = pr.lignes.map((l) => (l.aVerifier ? `<tr class="a-verifier"><td>${esc(l.nom)}<small>${ha2(l.ha)} ha · ${jourMois(l.date)} · ${ha(Math.round(l.tHaReel * 10) / 10)} t/ha</small></td>
      <td>${l.prevu == null ? '—' : ha2(l.prevu)}</td><td>${ha2(l.realise)}</td><td>valeur à vérifier</td></tr>` : `<tr><td>${esc(l.nom)}<small>${[`${ha2(l.ha)} ha`, jourMois(l.date), l.tHaReel != null ? `${ha(Math.round(l.tHaReel * 10) / 10)} t/ha` : ''].filter(Boolean).join(' · ')}</small></td>
      <td${l.prevu == null ? ' class="na"' : ''}>${l.prevu == null ? '—' : ha2(l.prevu)}</td><td${l.realise == null ? ' class="na"' : ''}>${l.realise == null ? '—' : ha2(l.realise)}</td>${ecart(l.aFaire ? null : l.ecart)}</tr>`)).join('');
    const tot = `<tr class="tot"><td>Total</td><td>${pr.lignes.some((l) => l.prevu != null) ? ha2(pr.prevuT) : '—'}</td><td>${ha2(pr.realiseT)}</td><td>${pr.ecartT > 0 ? '+' : pr.ecartT < 0 ? '−' : ''}${ha2(Math.abs(pr.ecartT))}</td></tr>`;
    return tableau(cap, ['Parcelle', 'Prévu', 'Réalisé', 'Écart'], lignes + tot, `rap-ferti-reel-${pr.produit}`)
      + (pr.aVerifier.length ? note(noteAVerifier(nom, pr.aVerifier)) : '');
  }).join('');

  // 3. Bilan stocks : dérivé du journal de mouvements, jamais saisi.
  const { lignes: lst, tot } = syntheseStocks(stocks.groupes);
  const lignesStock = lst.map((g) => {
    const origine = [g.depart > 0 ? 'départ' : '', g.recolte > 0 ? 'récolte' : '', g.achat > 0 ? 'achats' : ''].filter(Boolean).join(' + ');
    return `<tr><td>${esc(g.nom)}${origine ? `<small>${origine}</small>` : ''}</td><td>${t1(g.entrees)}</td><td>${t1(g.sorties)}</td><td>${t1(g.reste)}</td></tr>`;
  }).join('');
  const ajust = tot.sorties - tot.conso;
  let s3 = kpis([
    kpi('vert', `${t1(tot.entrees)} t`, 'Disponible'),
    kpi('ambre', `${t1(tot.sorties)} t`, 'Consommé'),
    kpi('bleu', `${t1(tot.reste)} t`, 'En stock')
  ]) + (lignesStock
    ? tableau('', ['Catégorie', 'Entrées', 'Sorties', 'Stock'], lignesStock + `<tr class="tot"><td>Total (t)</td><td>${t1(tot.entrees)}</td><td>${t1(tot.sorties)}</td><td>${t1(tot.reste)}</td></tr>`, 'rap-stocks-reel')
    : note('Aucun stock ni mouvement sur la campagne.'))
    + (lignesStock && Math.abs(ajust) >= 0.05 ? note(`Sorties : ${t1(tot.conso)} t distribuées aux lots, ${t1(ajust)} t d'ajustements d'inventaire.`) : '')
    + (lignesStock ? note('Entrées = stock de départ au 01/09 + récoltes + achats. Stock = journal des mouvements rejoué.') : '');
  if (!coupes.length) s3 += tableau('Récoltes fourragères par coupe', ['Coupe', 'ha', 't/ha', 't'],
    '<tr><td colspan="4" class="na">Aucune récolte enregistrée sur la campagne.</td></tr>', 'rap-coupes-reel');
  else {
    const conflits = [];
    let lignesC = '';
    let totalT = 0;
    coupes.forEach((c) => {
      lignesC += `<tr class="grp"><td colspan="4">${esc(c.culture)}</td></tr>`;
      c.coupes.forEach((cp) => {
        if (cp.estimee) estimee = true;
        totalT += cp.tonnes;
        cp.conflits.forEach((k) => conflits.push(`${esc(k.nom)} (${ORDINAL(cp.numero)} ${esc(c.culture.toLowerCase())}) : ${k.valeurs.map(ha2).join(' / ')} ha, ${ha2(k.valeurs[0])} ha retenus`));
        lignesC += `<tr><td>${ORDINAL(cp.numero)}</td><td>${t1(cp.surfaceHa)}${et(cp.estimee)}</td><td>${cp.tHa == null ? '—' : t1(cp.tHa) + et(cp.estimee)}</td><td>${t1(cp.tonnes)}</td></tr>`;
      });
    });
    s3 += tableau('Récoltes fourragères par coupe', ['Coupe', 'ha', 't/ha', 't'],
      lignesC + `<tr class="tot"><td>Total récolté</td><td></td><td></td><td>${t1(totalT)}</td></tr>`, 'rap-coupes-reel')
      + (conflits.length ? note('Surfaces différentes déclarées pour une même coupe : ' + conflits.join(' ; ') + '.') : '');
  }

  docRealEl.innerHTML = entete(`Bilan réalisé — campagne ${camp}`, `Arrêté au ${dateFr(arreteAu(stocks))}`,
    'Source : activités enregistrées et mouvements de stock. Comparé au prévisionnel de la campagne.')
    + section(1, 'Semis réalisés', s1)
    + section(2, 'Fertilisation réalisée', s2)
    + section(3, 'Bilan stocks', s3)
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
