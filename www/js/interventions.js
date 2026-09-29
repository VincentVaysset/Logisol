// Journal d'interventions (collection Firestore "interventions").
//
// Une intervention porte sur UNE OU PLUSIEURS parcelles : un épandage couvre
// souvent tout un secteur, et le ressaisir parcelle par parcelle serait à la
// fois pénible et faux (la durée et la quantité concernent le chantier
// entier). Le champ parcelleIds est donc toujours un tableau, même pour une
// seule parcelle — un tableau de chaînes, ce que Firestore accepte sans
// réserve (contrairement aux tableaux imbriqués, cf. geometrie.js).
import { db, auth } from './firebase-config.js';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";
import { ecrire } from './ecriture-locale.js';

const COL = collection(db, 'interventions');

// Tri du plus récent au plus ancien, toutes parcelles mélangées : c'est le fil
// d'activité de l'écran d'accueil. À date égale, la saisie la plus récente
// passe devant.
function parDateDecroissante(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = msDe(a.creeLe);
  const tb = msDe(b.creeLe);
  return tb - ta;
}

function msDe(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

let courantes = [];

// Cache local, en plus du callback historique : évite de faire remonter la
// liste jusqu'ici depuis main.js à chaque nouvel usage (cf. stocks.js/lots.js
// et la plupart des autres modules, qui suivent déjà ce principe) — c'est ce
// qui permet à campagnes.js/ui-intervention.js de relire l'historique d'une
// parcelle sans aller-retour Firestore à chaque frappe.
export function getInterventions() { return courantes; }

export function watchInterventions(onChange) {
  return onSnapshot(COL, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort(parDateDecroissante);
    courantes = list;
    onChange(list);
  });
}

function nettoyer(data) {
  return {
    date: data.date,                                   // "AAAA-MM-JJ"
    typeId: data.typeId || null,
    typeNom: data.typeNom || '',                       // copie figée : le fil
                                                       // reste lisible même si
                                                       // le type est renommé
    parcelleIds: Array.isArray(data.parcelleIds) ? data.parcelleIds.slice() : [],
    // cibleType : les parcelleIds désignent des parcelles OU des bergeries
    // selon ce champ. Un seul tableau plutôt que deux évite d'avoir à traiter
    // partout le cas « les deux sont remplis ».
    cibleType: data.cibleType || 'PARCELLE',
    // 'TERMINE' par défaut : au champ, on saisit ce qu'on vient de faire.
    statut: data.statut === 'A_FAIRE' ? 'A_FAIRE' : 'TERMINE',
    // Mouvement de stock engendré par cette activité, s'il y en a un.
    mouvementId: data.mouvementId || null,
    // INTENTION de mouvement, conservée même quand aucun mouvement n'existe.
    //
    // Une activité « À faire » ne doit rien bouger dans les stocks, mais ce
    // qu'on a prévu (58 t vers le Silo 1) doit être retrouvé tel quel le jour
    // où on la passe à « Terminé ». Sans ce champ, tout ce qui avait été saisi
    // à l'étape 3 était perdu à la réouverture : c'est l'activité qui porte
    // l'intention, le mouvement n'en est que la conséquence sur le stock.
    flux: data.flux || null,
    produit: data.produit || '',
    quantite: data.quantite === '' || data.quantite == null ? null : Number(data.quantite),
    unite: data.unite || '',
    materiel: data.materiel || '',
    materielId: data.materielId || null,
    materielNom: data.materielNom || '',
    dureeHeures: data.dureeHeures === '' || data.dureeHeures == null ? null : Number(data.dureeHeures),
    meteo: data.meteo || null,                         // objet plat, cf. meteo.js
    photo: data.photo || null,                         // data URL JPEG compressée
    // Étiquette de semence : photo distincte de la photo de chantier, gardée
    // comme pièce justificative en cas de contrôle Bio.
    photoEtiquette: data.photoEtiquette || null,
    // En-tête commun à toutes les interventions. campagneId est désormais
    // TOUJOURS calculé (cf. campagnes.js/calculerCampagnes), jamais saisi —
    // sauf surcharge explicite via forcerCampagne, prioritaire sur le calcul.
    campagneId: data.campagneId ? String(data.campagneId) : null,
    forcerCampagne: data.forcerCampagne ? String(data.forcerCampagne) : null,
    chauffeur: String(data.chauffeur || '').trim(),
    // Ce que l'activité a fait à la culture en place, et de quoi le défaire
    // si elle est supprimée : sans cette trace, effacer un labour saisi par
    // erreur laisserait l'assolement détruit pour toujours.
    effetCulture: nettoyerEffetCulture(data.effetCulture),
    // Saisie propre au groupe d'activité (bottes, bennes, remorques, dose...).
    // Un sous-objet plutôt qu'une douzaine de champs à plat : les clés
    // dépendent du type, et les étaler rendrait chaque document illisible.
    saisie: nettoyerSaisie(data.saisie),
    notes: data.notes || ''
  };
}

