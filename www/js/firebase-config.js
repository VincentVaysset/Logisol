// Config Firebase — MÊME projet que Ovilog (ovilog-15ef6), collections
// dédiées à Logisol uniquement ("parcelles", "parcelles_config").
// Ne jamais lire/écrire dans les collections d'Ovilog depuis ce fichier
// ou ailleurs dans Logisol.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDY_Z3Jqo92RAuJlYX5K4sZKTFmf-0P-h4",
  authDomain: "ovilog-15ef6.firebaseapp.com",
  projectId: "ovilog-15ef6",
  storageBucket: "ovilog-15ef6.firebasestorage.app",
  messagingSenderId: "861492569011",
  appId: "1:861492569011:web:67ade13ee7fdedff62a1c6"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
