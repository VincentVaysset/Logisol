// Fiche aliment (onglet Stocks) : tous les mouvements qui concernent un
// aliment, avec Modifier / Supprimer par ligne.
//
// Un mouvement créé par le tunnel d'activité (ex. "Récolte séchage grange")
// reste la propriété de son intervention (interventions.js/mouvementId) :
// le modifier ou le supprimer ici créerait un double source de vérité, la
// prochaine sauvegarde de l'intervention réécrirait par-dessus. Ces lignes
// ne portent donc qu'un renvoi vers l'intervention, jamais Modifier/Supprimer
// en direct — la suppression reste possible, mais depuis l'intervention, qui
// nettoie déjà son propre mouvement (cf. ui-intervention.js).
//
// Supprimer un mouvement ne touche à rien d'autre : le niveau d'un contenant
// est toujours recalculé depuis le journal (mouvements.js/niveauContenant),
// donc aucun décrément à corriger ailleurs. On avertit seulement si le
// niveau resterait négatif après coup, sans jamais l'empêcher.
import {
  getMouvements, deleteMouvement, niveauContenant, typeMouvement
} from './mouvements.js';
import { mouvementsDeAliment } from './fourrages.js';
import { getInterventions } from './interventions.js';
import { openEditIntervention } from './ui-intervention.js';
import { openEditMouvement } from './ui-mouvements.js';
import { dateLisible } from './accueil.js';
import { formatTonnes } from './ui-stocks.js';
import { toastSucces, toastErreur } from './toast.js';
import { clePaille } from './stocks.js';
import { getCellules } from './cellules.js';
import { getEmplacements } from './emplacements.js';
import { previsualiserVidage, viderStockPaille } from './vider-paille.js';
import { estAchete } from './groupes-stock.js';
import { apercuRenommage, renommerAliment } from './renommer-aliment.js';

const panel = document.getElementById('aliment-panel');
const nomEl = document.getElementById('aliment-nom');
const erreurBanner = document.getElementById('aliment-erreur');
const erreurTexte = document.getElementById('aliment-erreur-texte');
const mouvementsEl = document.getElementById('aliment-mouvements');
const viderBtn = document.getElementById('aliment-vider');
const renommerBtn = document.getElementById('aliment-renommer');

let cleCourante = null;

function hideErreur() { erreurBanner.hidden = true; }
function showErreur(m) { erreurTexte.textContent = m; erreurBanner.hidden = false; }
document.getElementById('aliment-erreur-close').addEventListener('click', hideErreur);
document.getElementById('aliment-fermer').addEventListener('click', fermer);

export function ouvrirFicheAliment(cle, label) {
  cleCourante = cle;
  panel.hidden = false;
  hideErreur();
  nomEl.textContent = label || cle;
  // Remise à zéro fin de campagne : proposée uniquement sur la fiche Paille
  // (aucun suivi de consommation, cf. CLAUDE.md/ticket paille point 7).
  if (viderBtn) viderBtn.hidden = cle !== clePaille();
  renommerBtn.hidden = !estAchete(cle);
  render();
}

// Renommer un aliment acheté : partout d'un coup (renommer-aliment.js),
// annoncé avant d'être appliqué.
renommerBtn.addEventListener('click', async () => {
  hideErreur();
  const nom = prompt('Nouveau nom de l\'aliment :', nomEl.textContent.replace(/ · acheté$/, ''));
  if (nom == null || !nom.trim()) return;
  const a = apercuRenommage(cleCourante, nom);
  if (!a) return;
  if (a.conflit) { showErreur(`Un autre aliment acheté s'appelle déjà « ${a.nom} ».`); return; }
  if (!confirm(`Renommer en « ${a.nom} » ? ${a.mouvements.length} mouvement(s), ${a.lots.length} lot(s) (rations) et ${a.clotures.length} clôture(s) seront mis à jour. Aucune quantité ne change.`)) return;
  renommerBtn.disabled = true;
  try {
    await renommerAliment(cleCourante, nom);
    cleCourante = a.cle;
    nomEl.textContent = a.nom;
    toastSucces('Aliment renommé.');
    render();
  } catch (err) {
    showErreur('Renommage impossible : ' + ((err && err.message) || err));
  } finally {
    renommerBtn.disabled = false;
  }
});

// La paille n'a aucune sortie automatique (ni rations, ni bergerie) : c'est
// le seul moyen de remettre son stock à 0 en fin de campagne — un mouvement
// d'inventaire comme un autre ensuite, modifiable/supprimable ci-dessus.
if (viderBtn) {
  viderBtn.addEventListener('click', async () => {
    hideErreur();
    const { totalTonnes } = previsualiserVidage(getMouvements(), getCellules(), getEmplacements());
    if (!(totalTonnes > 0)) { showErreur('Le stock de paille est déjà à 0 t.'); return; }
    if (!confirm(`Vider ${formatTonnes(totalTonnes)} t de paille ?`)) return;
    viderBtn.disabled = true;
    try {
      await viderStockPaille(getMouvements(), getCellules(), getEmplacements());
      toastSucces('Stock de paille vidé.');
      render();
    } catch (err) {
      const msg = (err && err.message) || err;
      showErreur('Vidage impossible : ' + msg);
      toastErreur('Vidage impossible : ' + msg);
    } finally {
      viderBtn.disabled = false;
    }
  });
}

