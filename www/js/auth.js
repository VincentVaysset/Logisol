import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const screenLogin = document.getElementById('screen-login');
const screenApp = document.getElementById('screen-app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userEmailLabel = document.getElementById('user-email');

onAuthStateChanged(auth, (user) => {
  if (user) {
    screenLogin.hidden = true;
    screenApp.hidden = false;
    userEmailLabel.textContent = user.email || '';
    document.dispatchEvent(new CustomEvent('logisol:auth', { detail: { user } }));
  } else {
    screenLogin.hidden = false;
    screenApp.hidden = true;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  btnLogin.disabled = true;
  btnLogin.textContent = 'Connexion...';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = messageFromError(err);
    loginError.hidden = false;
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Se connecter';
  }
});

btnLogout.addEventListener('click', () => {
  signOut(auth);
});

function messageFromError(err) {
  switch (err.code) {
    case 'auth/invalid-email': return "Adresse email invalide.";
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return "Email ou mot de passe incorrect.";
    case 'auth/too-many-requests': return "Trop de tentatives, réessaie plus tard.";
    case 'auth/network-request-failed': return "Pas de connexion réseau.";
    default: return "Erreur de connexion (" + (err.code || err.message) + ").";
  }
}
