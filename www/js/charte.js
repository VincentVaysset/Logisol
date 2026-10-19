// Miroir JS de la charte graphique (variables --ch-* de css/style.css) pour
// ce qui ne lit pas le CSS : Leaflet (tracés, polygones, marqueurs) veut des
// valeurs réelles. À garder IDENTIQUE à :root dans style.css.
export const COULEURS_CARTE = {
  vert: '#357f4b',         // --ch-vert
  vertFonce: '#2f6e44',    // --ch-vert-fonce
  vertPastel: '#e3f3e6',   // --ch-vert-pastel
  bleu: '#1f5a8a',         // --ch-bleu
  ambre: '#b5701c',        // --ch-ambre
  rouge: '#a33a31',        // --ch-rouge
  texte: '#2b261c',        // --ch-texte
  texte2: '#5e5b47',       // --ch-texte2
  icone: '#8a8670',        // --ch-icone
  bordChamp: '#d9cfb8',    // --ch-bord-champ
  onglets: '#efe9da',      // --ch-onglets
  blanc: '#ffffff'         // --ch-carte
};

const C = COULEURS_CARTE;
// Couleurs par culture (charte) : luzerne = vert, prairies RGA/trèfle = bleu,
// céréales = ambre, prairies naturelles = gris. Les autres cultures gardent
// la couleur choisie dans les réglages (donnée de l'exploitation).
export function couleurCulture(culture) {
  if (!culture) return C.bordChamp;
  const nom = String(culture.nom || '').toLowerCase();
  if (/luzerne/.test(nom)) return C.vert;
  if (culture.famille === 'cereale') return C.ambre;
  if (culture.famille === 'prairie_permanente' || /naturelle/.test(nom)) return C.texte2;
  if (/\brg\b|ray|trèfle|trefle|fétuque|fetuque/.test(nom) || culture.famille === 'prairie_temporaire' || culture.famille === 'prairie') return C.bleu;
  return culture.couleur || C.icone;
}
