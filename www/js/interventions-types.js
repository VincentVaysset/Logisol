// Types d'intervention (collection Firestore "interventions_types") : liste
// prédéfinie, complétable librement — un DOCUMENT par type.
//
// Chaque type porte quatre métadonnées qui pilotent le tunnel de saisie :
//   categorie  — regroupement affiché à l'étape 1 ;
//   cible      — sur quoi l'activité porte (parcelle, bergerie, ou les deux),
//                ce qui filtre la liste dès que la cible est choisie ;
//   flux       — ce que l'étape 3 doit demander : rien, une entrée en stock
//                (récolte), ou une distribution (source + destination) ;
//   formulaire — le bloc de saisie propre au groupe, à l'étape 2 (bottes,
//                bennes, remorques, dose...). null = rien de spécifique ;
//   effetCulture — ce que le passage fait à la culture en place :
//                'DETRUIT' (le sol est retourné ou travaillé : ce qui poussait
//                n'y est plus) ou 'IMPLANTE' (un semis clôture la précédente
//                et en démarre une nouvelle). null = sans effet.
//   pivotCampagne   — ce passage fait-il basculer la campagne agricole de la
//                parcelle (cf. campagnes.js/calculerCampagnes) ? Modifiable
//                depuis Paramètres, indépendamment d'effetCulture.
//   recolteCampagne — ce passage réarme-t-il la bascule (une récolte a eu
//                lieu, le prochain pivot ouvrira la campagne suivante) ?
//
// EXPLOITATION BIO : il n'y a volontairement AUCUN groupe « Protection /
// Phyto ». Les anciens types de traitement des cultures sont masqués (voir
// MASQUES) et non supprimés, pour que les interventions déjà saisies gardent
// un libellé cohérent.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, getDocs, onSnapshot
} from "../vendor/firebase/firebase-firestore.js";

const COL = collection(db, 'interventions_types');

// Jeux de champs de l'ancien bloc « Détails ». TRAVAIL n'a pas de « produit » :
// en Bio, aucun engrais ni amendement de synthèse n'est à saisir sur un
// passage d'outil, et le chaulage a sa propre dose.
const COMPLET = ['produit', 'materiel', 'duree', 'meteo'];
const TRAVAIL = ['materiel', 'duree', 'meteo'];
const SOIN    = ['produit', 'duree'];

export const TYPE_NOTE = 'Note';

export const CATEGORIES = [
  { value: 'SEMIS',            label: 'Semis',                      icone: '🌱' },
  { value: 'FOURRAGES',        label: 'Fourrages',                  icone: '🌾' },
  { value: 'RECOLTE_FOURRAGE', label: 'Récolte fourrages',          icone: '📦' },
  { value: 'MOISSON',          label: 'Moisson',                    icone: '🌽' },
  { value: 'EPANDAGE',         label: 'Épandage',                   icone: '💩' },
  { value: 'SOL',              label: 'Travail du sol & entretien', icone: '⚙️' },
  { value: 'TROUPEAU',         label: 'Troupeau / élevage',         icone: '🐑' },
  { value: 'AUTRE',            label: 'Divers',                     icone: '📝' }
];

/** @typedef {'ENTREE_STOCK'|'DISTRIBUTION'|null} FluxType */
/** @typedef {'PARCELLE'|'BERGERIE'|'LES_DEUX'} CibleType */
/** @typedef {'SEMIS'|'SURFACE'|'PRESSAGE'|'SECHAGE'|'MOISSON'|'FUMIER'|'CHAULAGE'|null} FormulaireType */
/** @typedef {'DETRUIT'|'IMPLANTE'|null} EffetCulture */

