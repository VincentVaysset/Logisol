// Écran Inventaire (Stocks > 📋 Inventaire). Le calcul est dans
// inventaire-calc.js (pur, testé) ; ici : la saisie, l'affichage ligne à
// ligne (théorique, flux depuis le 31/08, stock déduit, écart) et l'appel à
// clotures-stock.js/enregistrerInventaire.
import { stockAuSoir, enregistrerInventaire } from './clotures-stock.js';
import { calculerLigne, campagneACloturer } from './inventaire-calc.js';
import { GROUPES, groupeDeCle, libelleLigne, lireCle } from './groupes-stock.js';
import { getCloture } from './verrou-campagne.js';
import { bornesCampagneStock, campagneStockSuivante, aujourdhuiIso } from './campagne-stock.js';
import { renderSortiesManuelles } from './ui-rations.js';
import { formatTonnes, metaParCle } from './ui-stocks.js';
import { toastSucces } from './toast.js';

const el = {};
['panel', 'retour', 'date', 'lignes', 'cloture', 'cloture-titre', 'cloture-texte', 'limite', 'erreur', 'valider']
  .forEach((k) => { el[k] = document.getElementById(k === 'panel' ? 'inventaire-panel' : 'inv-' + k); });

const saisies = new Map();     // cle -> valeur tapée (texte)
const confirmees = new Set();  // cles au stock déduit négatif confirmé
let lignes = [];               // [{cle, label, libelle, groupe, paille, calcul}]
let campagne = null;

const TITRES = { cereales: 'Céréales et concentrés' };

function dateCourte(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '…'; }
function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function signe(v) { return (v > 0 ? '+' : '') + formatTonnes(v); }

export function ouvrirInventaire({ cloture = false } = {}) {
  saisies.clear();
  confirmees.clear();
  el.date.max = aujourdhuiIso();
  el.date.value = aujourdhuiIso();
  el.cloture.checked = cloture;
  el.erreur.hidden = true;
  el.panel.hidden = false;
  calculer();
  renderSortiesManuelles();
}

function fermer() { el.panel.hidden = true; }

function calculer() {
  preparer();
  render(el.date.value, el.cloture.checked);
}

// Calcule les lignes sans toucher à l'écran (frappe dans un champ : seule la
// ligne concernée est redessinée, le clavier du téléphone reste ouvert).
function preparer() {
  const C = el.date.value;
  campagne = campagneACloturer(C);
  const fin = bornesCampagneStock(campagne).fin;
  const cl = getCloture(campagne);
  const dejaCloturee = !!(cl && cl.statut === 'cloturee');
  if (dejaCloturee) el.cloture.checked = false;
  el.cloture.disabled = dejaCloturee;
  el['cloture-titre'].textContent = dejaCloturee
    ? `Campagne ${campagne} déjà clôturée`
    : `${cl && cl.statut === 'reouverte' ? 'Clôturer à nouveau' : 'Clôturer'} la campagne ${campagne}`;
  el['cloture-texte'].textContent = dejaCloturee
    ? `Comptage du ${dateFr(cl.dateComptage)}. Réouvre-la depuis Stocks pour la corriger.`
    : `Inventaire au 31/08. Le bilan est figé et le stock réel devient le stock de départ de ${campagneStockSuivante(campagne)} (au 01/09).`;
  const cloture = el.cloture.checked;
  el.limite.hidden = !cloture;

  const tC = new Map(stockAuSoir(C).map((g) => [g.cle, g]));
  const t31 = new Map(stockAuSoir(fin).map((g) => [g.cle, g]));
  const meta = metaParCle();
  const cles = new Set();
  tC.forEach((g, cle) => { if (Math.abs(g.tonnes) > 0.0005) cles.add(cle); });
  if (cloture) t31.forEach((g, cle) => { if (Math.abs(g.tonnes) > 0.0005) cles.add(cle); });
  saisies.forEach((v, cle) => cles.add(cle));

  lignes = Array.from(cles).map((cle) => {
    const g = tC.get(cle) || t31.get(cle) || { label: cle };
    const paille = lireCle(cle).type === 'paille';
    const m = meta.get(cle) || {};
    const calcul = calculerLigne({
      theoriqueC: tC.has(cle) ? tC.get(cle).tonnes : 0,
      theorique31: t31.has(cle) ? t31.get(cle).tonnes : 0,
      saisie: saisies.has(cle) ? saisies.get(cle) : null,
      paille, cloture
    });
    return { cle, label: g.label, libelle: libelleLigne(cle, g.label, m), groupe: groupeDeCle(cle, m), paille, calcul,
             theoriqueC: tC.has(cle) ? tC.get(cle).tonnes : 0, theorique31: t31.has(cle) ? t31.get(cle).tonnes : 0 };
  });
}

function render(C, cloture) {
  const sections = GROUPES.map((g) => {
    const ls = lignes.filter((l) => l.groupe === g.id).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
    if (!ls.length) return '';
    return `<h3 class="stk-section">${esc(TITRES[g.id] || g.nom)}</h3>
      <div class="stk-carte">${ls.map((l) => ligneHtml(l, C, cloture)).join('')}</div>`;
  }).join('');
  el.lignes.innerHTML = sections || '<p class="list-empty">Aucun stock à compter à cette date.</p>';
  el.lignes.querySelectorAll('input[data-cle]').forEach((input) => {
    input.addEventListener('input', () => {
      const cle = input.dataset.cle;
      if (input.value === '') saisies.delete(cle); else saisies.set(cle, input.value);
      preparer();
      const l = lignes.find((x) => x.cle === cle);
      const ligne = input.closest('.inv-ligne');
      if (!l || !ligne) return;
      ligne.classList.toggle('inv-ligne-bloquante', l.calcul.bloquant);
      ligne.querySelector('.inv-ligne-g').innerHTML = partieGauche(l, el.date.value, el.cloture.checked);
      cablerConfirmations(ligne);
    });
  });
  cablerConfirmations(el.lignes);
}

