// Notification flottante (toast) pour confirmer ou signaler l'issue d'un
// enregistrement, en plus des bandeaux d'erreur déjà présents dans chaque
// fiche (qui restent la source du détail). Un seul point d'entrée, réutilisé
// par tous les formulaires de l'appli : pas de logique dupliquée par écran,
// pas de dépendance à quoi que ce soit d'autre que le DOM.
let container = null;

function conteneur() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

function afficherToast(message, type) {
  const c = conteneur();
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  c.appendChild(el);
  // Deux frames avant de révéler : la transition CSS doit partir de l'état
  // initial (translaté, opacité 0), jamais s'appliquer d'entrée.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));
  const DUREE_MS = type === 'erreur' ? 4200 : 2600;
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 250);
  }, DUREE_MS);
}

export function toastSucces(message) {
  afficherToast(message, 'succes');
}

export function toastErreur(message) {
  console.error('[Logisol]', message);
  afficherToast(message, 'erreur');
}

/**
 * Confirmation avec une action (« Annuler ») : reste plus longtemps, et le
 * bouton est cliquable (le conteneur, lui, laisse passer les taps).
 */
export function toastAction(message, libelleAction, onAction, dureeMs = 6000) {
  const c = conteneur();
  const el = document.createElement('div');
  el.className = 'toast toast-succes toast-avec-action';
  const texte = document.createElement('span');
  texte.textContent = message;
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'toast-action';
  bouton.textContent = libelleAction;
  const fermer = () => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 250);
  };
  bouton.addEventListener('click', () => { bouton.disabled = true; fermer(); onAction(); });
  el.append(texte, bouton);
  c.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));
  setTimeout(fermer, dureeMs);
}
