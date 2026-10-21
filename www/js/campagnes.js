// Campagne d'une activité — LA fonction unique qui décide, pour toutes les
// activités d'UNE parcelle, à quelle campagne chacune appartient.
//
// AVANT cette fonction, deux logiques distinctes coexistaient sans jamais se
// synchroniser :
//   - ui-intervention.js/campagneDeLaDate() : calculée à la SAISIE d'une
//     activité, à partir de son SEUL type + de la date + d'un test ponctuel
//     "la parcelle est-elle en interculture ?" — sans jamais regarder ce qui
//     avait déjà été semé/détruit avant elle sur la même parcelle ;
//   - implantations.js/campagneDeSemis() : calculée à l'enregistrement d'une
//     implantation, pour le champ campagneVisee (utilisé par ce SEUL champ,
//     cf. plus bas — ce n'est plus une seconde source pour l'activité).
// La seconde restait juste (un semis d'août-décembre vise déjà la campagne
// suivante) ; la première ne propageait cette bascule à AUCUNE activité
// suivante sur la même parcelle (roulage, désherbage...), qui retombait sur
// l'année civile brute de sa propre date — d'où le bug : une parcelle semée
// passe en 2027, mais son roulage reste en 2026.
//
// RÈGLE (une seule, ici — le semis n'a PLUS de traitement à part, il suit
// exactement la même règle que tout autre pivot) :
//   - Les activités d'une parcelle sont rejouées par ordre chronologique.
//   - Chaque activité prend max(campagne héritée des travaux, campagne du
//     calendrier de sa date — 01/09 et après : année suivante,
//     calendrier-campagne.js). Une culture pluriannuelle (prairie semée en
//     2024, jamais retravaillée) ne reste donc pas bloquée sur la campagne
//     de son semis : sa coupe de mai 2026 est en 2026.
//   - Campagne héritée : celle du dernier pivot (drapeau pivotCampagne —
//     labour, déchaumage, semis, broyage de destruction...) ; aucune avant
//     le premier pivot.
//   - Le « +1 » ne vient QUE d'une récolte (drapeau recolteCampagne) : le
//     premier pivot qui suit une récolte hérite de la campagne de cette
//     récolte + 1. Jamais par rapport à l'activité précédente : un
//     déchaumage du 06/10 après un épandage du 05/10 (déjà N+1 par le
//     calendrier), sans récolte entre deux, reste en N+1.
//   - Une récolte NE BASCULE JAMAIS elle-même (même une moisson, qui est
//     aussi un pivot) et réarme le « +1 » pour le prochain pivot. Datée du
//     01/09 au 31/12, elle appartient à la culture en place :
//       · un semis / travail du sol a eu lieu depuis la dernière récolte →
//         campagne héritée de ce pivot (dérobée semée le 25/08 après la
//         moisson, fauchée en novembre : 2027) ;
//       · sinon → max(héritée, année civile) (dernière coupe de luzerne en
//         septembre, tournesol moissonné le 25/09 : 2026).
//   - forcerCampagne sur une activité est TOUJOURS prioritaire, et n'altère
//     pas la chaîne pour les activités suivantes (une correction ponctuelle
//     n'a pas à fausser tout ce qui vient après). La valeur que la règle lui
//     aurait donnée reste lisible (resultat.sansForcage), pour que la reprise
//     puisse la montrer « forcée, ignorée ».
// L'implémentation réelle n'est importée qu'À LA DEMANDE (import dynamique),
// jamais au chargement du module : ce fichier reste ainsi testable en Node
// pur (cf. scratchpad/test-campagnes.mjs), sans tirer Firestore/
// firebase-config.js juste pour vérifier l'algorithme avec des dépendances
// injectées.
import { campagneDeDate } from './calendrier-campagne.js';

let modulesReels = null;
async function chargerModulesReels() {
  if (!modulesReels) {
    const typesM = await import('./interventions-types.js');
    const implM = await import('./implantations.js');
    const cultM = await import('./cultures-config.js');
    modulesReels = { getTypeById: typesM.getTypeById, implantationEnCours: implM.implantationEnCours, getCultureById: cultM.getCultureById };
  }
  return modulesReels;
}