function cablerConfirmations(racine) {
  racine.querySelectorAll('input[data-confirme]').forEach((cb) => {
    cb.addEventListener('change', () => { if (cb.checked) confirmees.add(cb.dataset.confirme); else confirmees.delete(cb.dataset.confirme); });
  });
}

function partieGauche(l, C, cloture) {
  const c = l.calcul;
  const paille31 = cloture && l.paille;
  const theo = paille31
    ? `Théorique au 31/08 : ${formatTonnes(l.theorique31)} t`
    : `Théorique au ${dateCourte(C)} : ${formatTonnes(l.theoriqueC)} t`;
  const flux = cloture && !l.paille ? `<span class="inv-theo">Flux 31/08 → ${dateCourte(C)} : ${signe(c.flux)} t</span>` : '';
  let ecart = '<span class="inv-ecart">Aucun écart</span>';
  if (c.saisi) {
    const cls = Math.abs(c.ecart) < 0.001 ? '' : c.ecart > 0 ? ' inv-ecart-plus' : ' inv-ecart-moins';
    const quand = cloture ? ' au 31/08' : '';
    const deduit = cloture && !l.paille ? `Stock déduit au 31/08 : ${formatTonnes(c.deduit31)} t · ` : '';
    ecart = `<span class="inv-ecart${cls}">${deduit}${Math.abs(c.ecart) < 0.001 ? 'Aucun écart' : `Écart${quand} : ${signe(c.ecart)} t`}</span>`;
  }
  const bloquant = c.bloquant ? `<label class="inv-bloquant"><input type="checkbox" data-confirme="${esc(l.cle)}"${confirmees.has(l.cle) ? ' checked' : ''}>
      Stock déduit négatif : une saisie depuis le 31/08 est sans doute fausse. Je confirme quand même.</label>` : '';
  return `<span class="inv-nom">${esc(l.libelle)}</span><span class="inv-theo">${theo}</span>${flux}${ecart}${bloquant}`;
}

function ligneHtml(l, C, cloture) {
  const c = l.calcul;
  const paille31 = cloture && l.paille;
  const placeholder = String(Math.round((paille31 ? l.theorique31 : l.theoriqueC) * 10) / 10);
  const etiquette = paille31 ? 'stock au 31/08' : `réel au ${dateCourte(C)}, fin de journée`;
  return `<div class="inv-ligne${c.bloquant ? ' inv-ligne-bloquante' : ''}">
    <div class="inv-ligne-g">${partieGauche(l, C, cloture)}</div>
    <div class="inv-saisie"><span><input type="number" step="0.1" min="0" inputmode="decimal" data-cle="${esc(l.cle)}"
      value="${esc(saisies.has(l.cle) ? saisies.get(l.cle) : '')}" placeholder="${esc(placeholder)}"> t</span>
      <span class="inv-saisie-label">${etiquette}</span></div>
  </div>`;
}

async function valider() {
  el.erreur.hidden = true;
  const C = el.date.value;
  const cloture = el.cloture.checked;
  try {
    if (!C || C > aujourdhuiIso()) throw new Error('Date de comptage invalide (pas dans le futur).');
    calculer();
    const bloquees = lignes.filter((l) => l.calcul.bloquant && !confirmees.has(l.cle));
    if (bloquees.length) {
      throw new Error(`Stock déduit au 31/08 négatif : ${bloquees.map((l) => l.libelle).join(', ')}. ` +
        'Corrige la saisie fautive depuis le 31/08, ou confirme la ligne.');
    }
    const ecarts = lignes.filter((l) => Math.abs(l.calcul.ecart) >= 0.001);
    if (!cloture && !ecarts.length) throw new Error('Aucun écart à enregistrer.');
    if (cloture) {
      const ok = confirm(`Clôturer la campagne ${campagne} au 31/08 ?\n` +
        `${ecarts.length} ajustement(s) daté(s) du 31/08. Les stocks au 31/08 deviennent le départ de ${campagneStockSuivante(campagne)}, ` +
        'et les saisies jusqu\'au 31/08 sont verrouillées (réouverture possible).');
      if (!ok) return;
    }
    el.valider.disabled = true;
    const r = await enregistrerInventaire({ dateComptage: C, cloture, campagne: cloture ? campagne : null, lignes });
    toastSucces(cloture
      ? `Campagne ${campagne} clôturée (${r.nbAjustements} ajustement(s)).`
      : `${r.nbAjustements} ajustement(s) enregistré(s).`);
    fermer();
  } catch (err) {
    el.erreur.textContent = (err && err.message) || String(err);
    el.erreur.hidden = false;
  } finally {
    el.valider.disabled = false;
  }
}

el.retour.addEventListener('click', fermer);
el.date.addEventListener('change', calculer);
el.cloture.addEventListener('change', calculer);
el.valider.addEventListener('click', valider);
