// Vocations fixes des parcelles (non configurables, contrairement aux
// cultures) + résolution couleur/label combinant vocation + IMPLANTATION EN
// COURS (cf. implantations.js) + cultures_config. Logique partagée entre la
// carte, la légende, la vue liste et l'écran d'accueil pour ne pas la
// dupliquer.
export const VOCATIONS = [
  { value: 'culture', label: 'Culture' },
  { value: 'prairie', label: 'Prairie' },
  { value: 'batiment', label: 'Bâtiment' },
  { value: 'bois', label: 'Bois' },
  { value: 'autre', label: 'Autre' }
];

const VOCATION_LABEL = Object.fromEntries(VOCATIONS.map((v) => [v.value, v.label]));

const VOCATION_FIXED_COLOR = {
  batiment: '#8a6d5c',
  bois: '#2c4d29',
  autre: '#9a988f'
};

export const COULEUR_A_RENSEIGNER = '#c4c0b0';

// Vue regroupée (macro / PAC) : chaque culture retombe sur la couleur et le
// libellé de SA FAMILLE (cultures_config.famille) plutôt que sa couleur
// propre — toutes les prairies (RG trèfle, luzerne, fétuque/trèfle, prairie
// permanente) se confondent alors sous un seul vert, comme demandé.
export const FAMILLE_LABEL = {
  prairie: 'Prairie', cereale: 'Céréales', oleagineux: 'Oléagineux',
  legumineuse: 'Légumineuses', autre: 'Autre'
};
export const FAMILLE_COULEUR = {
  prairie: '#059669', cereale: '#d97706', oleagineux: '#a8b83f',
  legumineuse: '#10b981', autre: '#9a988f'
};

export function estVocationCulture(vocation) {
  return vocation === 'culture' || vocation === 'prairie';
}

export function vocationLabel(vocation) {
  return VOCATION_LABEL[vocation] || VOCATION_LABEL.autre;
}

/**
 * @param {object} parcelle
 * @param {Map<string, object>} implantationsByParcelle parcelleId -> implantation en cours ({cultureId, dateSemis})
 * @param {Map<string, object>} culturesById             cultureId -> {nom, couleur, famille}
 * @param {boolean} [groupe] true : couleur/libellé de la famille plutôt que de la culture précise
 */
export function resolveCouleur(parcelle, implantationsByParcelle, culturesById, groupe) {
  const vocation = parcelle.vocation || 'autre';
  if (estVocationCulture(vocation)) {
    const impl = implantationsByParcelle.get(parcelle.id);
    const culture = impl ? culturesById.get(impl.cultureId) : null;
    if (!culture) return COULEUR_A_RENSEIGNER;
    if (groupe) return FAMILLE_COULEUR[culture.famille] || FAMILLE_COULEUR.autre;
    return culture.couleur;
  }
  return VOCATION_FIXED_COLOR[vocation] || VOCATION_FIXED_COLOR.autre;
}

export function resolveLabel(parcelle, implantationsByParcelle, culturesById, groupe) {
  const vocation = parcelle.vocation || 'autre';
  if (estVocationCulture(vocation)) {
    const impl = implantationsByParcelle.get(parcelle.id);
    const culture = impl ? culturesById.get(impl.cultureId) : null;
    if (!culture) return 'À renseigner';
    if (groupe) return FAMILLE_LABEL[culture.famille] || FAMILLE_LABEL.autre;
    return culture.nom;
  }
  return vocationLabel(vocation);
}