// Pré-charge les dépendances réelles — à appeler une fois au bootstrap
// (main.js) avant tout calculerCampagnes() sans deps explicites : l'import
// dynamique est asynchrone, calculerCampagnes() elle-même ne l'est pas.
export async function preparerCampagnes() {
  await chargerModulesReels();
}

function valeurDefaut(defaut, date) {
  if (typeof defaut === 'function') return defaut(date);
  if (defaut != null) return String(defaut);
  return campagneDeDate(date);
}

// Repli par défaut si le type n'a pas encore le drapeau explicite (types
// existants non mis à niveau, cf. interventions-types.js/ensureSeeded) :
// un type déjà marqué DETRUIT ou IMPLANTE se comportait déjà comme un pivot.
export function estPivotCampagne(type) {
  if (!type) return false;
  if (typeof type.pivotCampagne === 'boolean') return type.pivotCampagne;
  const e = type.effetCulture;
  return e === 'DETRUIT' || e === 'IMPLANTE';
}

// Repli par défaut : un type qui rentre quelque chose en stock (moisson,
// pressage, séchage) est de facto une récolte, même sans le drapeau explicite.
export function estRecolteCampagne(type) {
  if (!type) return false;
  if (typeof type.recolteCampagne === 'boolean') return type.recolteCampagne;
  return type.flux === 'ENTREE_STOCK';
}

// Dérobée (colza fourrager entre une céréale et la culture suivante) : rattachée
// à la campagne de la récolte qui la précède (N), sans la faire basculer — ni
// elle, ni le travail du sol qui la prépare. C'est la destruction de la dérobée
// (ou le semis de la culture suivante) qui ouvre N+1. Est « dérobée » : le
// semis d'une culture de famille dérobée, et les récoltes / fauches / pâturages
// faits pendant qu'une dérobée est en place sur la parcelle.
const CATEGORIES_SUR_DEROBEE = ['FOURRAGES', 'RECOLTE_FOURRAGE', 'TROUPEAU'];
export function estSemis(type) {
  return !!type && (type.effetCulture === 'IMPLANTE' || type.formulaire === 'SEMIS');
}
export function estActiviteDerobee(act, type, parcelleId, deps = {}) {
  if (!act || !type) return false;
  if (typeof act.derobee === 'boolean') return act.derobee;
  const { getCultureById, implantationEnCours } = deps;
  const famille = (id) => ((id && getCultureById && getCultureById(id)) || {}).famille;
  const s = act.saisie || {};
  if (estSemis(type)) return s.derobee === true || (s.derobee !== false && famille(s.cultureId) === 'derobee');
  if (!parcelleId || !implantationEnCours || !CATEGORIES_SUR_DEROBEE.includes(type.categorie)) return false;
  const impl = implantationEnCours(parcelleId, act.date);
  return !!impl && (impl.derobee === true || famille(impl.cultureId) === 'derobee');
}

/**
 * Calcule la campagne de chaque activité d'UNE parcelle.
 * @param {Array<{id, date, typeId, forcerCampagne?}>} activitesParcelle
 *        Déjà filtrées à une seule parcelle par l'appelant — la bascule est
 *        intrinsèquement propre à la rotation d'UNE parcelle.
 * @param {string|number|((date:string)=>string)} [defaut]
 *        Campagne à utiliser tant qu'aucun pivot n'a encore rien ancré.
 *        Une fonction (date -> campagne) est recalculée activité par
 *        activité (c'est le cas par défaut : calendrier-campagne.js) ;
 *        une valeur fixe reste constante pour toutes ces activités-là.
 * @param {{getTypeById?:Function}} [deps]
 *        Dépendances injectables (tests Node purs, sans Firestore) ; les
 *        implémentations réelles sont utilisées par défaut.
 * @param {string} [parcelleId]  pour reconnaître une récolte faite sur une dérobée en place
 * @returns {Map<string, string>} id d'activité -> campagne
 */
