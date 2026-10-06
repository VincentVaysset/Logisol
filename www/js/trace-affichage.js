// Affichage des tracés enregistrés (lgs_traces) sur la carte : depuis la
// fiche d'une activité (« Voir le tracé ») ou la liste « Tracés » d'une
// parcelle (afficher / masquer). Couleur = celle du type d'activité. Option
// « Largeur de l'outil » : le trait prend la largeur réelle de l'outil à
// l'échelle de la carte, ce qui montre la surface couverte (recouvrements
// compris) ; sinon, un simple trait.
import { getMap } from './map.js';
import { lireTrace } from './traces.js';
import { morceauxContinus } from './trace-points-calc.js';

const COULEUR_DEFAUT = '#2563eb';
const affichees = new Map();   // id -> { groupe, lignes, largeurM, couleur, points, coupures, titre }
let modeLargeur = false;
let controle = null;
let retourEnCours = null;      // rappel « Retour à l'activité » (Voir le tracé)
const abonnes = new Set();

function notifier() { abonnes.forEach((f) => { try { f(); } catch (_) { /* jamais bloquant */ } }); }
export function onTracesAfficheesChange(f) { abonnes.add(f); return () => abonnes.delete(f); }

function metresParPixel(map) {
  const lat = map.getCenter().lat;
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom() + 8);
}

function epaisseur(map, t) {
  if (modeLargeur && t.largeurM) return Math.max(2, t.largeurM / metresParPixel(map));
  return 4;
}

function majStyles() {
  const map = getMap();
  if (!map) return;
  affichees.forEach((t) => t.lignes.forEach((l) => l.setStyle({
    weight: epaisseur(map, t),
    opacity: modeLargeur && t.largeurM ? 0.45 : 0.9,
    lineCap: modeLargeur && t.largeurM ? 'butt' : 'round'
  })));
}

function majControle() {
  const map = getMap();
  if (!map) return;
  if (!controle) {
    const Ctrl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'traces-ctrl');
        div.id = 'traces-ctrl';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      }
    });
    controle = new Ctrl().addTo(map);
    map.on('zoomend', majStyles);
  }
  const div = controle.getContainer();
  div.hidden = !affichees.size;
  if (!affichees.size) { div.innerHTML = ''; return; }
  const titre = affichees.size === 1 ? [...affichees.values()][0].titre : `${affichees.size} tracés affichés`;
  div.innerHTML = `
    <div class="traces-ctrl-titre">🛰️ ${titre.replace(/[<>&]/g, '')}</div>
    <label class="traces-ctrl-largeur"><input type="checkbox" id="traces-largeur" ${modeLargeur ? 'checked' : ''}> Largeur de l'outil</label>
    <div class="traces-ctrl-actions">
      ${retourEnCours ? '<button type="button" class="traces-ctrl-btn traces-ctrl-retour" id="traces-retour">↩ Retour à l\'activité</button>'
        : '<button type="button" class="traces-ctrl-btn" id="traces-masquer">✖ Masquer</button>'}
    </div>`;
  div.querySelector('#traces-largeur').addEventListener('change', (e) => definirModeLargeur(e.target.checked));
  const retour = div.querySelector('#traces-retour');
  if (retour) retour.addEventListener('click', () => { const r = retourEnCours; retourEnCours = null; masquerTout(); if (r) r(); });
  const masquer = div.querySelector('#traces-masquer');
  if (masquer) masquer.addEventListener('click', masquerTout);
}

export function definirModeLargeur(v) {
  modeLargeur = !!v;
  majStyles();
  majControle();
  notifier();
}
export function getModeLargeur() { return modeLargeur; }
export function estAffichee(id) { return affichees.has(id); }

/**
 * Affiche un tracé. Points fournis (tracé tout juste fait, pas encore
 * enregistré) ou lus dans lgs_traces par l'id de l'activité.
 * @returns {Promise<boolean>} false si aucun point n'est conservé
 */
export async function afficherTrace(id, { points = null, coupures = null, couleur = '', largeurM = null, titre = 'Tracé', cadrer = true } = {}) {
  const map = getMap();
  if (!map) return false;
  if (affichees.has(id)) { if (cadrer) cadrerSur(id); return true; }
  let pts = points, cps = coupures || [], meta = null;
  if (!pts) {
    const lu = await lireTrace(id);
    if (!lu || lu.points.length < 2) return false;
    pts = lu.points; cps = lu.coupures; meta = lu.meta;
  }
  const t = {
    largeurM: Number(largeurM || (meta && meta.largeurM)) || null,
    couleur: couleur || (meta && meta.couleur) || COULEUR_DEFAUT,
    titre, points: pts, coupures: cps, groupe: L.layerGroup(), lignes: []
  };
  morceauxContinus(pts, cps).forEach((m) => {
    const l = L.polyline(m.map((p) => [p.lat, p.lon]), { color: t.couleur, interactive: false });
    t.lignes.push(l);
    t.groupe.addLayer(l);
  });
  t.groupe.addTo(map);
  affichees.set(id, t);
  majStyles();
  majControle();
  if (cadrer) cadrerSur(id);
  notifier();
  return true;
}

function cadrerSur(id) {
  const map = getMap();
  const t = affichees.get(id);
  if (!map || !t || !t.points.length) return;
  map.fitBounds(L.latLngBounds(t.points.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 18, animate: false });
}

export function masquerTrace(id) {
  const t = affichees.get(id);
  if (!t) return;
  t.groupe.remove();
  affichees.delete(id);
  majControle();
  notifier();
}

export function masquerTout() {
  [...affichees.keys()].forEach((id) => { const t = affichees.get(id); t.groupe.remove(); affichees.delete(id); });
  majControle();
  notifier();
}

/**
 * « Voir le tracé » depuis la fiche d'une activité : seul tracé affiché,
 * cadré, avec « Retour à l'activité ».
 */
export async function afficherTraceActivite({ interventionId, points, coupures, couleur, largeurM, titre, onRetour }) {
  masquerTout();
  retourEnCours = onRetour || null;
  const ok = await afficherTrace(interventionId || 'trace-en-cours', { points, coupures, couleur, largeurM, titre });
  if (!ok) {
    retourEnCours = null;
    majControle();
    throw new Error('Le tracé de cette activité n\'a pas été conservé (activité enregistrée avant l\'historique des tracés, le 06/10/2026).');
  }
  majControle();
}
