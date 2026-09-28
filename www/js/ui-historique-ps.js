// Écran Paramètres → Historique PS : corrige en une fois les moissons déjà
// enregistrées avec un poidsSpecifique saisi mais jamais appliqué (cf.
// historique-ps.js/corriger-ps.js) — prévisualisation obligatoire, bouton
// unique "Corriger ces lignes", et chaque ligne reste annulable au cas par
// cas ensuite (aucune migration silencieuse, cf. CLAUDE.md).
import { getInterventions } from './interventions.js';
import { previsualiserHistoriquePs, appliquerHistoriquePs } from './historique-ps.js';
import { annulerCorrectionPs } from './corriger-ps.js';
import { toastSucces, toastErreur } from './toast.js';

const panelEl = document.getElementById('historique-ps-panel');
const listeEl = document.getElementById('historique-ps-liste');
const appliquerBtn = document.getElementById('historique-ps-appliquer');
const annulablesEl = document.getElementById('historique-ps-annulables');

let parcelles = [];
let dernierEcarts = [];

/** Branché depuis main.js, comme setParcellesCampagnes (ui-campagnes.js) :
 * seuls les noms de parcelles sont utiles ici, pour l'affichage. */
export function setParcellesHistoriquePs(list) {
  parcelles = (list || []).map((p) => ({ id: p.id, nom: p.nom || 'Sans nom' }));
}

function nomsParcelles(ids) {
  return (ids || [])
    .map((id) => (parcelles.find((p) => p.id === id) || {}).nom || id)
    .join(', ') || '—';
}

export function initHistoriquePs() {
  document.getElementById('btn-historique-ps-panel').addEventListener('click', () => {
    panelEl.hidden = false;
    dernierEcarts = previsualiserHistoriquePs(getInterventions());
    renderListe();
    renderAnnulables();
  });
  document.getElementById('historique-ps-panel-fermer').addEventListener('click', () => { panelEl.hidden = true; });

  appliquerBtn.addEventListener('click', async () => {
    if (!dernierEcarts.length) return;
    if (!confirm(`Corriger ${dernierEcarts.length} ligne(s) ? Chacune reste annulable ensuite, au cas par cas.`)) return;
    appliquerBtn.disabled = true;
    try {
      const n = dernierEcarts.length;
      await appliquerHistoriquePs(dernierEcarts);
      toastSucces(`${n} ligne(s) corrigée(s).`);
      dernierEcarts = [];
      renderListe();
      renderAnnulables();
    } catch (err) {
      toastErreur('Correction impossible : ' + ((err && err.message) || err));
    } finally {
      appliquerBtn.disabled = false;
    }
  });
}

function renderListe() {
  if (!dernierEcarts.length) {
    listeEl.innerHTML = '<p class="list-empty">Aucune ligne à corriger — l\'historique est déjà à jour.</p>';
    appliquerBtn.hidden = true;
    return;
  }
  listeEl.innerHTML = dernierEcarts.map((e) => `
    <div class="cat-card">
      <div class="cat-card-nom">${escapeHtml(nomsParcelles(e.parcelleIds))} — ${escapeHtml(e.typeNom)}</div>
      <div class="cat-card-detail">${escapeHtml(e.date)} : ${escapeHtml(String(e.ancienneQuantite ?? '—'))} t → ${escapeHtml(String(e.nouvelleQuantite))} t (PS ${escapeHtml(String(e.psSaisi))})</div>
    </div>`).join('');
  appliquerBtn.hidden = false;
  appliquerBtn.textContent = `Corriger ces ${dernierEcarts.length} ligne(s)`;
}

/** Moissons déjà corrigées (ps renseigné, quelle que soit l'origine de la
 * correction — cette page ou l'action "Corriger avec PS" du journal),
 * restaurables au cas par cas. */
function renderAnnulables() {
  const liste = getInterventions().filter((i) => i.saisie && i.saisie.ps != null);
  if (!liste.length) { annulablesEl.innerHTML = ''; return; }
  annulablesEl.innerHTML = `<h3 style="margin:18px 0 4px">Déjà corrigées</h3>
    <p class="apercu-sous-titre">Restaurable au cas par cas.</p>` +
    liste.map((i) => `
    <div class="cat-card" data-id="${escapeAttr(i.id)}">
      <div class="cat-card-nom">${escapeHtml(nomsParcelles(i.parcelleIds))} — ${escapeHtml(i.typeNom || '')}</div>
      <div class="cat-card-detail">${escapeHtml(i.date)} : PS ${escapeHtml(String(i.saisie.ps))}</div>
      <button type="button" class="btn btn-secondary btn-mini historique-ps-annuler-une" aria-label="Annuler">↩ Annuler</button>
    </div>`).join('');
  annulablesEl.querySelectorAll('.historique-ps-annuler-une').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.cat-card').dataset.id;
      btn.disabled = true;
      try {
        await annulerCorrectionPs(id);
        toastSucces('Correction annulée.');
        renderAnnulables();
      } catch (err) {
        toastErreur('Annulation impossible : ' + ((err && err.message) || err));
        btn.disabled = false;
      }
    });
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