// Firestore refuse `undefined` et les tableaux imbriqués : on ne garde que
// des nombres, des chaînes, et un tableau d'objets plats pour le mélange.
function nettoyerSaisie(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const nombre = (k) => {
    const v = s[k];
    if (v === '' || v == null) return;
    const n = Number(v);
    if (isFinite(n)) out[k] = n;
  };
  const texte = (k) => {
    const v = String(s[k] == null ? '' : s[k]).trim();
    if (v) out[k] = v;
  };
  ['doseKgHa', 'surfaceHa', 'nbBottes', 'poidsBotteKg', 'nbRemorques',
   'tonnesParRemorque', 'nbBennes', 'tonnageBenne', 'poidsSpecifique',
   // capaciteBenne/remplissageBenne/ps : nouveau modèle (capacité × remplissage
   // × PS, cf. poids-specifique.js). tonnageBenne/poidsSpecifique restent tels
   // quels au-dessus pour les interventions déjà enregistrées avant ce champ —
   // jamais réinterprétés tout seuls (cf. quantiteDeSaisie, corriger-ps.js).
   'capaciteBenne', 'remplissageBenne', 'ps',
   'nbEpandeurs', 'tonnageEpandeur', 'doseTonnesHa', 'numeroCoupe'].forEach(nombre);
  ['semence', 'typeFourrage', 'cultureId', 'typeAliment', 'psUniteSaisie', 'produitRecolte'].forEach(texte);
  if (Array.isArray(s.melange)) {
    const m = s.melange
      .map((x) => ({ nom: String((x && x.nom) || '').trim(), pourcentage: Number((x && x.pourcentage) || 0) }))
      .filter((x) => x.nom || x.pourcentage > 0);
    if (m.length) out.melange = m;
  }
  return Object.keys(out).length ? out : null;
}

function nettoyerEffetCulture(e) {
  if (!e || typeof e !== 'object') return null;
  const cloturees = Array.isArray(e.cloturees)
    ? e.cloturees
        .map((c) => ({ id: String((c && c.id) || ''), finPrecedente: (c && c.finPrecedente) || null }))
        .filter((c) => c.id)
    : [];
  const creees = Array.isArray(e.creees) ? e.creees.map(String).filter(Boolean) : [];
  if (!cloturees.length && !creees.length) return null;
  return { cloturees, creees };
}

// quantiteDeSaisie vit dans poids-specifique.js, un module pur sans aucune
// dépendance Firestore (contrairement à ce fichier-ci) : ça la garde
// testable en Node tel quel. Ré-exportée ici pour que les appelants
// existants (ui-intervention.js) n'aient rien à changer.
export { quantiteDeSaisie } from './poids-specifique.js';

// Plafond Firestore de 1 Mio par document, vérifié par le SERVEUR seulement :
// hors ligne, un document trop lourd est accepté en local puis refusé au
// retour du réseau — donc perdu. Un Semis porte deux photos (chantier +
// étiquette), chacune jusqu'à ~800 ko une fois encodée (cf. photo.js) :
// vérifié AVANT toute écriture, formulaire encore ouvert.
const PLAFOND_OCTETS = 1000 * 1000;
export function verifierTailleIntervention(data) {
  const octets = new Blob([JSON.stringify(nettoyer(data))]).size;
  if (octets > PLAFOND_OCTETS) {
    throw new Error(`Activité trop lourde pour être enregistrée (${Math.round(octets / 1024)} ko, ` +
      'maximum ~980 ko) : retire la photo de chantier ou celle de l\'étiquette, ou reprends-la moins large.');
  }
}

export async function createIntervention(data) {
  if (!data.date) throw new Error('La date est obligatoire.');
  verifierTailleIntervention(data);
  const ref = doc(COL);
  await ecrire(ref, setDoc(ref, {
    ...nettoyer(data),
    creeLe: serverTimestamp(),
    majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  }), 'Activité');
  return ref;
}

export async function updateIntervention(id, data) {
  verifierTailleIntervention(data);
  const ref = doc(db, 'interventions', id);
  await ecrire(ref, updateDoc(ref, { ...nettoyer(data), majLe: serverTimestamp() }), 'Activité');
}

export async function deleteIntervention(id) {
  const ref = doc(db, 'interventions', id);
  await ecrire(ref, deleteDoc(ref), "Suppression d'activité");
}

// Écriture ciblée pour reprise-campagnes.js : seule campagneId (et, à
// l'annulation, campagneAvantReprise) change — passer par updateIntervention
// réécrirait tout le document via nettoyer() avec les valeurs par défaut des
// champs absents de l'appel, effaçant au passage tout le reste de la saisie.
export async function ecrireCampagne(id, { campagneId, campagneAvantReprise }) {
  const maj = { campagneId: campagneId ? String(campagneId) : null, majLe: serverTimestamp() };
  if (campagneAvantReprise !== undefined) {
    maj.campagneAvantReprise = campagneAvantReprise ? String(campagneAvantReprise) : null;
  }
  const ref = doc(db, 'interventions', id);
  await ecrire(ref, updateDoc(ref, maj), 'Campagne');
}
