// Écran Paramètres → Campagnes agricoles : deux réglages qui alimentent
// campagnes.js/calculerCampagnes, LA seule fonction qui décide de la
// campagne d'une activité (saisie, journal, filtres, assolement, bilans) —
// (1) quels types d'intervention font basculer la campagne (pivot) et
// lesquels réarment la bascule (récolte), (2) la reprise de l'historique
// déjà enregistré avec la règle actuelle.
import { getTypes, onTypesChange, pivotCampagneDe, recolteCampagneDe, setPivotRecolte } from './interventions-types.js';
import { getInterventions } from './interventions.js';
import { previsualiserReprise, appliquerReprise, annulerReprise } from './reprise-campagnes.js';
import { toastSucces, toastErreur } from './toast.js';

const panelEl = document.getElementById('campagnes-panel');
const typesListeEl = document.getElementById('campagnes-types-liste');
const repriseListeEl = document.getElementById('campagnes-reprise-liste');
const repriseAppliquerBtn = document.getElementById('campagnes-reprise-appliquer');
const annulablesEl = document.getElementById('campagnes-reprise-annulables');

let parcelles = [];
let dernierEcarts = [];
let previsualisationFaite = false;

/** Branché depuis main.js, comme setParcellesDisponibles (ui-intervention.js) :
 * seuls les noms de parcelles sont utiles ici, pour l'affichage de la reprise. */
export function setParcellesCampagnes(list) {
  parcelles = (list || []).map((p) => ({ id: p.id, nom: p.nom || 'Sans nom' }));
}

function nomParcelle(id) {
  const p = parcelles.find((x) => x.id === id);
  return p ? p.nom : (id || '—');
}

export function initParametresCampagnes() {
  document.getElementById('btn-campagnes-panel').addEventListener('click', () => {
    panelEl.hidden = false;
    renderTypes();
    dernierEcarts = [];
    previsualisationFaite = false;
    renderReprise();
    renderAnnulables();
  });
  document.getElementById('campagnes-panel-fermer').addEventListener('click', () => { panelEl.hidden = true; });

  document.getElementById('campagnes-reprise-previsualiser').addEventListener('click', () => {
    try {
      dernierEcarts = previsualiserReprise(getInterventions());
      previsualisationFaite = true;
      renderReprise();
    } catch (err) {
      toastErreur('Prévisualisation impossible : ' + ((err && err.message) || err));
    }
  });

  repriseAppliquerBtn.addEventListener('click', async () => {
    if (!dernierEcarts.length) return;
    if (!confirm(`Appliquer ${dernierEcarts.length} changement(s) de campagne ? Chaque ancienne valeur reste restaurable (section « Déjà appliquées » ci-dessous).`)) return;
    repriseAppliquerBtn.disabled = true;
    try {
      const n = dernierEcarts.length;
      await appliquerReprise(dernierEcarts);
      toastSucces(`${n} activité(s) mise(s) à jour.`);
      dernierEcarts = [];
      previsualisationFaite = true;
      renderReprise();
      renderAnnulables();
    } catch (err) {
      toastErreur('Application impossible : ' + ((err && err.message) || err));
    } finally {
      repriseAppliquerBtn.disabled = false;
    }
  });

  // Reflète tout changement venu d'ailleurs (un autre appareil) tant que le
  // panneau est ouvert — même principe que ui-parametres.js/onCulturesChange.
  onTypesChange(() => { if (!panelEl.hidden) renderTypes(); });
}

