// Mises à jour automatiques In-App — porté depuis Ovilog (dépôt
// VincentVaysset/Ovilog, branche claude/sheep-herd-android-app-7tlcq1),
// mécanisme complet et déjà en production là-bas. Seules adaptations :
// dépôt/propriétaire GitHub, package natif (com.logisol.app), et la source
// de la version installée (window.__LOGISOL_VERSION, déjà en place côté
// Logisol — @capacitor/app n'est pas une dépendance du projet, inutile d'en
// ajouter une rien que pour lire le même numéro de build).
//
// L'appli n'étant pas distribuée via le Play Store, elle interroge
// directement les Releases du dépôt GitHub public pour savoir si une
// version plus récente existe, propose de la télécharger, puis relance
// l'installeur système Android dessus (voir ApkInstallerPlugin côté
// natif). Android gère alors seul la mise à jour par-dessus l'existant
// (même applicationId + même clé de signature, versionCode strictement
// croissant — voir build.gradle et .github/workflows/build-android.yml) :
// aucune donnée locale (IndexedDB/localStorage/cache Firestore hors-ligne)
// n'est jamais perdue par ce mécanisme, sans code de migration à écrire
// ici. Firestore n'est de toute façon jamais concerné, une mise à jour
// cliente ne touchant à rien côté serveur.
const UPDATE_REPO_OWNER = 'VincentVaysset';
const UPDATE_REPO_NAME = 'Logisol';
const UPDATE_DISMISSED_KEY = 'logisol_update_dismissed_versioncode';

const popupEl = document.getElementById('maj-popup');
const popupNomEl = document.getElementById('maj-popup-nom');
const popupNotesEl = document.getElementById('maj-popup-notes');
const popupStatutEl = document.getElementById('maj-popup-statut');
const popupInstallerBtn = document.getElementById('maj-popup-installer');
const popupPlusTardBtn = document.getElementById('maj-popup-plus-tard');
const btnVerifierEl = document.getElementById('btn-verifier-maj');
const verifStatutEl = document.getElementById('maj-verif-statut');

// null si l'appli tourne hors app installée (navigateur de test) ou si le
// numéro de build n'est pas exploitable ("local", build de dev) — jamais
// une exception remontée à l'appelant.
function versionCodeInstalle() {
  const build = window.__LOGISOL_VERSION && window.__LOGISOL_VERSION.build;
  if (!build || build === 'local') return null;
  const n = parseInt(build, 10);
  return Number.isFinite(n) ? n : null;
}

