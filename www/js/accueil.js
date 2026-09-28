// Vue Ferme : fil des dernières activités (toutes parcelles mélangées, les
// plus récentes en premier) et aperçu d'une parcelle tapée sur la carte.
import { implantationEnCours, historiqueParcelle, dureeLisible } from './implantations.js';
import { resumeMeteo } from './meteo.js';
import { openCreateIntervention, openEditIntervention } from './ui-intervention.js';
import { estCorrigeableAvecPs, corrigerAvecPs } from './corriger-ps.js';
import { toastSucces, toastErreur } from './toast.js';

// Id de l'activité dont le petit formulaire "Corriger avec PS" est déplié
// dans le fil — une seule à la fois, jamais un état par carte (le fil est
// entièrement redessiné à chaque changement, cf. renderFeed()).
let corrigerPsOuvertPourId = null;

const feedList = document.getElementById('feed-list');
const apercuPanel = document.getElementById('apercu-panel');
const apercuNom = document.getElementById('apercu-nom');
const apercuSurface = document.getElementById('apercu-surface');
const apercuCulture = document.getElementById('apercu-culture');
const apercuDuree = document.getElementById('apercu-duree');
const apercuSemis = document.getElementById('apercu-semis');
const apercuDerobeeLigne = document.getElementById('apercu-derobee-ligne');
const apercuDerobee = document.getElementById('apercu-derobee');
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
    el.addEventListener('click', (e) => {
      if (e.target.closest('.feed-ps-correction')) return;
      const itv = interventions.find((i) => i.id === el.dataset.id);
      if (itv) openEditIntervention(itv);
    });
  });
  feedList.querySelectorAll('[data-ps-ouvrir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      corrigerPsOuvertPourId = btn.dataset.psOuvrir;
      renderFeed();
    });
  });
  feedList.querySelectorAll('[data-ps-annuler]').forEach((btn) => {
    btn.addEventListener('click', () => {
      corrigerPsOuvertPourId = null;
      renderFeed();
    });
  });
  feedList.querySelectorAll('[data-ps-valider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.psValider;
      const input = feedList.querySelector(`[data-ps-input="${cssEchap(id)}"]`);
      const ps = input ? Number(input.value) : NaN;
      if (!(ps > 0)) { toastErreur('PS invalide.'); return; }
      btn.disabled = true;
      try {
        await corrigerAvecPs(id, ps);
        toastSucces('PS appliqué, quantité recalculée.');
        corrigerPsOuvertPourId = null;
      } catch (err) {
        toastErreur('Correction impossible : ' + ((err && err.message) || err));
      } finally {
        renderFeed();
      }
    });
  });
}

// CSS.escape n'existe pas partout en WebView Android ancienne — un
// remplacement minimal suffit ici (l'id vient de Firestore, jamais de
// caractères spéciaux CSS en pratique).
function cssEchap(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

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
  // Pressage paille : "X t" (le tonnage réel rentré), pas le compte de bottes
  // — resumeSaisie() affiche déjà nbBottes pour un pressage foin, mais la
  // paille ne suit pas de coupe/type et le tonnage est ce qui compte.
  if ((itv.saisie || {}).produitRecolte === 'PAILLE' && itv.flux && itv.flux.quantite != null) {
    details.push(escapeHtml(itv.flux.quantite + ' t'));
  } else {
    resumeSaisie(itv).forEach((d) => details.push(escapeHtml(d)));
  }
  if (itv.materielNom) details.push('🛠️ ' + escapeHtml(itv.materielNom));
  if (itv.materiel) details.push(escapeHtml(itv.materiel));
  if (itv.chauffeur) details.push('👤 ' + escapeHtml(itv.chauffeur));
  if (itv.dureeHeures != null) details.push(itv.dureeHeures + ' h');
  const meteo = resumeMeteo(itv.meteo);
  if (meteo) details.push(escapeHtml(meteo));

  const corrigeable = estCorrigeableAvecPs(itv);
  const psOuvert = corrigeable && corrigerPsOuvertPourId === itv.id;

  return `
  <article class="feed-item" data-id="${escapeAttr(itv.id)}">
    <div class="feed-icon" style="background:${escapeAttr(couleurType(itv))}">${escapeHtml(iconeType(itv))}</div>
    <div class="feed-body">
      <div class="feed-line1">
        <span class="feed-type">${escapeHtml(libelleType(itv))}</span>
        ${itv.statut === 'A_FAIRE' ? '<span class="badge-afaire">à faire</span>' : ''}
        <span class="feed-date">${escapeHtml(dateLisible(itv.date))}</span>
      </div>
      <div class="feed-parcelles">${
        nomsParcelles.length ? escapeHtml(nomsParcelles.join(' · ')) : '<em>parcelle supprimée</em>'
      }</div>
      ${details.length ? `<div class="feed-details">${details.join(' · ')}</div>` : ''}
      ${itv.notes ? `<div class="feed-notes">${escapeHtml(itv.notes)}</div>` : ''}
      ${corrigeable ? `<div class="feed-ps-correction">${psOuvert ? `
        <input type="number" step="0.01" class="feed-ps-input" data-ps-input="${escapeAttr(itv.id)}" placeholder="PS (t/m³ ou kg/hL)">
        <button type="button" class="btn btn-secondary btn-mini" data-ps-valider="${escapeAttr(itv.id)}">✔️ Valider</button>
        <button type="button" class="btn btn-secondary btn-mini" data-ps-annuler="${escapeAttr(itv.id)}">✕</button>
      ` : `<button type="button" class="btn btn-secondary btn-mini" data-ps-ouvrir="${escapeAttr(itv.id)}">⚖️ Corriger avec PS</button>`}</div>` : ''}
    </div>
    ${itv.photo ? `<img class="feed-photo" src="${escapeAttr(itv.photo)}" alt="">` : ''}
  </article>`;
}

