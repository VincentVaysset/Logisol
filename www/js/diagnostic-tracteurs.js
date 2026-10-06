// Diagnostic > Outils > Activités sans tracteur : en lecture seule. Jusqu'au
// 06/10/2026, le tracteur choisi dans une activité n'était jamais enregistré
// (interventions.js/nettoyer l'ignorait) : liste des activités terminées avec
// un outil mais sans tracteur, pour les compléter à la main si besoin. Rien
// n'est écrit.
import { getInterventions } from './interventions.js';
import { getMaterielById } from './materiel.js';

function dateFr(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?'; }

export function rapportTracteurs() {
  const toutes = getInterventions();
  const avecOutil = toutes.filter((i) => i.statut !== 'A_FAIRE' && (i.materielId || i.materielNom));
  const sans = avecOutil.filter((i) => !i.tracteurId);
  const out = ['ACTIVITÉS SANS TRACTEUR (rien n\'est modifié)',
    `${sans.length} activité(s) terminée(s) avec un outil et sans tracteur, sur ${avecOutil.length} avec un outil (${toutes.length} activités en tout).`];
  sans.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((i) => {
    const m = i.materielId ? getMaterielById(i.materielId) : null;
    out.push(`• ${dateFr(i.date)} · ${i.typeNom || 'activité'} · outil ${(m && m.nom) || i.materielNom || '?'}${i.trace ? ' · tracé GPS' : ''}${i.chauffeur ? ' · ' + i.chauffeur : ''}`);
  });
  return out.join('\n');
}