// Liste de référence. Les types déjà présents en base sont mis à jour sur
// place (mêmes documents, donc les interventions existantes gardent leur
// rattachement) ; les manquants sont ajoutés. Rien n'est jamais supprimé.
//
// pivotCampagne/recolteCampagne par défaut : repris de l'ancienne inférence
// effetCulture/flux (cf. campagnes.js/estPivotCampagne,estRecolteCampagne),
// désormais des champs explicites modifiables depuis Paramètres.
const TYPES_PAR_DEFAUT = [
  // --- 🌱 Semis ---
  { nom: 'Semis (semoir + tasse-avant)', icone: '🌱', couleur: '#5b8c5a', categorie: 'SEMIS', cible: 'PARCELLE', flux: null, formulaire: 'SEMIS', effetCulture: 'IMPLANTE', pivotCampagne: true, recolteCampagne: false, champs: TRAVAIL },

  // --- 🌾 Fourrages : préparation de l'andain, aucune entrée en stock ---
  // Rattacher un stock à la fauche ferait compter le fourrage deux fois :
  // seuls le pressage et le séchage en grange rentrent quelque chose.
  { nom: 'Fauche',                       icone: '🚜', couleur: '#4f9c5f', categorie: 'FOURRAGES', cible: 'PARCELLE', flux: null, formulaire: 'SURFACE', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Pirouette / Fanage',           icone: '☀️', couleur: '#e0a326', categorie: 'FOURRAGES', cible: 'PARCELLE', flux: null, formulaire: 'SURFACE', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Andainage',                    icone: '🌾', couleur: '#d4a53f', categorie: 'FOURRAGES', cible: 'PARCELLE', flux: null, formulaire: 'SURFACE', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },

  // --- 📦 Récolte fourrages : entrée en stock OBLIGATOIRE ---
  // recolteCampagne: false — un pressage (foin ou paille) est UNE des
  // récoltes possibles d'une parcelle, jamais celle qui clôt une campagne :
  // une luzerne fauchée plusieurs fois par an ne doit pas réarmer la
  // bascule à chaque coupe, et la paille n'est qu'un sous-produit de la
  // moisson (déjà recolteCampagne) sur une céréale — cf. campagnes.js.
  { nom: 'Pressage (bottes)',            icone: '🧻', couleur: '#b98b2f', categorie: 'RECOLTE_FOURRAGE', cible: 'PARCELLE', flux: 'ENTREE_STOCK', formulaire: 'PRESSAGE', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Séchage en grange',            icone: '🚛', couleur: '#c98a3e', categorie: 'RECOLTE_FOURRAGE', cible: 'PARCELLE', flux: 'ENTREE_STOCK', formulaire: 'SECHAGE', pivotCampagne: false, recolteCampagne: true, champs: TRAVAIL },

  // --- 🌽 Moisson : entrée en stock OBLIGATOIRE, en cellule à grain ---
  // effetCulture: DETRUIT — la moisson clôt la culture en place à la date de
  // récolte (comme un déchaumage/labour) : la parcelle passe alors en
  // interculture (chaumes) plutôt que de rester bloquée sur la céréale
  // récoltée jusqu'au prochain déchaumage. C'est aussi une récolte : elle
  // réarme la bascule pour le prochain pivot (cf. campagnes.js).
  { nom: 'Moisson',                      icone: '🌽', couleur: '#c98a3e', categorie: 'MOISSON', cible: 'PARCELLE', flux: 'ENTREE_STOCK', formulaire: 'MOISSON', effetCulture: 'DETRUIT', pivotCampagne: true, recolteCampagne: true, champs: TRAVAIL },

  // --- 💩 Épandage ---
  { nom: 'Épandage fumier',              icone: '💩', couleur: '#8a6d5c', categorie: 'EPANDAGE', cible: 'PARCELLE', flux: null, formulaire: 'FUMIER', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },

  // --- ⚙️ Travail du sol & entretien ---
  { nom: 'Déchaumage',                   icone: '🌾', couleur: '#a08a5c', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, effetCulture: 'DETRUIT', pivotCampagne: true, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Alignement pierres',           icone: '🪨', couleur: '#8d8878', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Broyage pierres (casseuse)',   icone: '🧱', couleur: '#79765f', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Labour',                       icone: '🔵', couleur: '#6b5344', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, effetCulture: 'DETRUIT', pivotCampagne: true, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Vibroculteur',                 icone: '〰️', couleur: '#8a7c5c', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, effetCulture: 'DETRUIT', pivotCampagne: true, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Roulage',                      icone: '🛞', couleur: '#79765f', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },
  { nom: 'Chaulage',                     icone: '🤍', couleur: '#b9b4a4', categorie: 'SOL', cible: 'PARCELLE', flux: null, formulaire: 'CHAULAGE', pivotCampagne: false, recolteCampagne: false, champs: TRAVAIL },

  // --- 🐑 Troupeau / élevage ---
  { nom: 'Pâturage',                     icone: '🐑', couleur: '#3f6b3a', categorie: 'TROUPEAU', cible: 'PARCELLE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: ['duree', 'meteo'] },
  { nom: 'Distribution alimentation',    icone: '🥣', couleur: '#5b8c5a', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: 'DISTRIBUTION', formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: ['duree'] },
  { nom: 'Allotement',                   icone: '🔀', couleur: '#6b8fa8', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: ['duree'] },
  { nom: 'Soin',                         icone: '💉', couleur: '#a8557a', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: SOIN },
  { nom: 'Traitement sanitaire',         icone: '🩺', couleur: '#b5546b', categorie: 'TROUPEAU', cible: 'BERGERIE', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: SOIN },

  // --- 📝 Divers ---
  { nom: 'Note',                         icone: '📝', couleur: '#79765f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: [] },
  { nom: 'Observation',                  icone: '👁️', couleur: '#79765f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: ['meteo'] },
  { nom: 'Autre',                        icone: '🔧', couleur: '#9a988f', categorie: 'AUTRE', cible: 'LES_DEUX', flux: null, formulaire: null, pivotCampagne: false, recolteCampagne: false, champs: COMPLET }
];


// Types dont le libellé a été précisé au fil des versions. Le document est
// CONSERVÉ (même id) et seulement renommé : les interventions déjà saisies
// restent rattachées, et leur libellé figé garde de toute façon l'ancien nom
// dans le fil d'activités.
const RENOMMAGES = {
  'Récolte': 'Moisson',
  'Fauche / Enrubannage': 'Fauche',
  'Épandage': 'Épandage fumier',
  'Fanage': 'Pirouette / Fanage',
  'Pressage': 'Pressage (bottes)',
  'Semis': 'Semis (semoir + tasse-avant)',
  'Ramassage vrac (séchage en grange)': 'Séchage en grange'
};

// Types génériques des premières versions, remplacés par le vocabulaire réel
// mais JAMAIS supprimés : des interventions y sont peut-être rattachées, et
// effacer un type rendrait leur historique incohérent. Ils sont simplement
// rangés en fin de liste, dans « Divers », pour ne pas encombrer le choix.
const HERITAGE = [
  'Travail du sol', 'Épierrage', 'Irrigation', 'Fertilisation'
];

// Traitement des cultures : hors sujet sur une exploitation Bio. Masqués du
// choix d'activité (et non supprimés, cf. ci-dessus). « Traitement
// sanitaire », qui concerne le troupeau et non les cultures, reste proposé.
//
// « Distribution alimentation » : masqué depuis le refactor Prévisionnel/
// Distribué (audit troupeau/stocks) — l'alimentation du troupeau passe
// désormais exclusivement par les distributions (ui-rations.js/
// distribuerRation), plus par une activité de tunnel qui écrivait un
// mouvement SORTIE_ALIMENTATION manuel (double compte avec les
// distributions, cf. fourrages.js/stockDisponibleCanonique).
const MASQUES = ['Désherbage', 'Traitement', 'Traitement phytosanitaire', 'Protection', 'Phyto', 'Distribution alimentation'];

let courants = [];
const listeners = new Set();

export function getTypes() { return courants; }
export function getTypeById(id) { return courants.find((t) => t.id === id) || null; }
export function onTypesChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function typeAffiche(type, champ) {
  if (!type) return true;
  if (!Array.isArray(type.champs)) return true;
  return type.champs.includes(champ);
}
export function estNote(type) { return !!type && type.nom === TYPE_NOTE; }

// Un type personnalisé créé avant l'existence des catégories n'en a pas, et
// un type rangé dans une catégorie qui n'existe plus (« Céréales », fondue
// dans « Moisson ») ne doit pas disparaître du tunnel : dans les deux cas on
// le range dans « Divers » plutôt que de le perdre.
export function categorieDe(type) {
  const c = type && type.categorie;
  return CATEGORIES.some((x) => x.value === c) ? c : 'AUTRE';
}
export function cibleDe(type) {
  return (type && type.cible) || 'LES_DEUX';
}
export function fluxDe(type) {
  return (type && type.flux) || null;
}
export function formulaireDe(type) {
  return (type && type.formulaire) || null;
}

// Un déchaumage, un labour ou un coup de vibroculteur retournent le sol : ce
// qui poussait là n'y est plus. Un semis fait la même chose ET démarre la
// culture suivante. Laisser l'ancienne culture ouverte ferait dire à la carte
// et au croisement coupe × fourrage qu'une luzerne pousse encore sur une
// parcelle labourée il y a trois mois.
export function effetCultureDe(type) {
  return (type && type.effetCulture) || null;
}

// Drapeaux de campagnes.js/calculerCampagnes, portés par le type lui-même
// (modifiables depuis Paramètres) — repli sur l'ancienne inférence
// effetCulture/flux pour un type créé avant l'existence de ces deux champs.
export function pivotCampagneDe(type) {
  if (!type) return false;
  if (typeof type.pivotCampagne === 'boolean') return type.pivotCampagne;
  const e = effetCultureDe(type);
  return e === 'DETRUIT' || e === 'IMPLANTE';
}
export function recolteCampagneDe(type) {
  if (!type) return false;
  if (typeof type.recolteCampagne === 'boolean') return type.recolteCampagne;
  return fluxDe(type) === 'ENTREE_STOCK';
}

// Écrit les deux drapeaux depuis le panneau de configuration Paramètres.
export async function setPivotRecolte(typeId, { pivotCampagne, recolteCampagne }) {
  await setDoc(doc(db, 'interventions_types', typeId), {
    pivotCampagne: !!pivotCampagne,
    recolteCampagne: !!recolteCampagne
  }, { merge: true });
}

// Une récolte DOIT rentrer son produit quelque part : c'est ce qui garantit
// que les tonnages saisis au champ alimentent bien l'onglet Stocks, puis les
// rations. Sans cette obligation, un pressage saisi sans destination
// disparaîtrait des stocks sans que rien ne le signale.
export function fluxObligatoire(type) {
  return fluxDe(type) === 'ENTREE_STOCK';
}

export function estMasque(type) { return !!(type && type.masque); }

export function typesPourCible(cible, liste = courants) {
  return liste.filter((t) => {
    if (estMasque(t)) return false;
    const c = cibleDe(t);
    return c === 'LES_DEUX' || c === cible;
  });
}

// Clé de recherche insensible à la casse et aux espaces parasites — sans
// ça, un type saisi un jour "Moisson " (espace final) ou "moisson"
// (minuscule), par exemple via "+ Action sur mesure" ou une ancienne
// version, ne se reconnaît jamais comme le "Moisson" par défaut : deux
// documents coexistent, celui qu'on met à niveau ici (effetCulture: DETRUIT
// compris) et un doublon oublié sans effet sur la culture — la parcelle
// choisie via ce doublon reste alors bloquée sur son ancienne céréale au
// lieu de basculer en Interculture (chaumes), quelle que soit celle-ci.
function cleNom(nom) {
  return String(nom || '').trim().toLowerCase();
}

/**
 * Amorce et met à niveau la liste des types.
 * Idempotent : les documents existants sont retrouvés par leur nom (ancien ou
 * nouveau, comparé sans casse ni espaces) et complétés, les manquants créés.
 * Aucun type n'est supprimé, y compris ceux créés à la main depuis l'appli.
 * Si plusieurs documents partagent le même nom normalisé (doublon issu d'une
 * saisie à la casse différente), TOUS sont mis à niveau, pas seulement le
 * premier trouvé — sinon le doublon resterait sans effet sur la culture.
 */
export async function ensureSeeded() {
  const snap = await getDocs(COL);
  const parNom = new Map(); // clé normalisée -> [{id, ...}]
  snap.docs.forEach((d) => {
    const k = cleNom(d.data().nom);
    if (!parNom.has(k)) parNom.set(k, []);
    parNom.get(k).push({ id: d.id, ...d.data() });
  });

  // Les anciens types génériques sont rétrogradés dans « Divers » plutôt que
  // laissés dans des catégories qui n'existent plus.
  for (const nom of HERITAGE) {
    for (const h of parNom.get(cleNom(nom)) || []) {
      if (h.categorie !== 'AUTRE' || !h.heritage) {
        await setDoc(doc(db, 'interventions_types', h.id), { categorie: 'AUTRE', heritage: true }, { merge: true });
      }
    }
  }

  // Traitements de culture : masqués, pas effacés.
  for (const nom of MASQUES) {
    for (const m of parNom.get(cleNom(nom)) || []) {
      if (!m.masque) {
        await setDoc(doc(db, 'interventions_types', m.id), { masque: true, heritage: true, categorie: 'AUTRE' }, { merge: true });
      }
    }
  }

  for (const t of TYPES_PAR_DEFAUT) {
    const ancienNom = Object.keys(RENOMMAGES).find((k) => RENOMMAGES[k] === t.nom);
    const existants = (parNom.get(cleNom(t.nom)) || [])
      .concat(ancienNom ? (parNom.get(cleNom(ancienNom)) || []) : []);
    if (existants.length) {
      for (const existant of existants) {
        // Mise à niveau : on n'écrase QUE les métadonnées de classement et de
        // formulaire, pas la couleur ni l'icône que l'exploitant aurait pu
        // personnaliser. « champs » en fait partie : c'est lui qui retire le
        // champ engrais/amendement du semis, il doit donc être resynchronisé.
        const maj = {};
        if (existant.nom !== t.nom) maj.nom = t.nom;
        if (existant.categorie !== t.categorie) maj.categorie = t.categorie;
        if (existant.cible !== t.cible) maj.cible = t.cible;
        if ((existant.flux || null) !== (t.flux || null)) maj.flux = t.flux;
        if ((existant.formulaire || null) !== (t.formulaire || null)) maj.formulaire = t.formulaire;
        if ((existant.effetCulture || null) !== (t.effetCulture || null)) maj.effetCulture = t.effetCulture || null;
        // pivotCampagne/recolteCampagne : seedés seulement s'ils sont encore
        // absents (undefined) — une fois posés, une modification depuis le
        // panneau Paramètres (setPivotRecolte) ne doit plus être écrasée à
        // chaque ensureSeeded().
        if (typeof existant.pivotCampagne !== 'boolean') maj.pivotCampagne = !!t.pivotCampagne;
        if (typeof existant.recolteCampagne !== 'boolean') maj.recolteCampagne = !!t.recolteCampagne;
        if (!memesChamps(existant.champs, t.champs)) maj.champs = t.champs;
        if (existant.masque) maj.masque = false;
        if (existant.heritage) maj.heritage = false;
        if (Object.keys(maj).length) await setDoc(doc(db, 'interventions_types', existant.id), maj, { merge: true });
      }
    } else {
      await addDoc(COL, t);
    }
  }
}

function memesChamps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function watchTypes() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ordre(a) - ordre(b) || String(a.nom).localeCompare(String(b.nom), 'fr'));
    listeners.forEach((cb) => cb(courants));
  });
}

function ordre(t) {
  if (t.nom === TYPE_NOTE) return -1;
  if (t.heritage) return 2000;          // anciens types génériques, tout en bas
  const i = TYPES_PAR_DEFAUT.findIndex((d) => d.nom === t.nom);
  return i === -1 ? 1000 : i;           // types sur mesure juste avant
}

export async function addType(nom, icone, couleur, extra = {}) {
  const ref = await addDoc(COL, {
    nom,
    icone: icone || '🔧',
    couleur: couleur || '#9a988f',
    categorie: extra.categorie || 'AUTRE',
    cible: extra.cible || 'LES_DEUX',
    flux: extra.flux || null,
    formulaire: null,
    // Une action inventée ne touche pas à la culture en place sans que
    // l'exploitant l'ait demandé : détruire un assolement par surprise serait
    // la pire des initiatives, ni ne fait basculer de campagne.
    effetCulture: null,
    pivotCampagne: false,
    recolteCampagne: false,
    champs: TRAVAIL
  });
  return ref.id;
}
