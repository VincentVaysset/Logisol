// PDF « Carnet de pâturage » (Rapports & Synthèses), à la charte des autres
// exports (pdf-charte.js) : vue de la saison, périodes de pâturage, jours sans
// sortie et horaires différents avec leur motif. Bornes de dates choisies par
// l'exploitant ; année civile. Calculs : paturage-calc.js.
import { creerPdfCharte } from './pdf-charte.js';
import { jourLot, caseParcelle, bilanParcelle, ajouterJours, ecartJours, heureDecimale } from './paturage-calc.js';
import { resumeMeteo } from './meteo.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateFr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const hFr = (v) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');

/** Nom du fichier : carnet-paturage_2026-03-02_2026-10-27.pdf */
export const nomFichierCarnet = (debut, fin) => `carnet-paturage_${debut}_${fin}.pdf`;

/**
 * @param {object} o
 * @param {{lots, periodes, exceptions, aujourdhui}} o.ctx   lots : [{id, nom, type, effectif}]
 * @param {Array<{id, nom, surfaceHa}>} o.parcelles
 * @param {string} o.debut  « AAAA-MM-JJ »
 * @param {string} o.fin
 * @param {Map<string,string>} [o.travaux]  « parcelleId|date » -> 'F' | 'B' (journal)
 */
export function pdfCarnetPaturage({ ctx, parcelles, debut, fin, travaux = new Map(), exploitation, aujourdhui }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Générateur PDF indisponible (jsPDF non chargé).');
  const annee = debut.slice(0, 4);
  const p = creerPdfCharte({ jsPDF: window.jspdf.jsPDF, titre: 'Carnet de pâturage', sousTitre: `Du ${dateFr(debut)} au ${dateFr(fin)}`,
    exploitation, edition: `Édité le ${dateFr(aujourdhui)}`, pied: `Logisol — Carnet de pâturage · ${annee}` });
  const dansPeriode = { ...ctx, aujourdhui: fin < ctx.aujourdhui ? fin : ctx.aujourdhui };
  const lotDe = new Map(ctx.lots.map((l) => [l.id, l]));
  const nomParcelle = new Map(parcelles.map((x) => [x.id, x.nom || 'Sans nom']));

  // Jours avec sortie dans les bornes, par type de lot.
  const sorties = { BREBIS: 0, AGNELLES: 0 };
  const jours = [];
  for (let d = debut; d <= fin; d = ajouterJours(d, 1)) jours.push(d);
  jours.filter((d) => d <= dansPeriode.aujourdhui).forEach((d) => ['BREBIS', 'AGNELLES'].forEach((t) => {
    if (ctx.lots.some((l) => l.type === t && (jourLot(l.id, d, ctx) || {}).sorti)) sorties[t]++;
  }));
  const exceptions = ctx.exceptions.filter((e) => e.date >= debut && e.date <= fin && lotDe.has(e.lotId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const joursSans = new Set(exceptions.filter((e) => e.type === 'SANS_SORTIE').map((e) => e.date));

  // 1. Vue de la saison
  const paturees = parcelles.filter((x) => ctx.periodes.some((q) => q.parcelleId === x.id && q.debut <= fin && (q.fin || ctx.aujourdhui) >= debut))
    .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr', { numeric: true }));
  p.section(1, 'Vue de la saison', 'Source : calendrier de pâturage', 63 + 60);
  p.tuiles([
    { teinte: 'vert', valeur: `${sorties.BREBIS} j`, label: 'Jours avec sortie · laitières' },
    { teinte: 'bleu', valeur: `${sorties.AGNELLES} j`, label: 'Jours avec sortie · agnelles' },
    { teinte: 'ambre', valeur: `${joursSans.size} j`, label: 'Jours sans sortie' }
  ]);
  if (paturees.length) {
    const mois = [];
    jours.forEach((d) => { const m = Number(d.slice(5, 7)) - 1; if (!mois.length || mois[mois.length - 1].m !== m) mois.push({ m, label: MOIS[m], n: 0 }); mois[mois.length - 1].n++; });
    p.bande({ mois, lignes: paturees.map((x) => {
      const b = bilanParcelle(x.id, debut, fin, ctx);
      return { nom: x.nom || 'Sans nom', sous: `${hFr(b.heures)} h · ${b.passages} passage${b.passages > 1 ? 's' : ''}`,
        jours: jours.map((d) => (travaux.get(`${x.id}|${d}`) ? 'fau' : d <= ctx.aujourdhui ? caseParcelle(x.id, d, ctx).k : '')) };
    }) });
    p.note('Vert : laitières · bleu : agnelles · vert et bleu : ensemble · gris : lot affecté, pas de sortie · ambre : fauche ou broyage (journal).');
  } else p.note('Aucune période de pâturage sur ces dates.');

  // 2. Périodes de pâturage
  const periodes = ctx.periodes.filter((q) => lotDe.has(q.lotId) && q.debut <= fin && (q.fin || ctx.aujourdhui) >= debut)
    .sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
  p.section(2, 'Périodes de pâturage', 'Source : calendrier de pâturage', 18 + 48);
  if (periodes.length) {
    p.tableau({
      colonnes: [{ label: 'Lot', w: 2.2 }, { label: 'Parcelle', w: 3, align: 'left' }, { label: 'Du', w: 1.4 }, { label: 'Au', w: 1.4 }, { label: 'Jours', w: 1 }, { label: 'Horaire', w: 1.8 }],
      lignes: periodes.map((q) => {
        const lot = lotDe.get(q.lotId);
        const du = q.debut < debut ? debut : q.debut;
        const finP = q.fin || null;
        const au = finP && finP < fin ? finP : (finP ? fin : (ctx.aujourdhui < fin ? ctx.aujourdhui : fin));
        return { cells: [`${lot.nom} · ${lot.effectif}`, nomParcelle.get(q.parcelleId) || '—', dateFr(du), finP ? dateFr(au) : 'en cours',
          String(ecartJours(du, au) + 1), `${q.heureDebut || '11:00'}–${q.heureFin || '17:00'}`] };
      })
    });
  } else p.note('Aucune période sur ces dates.');

  // 3. Jours sans sortie et horaires différents
  p.section(3, 'Jours sans sortie et horaires différents', 'Motifs saisis, météo Open-Meteo', 18 + 48);
  if (exceptions.length) {
    p.tableau({
      colonnes: [{ label: 'Date', w: 1.4 }, { label: 'Lot', w: 1.8 }, { label: 'Exception', w: 2.2, align: 'left' }, { label: 'Motif', w: 1.6, align: 'left' }, { label: 'Météo', w: 3, align: 'left' }],
      lignes: exceptions.map((e) => ({ cells: [dateFr(e.date), (lotDe.get(e.lotId) || {}).nom || '—',
        e.type === 'HORAIRE' ? `Horaire ${e.heureDebut}–${e.heureFin} (${hFr(heureDecimale(e.heureFin) - heureDecimale(e.heureDebut))} h)` : 'Pas de sortie',
        e.motif || '—', e.meteo ? resumeMeteo(e.meteo) : '—'] }))
    });
  } else p.note('Aucun jour sans sortie ni horaire différent sur ces dates.');
  return p.terminer();
}
