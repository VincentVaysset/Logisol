// Vue Ferme : fil des dernières activités (toutes parcelles mélangées, les
// plus récentes en premier) et aperçu d'une parcelle tapée sur la carte.
import { implantationEnCours, dureeLisible } from './implantations.js';
import { resumeMeteo } from './meteo.js';
import { openCreateIntervention, openEditIntervention } from './ui-intervention.js';

const feedList = document.getElementById('feed-list');
const apercuPanel = document.getElementById('apercu-panel');
const apercuNom = document.getElementById('apercu-nom');
const apercuSurface = document.getElementById('apercu-surface');
const apercuCulture = document.getElementById('apercu-culture');
const apercuDuree = document.getElementById('apercu-duree');
const apercuSemis = document.getElementById('apercu-semis');
const apercuActivites = document.getElementById('apercu-activites');

let parcelleAffichee = null;
let onModifierParcelle = () => {};

// Dernier état connu, tenu à jour par main.js à chaque snapshot Firestore.
let etat = { interventions: [], parcelles: [], cultures: [], implantations: [] };

export function initAccueil(opts = {}) {
  onModifierParcelle = opts.onModifierParcelle || (() => {});

  document.getElementById('btn-new-intervention').addEventListener('click', () =>
    openCreateIntervention()
  );
  document.getElementById('apercu-fermer').addEventListener('click', fermerApercu);
  document.getElementById('apercu-note').addEventListener('click', () => {
    const id = parcelleAffichee && parcelleAffichee.id;
    fermerApercu();
    openCreateIntervention({ parcelleIds: id ? [id] : [], note: true });
  });
  document.getElementById('apercu-activite').addEventListener('click', () => {
    const id = parcelleAffichee && parcelleAffichee.id;
    fermerApercu();
    openCreateIntervention({ parcelleIds: id ? [id] : [] });
  });
  document.getElementById('apercu-modifier').addEventListener('click', () => {
    const p = parcelleAffichee;
    fermerApercu();
    if (p) onModifierParcelle(p);
  });
}

export function majEtat(partiel) {
  etat = { ...etat, ...partiel };
}

// --- Fil d'activités ------------------------------------------------------
export function renderFeed() {
  const { interventions } = etat;
  if (!interventions.length) {
    feedList.innerHTML =
      '<p class="list-empty">Aucune activité enregistrée.<br>Utilise « ➕ Intervention » pour commencer.</p>';
    return;
  }
  feedList.innerHTML = interventions.map(carteIntervention).join('');
  feedList.querySelectorAll('.feed-item').forEach((el) => {
    el.addEventListener('click', () => {
      const itv = interventions.find((i) => i.id === el.dataset.id);
      if (itv) openEditIntervention(itv);
    });
  });
}

function carteIntervention(itv) {
  const nomsParcelles = (itv.parcelleIds || [])
    .map((id) => {
      const p = etat.parcelles.find((x) => x.id === id);
      return p ? p.nom || 'Sans nom' : null;
    })
    .filter(Boolean);

  const details = [];
  if (itv.produit) {
    details.push(
      escapeHtml(itv.produit) +
        (itv.quantite != null ? ` ${itv.quantite}${itv.unite ? ' ' + escapeHtml(itv.unite) : ''}` : '')
    );
  }
  if (itv.materiel) details.push(escapeHtml(itv.materiel));
  if (itv.dureeHeures != null) details.push(itv.dureeHeures + ' h');
  const meteo = resumeMeteo(itv.meteo);
  if (meteo) details.push(escapeHtml(meteo));

  return `
  <article class="feed-item" data-id="${escapeAttr(itv.id)}">
    <div class="feed-icon" style="background:${escapeAttr(couleurType(itv))}">${escapeHtml(iconeType(itv))}</div>
    <div class="feed-body">
      <div class="feed-line1">
        <span class="feed-type">${escapeHtml(itv.typeNom || 'Intervention')}</span>
        <span class="feed-date">${escapeHtml(dateLisible(itv.date))}</span>
      </div>
      <div class="feed-parcelles">${
        nomsParcelles.length ? escapeHtml(nomsParcelles.join(' · ')) : '<em>parcelle supprimée</em>'
      }</div>
      ${details.length ? `<div class="feed-details">${details.join(' · ')}</div>` : ''}
      ${itv.notes ? `<div class="feed-notes">${escapeHtml(itv.notes)}</div>` : ''}
    </div>
    ${itv.photo ? `<img class="feed-photo" src="${escapeAttr(itv.photo)}" alt="">` : ''}
  </article>`;
}

function typeDe(itv) {
  return etat.typesIntervention ? etat.typesIntervention.find((t) => t.id === itv.typeId) : null;
}
function iconeType(itv) {
  const t = typeDe(itv);
  return (t && t.icone) || '🔧';
}
function couleurType(itv) {
  const t = typeDe(itv);
  return (t && t.couleur) || '#9a988f';
}

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function dateLisible(iso) {
  if (!iso || iso.length < 10) return iso || '';
  const [a, m, j] = iso.split('-');
  const mois = MOIS[parseInt(m, 10) - 1] || m;
  return `${parseInt(j, 10)} ${mois} ${a}`;
}

// --- Aperçu d'une parcelle ------------------------------------------------
export function ouvrirApercu(parcelle) {
  parcelleAffichee = parcelle;
  apercuPanel.hidden = false;   // affiché d'abord, rempli ensuite
  try {
    apercuNom.textContent = parcelle.nom || 'Parcelle';
    apercuSurface.textContent = parcelle.surfaceHa != null ? parcelle.surfaceHa + ' ha' : '—';

    const impl = implantationEnCours(parcelle.id, undefined, etat.implantations);
    if (impl) {
      const culture = etat.cultures.find((c) => c.id === impl.cultureId);
      apercuCulture.textContent = culture ? culture.nom : 'Culture inconnue';
      apercuDuree.textContent = dureeLisible(impl) || '—';
      apercuSemis.textContent = dateLisible(impl.dateSemis);
    } else {
      apercuCulture.textContent = 'À renseigner';
      apercuDuree.textContent = '—';
      apercuSemis.textContent = '—';
    }

    const liees = etat.interventions.filter((i) => (i.parcelleIds || []).includes(parcelle.id)).slice(0, 5);
    apercuActivites.innerHTML = liees.length
      ? liees
          .map(
            (i) => `<div class="apercu-activite" data-id="${escapeAttr(i.id)}">
              <span class="apercu-activite-icone">${escapeHtml(iconeType(i))}</span>
              <span class="apercu-activite-nom">${escapeHtml(i.typeNom || 'Intervention')}</span>
              <span class="apercu-activite-date">${escapeHtml(dateLisible(i.date))}</span>
            </div>`
          )
          .join('')
      : '<p class="list-empty">Aucune activité sur cette parcelle.</p>';

    apercuActivites.querySelectorAll('.apercu-activite').forEach((el) => {
      el.addEventListener('click', () => {
        const itv = etat.interventions.find((i) => i.id === el.dataset.id);
        if (!itv) return;
        fermerApercu();
        openEditIntervention(itv);
      });
    });
  } catch (err) {
    apercuActivites.innerHTML =
      '<p class="list-empty">Détails indisponibles : ' + escapeHtml((err && err.message) || String(err)) + '</p>';
  }
}

export function fermerApercu() {
  apercuPanel.hidden = true;
  parcelleAffichee = null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
