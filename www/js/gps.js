// Service de géolocalisation unifié — abstraction commune entre le GPS natif
// du téléphone (aujourd'hui, seule source réellement branchée) et une future
// antenne RTK externe (Bluetooth/série, trames NMEA GGA) : le reste de
// l'appli consomme un même format de "fix" quelle que soit la source, sans
// jamais savoir d'où il vient.
//
//   { lat, lon, accuracy, fixType, source, horodatage }
//
// PRÉCISION / TYPE DE FIX
// Un GPS de téléphone seul (SINGLE) plafonne à quelques mètres de précision.
// Une antenne RTK correctement calée descend à 1-2 cm (RTK_FIX) ou quelques
// dizaines de cm en attente de convergence (RTK_FLOAT). Un flux NMEA GGA
// donne directement le fixType réel (champ qualité de fix, cf.
// parserTrameGGA) ; le GPS natif du téléphone ne connaît pas ces notions —
// son fixType est déduit par défaut de l'accuracy seule (classifierFixType).
export const FIX_TYPES = { RTK_FIX: 'RTK_FIX', RTK_FLOAT: 'RTK_FLOAT', SINGLE: 'SINGLE' };

const SEUIL_RTK_FIX_M = 0.05;   // 5 cm
const SEUIL_RTK_FLOAT_M = 0.5;  // 50 cm — convergence RTK en cours

// Déduit un fixType d'une simple accuracy (GPS natif, qui ne fournit rien
// d'autre) — un flux NMEA réel fournit son propre fixType, plus fiable que
// cette déduction, cf. parserTrameGGA.
export function classifierFixType(accuracy) {
  if (accuracy == null || !isFinite(accuracy)) return FIX_TYPES.SINGLE;
  if (accuracy <= SEUIL_RTK_FIX_M) return FIX_TYPES.RTK_FIX;
  if (accuracy <= SEUIL_RTK_FLOAT_M) return FIX_TYPES.RTK_FLOAT;
  return FIX_TYPES.SINGLE;
}

function fixDepuisPosition(pos, source) {
  return {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    fixType: classifierFixType(pos.coords.accuracy),
    source,
    horodatage: pos.timestamp || Date.now()
  };
}

/**
 * Badge de précision GPS/RTK pour l'interface — texte + niveau visuel
 * ('rtk' | 'standard' | 'inconnu', cf. www/css/style.css .gps-badge-*).
 * Règle volontairement simple : sous 5 cm de précision, l'appareil ne peut
 * être qu'une antenne RTK correctement calée (aucun GPS de téléphone seul
 * n'atteint cette précision) — badge vert dédié. Au-dessus, précision
 * standard affichée telle quelle, en mètres.
 */
export function libelleBadge(fix) {
  if (!fix || fix.accuracy == null || !isFinite(fix.accuracy)) {
    return { texte: 'Précision inconnue', niveau: 'inconnu' };
  }
  if (fix.accuracy <= SEUIL_RTK_FIX_M) {
    return { texte: 'RTK FIX (2 cm)', niveau: 'rtk' };
  }
  const m = fix.accuracy >= 10 ? Math.round(fix.accuracy) : Math.round(fix.accuracy * 10) / 10;
  return { texte: '± ' + m + ' m', niveau: 'standard' };
}

/**
 * Champ optionnel à attacher à une parcelle/un relevé quand sa géométrie a
 * été saisie ou ajustée avec un fix GPS/RTK connu — jamais requis, absent de
 * toute géométrie dessinée à la souris/au doigt comme aujourd'hui (voir
 * draw.js). Même forme prévue pour une future collection de tracés
 * d'intervention (pas encore implémentée, hors périmètre de cette
 * préparation) : un tableau de { accuracy, fixType, horodatage } par point.
 */
export function releveGpsDepuisFix(fix) {
  if (!fix) return null;
  return { accuracy: fix.accuracy, fixType: fix.fixType, horodatage: fix.horodatage };
}

// --- Source native (GPS téléphone) ------------------------------------------

/**
 * Position actuelle, une seule fois (Promise). Mêmes options qu'utilisées
 * jusqu'ici par map.js/centrerSurMaPosition — centralisées ici pour que ce
 * module reste l'unique endroit qui parle à navigator.geolocation.
 */
export function positionActuelle(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(fixDepuisPosition(pos, 'NATIF')),
      (err) => reject(new Error(err && err.message ? err.message : 'Position indisponible.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000, ...opts }
    );
  });
}

/**
 * Écoute continue (pour un futur relevé de tracé en marchant/roulant le long
 * d'une limite) — renvoie un handle à passer à arreterEcoutePositionNative.
 * Pas encore utilisée nulle part dans l'appli (aucun écran de tracé n'existe
 * encore) : fournie ici pour que GpsService soit complet dès cette
 * préparation, sans avoir à y retoucher quand cet écran sera construit.
 */