export function calculerCampagnes(activitesParcelle, defaut, deps = {}, parcelleId = null) {
  // Repli sur les modules réels seulement s'ils ont déjà été chargés (cf.
  // preparerCampagnes(), appelée au bootstrap) : un appel sans deps ni
  // préparation préalable échouerait clairement plutôt que de tirer
  // Firestore en silence au milieu d'un calcul synchrone.
  const reels = modulesReels || {};
  const getTypeById = deps.getTypeById || reels.getTypeById;
  if (!getTypeById) {
    throw new Error('calculerCampagnes : dépendances manquantes — appelle preparerCampagnes() au démarrage, ou passe-les explicitement (deps).');
  }

  const tri = (activitesParcelle || [])
    .filter((a) => a && a.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const depsDerobee = {
    getCultureById: deps.getCultureById || reels.getCultureById,
    implantationEnCours: deps.implantationEnCours || reels.implantationEnCours
  };
  const infos = tri.map((act) => {
    const type = getTypeById(act.typeId);
    return { type, derobee: estActiviteDerobee(act, type, parcelleId, depsDerobee) };
  });
  // Pivot qui prépare une dérobée : le premier semis qui le suit (avant toute
  // autre récolte) est celui d'une dérobée.
  const prepareDerobee = (i) => {
    for (let j = i + 1; j < tri.length; j++) {
      const { type, derobee } = infos[j];
      if (estSemis(type)) return derobee;
      if (!derobee && estRecolteCampagne(type)) return false;
    }
    return false;
  };

  let herite = null;          // campagne du dernier pivot
  let campagneDerobee = null; // campagne de la dérobée en place (N)
  let campagneRecolte = null; // campagne de la dernière récolte depuis ce pivot (« +1 » armé)
  const resultat = new Map();
  const sansForcage = new Map();
  const maxi = (...v) => String(Math.max(...v.filter((x) => x != null && x !== '').map(Number)));

  for (let i = 0; i < tri.length; i++) {
    const act = tri[i];
    const { type, derobee } = infos[i];
    const estPivot = estPivotCampagne(type);
    const estRecolte = estRecolteCampagne(type);
    const cal = valeurDefaut(defaut, act.date);
    let valeur;
    let chaine = true; // l'activité fait-elle avancer la chaîne (pivot / récolte) ?
    const preparation = !derobee && estPivot && !estRecolte && prepareDerobee(i);
    if (derobee || preparation) {
      if (campagneDerobee == null) campagneDerobee = campagneRecolte != null ? campagneRecolte : (herite != null ? herite : cal);
      valeur = campagneDerobee;
      chaine = false;
    } else if (estRecolte) {
      const automne = Number(String(act.date).slice(5, 7)) >= 9;
      // Semis / travail du sol depuis la dernière récolte : c'est sa culture
      // qu'on récolte (dérobée semée fin août, fauchée en novembre).
      const pivotDepuisRecolte = herite != null && campagneRecolte == null;
      if (automne && pivotDepuisRecolte) valeur = herite;
      else valeur = maxi(herite, automne ? String(act.date).slice(0, 4) : cal);
    } else if (estPivot && campagneRecolte != null) {
      valeur = maxi(Number(campagneRecolte) + 1, cal);
    } else {
      valeur = maxi(herite, cal);
    }
    // Plafond : une activité n'appartient jamais au-delà de la campagne
    // « année civile + 1 ». Sans lui, une récolte d'automne déjà en N+1
    // (pressage de paille après déchaumage, coupe d'une dérobée) réarmait le
    // « +1 » et le pivot suivant partait en N+2 (bug 2028), propagé ensuite
    // à toutes les activités de la parcelle.
    const plafond = Number(String(act.date).slice(0, 4)) + 1;
    if (Number(valeur) > plafond) valeur = String(plafond);
    sansForcage.set(act.id, valeur);
    if (act.forcerCampagne) {
      resultat.set(act.id, String(act.forcerCampagne));
      continue; // n'affecte jamais la chaîne pour les activités suivantes
    }
    resultat.set(act.id, valeur);
    if (!chaine) continue;
    if (estPivot) campagneDerobee = null;
    if (estRecolte) {
      if (estPivot) herite = valeur;
      campagneRecolte = valeur;
    } else if (estPivot) {
      herite = valeur;
      campagneRecolte = null;
    }
  }

  resultat.sansForcage = sansForcage;
  return resultat;
}
