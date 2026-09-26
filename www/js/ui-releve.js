// Panneau de fin de relevé de contour (www/js/releve-contour.js) : une fois
// le tracé terminé (≥ 3 points), choix explicite de la destination — jamais
// automatique, cf. CLAUDE.md ("toute action irréversible s'annonce avant
// d'être appliquée"). Écrit dans Firestore via les mêmes fonctions que le
// reste de l'appli (updateParcelle pour une parcelle existante, openCreate
// pour en pré-remplir une nouvelle — exactement le même formulaire que pour
// une parcelle dessinée à la main, cf. main.js/onPolygonReady).
import { updateParcelle } from './parcelles.js';
import { openCreate } from './ui.js';
import { libelleBadge } from './gps.js';

const panelEl = document.getElementById('releve-fin-panel');
const resumeEl = document.getElementById('releve-fin-resume');
const formEl = document.getElementById('releve-fin-form');
const selectWrapEl = document.getElementById('releve-fin-select-wrap');
const selectEl = document.getElementById('releve-fin-select');
const errorBanner = document.getElementById('releve-fin-error-banner');
const errorText = document.getElementById('releve-fin-error-text');
const btnRetour = document.getElementById('releve-fin-retour');
const btnValider = document.getElementById('releve-fin-valider');

let parcelles = [];
let resultatCourant = null;
let onRetour = () => {};
let onTermine = () => {};

function showError(message) {
  errorText.textContent = message;
  errorBanner.hidden = false;
}
function hideError() {
  errorBanner.hidden = true;
  errorText.textContent = '';
}

function destinationChoisie() {
  const coche = formEl.querySelector('input[name="releve-destination"]:checked');
  return coche ? coche.value : 'nouvelle';
}

function peuplerSelect() {
  selectEl.innerHTML = parcelles
    .slice()
    .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'))
    .map((p) => `<option value="${p.id}">${escapeHtml(p.nom || 'Sans nom')}</option>`)
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function setParcellesReleve(list) {
  parcelles = list || [];
  peuplerSelect();
}

/**
 * Ouvre le panneau de fin de relevé. resultat = releve-contour.js/getResultat()
 * ({ geometry, surfaceHa, releveGps }).
 * @param {object} cb
 * @param {() => void} [cb.onRetour] appelé si l'utilisateur revient au tracé
 *   sans enregistrer (points conservés côté releve-contour.js, cf. main.js).
 * @param {() => void} [cb.onTermine] appelé juste après un enregistrement
 *   réussi (nouvelle parcelle ou mise à jour) — à main.js d'arrêter le
 *   relevé (GPS, calques carte) à ce moment-là.
 */
export function ouvrirFinReleve(resultat, cb = {}) {
  if (!resultat) return;
  resultatCourant = resultat;
  onRetour = cb.onRetour || (() => {});
  onTermine = cb.onTermine || (() => {});
  hideError();
  const precision = libelleBadge({ accuracy: resultat.releveGps && resultat.releveGps.accuracy });
  resumeEl.textContent =
    `Surface calculée : ${resultat.surfaceHa} ha — précision du relevé : ${precision.texte}.`;
  formEl.querySelector('input[value="nouvelle"]').checked = true;
  selectWrapEl.hidden = true;
  peuplerSelect();
  panelEl.hidden = false;
}

function fermer() {
  panelEl.hidden = true;
  resultatCourant = null;
}

export function initReleveUi() {
  document.getElementById('releve-fin-error-close').addEventListener('click', hideError);

  formEl.querySelectorAll('input[name="releve-destination"]').forEach((r) => {
    r.addEventListener('change', () => {
      selectWrapEl.hidden = destinationChoisie() !== 'existante';
    });
  });

  btnRetour.addEventListener('click', () => {
    fermer();
    onRetour();
  });

  btnValider.addEventListener('click', async () => {
    if (!resultatCourant) return;
    hideError();
    const { geometry, surfaceHa, releveGps } = resultatCourant;
    btnValider.disabled = true;
    try {
      if (destinationChoisie() === 'existante') {
        const id = selectEl.value;
        if (!id) throw new Error('Choisis la parcelle à mettre à jour.');
        await updateParcelle(id, { coordonnees: geometry, surfaceHa, releveGps });
        fermer();
        onTermine();
      } else {
        fermer();
        onTermine();
        // Même fiche que pour une parcelle dessinée à la main (ui.js/openCreate) :
        // l'exploitant complète nom/culture/vocation avant écriture réelle,
        // le relevé n'a fait qu'en calculer le contour et la surface.
        openCreate({ geometry, surfaceHa, croise: false, releveGps });
      }
    } catch (err) {
      showError((err && err.message) || 'Enregistrement impossible.');
    } finally {
      btnValider.disabled = false;
    }
  });
}