// "Pressage paille" plutôt que le nom générique du type (« Pressage
// (bottes) ») : le journal doit dire ce qui a été récolté, pas juste le
// geste — cf. ticket paille, point 4.
function libelleType(itv) {
  if ((itv.saisie || {}).produitRecolte === 'PAILLE') return 'Pressage paille';
  return itv.typeNom || 'Intervention';
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
    apercuDerobeeLigne.hidden = !parcelle.derobee;
    if (parcelle.derobee) apercuDerobee.textContent = parcelle.derobee;

    const impl = implantationEnCours(parcelle.id, undefined, etat.implantations);
    if (impl) {
      const culture = etat.cultures.find((c) => c.id === impl.cultureId);
      apercuCulture.textContent = culture ? culture.nom : 'Culture inconnue';
      apercuDuree.textContent = dureeLisible(impl) || '—';
      apercuSemis.textContent = dateLisible(impl.dateSemis);
    } else {
      // Rien d'actif : soit la parcelle n'a jamais rien porté ("À
      // renseigner"), soit la dernière culture vient d'être récoltée/détruite
      // (Moisson, Déchaumage, Labour...) et rien n'est encore semé — c'est
      // l'interculture, jamais à confondre avec une parcelle qu'on aurait
      // oublié de renseigner.
      const derniere = historiqueParcelle(parcelle.id, etat.implantations)[0];
      apercuCulture.textContent = derniere && derniere.dateFin ? 'Interculture (chaumes)' : 'À renseigner';
      apercuDuree.textContent = '—';
      apercuSemis.textContent = '—';
    }

    const liees = etat.interventions.filter((i) => (i.parcelleIds || []).includes(parcelle.id)).slice(0, 5);
    apercuActivites.innerHTML = liees.length
      ? liees
          .map(
            (i) => `<div class="apercu-activite" data-id="${escapeAttr(i.id)}">
              <span class="apercu-activite-icone">${escapeHtml(iconeType(i))}</span>
              <span class="apercu-activite-nom">${escapeHtml(libelleType(i))}</span>
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
    if (s.capaciteBenne != null) {
      // Nouveau modèle : capacité × remplissage × PS (cf. poids-specifique.js).
      out.push(`${s.nbBennes} benne${s.nbBennes > 1 ? 's' : ''} × ${s.capaciteBenne} m³` +
        (s.remplissageBenne != null ? ` × ${s.remplissageBenne} %` : '') +
        (s.ps != null ? ` × PS ${s.ps}` : ''));
    } else {
      out.push(s.nbBennes + ' benne' + (s.nbBennes > 1 ? 's' : '') +
        (s.tonnageBenne != null ? ` × ${s.tonnageBenne} t` : ''));
      if (s.ps != null) out.push('PS ' + s.ps);
    }
  }
  if (s.poidsSpecifique != null && s.ps == null) out.push('PS ' + s.poidsSpecifique + ' (non appliqué)');
  if (s.nbEpandeurs != null) {
    out.push(s.nbEpandeurs + ' épandeur' + (s.nbEpandeurs > 1 ? 's' : '') +
      (s.tonnageEpandeur != null ? ` × ${s.tonnageEpandeur} t` : ''));
  }
  return out;
}
