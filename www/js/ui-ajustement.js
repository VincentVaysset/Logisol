// Ajustement de stock sur UN aliment : l'exploitant compte le stock réel à une
// date (fin de journée) ; l'écart avec le stock théorique de l'appli devient
// un mouvement AJUSTEMENT (mouvements.js), daté, supprimable, jamais compté
// comme consommation. L'Inventaire fait la même chose sur tous les aliments.
import { createMouvement } from './mouvements.js';
import { formatTonnes } from './ui-stocks.js';
import { toastSucces } from './toast.js';
import { aujourdhuiIso } from './campagne-stock.js';

const ids = ['panel', 'aliment', 'date', 'theorique', 'reel', 'reel-label', 'ecart', 'note', 'erreur', 'valider', 'annuler'];
const el = {};
ids.forEach((k) => { el[k] = document.getElementById('ajust-' + k); });

let lignes = [];
let theoriqueAu = () => 0;
let theorique = 0;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function arrondi3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }
function dateCourte(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }

function majCalcul() {
  const ligne = lignes.find((l) => l.cle === el.aliment.value);
  const date = el.date.value;
  theorique = ligne && date ? arrondi3(theoriqueAu(ligne.cle, date)) : 0;
  el.theorique.textContent = date ? `Stock théorique au ${dateCourte(date)} au soir : ${formatTonnes(theorique)} t` : '';
  el['reel-label'].textContent = `Réel au ${dateCourte(date) || '…'}, fin de journée (t)`;
  if (el.reel.value === '') { el.ecart.textContent = ''; return; }
  const ecart = arrondi3(Number(el.reel.value) - theorique);
  el.ecart.textContent = Math.abs(ecart) < 0.001 ? 'Aucun écart' : `Écart : ${ecart > 0 ? '+' : ''}${formatTonnes(ecart)} t`;
  el.ecart.className = 'stk-ecart ' + (Math.abs(ecart) < 0.001 ? '' : ecart > 0 ? 'stk-ecart-plus' : 'stk-ecart-moins');
}

/**
 * @param {{lignes:Array<{cle,libelle,label}>, date?:string, theoriqueAu:(cle,date)=>number}} p
 */
export function ouvrirAjustement(p) {
  lignes = p.lignes || [];
  theoriqueAu = p.theoriqueAu;
  el.aliment.innerHTML = lignes.map((l) => `<option value="${esc(l.cle)}">${esc(l.libelle)}</option>`).join('');
  el.date.max = aujourdhuiIso();
  el.date.value = p.date || aujourdhuiIso();
  el.reel.value = '';
  el.note.value = '';
  el.erreur.hidden = true;
  el.panel.hidden = false;
  majCalcul();
}

function fermer() { el.panel.hidden = true; }

async function valider() {
  el.erreur.hidden = true;
  const ligne = lignes.find((l) => l.cle === el.aliment.value);
  try {
    if (!ligne) throw new Error('Choisis un aliment.');
    if (!el.date.value || el.date.value > aujourdhuiIso()) throw new Error('Date de comptage invalide (pas dans le futur).');
    if (el.reel.value === '' || Number(el.reel.value) < 0) throw new Error('Indique le stock réel compté.');
    majCalcul();
    const ecart = arrondi3(Number(el.reel.value) - theorique);
    if (Math.abs(ecart) < 0.001) throw new Error('Aucun écart : rien à enregistrer.');
    el.valider.disabled = true;
    await createMouvement({
      date: el.date.value, typeMouvement: 'AJUSTEMENT', quantite: ecart, unite: 't',
      categorieCle: ligne.cle, categorieLabel: ligne.label || ligne.libelle,
      libelle: el.note.value.trim() || `Ajustement (réel ${formatTonnes(Number(el.reel.value))} t)`
    });
    toastSucces(`Ajustement enregistré : ${ecart > 0 ? '+' : ''}${formatTonnes(ecart)} t.`);
    fermer();
  } catch (err) {
    el.erreur.textContent = (err && err.message) || String(err);
    el.erreur.hidden = false;
  } finally {
    el.valider.disabled = false;
  }
}

['aliment', 'date'].forEach((k) => el[k].addEventListener('change', majCalcul));
el.reel.addEventListener('input', majCalcul);
el.valider.addEventListener('click', valider);
el.annuler.addEventListener('click', fermer);
