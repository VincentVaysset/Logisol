// Plan de campagne prévisionnel (collection Firestore "lgs_plan_campagne",
// un document par campagne, id = l'année de campagne).
//
// Une LIGNE = un stade physiologique prévu sur une fenêtre de dates, avec un
// effectif prévu et sa ration (composants = aliments existants référencés
// par clé, jamais ressaisis, cf. fourrages.js/agrégation des catégories de
// stock). C'est un PLAN, distinct du réel distribué (affectations.js) : les
// deux ne se mélangent jamais à l'écran (cf. CLAUDE.md), seul le bilan
// (rations-calc.js) les confronte.
//
// Contrairement à une distribution réelle (dateFin optionnelle, encore
// ouverte), une ligne de plan a TOUJOURS ses deux bornes connues : un plan
// sert à annoncer un total sur une période délimitée, pas à décrire un état
// en cours. Les deux bornes sont donc INCLUSIVES ici (nbJours = dateFin -
// dateDebut + 1), à la différence de la convention "fin exclue" du reste de
// l'appli qui, elle, décrit une chronologie de faits qui se succèdent sans
// jamais compter un jour deux fois.
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from "../vendor/firebase/firebase-firestore.js";
import { aujourdhui, campagneDeSemis } from './implantations.js';

const COL = 'lgs_plan_campagne';

export function campagneCourante(date = aujourdhui()) {
  return campagneDeSemis(date) || String(new Date(date + 'T12:00:00').getFullYear());
}

let planActuel = null;
let campagneEnCours = null;
const listeners = new Set();
let unsub = null;

export function getPlan() { return planActuel || { campagne: campagneEnCours, stades: [] }; }
export function onPlanChange(cb) { listeners.add(cb); cb(getPlan()); return () => listeners.delete(cb); }

export function watchPlanCampagne(campagne = campagneCourante()) {
  campagneEnCours = campagne;
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, COL, campagne), (snap) => {
    planActuel = snap.exists() ? { id: snap.id, ...snap.data() } : { campagne, stades: [] };
    listeners.forEach((cb) => cb(planActuel));
  });
  return unsub;
}

function idLigne() { return Math.random().toString(36).slice(2, 10); }

function nettoyerLigne(l) {
  return {
    id: l.id || idLigne(),
    stadeId: l.stadeId || null,
    stadeNom: String(l.stadeNom || '').trim(),
    effectifPrevu: Math.max(0, Math.round(Number(l.effectifPrevu) || 0)),
    dateDebut: l.dateDebut,
    dateFin: l.dateFin,
    composants: (l.composants || [])
      .filter((c) => c.stockCle && Number(c.kgParAnimalJour) > 0)
      .map((c) => ({ stockCle: c.stockCle, stockLabel: c.stockLabel, kgParAnimalJour: Number(c.kgParAnimalJour) || 0 }))
  };
}

// Relit depuis Firestore si le cache local n'est pas (encore) celui de la
// campagne visée : une écriture juste après le démarrage de l'appli, avant
// le premier instantané, ne doit pas écraser un plan déjà enregistré.
async function lignesActuelles(campagne) {
  if (planActuel && planActuel.campagne === campagne) return planActuel.stades || [];
  const snap = await getDoc(doc(db, COL, campagne));
  return snap.exists() ? (snap.data().stades || []) : [];
}

export async function ajouterLignePlan(campagne, ligne) {
  if (!ligne.stadeNom) throw new Error('Choisis un stade physiologique.');
  if (!ligne.dateDebut || !ligne.dateFin) throw new Error('Indique la date de début ET la date de fin de cette période.');
  if (ligne.dateFin <= ligne.dateDebut) throw new Error('La date de fin doit être postérieure à la date de début.');
  if (!(Number(ligne.effectifPrevu) > 0)) throw new Error("L'effectif prévu doit être supérieur à 0.");
  const propre = nettoyerLigne(ligne);
  const stades = (await lignesActuelles(campagne)).concat([propre]);
  await setDoc(doc(db, COL, campagne), { campagne, stades, majLe: serverTimestamp() }, { merge: true });
  return propre;
}

export async function supprimerLignePlan(campagne, ligneId) {
  const stades = (await lignesActuelles(campagne)).filter((l) => l.id !== ligneId);
  await setDoc(doc(db, COL, campagne), { campagne, stades, majLe: serverTimestamp() }, { merge: true });
}

// Jours PLANIFIÉS d'une ligne — bornes inclusives (cf. en-tête du fichier).
export function joursLignePlan(ligne) {
  if (!ligne || !ligne.dateDebut || !ligne.dateFin) return 0;
  const j = Math.round(
    (Date.parse(ligne.dateFin + 'T12:00:00') - Date.parse(ligne.dateDebut + 'T12:00:00')) / 86400000
  ) + 1;
  return Math.max(0, j);
}
