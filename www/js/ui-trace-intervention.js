// Barre d'outils du traçage GPS en direct (trace-intervention.js) — même
// principe hors carte que les autres modes (#draw-toolbar, #releve-toolbar) :
// jamais recouverte par la carte ou un calque en cours de tracé.
import { demarrerTrace, arreterTrace, definirLargeur, getResultat } from './trace-intervention.js';
import { getMateriels } from './materiel.js';

const toolbarEl = document.getElementById('trace-toolbar');
const materielSelectEl = document.getElementById('trace-materiel-select');
const distanceEl = document.getElementById('trace-distance');
const surfaceEl = document.getElementById('trace-surface');
const btnFinish = document.getElementById('btn-trace-finish');
const btnCancel = document.getElementById('btn-trace-cancel');

let onTermine = () => {};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function peuplerMateriels(materielId) {
  const liste = getMateriels();
  materielSelectEl.innerHTML = '<option value="">— Sans largeur (tracé filaire) —</option>' +
    liste.map((m) => (
      `<option value="${m.id}">${escapeHtml(m.nom)}${m.largeurTravailMetres ? ' (' + m.largeurTravailMetres + ' m)' : ''}</option>`
    )).join('');
  if (materielId && liste.some((m) => m.id === materielId)) materielSelectEl.value = materielId;
}

function largeurDuMaterielChoisi() {
  const liste = getMateriels();
  const m = liste.find((x) => x.id === materielSelectEl.value);
  return m ? m.largeurTravailMetres : null;
}

/**
 * Ouvre la barre d'outils et démarre le tracé. opts.largeurM : largeur du
 * matériel déjà choisi dans le tunnel d'intervention (ou null -> filaire).
 * opts.onTermine(resultat) : rappelé à la fermeture, resultat = null si
 * annulé, sinon { surfaceHa, distanceM, modeFilaire } (trace-intervention.js).
 */
export function ouvrirTrace({ largeurM, materielId, onTermine: cb }) {
  onTermine = cb || (() => {});
  peuplerMateriels(materielId);
  toolbarEl.hidden = false;
  demarrerTrace(largeurM);
}

function fermer(resultat) {
  toolbarEl.hidden = true;
  arreterTrace();
  onTermine(resultat);
}

export function initTraceUi() {
  materielSelectEl.addEventListener('change', () => definirLargeur(largeurDuMaterielChoisi()));

  btnFinish.addEventListener('click', () => fermer(getResultat()));
  btnCancel.addEventListener('click', () => fermer(null));
}

/** Reflète l'état du tracé (appelé par trace-intervention.js à chaque fix GPS). */
export function majEtatTrace({ distanceM, surfaceHa, dureeMin, modeFilaire }) {
  distanceEl.textContent = `${distanceM} m · ${dureeMin} min`;
  surfaceEl.textContent = modeFilaire ? '(tracé filaire, pas de largeur)' : `${surfaceHa} ha couverts`;
}
