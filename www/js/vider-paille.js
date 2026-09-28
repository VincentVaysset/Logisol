// Vider le stock de paille — remise à zéro en fin de campagne (cf. CLAUDE.md,
// point 7 du ticket) : la paille n'a aucun suivi de consommation, donc pas
// de sortie automatique pour la ramener à 0 d'elle-même. Un mouvement
// d'inventaire daté du jour, quantité 0, REMPLACE le niveau constaté sur
// chaque contenant qui en porte (cf. mouvements.js/niveauContenant — "un
// inventaire ne s'ajoute pas, il remplace") : c'est une remise à zéro
// explicite, pas une sortie déguisée, et un mouvement comme un autre
// ensuite — modifiable/supprimable depuis la fiche aliment ou la fiche
// bâtiment, comme n'importe quel mouvement (règle mouvements.js).
import { clePaille } from './stocks.js';
import { niveauContenant, createMouvement } from './mouvements.js';
import { identiteDuMouvement, stockNetParCategorie } from './fourrages.js';
import { aujourdhui } from './implantations.js';

const EPSILON = 0.001;

/**
 * Calcul pur : liste les contenants qui portent actuellement de la paille,
 * avec leur niveau — sans rien écrire.
 * @returns {{lignes: Array<{type, id, nom, quantite}>, totalTonnes: number}}
 */
export function previsualiserVidage(mouvements, cellules, emplacements) {
  const cle = clePaille();
  const contenants = [
    ...(cellules || []).map((c) => ({ type: 'CELLULE', id: c.id, nom: c.nom || 'Cellule' })),
    ...(emplacements || []).map((e) => ({ type: 'EMPLACEMENT_FOURRAGE', id: e.id, nom: e.nom || 'Emplacement' }))
  ];
  const lignes = [];
  for (const c of contenants) {
    // Un contenant qui n'a jamais reçu de paille n'a rien à vider — évite de
    // proposer un mouvement à 0 sur un emplacement qui n'en a jamais porté.
    const aDejaRecuPaille = (mouvements || []).some((m) =>
      m.destinationType === c.type && m.destinationId === c.id &&
      (identiteDuMouvement(m) || {}).cle === cle);
    if (!aDejaRecuPaille) continue;
    const quantite = niveauContenant(c.type, c.id, mouvements).quantite;
    if (quantite > EPSILON) lignes.push({ type: c.type, id: c.id, nom: c.nom, quantite });
  }
  const groupe = stockNetParCategorie(mouvements, cellules, emplacements).find((g) => g.cle === cle);
  return { lignes, totalTonnes: (groupe && groupe.tonnes) || 0 };
}

/** Écrit un mouvement d'inventaire à 0 sur chaque contenant listé par
 * previsualiserVidage() — aucun mouvement créé si le stock est déjà à 0. */
export async function viderStockPaille(mouvements, cellules, emplacements) {
  const { lignes } = previsualiserVidage(mouvements, cellules, emplacements);
  for (const l of lignes) {
    await createMouvement({
      date: aujourdhui(),
      typeMouvement: 'INVENTAIRE',
      destinationType: l.type,
      destinationId: l.id,
      destinationNom: l.nom,
      quantite: 0,
      unite: l.type === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't',
      libelle: 'Remise à zéro fin de campagne'
    });
  }
  return lignes.length;
}