export function ecouterPositionNative(callback, opts = {}) {
  if (!navigator.geolocation) return null;
  return navigator.geolocation.watchPosition(
    (pos) => callback(fixDepuisPosition(pos, 'NATIF')),
    (err) => { if (opts.onError) opts.onError(err && err.message ? err.message : 'Position indisponible.'); },
    { enableHighAccuracy: true, maximumAge: 5000, ...opts }
  );
}

export function arreterEcoutePositionNative(handle) {
  if (handle != null && navigator.geolocation) navigator.geolocation.clearWatch(handle);
}

// --- Source externe (antenne RTK Bluetooth/série, trames NMEA) -------------
// Pas de transport Bluetooth/série branché ici (Web Bluetooth GATT ou plugin
// natif Capacitor, à choisir selon le matériel réellement utilisé) : ce
// module fournit seulement le point d'entrée — un futur transport n'aura
// qu'à passer chaque ligne reçue à injecterTrameNmea(ligne, callback) pour
// que le reste de l'appli reçoive le même format de "fix" que le GPS natif,
// sans rien savoir de la source.

/**
 * Parse une trame NMEA $--GGA (GPS Fix Data) — la seule dont on a besoin ici
 * (position + qualité de fix). Renvoie null si la ligne n'est pas une GGA
 * exploitable (trame d'un autre type du même flux, ligne tronquée, fix non
 * acquis) plutôt que de lever une exception sur une ligne isolée.
 * Format : $GNGGA,hhmmss.ss,ddmm.mmmm,N,dddmm.mmmm,E,q,nbSat,hdop,alt,M,...
 * q (qualité de fix) : 0=invalide 1=GPS simple 2=DGPS 4=RTK fixe 5=RTK flottant
 */
export function parserTrameGGA(ligne) {
  if (typeof ligne !== 'string') return null;
  const corps = ligne.trim().replace(/\*[0-9A-Fa-f]{2}$/, ''); // retire le checksum
  const champs = corps.split(',');
  if (champs.length < 9 || !/GGA$/.test(champs[0] || '')) return null;

  const qualite = parseInt(champs[6], 10);
  if (!Number.isFinite(qualite) || qualite === 0) return null; // pas de fix

  const lat = convertirCoordonneeNmea(champs[2], champs[3]);
  const lon = convertirCoordonneeNmea(champs[4], champs[5]);
  if (lat === null || lon === null) return null;

  const hdop = parseFloat(champs[8]);
  const FIX_PAR_QUALITE = { 4: FIX_TYPES.RTK_FIX, 5: FIX_TYPES.RTK_FLOAT };
  const fixType = FIX_PAR_QUALITE[qualite] || FIX_TYPES.SINGLE;
  // Accuracy estimée depuis le HDOP à défaut d'un champ dédié dans la GGA :
  // grossier (dépend de l'erreur de portée propre au récepteur), mais
  // RTK_FIX/RTK_FLOAT priment de toute façon sur ce calcul pour le badge
  // (cf. libelleBadge, qui ne regarde que l'accuracy — déjà fixée ci-dessous
  // à la précision typique de chaque mode dans ces deux cas).
  const accuracy = fixType === FIX_TYPES.RTK_FIX ? 0.02
    : fixType === FIX_TYPES.RTK_FLOAT ? 0.3
    : (Number.isFinite(hdop) ? hdop * 4 : null);

  return { lat, lon, accuracy, fixType, source: 'NMEA_EXTERNE', horodatage: Date.now() };
}

// ddmm.mmmm / dddmm.mmmm (degrés-minutes NMEA) -> degrés décimaux signés.
function convertirCoordonneeNmea(valeur, hemisphere) {
  if (!valeur || !hemisphere) return null;
  const v = parseFloat(valeur);
  if (!Number.isFinite(v)) return null;
  const degres = Math.floor(v / 100);
  const minutes = v - degres * 100;
  let decimal = degres + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'O' || hemisphere === 'W') decimal = -decimal;
  return decimal;
}

/**
 * Point d'entrée pour un futur transport Bluetooth/série RTK : lui passer
 * chaque ligne reçue telle quelle. Ignore silencieusement toute ligne qui
 * n'est pas une GGA exploitable plutôt que de faire échouer tout le flux sur
 * une trame isolée (GSA/RMC/GSV du même flux, ligne tronquée...).
 */
export function injecterTrameNmea(ligne, callback) {
  const fix = parserTrameGGA(ligne);
  if (fix) callback(fix);
  return fix;
}
