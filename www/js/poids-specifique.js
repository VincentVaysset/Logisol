// Poids réel d'une benne de céréales — 1 m³ de grain ne pèse pas 1 t, il faut
// multiplier par le poids spécifique (PS). Fonction pure, sans aucune
// dépendance (ni Firestore, ni un autre module) : testable en Node tel quel.
//
// AVANT cette fonction, le PS existait déjà comme champ de saisie
// (#itv-ps, saisie.poidsSpecifique) mais n'était JAMAIS appliqué au calcul :
// interventions.js/quantiteDeSaisie faisait nbBennes × tonnageBenne, une
// tonne saisie directement par benne, sans lien avec un volume ni un PS.
//
// Codes "fourrage" (foin, enrubannage, paille, ensilage) dupliqués ici en
// donnée plate plutôt qu'importés de batiments.js, qui traîne
// firebase-config.js à son chargement — même principe que campagnes.js.
const CODES_FOURRAGE = ['FOIN', 'ENRUBANNAGE', 'PAILLE', 'SILAGE'];

/** Un type d'aliment est-il une céréale/grain (PS pertinent) ? Tout ce qui
 * n'est pas explicitement un fourrage l'est — y compris une espèce inconnue
 * ou non encore déduite (null) : le formulaire Moisson ne sert de toute
 * façon qu'à la récolte de grain. */
export function estCerealeAliment(typeAliment) {
  return !CODES_FOURRAGE.includes(typeAliment);
}

function arrondi(v, decimales) {
  const f = 10 ** decimales;
  return Math.round((Number(v) || 0) * f) / f;
}
function arrondi3(v) { return arrondi(v, 3); }

/**
 * Normalise un PS saisi en t/m³. Accepte aussi le kg/hL (ex. 70), détecté
 * par la valeur : aucun PS en t/m³ ne dépasse 1,2 (cf. psValide), alors
 * qu'un PS en kg/hL est toujours nettement au-dessus de 5 — 70 kg/hL devient
 * ainsi 0,70 t/m³ (1 kg/hL = 1 kg / 0,1 m³ = 0,01 t/m³).
 * @returns {number|null} en t/m³, ou null si rien de saisi/invalide.
 */
export function psVersTonnesM3(ps) {
  if (ps == null || ps === '') return null;
  const v = Number(ps);
  if (!isFinite(v) || v <= 0) return null;
  return v > 5 ? arrondi(v / 100, 4) : v;
}

/** PS plausible pour un grain : entre 0,3 et 1,2 t/m³ — alerte non
 * bloquante si en dehors (une saisie en dehors n'empêche jamais d'enregistrer). */
export function psValide(psTonnesM3) {
  return psTonnesM3 != null && psTonnesM3 >= 0.3 && psTonnesM3 <= 1.2;
}

/**
 * Poids réel d'UNE benne : capacité (m³) × PS (t/m³). PS vide -> 1
 * (comportement d'avant ce champ, une benne pleine "pèse" son volume). Un
 * type d'aliment fourrage (foin, paille...) ignore le PS : le tonnage reste
 * le volume de la benne, inchangé.
 * @param {number} capacite      capacité de la benne, en m³.
 * @param {number|string} ps     t/m³ ou kg/hL (converti automatiquement).
 * @param {string} [typeAliment] code d'espèce/fourrage — cf. estCerealeAliment.
 * @returns {number} tonnes, arrondies à 3 décimales.
 */
export function tonnesReelles(capacite, ps, typeAliment) {
  const cap = Number(capacite) || 0;
  if (!estCerealeAliment(typeAliment)) return arrondi3(cap);
  const psNormalise = psVersTonnesM3(ps);
  const facteur = psNormalise != null ? psNormalise : 1;
  return arrondi3(cap * facteur);
}

// Ancienne formule (avec un facteur remplissage %, retiré du formulaire) —
// gardée UNIQUEMENT pour ne JAMAIS recalculer en silence une intervention
// déjà enregistrée avant ce retrait : cf. quantiteDeSaisie ci-dessous, et
// corriger-remplissage.js pour la correction explicite, ligne par ligne.
function tonnesReellesAvecRemplissage(capacite, remplissage, ps, typeAliment) {
  const cap = Number(capacite) || 0;
  const rempl = remplissage == null || remplissage === '' ? 100 : Number(remplissage) || 0;
  const volume = cap * (rempl / 100);
  if (!estCerealeAliment(typeAliment)) return arrondi3(volume);
  const psNormalise = psVersTonnesM3(ps);
  const facteur = psNormalise != null ? psNormalise : 1;
  return arrondi3(volume * facteur);
}

/**
 * Total calculé d'une saisie de récolte, dans l'unité du contenant visé.
 * LA seule fonction qui calcule ce total — stocks, bilan, "à acheter", fiche
 * aliment et journal ne font que LIRE la quantité qu'elle a produite (celle
 * du mouvement de stock créé par l'activité), jamais un recalcul séparé.
 * Vit ici plutôt que dans interventions.js (qui importe firebase-config.js,
 * donc injoignable en Node pur) pour rester testable telle qu'exécutée par
 * l'appli — interventions.js ne fait que la ré-exporter.
 *
 * MOISSON a quatre cas, jamais mélangés (cf. CLAUDE.md — une reprise
 * d'historique n'écrit jamais toute seule) :
 *   1) capaciteBenne renseignée ET remplissageBenne encore présent :
 *      intervention enregistrée avant le retrait du champ Remplissage —
 *      formule figée telle quelle (tonnesReellesAvecRemplissage), jamais
 *      recalculée toute seule. "Corriger" (corriger-remplissage.js) retire
 *      explicitement ce facteur, ligne par ligne.
 *   2) capaciteBenne renseignée, sans remplissageBenne : nouveau modèle,
 *      capacité × PS (tonnesReelles ci-dessus), par benne, fois le nombre
 *      de bennes.
 *   3) pas de capaciteBenne, mais un ps renseigné : intervention ancienne
 *      "corrigée avec PS" (cf. corriger-ps.js) — le tonnage par benne saisi
 *      à l'origine valait volume × PS implicite de 1, on le multiplie donc
 *      par le PS a posteriori.
 *   4) ni l'un ni l'autre : comportement d'avant ce champ, inchangé — c'est
 *      ce qui garantit qu'une intervention déjà enregistrée n'est JAMAIS
 *      recalculée toute seule tant que personne n'a touché son PS.
 */
export function quantiteDeSaisie(formulaire, s) {
  if (!s) return null;
  const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
  if (formulaire === 'PRESSAGE') return n(s.nbBottes) || null;
  if (formulaire === 'SECHAGE')  return arrondi3(n(s.nbRemorques) * n(s.tonnesParRemorque)) || null;
  if (formulaire === 'MOISSON') {
    if (s.capaciteBenne != null) {
      const parBenne = s.remplissageBenne != null
        ? tonnesReellesAvecRemplissage(s.capaciteBenne, s.remplissageBenne, s.ps, s.typeAliment)
        : tonnesReelles(s.capaciteBenne, s.ps, s.typeAliment);
      return arrondi3(n(s.nbBennes) * parBenne) || null;
    }
    const brut = n(s.nbBennes) * n(s.tonnageBenne);
    if (s.ps != null && estCerealeAliment(s.typeAliment)) {
      const psNormalise = psVersTonnesM3(s.ps);
      return arrondi3(brut * (psNormalise != null ? psNormalise : 1)) || null;
    }
    return arrondi3(brut) || null;
  }
  if (formulaire === 'FUMIER')   return arrondi3(n(s.nbEpandeurs) * n(s.tonnageEpandeur)) || null;
  return null;
}
