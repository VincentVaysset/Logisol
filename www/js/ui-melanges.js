// Paramètres > Mélanges de semis : consulter, créer, modifier, renommer et
// supprimer les mélanges enregistrés (melanges.js). Supprimer un mélange ne
// touche pas les semis déjà saisis : ils gardent leur copie de la composition.
import { getMelanges, onMelangesChange, watchMelanges, enregistrerMelange, supprimerMelange, texteComposition } from './melanges.js';
import { getInterventions } from './interventions.js';
import { toastSucces, toastErreur } from './toast.js';

const panelEl = document.getElementById('melanges-panel');
const listeEl = document.getElementById('melanges-liste');
let editionId = null; // id du mélange en cours d'édition, '__nouveau__' pour un nouveau

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nbSemis = (nom) => getInterventions().filter((i) => i.saisie && String(i.saisie.semence || '').trim().toLowerCase() === String(nom).trim().toLowerCase()).length;

export function initMelanges() {
  document.getElementById('btn-melanges-panel').addEventListener('click', () => {
    watchMelanges();
    editionId = null;
    panelEl.hidden = false;
    render();
  });
  document.getElementById('melanges-panel-fermer').addEventListener('click', () => { panelEl.hidden = true; });
  document.getElementById('melanges-nouveau').addEventListener('click', () => { editionId = '__nouveau__'; render(); });
  listeEl.addEventListener('click', clic);
  listeEl.addEventListener('input', (e) => { if (e.target.closest('.mel-edit')) majTotal(); });
  onMelangesChange(() => { if (!panelEl.hidden && !editionId) render(); });
}

function ligneComposant(nom = '', pct = '') {
  return `<div class="melange-ligne"><input type="text" class="melange-nom" placeholder="Espèce / variété" value="${esc(nom)}">
    <input type="number" class="melange-pct" step="1" min="0" max="100" inputmode="numeric" placeholder="%" value="${esc(pct)}">
    <button type="button" class="btn btn-secondary btn-mini" data-act="retirer-ligne" aria-label="Retirer">✕</button></div>`;
}

function formulaire(m) {
  const comp = m && m.composants && m.composants.length ? m.composants : [{ nom: '', pourcentage: '' }];
  return `<div class="cat-card mel-edit" data-id="${esc(m ? m.id : '__nouveau__')}">
    <input type="text" class="mel-nom" placeholder="Nom du mélange (ex. RGI + TV)" value="${esc(m ? m.nom : '')}" aria-label="Nom du mélange">
    <div class="mel-lignes">${comp.map((x) => ligneComposant(x.nom, x.pourcentage)).join('')}</div>
    <div class="melange-pied"><button type="button" class="btn btn-secondary btn-mini" data-act="ajouter-ligne">➕ Composant</button><span class="champ-aide mel-total"></span></div>
    <div class="melange-pied"><button type="button" class="btn btn-primary btn-mini" data-act="enregistrer">Enregistrer</button><button type="button" class="btn btn-secondary btn-mini" data-act="annuler">Annuler</button></div>
  </div>`;
}

function render() {
  const liste = getMelanges();
  let h = editionId === '__nouveau__' ? formulaire(null) : '';
  h += liste.map((m) => (m.id === editionId ? formulaire(m) : `<div class="cat-card" data-id="${esc(m.id)}">
      <div class="cat-card-nom">${esc(m.nom)}</div>
      <div class="cat-card-detail">${esc(texteComposition(m.composants)) || 'composition vide'}${nbSemis(m.nom) ? ` · ${nbSemis(m.nom)} semis` : ''}</div>
      <button type="button" class="btn btn-secondary btn-mini" data-act="modifier" aria-label="Modifier">✏️</button>
      <button type="button" class="btn btn-secondary btn-mini" data-act="supprimer" aria-label="Supprimer">🗑</button>
    </div>`)).join('');
  listeEl.innerHTML = h || '<p class="list-empty">Aucun mélange enregistré. Crée-en un ici, ou depuis un Semis avec « Enregistrer ce mélange ».</p>';
  majTotal();
}

function majTotal() {
  const f = listeEl.querySelector('.mel-edit');
  if (!f) return;
  const t = Array.from(f.querySelectorAll('.melange-pct')).reduce((n, i) => n + (Number(i.value) || 0), 0);
  f.querySelector('.mel-total').textContent = t ? `Total : ${t} %` : '';
}

async function clic(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const carte = b.closest('.cat-card');
  const id = carte && carte.dataset.id;
  const act = b.dataset.act;
  if (act === 'modifier') { editionId = id; render(); return; }
  if (act === 'annuler') { editionId = null; render(); return; }
  if (act === 'ajouter-ligne') { carte.querySelector('.mel-lignes').insertAdjacentHTML('beforeend', ligneComposant()); return; }
  if (act === 'retirer-ligne') { b.closest('.melange-ligne').remove(); majTotal(); return; }
  if (act === 'enregistrer') {
    const composants = Array.from(carte.querySelectorAll('.melange-ligne')).map((l) => ({
      nom: l.querySelector('.melange-nom').value, pourcentage: Number(l.querySelector('.melange-pct').value) || 0 }));
    b.disabled = true;
    try {
      await enregistrerMelange({ id: id === '__nouveau__' ? null : id, nom: carte.querySelector('.mel-nom').value, composants });
      editionId = null;
      toastSucces('Mélange enregistré.');
      render();
    } catch (err) {
      toastErreur((err && err.message) || String(err));
      b.disabled = false;
    }
    return;
  }
  if (act === 'supprimer') {
    const m = getMelanges().find((x) => x.id === id);
    if (!m || !confirm(`Supprimer le mélange « ${m.nom} » ?\nLes semis déjà saisis gardent leur composition.`)) return;
    try { await supprimerMelange(id); toastSucces('Mélange supprimé.'); } catch (err) { toastErreur('Suppression impossible : ' + ((err && err.message) || err)); }
  }
}
