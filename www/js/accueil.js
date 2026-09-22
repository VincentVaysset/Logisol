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
  // Une activité peut porter sur des parcelles OU des bergeries : on cherche
  // dans la bonne liste selon cibleType.
  const source = itv.cibleType === 'BERGERIE' ? (etat.batiments || []) : etat.parcelles;
  const nomsParcelles = (itv.parcelleIds || [])
    .map((id) => {
      const p = source.find((x) => x.id === id);
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
  resumeSaisie(itv).forEach((d) => details.push(escapeHtml(d)));
  if (itv.materielNom) details.push('🛠️ ' + escapeHtml(itv.materielNom));
  if (itv.materiel) details.push(escapeHtml(itv.materiel));
  if (itv.chauffeur) details.push('👤 ' + escapeHtml(itv.chauffeur));
  if (itv.dureeHeures != null) details.push(itv.dureeHeures + ' h');
  const meteo = resumeMeteo(itv.meteo);
  if (meteo) details.push(escapeHtml(meteo));

  return `
  <article class="feed-item" data-id="${escapeAttr(itv.id)}">
    <div class="feed-icon" style="background:${escapeAttr(couleurType(itv))}">${escapeHtml(iconeType(itv))}</div>
    <div class="feed-body">
      <div class="feed-line1">
        <span class="feed-type">${escapeHtml(itv.typeNom || 'Intervention')}</span>
        ${itv.statut === 'A_FAIRE' ? '<span class="badge-afaire">à faire</span>' : ''}
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


// Ce qui a été compté au champ, remis en une ligne lisible dans le fil.
// Chaque groupe d'activité a ses propres unités : des bottes pour un
// pressage, des bennes pour une moisson — les afficher toutes sous un même
// « quantité » rendrait le fil illisible.
function resumeSaisie(itv) {
  const s = itv && itv.saisie;
  if (!s) return [];
  const out = [];
  if (s.semence) out.push('🌱 ' + s.semence);
  if (Array.isArray(s.melange) && s.melange.length) {
    out.push(s.melange.map((m) => `${m.nom}${m.pourcentage ? ' ' + m.pourcentage + ' %' : ''}`).join(' / '));
  }
  if (s.doseKgHa != null) out.push(s.doseKgHa + ' kg/ha');
  if (s.doseTonnesHa != null) out.push(s.doseTonnesHa + ' t/ha');
  if (s.surfaceHa != null) out.push(s.surfaceHa + ' ha travaillés');
  if (s.nbBottes != null) {
    out.push(s.nbBottes + ' botte' + (s.nbBottes > 1 ? 's' : '') +
      (s.poidsBotteKg != null ? ` × ${s.poidsBotteKg} kg` : ''));
  }
  if (s.nbRemorques != null) {
    out.push(s.nbRemorques + ' remorque' + (s.nbRemorques > 1 ? 's' : '') +
      (s.tonnesParRemorque != null ? ` × ${s.tonnesParRemorque} t` : ''));
  }
  if (s.nbBennes != null) {
    out.push(s.nbBennes + ' benne' + (s.nbBennes > 1 ? 's' : '') +
      (s.tonnageBenne != null ? ` × ${s.tonnageBenne} t` : ''));
  }
  if (s.poidsSpecifique != null) out.push('PS ' + s.poidsSpecifique);
  if (s.nbEpandeurs != null) {
    out.push(s.nbEpandeurs + ' épandeur' + (s.nbEpandeurs > 1 ? 's' : '') +
      (s.tonnageEpandeur != null ? ` × ${s.tonnageEpandeur} t` : ''));
  }
  return out;
}
