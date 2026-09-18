// Compression d'une photo prise au champ, avant stockage dans le document
// Firestore de l'intervention.
//
// POURQUOI COMPRESSER PLUTÔT QUE STOCKER TEL QUEL
// Un document Firestore est plafonné à 1 Mio, et une photo de tablette pèse
// couramment 3 à 8 Mo. Sans redimensionnement, l'enregistrement échouerait
// systématiquement — exactement le genre de mur rencontré avec les tableaux
// imbriqués. On réduit donc le plus grand côté à 1200 px et on ré-encode en
// JPEG, ce qui suffit largement pour documenter un chantier (état d'une
// parcelle, dégât, repère) tout en tenant dans le document.
//
// La qualité est abaissée par paliers tant que l'image dépasse le budget : on
// préfère une photo un peu moins fine à une saisie perdue.

const COTE_MAX = 1200;
const BUDGET_OCTETS = 600 * 1024;          // marge nette sous la limite de 1 Mio
const QUALITES = [0.72, 0.6, 0.5, 0.4, 0.3];

// Une data URL "data:image/jpeg;base64,XXXX" occupe ~4/3 de la taille binaire.
function octetsApprox(dataUrl) {
  const virgule = dataUrl.indexOf(',');
  return Math.round(((dataUrl.length - virgule - 1) * 3) / 4);
}

function chargerImage(fichier) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible.")); };
    img.src = url;
  });
}

/**
 * @param {File} fichier photo choisie ou prise avec l'appareil
 * @returns {Promise<string>} data URL JPEG compressée, stockable telle quelle
 */
export async function compresserPhoto(fichier) {
  if (!fichier) throw new Error('Aucune photo sélectionnée.');
  const img = await chargerImage(fichier);

  const facteur = Math.min(1, COTE_MAX / Math.max(img.width, img.height));
  const largeur = Math.max(1, Math.round(img.width * facteur));
  const hauteur = Math.max(1, Math.round(img.height * facteur));

  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, largeur, hauteur);

  let derniere = null;
  for (const q of QUALITES) {
    derniere = canvas.toDataURL('image/jpeg', q);
    if (octetsApprox(derniere) <= BUDGET_OCTETS) return derniere;
  }
  // Même à la qualité la plus basse l'image reste trop lourde (photo
  // panoramique très large, par exemple) : on le dit clairement plutôt que de
  // laisser Firestore rejeter l'enregistrement avec un message obscur.
  if (octetsApprox(derniere) > BUDGET_OCTETS) {
    throw new Error('Photo trop lourde même après compression — réessaie avec une photo moins large.');
  }
  return derniere;
}

export function tailleLisible(dataUrl) {
  if (!dataUrl) return '';
  const ko = Math.round(octetsApprox(dataUrl) / 1024);
  return ko >= 1024 ? (ko / 1024).toFixed(1) + ' Mo' : ko + ' ko';
}
