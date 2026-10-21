// Diagnostic > Outils > Campagnes des activités sur plusieurs parcelles : en
// lecture seule. La campagne d'une activité est enregistrée une seule fois,
// calculée sur la PREMIÈRE parcelle sélectionnée ; liste celles dont les
// parcelles donneraient des campagnes différentes avec la règle actuelle
// (campagnes.js/calculerCampagnes, rejouée parcelle par parcelle). Rien
// n'est écrit : la correction passe par « Reprise des campagnes ».
import { getInterventions } from './interventions.js';
import { getTypeById } from './interventions-types.js';
import { calculerCampagnes } from './campagnes.js';

function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?'; }

/** Pur : [{ itv, parCampagne: Map(parcelleId -> campagne) }] des activités divergentes. */
export function divergencesMultiParcelles(interventions, deps) {
  const parParcelle = new Map();
  interventions.forEach((i) => (i.parcelleIds || []).forEach((id) => {
    if (!parParcelle.has(id)) parParcelle.set(id, []);
    parParcelle.get(id).push({ id: i.id, date: i.date, typeId: i.typeId, forcerCampagne: i.forcerCampagne || null, saisie: i.saisie || null });
  }));
  const calcul = new Map();
  parParcelle.forEach((acts, id) => calcul.set(id, calculerCampagnes(acts, undefined, deps, id)));
  return interventions.filter((i) => (i.parcelleIds || []).length > 1).map((i) => {
    const parCampagne = new Map(i.parcelleIds.map((id) => [id, calcul.get(id).get(i.id) || null]));
    return { itv: i, parCampagne };
  }).filter((x) => new Set(x.parCampagne.values()).size > 1);
}

/** @param {Map<string,string>} noms parcelleId -> nom */
export function rapportCampagnesMultiParcelles(noms = new Map()) {
  const toutes = getInterventions();
  const multi = toutes.filter((i) => (i.parcelleIds || []).length > 1);
  const div = divergencesMultiParcelles(toutes, { getTypeById });
  const nom = (id) => noms.get(id) || id;
  const out = ['ACTIVITÉS SUR PLUSIEURS PARCELLES DONT LES CAMPAGNES DIVERGENT (rien n\'est modifié)',
    `${div.length} activité(s) divergente(s) sur ${multi.length} activité(s) multi-parcelles (${toutes.length} activités en tout).`];
  div.sort((a, b) => (a.itv.date < b.itv.date ? 1 : -1)).forEach(({ itv, parCampagne }) => {
    const detail = Array.from(parCampagne.entries()).map(([id, c]) => `${nom(id)} → ${c}`).join(', ');
    out.push(`• ${dateFr(itv.date)} · ${itv.typeNom || 'activité'} · enregistrée ${itv.campagneId || '—'}${itv.forcerCampagne ? ' (forcée)' : ''} · ${detail}`);
  });
  return out.join('\n');
}