// Interroge la liste des Releases GitHub (API publique, sans
// authentification — aucun secret embarqué dans l'APK distribué) et
// renvoie { ok, best } : ok=false si la requête ou la réponse est en échec
// (réseau, parsing) — distinct de "aucune release exploitable trouvée",
// qui reste ok=true avec best=null (nécessaire pour ne jamais afficher "à
// jour" à tort sur un simple échec réseau). Le tag doit être de la forme
// "v<entier>" (voir l'étape "Publier la Release GitHub" du workflow CI) :
// c'est cet entier, identique au versionCode Android du build
// correspondant, qui sert de base de comparaison — jamais le nom/tag brut.
//
// Examine TOUTES les releases renvoyées (pas seulement la première) et
// retient celle au versionCode le plus élevé — jamais un simple
// `releases[0]` en confiance aveugle dans l'ordre renvoyé par l'API (bug
// déjà rencontré et corrigé côté Ovilog : une release CI dont le tag
// pointait par erreur vers un vieux commit de main donnait à plusieurs
// releases un created_at identique, rendant l'ordre de tri non garanti).
async function derniereReleaseDisponible() {
  try {
    const res = await fetch('https://api.github.com/repos/' + UPDATE_REPO_OWNER + '/' + UPDATE_REPO_NAME + '/releases', {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    // reason distingue une réponse HTTP en erreur (ex: limite de requêtes
    // anonymes GitHub — 60/heure par IP publique, vite atteinte derrière
    // un NAT opérateur mobile partagé) d'un échec réseau pur (voir catch
    // ci-dessous).
    if (!res.ok) return { ok: false, best: null, reason: 'http_' + res.status };
    const releases = await res.json();
    if (!Array.isArray(releases)) return { ok: false, best: null, reason: 'reponse_invalide' };
    let best = null;
    for (const r of releases) {
      const m = /^v(\d+)$/.exec(r.tag_name || '');
      if (!m) continue;
      const asset = (r.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
      if (!asset || !asset.browser_download_url) continue;
      // Contrôle basique de provenance avant de retenir l'URL de
      // téléchargement : elle doit provenir de GitHub lui-même.
      let url;
      try { url = new URL(asset.browser_download_url); } catch (e) { continue; }
      const hoteAutorise = url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com');
      if (!hoteAutorise) continue;
      const versionCode = parseInt(m[1], 10);
      if (!best || versionCode > best.versionCode) {
        best = { versionCode, tagName: r.tag_name, name: r.name || r.tag_name, body: r.body || '', apkUrl: asset.browser_download_url };
      }
    }
    return { ok: true, best };
  } catch (e) {
    return { ok: false, best: null, reason: 'reseau:' + (e && e.message || 'inconnu') };
  }
}

// Combine les deux — renvoie { ok, release } : release contient les infos
// de la mise à jour à proposer si elle est réellement plus récente que la
// version installée (ok=true, release=objet), null si déjà à jour (ok=true,
// release=null) ou si hors app installée (ok=false, release=null — rien à
// vérifier). ok=false signale spécifiquement un échec de la vérification
// elle-même (réseau, réponse GitHub mal formée) — à distinguer d'un "déjà
// à jour" confirmé, pour ne jamais afficher à tort "Vous êtes à jour" sur
// un simple échec de connexion (voir l'appel manuel dans Paramètres).
async function verifierMiseAJourDisponible() {
  const localCode = versionCodeInstalle();
  if (localCode === null) return { ok: false, release: null, reason: 'version_installee_inconnue' };
  const { ok, best, reason } = await derniereReleaseDisponible();
  if (!ok) return { ok: false, release: null, reason };
  if (!best || best.versionCode <= localCode) return { ok: true, release: null };
  return { ok: true, release: best };
}

// Popup non bloquante "Nouvelle version disponible" — un seul exemplaire à
// la fois (appelée à la fois par le bouton manuel et par la vérification
// silencieuse au démarrage). "Plus tard" mémorise le versionCode proposé
// (localStorage) pour ne pas resolliciter à chaque ouverture pour cette
// même version — réapparaît dès qu'une version plus récente encore sort.
function afficherPopupMiseAJour(release) {
  if (!popupEl.hidden) return;
  popupNomEl.textContent = release.name;
  if (release.body) { popupNotesEl.textContent = release.body; popupNotesEl.hidden = false; }
  else { popupNotesEl.textContent = ''; popupNotesEl.hidden = true; }
  popupStatutEl.textContent = '';
  popupInstallerBtn.disabled = false;
  popupPlusTardBtn.disabled = false;
  popupInstallerBtn.onclick = () => telechargerEtInstallerMiseAJour(release);
  popupPlusTardBtn.onclick = () => {
    try { localStorage.setItem(UPDATE_DISMISSED_KEY, String(release.versionCode)); } catch (e) { /* ignoré */ }
    popupEl.hidden = true;
  };
  popupEl.hidden = false;
}

// Télécharge l'APK de la release et relance l'installeur système via
// ApkInstallerPlugin. Le téléchargement ne démarre jamais tout seul :
// uniquement sur ce clic explicite de l'exploitant.
async function telechargerEtInstallerMiseAJour(release) {
  const ApkInstaller = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstaller;
  if (!ApkInstaller) {
    popupStatutEl.textContent = "Mise à jour disponible uniquement sur l'application installée.";
    return;
  }
  popupInstallerBtn.disabled = true;
  popupPlusTardBtn.disabled = true;
  const fileName = 'logisol-update.apk';
  try {
    popupStatutEl.textContent = 'Téléchargement en cours...';
    // Téléchargement natif (ApkInstaller.download, Java/HttpURLConnection),
    // pas fetch() : GitHub ne renvoie aucun en-tête Access-Control-Allow-
    // Origin sur le téléchargement d'un asset de release (contrairement à
    // l'API /releases elle-même) — un fetch() depuis la WebView échoue
    // donc systématiquement avec "Failed to fetch".
    await ApkInstaller.download({ url: release.apkUrl, fileName });

    popupStatutEl.textContent = "Vérification de l'autorisation d'installation...";
    const perm = await ApkInstaller.canRequestInstall();
    if (!perm || !perm.value) {
      popupStatutEl.textContent = 'Autorise "Installer des applications inconnues" pour Logisol dans l\'écran qui s\'ouvre, puis reviens ici et retape sur "Télécharger et installer" (pas besoin de retélécharger).';
      await ApkInstaller.openInstallPermissionSettings();
      popupInstallerBtn.disabled = false;
      popupPlusTardBtn.disabled = false;
      return;
    }

    popupStatutEl.textContent = "Ouverture de l'installation...";
    await ApkInstaller.install({ fileName });
    // L'intent système est lancé — la suite (écran de confirmation
    // Android) échappe à l'appli, on referme simplement la popup.
    popupEl.hidden = true;
  } catch (e) {
    popupStatutEl.textContent = 'Échec : ' + (e && e.message ? e.message : 'erreur inconnue') + '.';
    popupInstallerBtn.disabled = false;
    popupPlusTardBtn.disabled = false;
  }
}

// Vérification silencieuse au démarrage — jamais attendue (ne doit jamais
// retarder l'affichage de l'accueil), jamais de message en cas d'échec
// réseau, et jamais de re-sollicitation pour une version déjà écartée via
// "Plus tard" (voir UPDATE_DISMISSED_KEY).
async function verifierMiseAJourAuDemarrage() {
  try {
    const { release } = await verifierMiseAJourDisponible();
    if (!release) return;
    let dernierRefus = null;
    try { dernierRefus = parseInt(localStorage.getItem(UPDATE_DISMISSED_KEY), 10); } catch (e) { /* ignoré */ }
    if (Number.isFinite(dernierRefus) && dernierRefus >= release.versionCode) return;
    afficherPopupMiseAJour(release);
  } catch (e) {
    // Silencieux par conception — jamais de popup d'erreur pour une simple
    // vérification en tâche de fond.
  }
}

// Bouton manuel (Paramètres) : contrairement à la vérification silencieuse,
// donne toujours un retour explicite, y compris en cas d'échec.
export function initMajApk() {
  const ApkInstaller = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstaller;
  if (ApkInstaller) {
    btnVerifierEl.disabled = false;
  } else {
    verifStatutEl.textContent = 'Mise à jour disponible uniquement sur l\'application installée.';
  }
  btnVerifierEl.addEventListener('click', async () => {
    btnVerifierEl.disabled = true;
    verifStatutEl.textContent = 'Vérification en cours...';
    const { ok, release, reason } = await verifierMiseAJourDisponible();
    btnVerifierEl.disabled = false;
    if (!ok) {
      // Distinct de "à jour" : la vérification elle-même a échoué (réseau,
      // réponse GitHub inattendue) — ne jamais laisser croire à tort que
      // tout est à jour dans ce cas. Le détail technique entre parenthèses
      // (code HTTP, etc.) permet de diagnostiquer à distance si le
      // problème se reproduit (ex: http_403 = limite de requêtes GitHub).
      verifStatutEl.textContent = '⚠️ Vérification impossible — vérifie ta connexion internet et réessaie.' + (reason ? ' (' + reason + ')' : '');
      return;
    }
    if (!release) {
      verifStatutEl.textContent = '✅ Vous êtes à jour.';
      return;
    }
    verifStatutEl.textContent = '🆕 Nouvelle version disponible : ' + release.name;
    afficherPopupMiseAJour(release);
  });

  // Jamais attendue, entièrement silencieuse tant qu'aucune mise à jour
  // n'est trouvée.
  verifierMiseAJourAuDemarrage();
}
