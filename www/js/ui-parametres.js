// Écran Paramètres → Référentiel Cultures : gestion manuelle du catalogue
// RÉEL des cultures (cultures_config — nom, couleur, famille, utilisé par la
// carte/fiche parcelle/semis). Ce catalogue reste séparé du référentiel
// PRÉVISIONNEL indexé par âge (assolement-previsionnel.js/CULTURES_PREV :
// Luz 0, RG trèfle 1...) — les deux ne se fondent jamais (cf. CLAUDE.md).
// Ajouter/renommer/supprimer une culture ici ne touche ni ne remplace ce
// second référentiel ; c'est l'harmonisation faite par ui-intervention.js
// (proposition automatique de culture au semis) qui relie les deux, par le
// NOM, sans jamais les fusionner en une seule liste.
import { getCultures, onCulturesChange, addCulture, renameCulture, deleteCulture } from './cultures-config.js';
import { getImplantations } from './implantations.js';
import { toastSucces, toastErreur } from './toast.js';

const panelEl = document.getElementById('cultures-panel');
const listeEl = document.getElementById('cultures-liste');
const nouveauNomEl = document.getElementById('cultures-nouveau-nom');

let editingId = null;

export function initParametresCultures() {
  document.getElementById('btn-cultures-panel').addEventListener('click', () => {
    panelEl.hidden = false;
    editingId = null;
    render();
  });
  document.getElementById('cultures-panel-fermer').addEventListener('click', () => { panelEl.hidden = true; });
  document.getElementById('cultures-nouveau-add').addEventListener('click', async () => {
    const nom = nouveauNomEl.value.trim();
    if (!nom) { toastErreur('Donne un nom à la culture.'); return; }
    try {
      await addCulture(nom, '#5b8c5a', 'autre');
      nouveauNomEl.value = '';
      toastSucces('Culture ajoutée.');
      render();
    } catch (err) {
      toastErreur('Culture non ajoutée : ' + ((err && err.message) || err));
    }
  });
  // Reflète tout changement venu d'ailleurs (un autre appareil, le "+
  // Nouvelle culture" du tunnel d'activité) tant que le panneau est ouvert.
  onCulturesChange(() => { if (!panelEl.hidden) render(); });
}

function nombreImplantations(cultureId) {
  return getImplantations().filter((i) => i.cultureId === cultureId).length;
}

function render() {
  const liste = getCultures().slice().sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
  if (!liste.length) {
    listeEl.innerHTML = '<p class="list-empty">Aucune culture enregistrée.</p>';
    return;
  }
  listeEl.innerHTML = liste.map((c) => {
    if (c.id === editingId) {
      return `<div class="cat-card" data-id="${escapeAttr(c.id)}">
        <span class="pastille" style="background:${escapeAttr(c.couleur || '#9a988f')}"></span>
        <input type="text" class="cultures-input-nom" value="${escapeAttr(c.nom || '')}" aria-label="Nouveau nom">
        <button type="button" class="btn btn-primary btn-mini cultures-ok" aria-label="Enregistrer">✔</button>
        <button type="button" class="btn btn-secondary btn-mini cultures-annuler" aria-label="Annuler">✕</button>
      </div>`;
    }
    const n = nombreImplantations(c.id);
    return `<div class="cat-card" data-id="${escapeAttr(c.id)}">
      <span class="pastille" style="background:${escapeAttr(c.couleur || '#9a988f')}"></span>
      <div class="cat-card-nom">${escapeHtml(c.nom || '')}</div>
      <div class="cat-card-detail">${n ? `${n} implantation${n > 1 ? 's' : ''}` : 'inutilisée'}</div>
      <button type="button" class="btn btn-secondary btn-mini cultures-renommer" aria-label="Renommer">✏️</button>
      <button type="button" class="btn btn-secondary btn-mini cultures-supprimer" aria-label="Supprimer">🗑</button>
    </div>`;
  }).join('');

  listeEl.querySelectorAll('.cultures-renommer').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingId = btn.closest('.cat-card').dataset.id;
      render();
      const input = listeEl.querySelector('.cultures-input-nom');
      if (input) { input.focus(); input.select(); }
    });
  });
  listeEl.querySelectorAll('.cultures-annuler').forEach((btn) => {
    btn.addEventListener('click', () => { editingId = null; render(); });
  });
  listeEl.querySelectorAll('.cultures-ok').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const carte = btn.closest('.cat-card');
      const id = carte.dataset.id;
      const nom = carte.querySelector('.cultures-input-nom').value;
      btn.disabled = true;
      try {
        await renameCulture(id, nom);
        editingId = null;
        toastSucces('Culture renommée.');
        render();
      } catch (err) {
        toastErreur('Renommage impossible : ' + ((err && err.message) || err));
        btn.disabled = false;
      }
    });
  });
  listeEl.querySelectorAll('.cultures-supprimer').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const carte = btn.closest('.cat-card');
      const id = carte.dataset.id;
      const c = liste.find((x) => x.id === id);
      const n = nombreImplantations(id);
      if (n) {
        toastErreur(`« ${c ? c.nom : 'Cette culture'} » est utilisée par ${n} implantation${n > 1 ? 's' : ''} — renomme-la plutôt que de la supprimer.`);
        return;
      }
      if (!confirm(`Supprimer définitivement la culture « ${c ? c.nom : ''} » ? Action irréversible.`)) return;
      try {
        await deleteCulture(id);
        toastSucces('Culture supprimée.');
        render();
      } catch (err) {
        toastErreur('Suppression impossible : ' + ((err && err.message) || err));
      }
    });
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
