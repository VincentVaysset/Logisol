// Météo automatique par géolocalisation, via Open-Meteo.
//
// Choix du service : gratuit, sans clé API et sans inscription — cohérent avec
// le reste de l'appli (tuiles IGN, OSM). Aucune saisie manuelle n'est demandée,
// conformément à la demande.
//
// Deux points d'entrée du même service selon la date :
//   * aujourd'hui  -> "current=" : la météo de l'instant du chantier ;
//   * date passée  -> "daily=" avec start_date/end_date : le relevé du jour
//     (l'API couvre environ 90 jours en arrière), car "current" ne renseigne
//     que l'instant présent et serait faux pour une saisie faite le soir ou le
//     lendemain.
//
// La météo n'est JAMAIS bloquante : si la position est refusée, si le réseau
// manque ou si le service ne répond pas, l'intervention s'enregistre quand
// même et le champ reste vide. Perdre un relevé météo ne doit pas faire perdre
// une saisie faite en bout de champ.

const CODES_WMO = {
  0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine faible', 53: 'Bruine', 55: 'Bruine forte',
  56: 'Bruine verglaçante', 57: 'Bruine verglaçante forte',
  61: 'Pluie faible', 63: 'Pluie', 65: 'Pluie forte',
  66: 'Pluie verglaçante', 67: 'Pluie verglaçante forte',
  71: 'Neige faible', 73: 'Neige', 75: 'Neige forte', 77: 'Grains de neige',
  80: 'Averses faibles', 81: 'Averses', 82: 'Averses fortes',
  85: 'Averses de neige', 86: 'Averses de neige fortes',
  95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle'
};

export function libelleCode(code) {
  return CODES_WMO[code] || 'Conditions inconnues';
}

// Résumé d'une ligne, tel qu'il s'affiche dans le fil et la fiche.
export function resumeMeteo(m) {
  if (!m) return '';
  const bouts = [];
  if (m.libelle) bouts.push(m.libelle);
  if (m.tempC != null) bouts.push(Math.round(m.tempC) + ' °C');
  if (m.precipMm != null && m.precipMm > 0) bouts.push(m.precipMm + ' mm');
  if (m.ventKmh != null) bouts.push('vent ' + Math.round(m.ventKmh) + ' km/h');
  return bouts.join(' · ');
}

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e && e.message ? e.message : 'Position indisponible.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });
}

function estAujourdhui(dateIso) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return dateIso === `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function appeler(url) {
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error('Service météo indisponible (HTTP ' + reponse.status + ').');
  return reponse.json();
}

/**
 * Relève la météo pour une date donnée, à la position actuelle de l'appareil.
 * @param {string} dateIso "AAAA-MM-JJ"
 * @param {{lat:number, lon:number}} [coords] position déjà connue (évite une
 *        seconde demande GPS quand on en a déjà une sous la main)
 * @returns {Promise<object>} relevé plat, prêt à être stocké dans Firestore
 */
export async function releverMeteo(dateIso, coords) {
  const { lat, lon } = coords || (await position());
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto`;

  if (estAujourdhui(dateIso)) {
    const j = await appeler(base + '&current=temperature_2m,precipitation,wind_speed_10m,weather_code');
    const c = (j && j.current) || {};
    return {
      tempC: nombre(c.temperature_2m),
      precipMm: nombre(c.precipitation),
      ventKmh: nombre(c.wind_speed_10m),
      code: nombre(c.weather_code),
      libelle: libelleCode(c.weather_code),
      date: dateIso,
      lat: arrondi(lat),
      lon: arrondi(lon),
      source: 'open-meteo/current'
    };
  }

  const j = await appeler(
    base +
      `&start_date=${dateIso}&end_date=${dateIso}` +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code'
  );
  const d = (j && j.daily) || {};
  const tmax = premier(d.temperature_2m_max);
  const tmin = premier(d.temperature_2m_min);
  const code = premier(d.weather_code);
  return {
    tempC: tmax != null && tmin != null ? Math.round(((tmax + tmin) / 2) * 10) / 10 : nombre(tmax),
    tempMaxC: nombre(tmax),
    tempMinC: nombre(tmin),
    precipMm: nombre(premier(d.precipitation_sum)),
    ventKmh: nombre(premier(d.wind_speed_10m_max)),
    code: nombre(code),
    libelle: libelleCode(code),
    date: dateIso,
    lat: arrondi(lat),
    lon: arrondi(lon),
    source: 'open-meteo/daily'
  };
}

function premier(t) {
  return Array.isArray(t) && t.length ? t[0] : null;
}
function nombre(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function arrondi(v) {
  return Math.round(v * 10000) / 10000;
}
