// Campagne CULTURE par défaut, d'après le seul calendrier : une date à partir
// du 01/09 appartient à la campagne de l'année suivante (semis d'automne,
// récolte l'été d'après). Fonction unique pour l'en-tête, les rapports, la
// saisie et le repli de campagnes.js quand une parcelle n'a pas encore
// d'historique qui décide. Module pur (aucun import).

function p2(n) { return String(n).padStart(2, '0'); }

/** « 2027 » pour toute date du 01/09/2026 au 31/08/2027. */
export function campagneDeDate(dateIso) {
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const a = Number(m[1]);
  return String(Number(m[2]) >= 9 ? a + 1 : a);
}

export function campagneEnCours(d = new Date()) {
  return campagneDeDate(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
}

/** Campagne d'une activité enregistrée : celle calculée à la saisie, sinon le calendrier. */
export function campagneDeActivite(itv) {
  return String((itv && itv.campagneId) || campagneDeDate(itv && itv.date) || '');
}
