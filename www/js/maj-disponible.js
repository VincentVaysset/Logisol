// Bandeau "nouvelle version installée".
//
// POURQUOI PAS UN SERVICE WORKER : un Service Worker ne peut vérifier "une
// version plus récente existe" qu'en interrogeant une URL hébergée — or
// Logisol n'en a pas : c'est un APK Capacitor dont les fichiers www/ sont
// embarqués DANS l'APK au moment du build (cf. .github/workflows/
// build-android.yml), jamais servis depuis un serveur web. Un Service
// Worker enregistré ici n'aurait donc rien à interroger, et risquerait en
// plus d'interférer avec le chargement 100% local déjà garanti par
// Capacitor (CLAUDE.md).
//
// CE QU'ON PEUT DÉTECTER SANS RISQUE : que CE lancement tourne sur un build
// différent du dernier vu sur CET appareil (window.__LOGISOL_VERSION,
// réécrit par la CI à chaque build — cf. version.js). Une différence ne
// peut venir que d'une chose : l'APK vient d'être réinstallé. On le
// confirme, avec un bouton qui recharge la page (utile si la WebView
// Android avait gardé en mémoire des modules JS de l'ancienne version) —
// jamais un vidage de cache : IndexedDB et le cache Firestore hors-ligne
// restent intacts, un simple reload() ne les touche pas.
const CLE = 'logisol_dernier_build_vu';

export function initMajDisponible() {
  const v = window.__LOGISOL_VERSION || {};
  const build = String(v.build || '');
  if (!build || build === 'local') return; // build de dev : rien de fiable à comparer

  let dernier = null;
  try { dernier = localStorage.getItem(CLE); } catch (e) { /* navigation privée, stockage bloqué... */ }
  try { localStorage.setItem(CLE, build); } catch (e) { /* tant pis, pas de suivi cette fois */ }

  if (!dernier || dernier === build) return; // premier lancement sur cet appareil, ou déjà signalé
  afficherBanniere(build, v.date || '');
}

function afficherBanniere(build, date) {
  const el = document.createElement('div');
  el.className = 'maj-banniere';
  el.innerHTML = `
    <span class="maj-banniere-texte">🎉 Logisol a été mis à jour — build ${escapeHtml(build)}${date ? ' du ' + escapeHtml(date) : ''}.</span>
    <button type="button" class="btn btn-primary btn-mini maj-banniere-recharger">🔄 Recharger</button>
    <button type="button" class="maj-banniere-fermer" aria-label="Fermer">✕</button>`;
  document.body.appendChild(el);
  // Deux frames avant de révéler, comme toast.js : la transition doit
  // partir de l'état initial (translaté, opacité 0), jamais s'appliquer d'entrée.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('maj-banniere-visible')));

  el.querySelector('.maj-banniere-recharger').addEventListener('click', () => window.location.reload());
  el.querySelector('.maj-banniere-fermer').addEventListener('click', () => fermer(el));
}

function fermer(el) {
  el.classList.remove('maj-banniere-visible');
  setTimeout(() => el.remove(), 250);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