function renderTypes() {
  const liste = getTypes().slice().sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
  if (!liste.length) {
    typesListeEl.innerHTML = '<p class="list-empty">Aucun type d\'intervention.</p>';
    return;
  }
  typesListeEl.innerHTML = liste.map((t) => `
    <div class="cat-card" data-id="${escapeAttr(t.id)}">
      <span class="pastille" style="background:${escapeAttr(t.couleur || '#9a988f')}"></span>
      <div class="cat-card-nom">${escapeHtml(t.icone || '')} ${escapeHtml(t.nom)}</div>
      <label class="campagnes-check"><input type="checkbox" class="campagnes-pivot" ${pivotCampagneDe(t) ? 'checked' : ''}> Pivot</label>
      <label class="campagnes-check"><input type="checkbox" class="campagnes-recolte" ${recolteCampagneDe(t) ? 'checked' : ''}> Récolte</label>
    </div>`).join('');

  typesListeEl.querySelectorAll('.cat-card').forEach((carte) => {
    const id = carte.dataset.id;
    const pivotEl = carte.querySelector('.campagnes-pivot');
    const recolteEl = carte.querySelector('.campagnes-recolte');
    const ecrire = async () => {
      pivotEl.disabled = true; recolteEl.disabled = true;
      try {
        await setPivotRecolte(id, { pivotCampagne: pivotEl.checked, recolteCampagne: recolteEl.checked });
        toastSucces('Enregistré.');
      } catch (err) {
        toastErreur('Enregistrement impossible : ' + ((err && err.message) || err));
      } finally {
        pivotEl.disabled = false; recolteEl.disabled = false;
      }
    };
    pivotEl.addEventListener('change', ecrire);
    recolteEl.addEventListener('change', ecrire);
  });
}

function renderReprise() {
  if (!dernierEcarts.length) {
    repriseListeEl.innerHTML = previsualisationFaite
      ? '<p class="list-empty">Aucun écart — l\'historique est déjà cohérent avec la règle actuelle.</p>'
      : '<p class="list-empty">Touche « Prévisualiser » pour comparer l\'historique à la règle actuelle.</p>';
    repriseAppliquerBtn.hidden = true;
    return;
  }
  repriseListeEl.innerHTML = dernierEcarts.map((e) => `
    <div class="cat-card" data-id="${escapeAttr(e.activiteId)}">
      <div class="cat-card-nom">${escapeHtml(nomParcelle(e.parcelleId))} — ${escapeHtml(e.typeNom)}</div>
      <div class="cat-card-detail">${escapeHtml(e.date)} : ${escapeHtml(e.ancienneCampagne || '—')} → ${escapeHtml(e.nouvelleCampagne)}</div>
    </div>`).join('');
  repriseAppliquerBtn.hidden = false;
  repriseAppliquerBtn.textContent = `✔ Appliquer les ${dernierEcarts.length} changement(s)`;
}

/** Activités déjà reprises (campagneAvantReprise porté), restaurables une
 * par une — la trace que reprise-campagnes.js garde précisément pour ça. */
function renderAnnulables() {
  const liste = getInterventions().filter((i) => i.campagneAvantReprise != null);
  if (!liste.length) { annulablesEl.innerHTML = ''; return; }
  annulablesEl.innerHTML = `<h3 style="margin:18px 0 4px">Déjà appliquées</h3>
    <p class="apercu-sous-titre">Restaurable au cas par cas.</p>` +
    liste.map((i) => `
    <div class="cat-card" data-id="${escapeAttr(i.id)}">
      <div class="cat-card-nom">${escapeHtml(nomParcelle((i.parcelleIds || [])[0]))} — ${escapeHtml(i.typeNom || '')}</div>
      <div class="cat-card-detail">${escapeHtml(i.date)} : ${escapeHtml(i.campagneAvantReprise)} → ${escapeHtml(i.campagneId)}</div>
      <button type="button" class="btn btn-secondary btn-mini campagnes-annuler-une" aria-label="Annuler">↩ Annuler</button>
    </div>`).join('');
  annulablesEl.querySelectorAll('.campagnes-annuler-une').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.cat-card').dataset.id;
      btn.disabled = true;
      try {
        await annulerReprise(id, getInterventions());
        toastSucces('Campagne restaurée.');
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
