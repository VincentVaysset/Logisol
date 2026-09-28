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
//   - Un type "pivot" (drapeau pivotCampagne — labour, déchaumage, semis,
//     broyage de destruction...) fait basculer la campagne à N+1 si :
//       (a) un type "récolte" (drapeau recolteCampagne) a eu lieu depuis le
//           dernier pivot ("bascule armée") ; OU
//       (b) aucun pivot n'a encore jamais ancré la chaîne de cette parcelle
//           ET une activité — de n'importe quel type — existe déjà avant lui
//           dans l'historique (pâturage, coupe, autre culture...) : ce pivot
//           clôt alors implicitement une campagne jamais formellement
//           ouverte dans l'appli.
//     Le TOUT PREMIER ÉVÉNEMENT d'une parcelle — rien du tout avant lui,
//     pas même une activité non-pivot — n'a rien à clore : il ancre une
//     campagne par défaut, sans bascule.
//   - Une récolte NE BASCULE JAMAIS elle-même (elle reste dans la campagne
//     où elle a eu lieu, même si elle est aussi un pivot — cf. la moisson,
//     qui clôt la culture ET rentre un produit) ; elle ancre sans progresser,
//     et réarme la bascule pour le PROCHAIN pivot.
//   - Les pivots suivants, une fois la chaîne ancrée et sans récolte entre
//     deux (ex. déchaumage -> labour), restent dans la même campagne : pas
//     de nouvelle bascule.
//   - Toute activité NON pivot hérite de la campagne courante (celle du
//     dernier pivot rencontré) mais n'ancre jamais elle-même la chaîne.
//   - Avant le premier pivot d'une parcelle : chaque activité reprend la
//     règle par défaut (l'année civile de sa propre date, sauf valeur
//     imposée par l'appelant) — c'est ce qui fait qu'une luzerne sans jamais
//     aucun pivot (donc sans bascule) voit quand même ses coupes annuelles
//     réparties sur la bonne année civile, une par une.
//   - forcerCampagne sur une activité est TOUJOURS prioritaire, et n'altère
//     pas la chaîne pour les activités suivantes (une correction ponctuelle
//     n'a pas à fausser tout ce qui vient après).
// L'implémentation réelle n'est importée qu'À LA DEMANDE (import dynamique),
// jamais au chargement du module : ce fichier reste ainsi testable en Node
// pur (cf. scratchpad/test-campagnes.mjs), sans tirer Firestore/
// firebase-config.js juste pour vérifier l'algorithme avec des dépendances
// injectées.
let modulesReels = null;
async function chargerModulesReels() {
  if (!modulesReels) {
    const typesM = await import('./interventions-types.js');
    modulesReels = { getTypeById: typesM.getTypeById };
  }
  return modulesReels;
}

// Pré-charge les dépendances réelles — à appeler une fois au bootstrap
// (main.js) avant tout calculerCampagnes() sans deps explicites : l'import
// dynamique est asynchrone, calculerCampagnes() elle-même ne l'est pas.
export async function preparerCampagnes() {
  await chargerModulesReels();
}

function anneeDe(dateIso) {
  const m = String(dateIso || '').match(/^(\d{4})/);
  return m ? m[1] : null;
}

function valeurDefaut(defaut, date) {
  if (typeof defaut === 'function') return defaut(date);
  if (defaut != null) return String(defaut);
  return anneeDe(date);
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

/**
 * Calcule la campagne de chaque activité d'UNE parcelle.
 * @param {Array<{id, date, typeId, forcerCampagne?}>} activitesParcelle
 *        Déjà filtrées à une seule parcelle par l'appelant — la bascule est
 *        intrinsèquement propre à la rotation d'UNE parcelle.
 * @param {string|number|((date:string)=>string)} [defaut]
 *        Campagne à utiliser tant qu'aucun pivot n'a encore rien ancré.
 *        Une fonction (date -> campagne) est recalculée activité par
 *        activité (c'est le cas par défaut : l'année civile de la date) ;
 *        une valeur fixe reste constante pour toutes ces activités-là.
 * @param {{getTypeById?:Function}} [deps]
 *        Dépendances injectables (tests Node purs, sans Firestore) ; les
 *        implémentations réelles sont utilisées par défaut.
 * @returns {Map<string, string>} id d'activité -> campagne
 */
export function calculerCampagnes(activitesParcelle, defaut, deps = {}) {
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

  let campagneActuelle = null; // pas encore ancrée par un pivot
  let basculeArmee = false;    // une récolte a eu lieu depuis le dernier pivot
  const resultat = new Map();

  for (let i = 0; i < tri.length; i++) {
    const act = tri[i];
    if (act.forcerCampagne) {
      resultat.set(act.id, String(act.forcerCampagne));
      continue; // n'affecte jamais la chaîne pour les activités suivantes
    }

    const type = getTypeById(act.typeId);
    const estRecolte = estRecolteCampagne(type);
    const base = campagneActuelle != null ? campagneActuelle : valeurDefaut(defaut, act.date);
    // Rien du tout avant cette activité (même pas une activité non-pivot) :
    // il n'y a formellement rien à clore, donc pas de bascule implicite.
    const estTresPremierEvenement = i === 0;
    let valeur;

    if (estPivotCampagne(type)) {
      if (estRecolte) {
        // Une récolte ne bascule jamais elle-même, même si elle est aussi un
        // pivot (moisson) : elle ancre sans progresser.
        campagneActuelle = base;
      } else if (basculeArmee || (campagneActuelle == null && !estTresPremierEvenement)) {
        campagneActuelle = String(Number(base) + 1);
      } else {
        // Premier pivot d'une parcelle vierge (rien avant lui), ou pivots
        // successifs sans récolte entre deux (ex. déchaumage -> labour) :
        // ancre sans faire progresser.
        campagneActuelle = base;
      }
      basculeArmee = false;
      valeur = campagneActuelle;
    } else {
      // Hérite de la campagne courante pour CETTE activité seulement — mais
      // n'ancre pas la chaîne : tant qu'aucun pivot n'a jamais rien ancré
      // (campagneActuelle reste null), chaque activité suivante doit encore
      // recalculer sa propre valeur par défaut (cas d'une culture pérenne
      // sans aucune destruction, ex. luzerne sur plusieurs années).
      valeur = base;
    }

    resultat.set(act.id, valeur);
    if (estRecolte) basculeArmee = true;
  }

  return resultat;
}
