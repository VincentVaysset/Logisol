// Vocations fixes des parcelles (non configurables, contrairement aux
// cultures) + résolution couleur/label combinant vocation + assolement de la
// campagne en cours + cultures_config. Logique partagée entre la carte, la
// légende et la vue liste pour ne pas la dupliquer.
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

export function estVocationCulture(vocation) {
  return vocation === 'culture' || vocation === 'prairie';
}

export function vocationLabel(vocation) {
  return VOCATION_LABEL[vocation] || VOCATION_LABEL.autre;
}

/**
 * @param {object} parcelle
 * @param {Map<string, object>} assolementsByParcelle  parcelleId -> assolement de la campagne en cours
 * @param {Map<string, object>} culturesById            cultureId -> {nom, couleur}
 */
export function resolveCouleur(parcelle, assolementsByParcelle, culturesById) {
  const vocation = parcelle.vocation || 'autre';
  if (estVocationCulture(vocation)) {
    const assol = assolementsByParcelle.get(parcelle.id);
    const culture = assol ? culturesById.get(assol.cultureId) : null;
    return culture ? culture.couleur : COULEUR_A_RENSEIGNER;
  }
  return VOCATION_FIXED_COLOR[vocation] || VOCATION_FIXED_COLOR.autre;
}

export function resolveLabel(parcelle, assolementsByParcelle, culturesById) {
  const vocation = parcelle.vocation || 'autre';
  if (estVocationCulture(vocation)) {
    const assol = assolementsByParcelle.get(parcelle.id);
    const culture = assol ? culturesById.get(assol.cultureId) : null;
    return culture ? culture.nom : 'À renseigner';
  }
  return vocationLabel(vocation);
}