function fermer() {
  panel.hidden = true;
  cleCourante = null;
}

const CONTENANTS = ['CELLULE', 'EMPLACEMENT_FOURRAGE'];

// Niveaux des contenants touchés par ce mouvement, SANS lui — pour avertir
// avant une suppression qui ferait passer un stock sous zéro.
function niveauxApresSuppression(m) {
  const sansM = getMouvements().filter((x) => x.id !== m.id);
  const resultats = [];
  if (CONTENANTS.includes(m.destinationType) && m.destinationId) {
    resultats.push({ nom: m.destinationNom || 'contenant', niveau: niveauContenant(m.destinationType, m.destinationId, sansM).quantite });
  }
  if (CONTENANTS.includes(m.sourceType) && m.sourceId) {
    resultats.push({ nom: m.sourceNom || 'contenant', niveau: niveauContenant(m.sourceType, m.sourceId, sansM).quantite });
  }
  return resultats;
}

async function supprimer(m) {
  hideErreur();
  const negatifs = niveauxApresSuppression(m).filter((r) => r.niveau < 0);
  const message = negatifs.length
    ? `⚠️ Stock négatif à cette date : ${negatifs.map((r) => `${r.nom} passerait à ${formatTonnes(r.niveau)}`).join(', ')}. Supprimer quand même ?`
    : 'Supprimer ce mouvement ? Cette action est irréversible.';
  if (!confirm(message)) return;
  try {
    await deleteMouvement(m.id);
    toastSucces('Mouvement supprimé.');
    render();
  } catch (err) {
    const msg = (err && err.message) || err;
    showErreur('Suppression impossible : ' + msg);
    toastErreur('Suppression impossible : ' + msg);
  }
}

function ligneMouvement(m) {
  const itv = getInterventions().find((i) => i.mouvementId === m.id);
  const t = typeMouvement(m.typeMouvement);
  const trajet = [m.sourceNom, m.destinationNom].filter(Boolean).join(' → ');
  const unite = m.unite === 'bottes' ? 'bottes' : 't';
  const actions = itv
    ? `<button type="button" class="btn btn-secondary btn-mini" data-voir-itv="${escapeAttr(m.id)}">🔗 Supprimer depuis l'intervention</button>`
    : `<button type="button" class="btn btn-secondary btn-mini" data-modifier="${escapeAttr(m.id)}">✏️ Modifier</button>
       <button type="button" class="btn btn-danger btn-mini" data-supprimer="${escapeAttr(m.id)}">🗑️ Supprimer</button>`;
  return `<div class="mvt-fiche-ligne" data-id="${escapeAttr(m.id)}">
    <div class="mvt-ligne">
      <span class="mvt-icone">${t.icone}</span>
      <div class="mvt-body">
        <div class="mvt-nom">${escapeHtml(m.libelle || t.label)}</div>
        <div class="mvt-sub">${escapeHtml(dateLisible(m.date))}${trajet ? ' · ' + escapeHtml(trajet) : ''}${itv ? ' · créé par l\'intervention « ' + escapeHtml(itv.typeNom || 'activité') + ' »' : ''}</div>
      </div>
      <div class="mvt-qte ${t.sens === -1 ? 'mvt-sortie' : t.sens === 1 ? 'mvt-entree' : ''}">${t.sens === -1 ? '−' : t.sens === 1 ? '+' : ''}${formatTonnes(m.quantite)} ${unite}</div>
    </div>
    <div class="mvt-fiche-actions">${actions}</div>
  </div>`;
}

function render() {
  const liste = mouvementsDeAliment(cleCourante, getMouvements());
  mouvementsEl.innerHTML = liste.length
    ? liste.map(ligneMouvement).join('')
    : '<p class="list-empty">Aucun mouvement pour cet aliment.</p>';

  mouvementsEl.querySelectorAll('[data-modifier]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = getMouvements().find((x) => x.id === btn.dataset.modifier);
      if (!m) return;
      fermer();
      openEditMouvement(m);
    });
  });
  mouvementsEl.querySelectorAll('[data-supprimer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = getMouvements().find((x) => x.id === btn.dataset.supprimer);
      if (m) supprimer(m);
    });
  });
  mouvementsEl.querySelectorAll('[data-voir-itv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = getMouvements().find((x) => x.id === btn.dataset.voirItv);
      const itv = m && getInterventions().find((i) => i.mouvementId === m.id);
      if (!itv) return;
      fermer();
      openEditIntervention(itv);
    });
  });
}

// Rafraîchit la fiche ouverte quand le journal change ailleurs (édition
// depuis la vue Bâtiments, par exemple) — sans re-render, la liste resterait
// périmée tant qu'on ne referme pas et rouvre la fiche.
export function rafraichirFicheAliment() {
  if (!panel.hidden && cleCourante) render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
