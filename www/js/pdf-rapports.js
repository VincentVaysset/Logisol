// Contenu des deux PDF des Rapports (onglet affiché = PDF exporté), posés par
// pdf-charte.js. Mêmes données que l'écran (ui-rapports.js) ; le papier a la
// largeur d'en dire plus par ligne (variété, date, t/ha réel en colonnes).
import { creerPdfCharte } from './pdf-charte.js';
import { syntheseStocks } from './realise-calc.js';
import { culturePrev } from './assolement-previsionnel.js';

const fixe = (d) => (v) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const ha2 = fixe(2);
const t1 = fixe(1);
const entier = fixe(0);
const libre = (v) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const signe = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${ha2(Math.abs(v))}`;
const jourMois = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export const dateFr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ORDINAL = (n) => (n === 1 ? '1re coupe' : `${n}e coupe`);
const NOTE_ESTIMEE = '* surface déduite des parcelles, non saisie.';

function jsPDFCharge() {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Générateur PDF indisponible (jsPDF non chargé).');
  return window.jspdf.jsPDF;
}

/** Nom du fichier : bilan-realise_campagne-2027_2026-10-19.pdf */
export function nomFichierPdf(vue, camp, aujourdhui) {
  return `bilan-${vue === 'realise' ? 'realise' : 'previsionnel'}_campagne-${camp}_${aujourdhui}.pdf`;
}

// --- Prévisionnel ---------------------------------------------------------------
const GROUPES_SEMIS = [
  { label: 'Céréales / annuelles', familles: ['CEREALES'] },
  { label: 'Prairies temporaires & fourrages', familles: ['PRAIRIE_COURTE', 'SEMIS_PRAIRIE'] }
];

export function pdfPrevisionnel({ camp, cal, cat, plan, exploitation, aujourdhui }) {
  const p = creerPdfCharte({ jsPDF: jsPDFCharge(), titre: 'Bilan prévisionnel', sousTitre: `Campagne ${camp} · assolement prévisionnel`,
    exploitation, edition: `Édité le ${dateFr(aujourdhui)}`, pied: `Logisol — Bilan prévisionnel · Campagne ${camp}` });

  const cultures = [
    ...cal.automne.details.map((d) => ({ ...d, periode: 'Automne' })),
    ...cal.printemps.details.map((d) => ({ ...d, periode: 'Printemps' }))
  ].map((d) => ({ ...d, famille: culturePrev(d.code).famille }));
  const lignes = [];
  let total = 0;
  GROUPES_SEMIS.forEach((g) => {
    const l = cultures.filter((c) => g.familles.includes(c.famille));
    if (!l.length) return;
    const st = l.reduce((n, c) => n + c.ha, 0);
    total += st;
    lignes.push({ type: 'grp', cells: [g.label] }, ...l.map((c) => ({ cells: [c.label, c.periode, ha2(c.ha)] })),
      { type: 'tot', cells: ['Sous-total', '', ha2(st)] });
  });
  if (lignes.length) lignes.push({ type: 'tot', cells: ['Total semé', '', ha2(total)] });
  if (cal.derobees.parcelles.length) {
    lignes.push({ type: 'grp', cells: ['Dérobées / couverts (réel, hors total)'] },
      ...cal.derobees.parcelles.map((d) => ({ cells: [`${d.derobee} · ${d.nom}`, 'En place', ha2(d.ha)] })));
  }
  p.section(1, 'Assolement & semis', 'Source : assolement prévisionnel', 63 + 18 + 48);
  p.tuiles([
    { teinte: 'ambre', valeur: `${ha2(cal.automne.ha)} ha`, label: 'Semis d\'automne' },
    { teinte: 'vert', valeur: `${ha2(cal.printemps.ha)} ha`, label: 'Semis de printemps' },
    { teinte: 'bleu', valeur: `${ha2(cal.derobees.ha)} ha`, label: 'Dérobées (réel)' }
  ]);
  if (lignes.length) p.tableau({ colonnes: [{ label: 'Culture', w: 5 }, { label: 'Période', w: 2 }, { label: 'ha', w: 1.5 }], lignes });
  else p.note(`Aucun semis prévu pour ${camp} dans l'assolement prévisionnel.`);
  if (!cat.coherent) {
    p.note(`Écart de ${libre(Math.abs(cat.totalEnregistre - cat.totalPrevisionnel))} ha entre l'assolement ${camp} (${libre(cat.totalPrevisionnel)} ha) et les fiches parcelles (${libre(cat.totalEnregistre)} ha) : vérifier les parcelles sans culture renseignée.`);
  }

  p.section(2, 'Plan de fertilisation', 'Source : assolement prévisionnel', 63 + 18 + 48);
  p.tuiles([
    { teinte: 'ambre', valeur: `${libre(plan.totalFumierT)} t`, label: 'Fumier à épandre' },
    { teinte: '', valeur: `${libre(plan.totalChauxT)} t`, label: 'Chaux à épandre' }
  ]);
  [['Fumier', 'fumierTHa', 'fumierT'], ['Chaux', 'chauxTHa', 'chauxT']].forEach(([nom, dose, t]) => {
    const l = plan.lignes.filter((x) => x[dose] > 0).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
    if (!l.length) { p.note(`${nom} : aucune parcelle prévue sur la campagne.`); return; }
    const doses = new Set(l.map((x) => x[dose]));
    p.tableau({
      legende: `${nom}${doses.size === 1 ? ` · ${libre([...doses][0])} t/ha` : ''}`,
      colonnes: [{ label: 'Parcelle', w: 5 }, { label: 'ha', w: 1.4 }, { label: 't/ha', w: 1.4 }, { label: 't', w: 1.6 }],
      lignes: [...l.map((x) => ({ cells: [x.nom, ha2(x.surfaceHa), libre(x[dose]), ha2(x[t])] })),
        { type: 'tot', cells: [`Total · ${l.length} parcelle${l.length > 1 ? 's' : ''}`, ha2(l.reduce((n, x) => n + x.surfaceHa, 0)), '', ha2(l.reduce((n, x) => n + x[t], 0))] }]
    });
  });
  return p.terminer();
}

// --- Réalisé --------------------------------------------------------------------
export function pdfRealise({ camp, semis, ferti, stocks, coupes, arreteLe, exploitation, aujourdhui }) {
  const p = creerPdfCharte({ jsPDF: jsPDFCharge(), titre: 'Bilan réalisé', sousTitre: `Campagne ${camp} · arrêté au ${dateFr(arreteLe)}`,
    exploitation, edition: `Édité le ${dateFr(aujourdhui)}`, pied: `Logisol — Bilan réalisé · Campagne ${camp}` });
  const et = (x) => (x ? '*' : '');
  let estimee = semis.estimee;

  // 1. Semis réalisés
  p.section(1, 'Semis réalisés', 'Source : activités de semis', 63 + 18 + 48);
  p.tuiles([
    { teinte: 'vert', valeur: `${ha2(semis.seme)}${et(semis.estimee)} ha`, label: 'Surface semée' },
    { teinte: '', valeur: `${ha2(semis.prevu)} ha`, label: 'Prévu' },
    { teinte: '', valeur: `${ha2(semis.reste)} ha`, label: 'Reste à semer' }
  ]);
  if (semis.lignes.length || semis.aSemer.length) {
    p.tableau({
      colonnes: [{ label: 'Culture', w: 3.6 }, { label: 'Variété', w: 3.2, align: 'left' }, { label: 'Date', w: 1.1 }, { label: 'ha', w: 1.1 },
        { label: 'kg/ha', w: 1.1 }, { label: 'kg', w: 1.3 }],
      lignes: [
        ...semis.lignes.map((l) => ({ cells: [l.label, l.semence, jourMois(l.date), ha2(l.ha) + et(l.estimee),
          l.dose == null ? { t: '—', cls: 'na' } : libre(l.dose), l.kg == null ? { t: '—', cls: 'na' } : entier(l.kg) + et(l.estimee)] })),
        ...semis.aSemer.map((x) => ({ type: 'na', cells: [`${x.label}${x.saison === 'printemps' ? ' (printemps)' : ''}`, `prévu ${ha2(x.ha)} ha`, '', '—', '—', 'À semer'] })),
        { type: 'tot', cells: ['Total semé', '', '', ha2(semis.seme) + et(semis.estimee), '', semis.kg == null ? '' : entier(semis.kg) + et(semis.estimee)] }
      ]
    });
  } else p.note(`Aucun semis enregistré ni prévu pour ${camp}.`);

  // 2. Fertilisation réalisée
  const fu = ferti[0];
  p.section(2, 'Fertilisation réalisée', 'Source : activités d\'épandage', 63 + 18 + 48);
  p.tuiles([
    { teinte: 'ambre', valeur: `${ha2(fu.realiseT)} t`, label: 'Fumier épandu' },
    { teinte: '', valeur: `${ha2(fu.prevuT)} t`, label: 'Prévu' },
    { teinte: '', valeur: fu.pct == null ? '—' : `${fu.pct} %`, label: 'Réalisé' }
  ]);
  ferti.forEach((pr) => {
    const nom = pr.produit === 'fumier' ? 'Fumier' : 'Chaux';
    if (!pr.lignes.length) { p.note(`${nom} : aucune parcelle prévue, rien d'épandu sur la campagne.`); return; }
    const avecPrevu = pr.lignes.some((l) => l.prevu != null);
    p.tableau({
      legende: `${nom}${pr.doseUnique != null ? ` · dose prévue ${libre(pr.doseUnique)} t/ha` : ''}`,
      colonnes: [{ label: 'Parcelle', w: 3.6 }, { label: 'ha', w: 1 }, { label: 'Date', w: 1.1 }, { label: 't/ha réel', w: 1.3 },
        { label: 'Prévu (t)', w: 1.3 }, { label: 'Réalisé (t)', w: 1.4 }, { label: 'Écart (t)', w: 1.3 }],
      lignes: [
        ...pr.lignes.map((l) => ({ cells: [l.nom, l.aFaire ? { t: ha2(l.ha), cls: 'na' } : ha2(l.ha), jourMois(l.date),
          l.tHaReel == null ? '' : t1(l.tHaReel),
          l.prevu == null ? { t: '—', cls: 'na' } : (l.aFaire ? { t: ha2(l.prevu), cls: 'na' } : ha2(l.prevu)),
          l.realise == null ? { t: '—', cls: 'na' } : ha2(l.realise),
          l.aFaire ? { t: 'À faire', cls: 'na' } : { t: signe(l.ecart), cls: l.ecart >= 0 ? 'ec-p' : 'ec-m' }] })),
        { type: 'tot', cells: [`Total · ${pr.lignes.length} parcelle${pr.lignes.length > 1 ? 's' : ''}`, ha2(pr.lignes.reduce((n, l) => n + l.ha, 0)), '', '',
          avecPrevu ? ha2(pr.prevuT) : '—', ha2(pr.realiseT), signe(pr.ecartT)] }
      ]
    });
  });

  // 3. Bilan stocks
  const { lignes: lst, tot } = syntheseStocks(stocks.groupes);
  p.section(3, 'Bilan stocks', 'Source : journal des mouvements de stock', 63 + 18 + 48);
  p.tuiles([
    { teinte: 'vert', valeur: `${t1(tot.entrees)} t`, label: 'Entrées' },
    { teinte: 'ambre', valeur: `${t1(tot.sorties)} t`, label: 'Consommé' },
    { teinte: 'bleu', valeur: `${t1(tot.reste)} t`, label: 'En stock' }
  ]);
  if (lst.length) {
    p.tableau({
      colonnes: [{ label: 'Catégorie', w: 3.4 }, { label: 'Départ (t)', w: 1.3 }, { label: 'Récolté (t)', w: 1.3 }, { label: 'Achats (t)', w: 1.3 },
        { label: 'Sorties (t)', w: 1.3 }, { label: 'Stock (t)', w: 1.3 }],
      lignes: [...lst.map((g) => ({ cells: [g.nom, t1(g.depart), t1(g.recolte), t1(g.achat), t1(g.sorties), t1(g.reste)] })),
        { type: 'tot', cells: ['Total', t1(tot.depart), t1(tot.recolte), t1(tot.achat), t1(tot.sorties), t1(tot.reste)] }]
    });
    const ajust = tot.sorties - tot.conso;
    if (Math.abs(ajust) >= 0.05) p.note(`Sorties : ${t1(tot.conso)} t distribuées aux lots, ${t1(ajust)} t d'ajustements d'inventaire.`);
  } else p.note('Aucun stock ni mouvement sur la campagne.');
  if (coupes.length) {
    const lignes = [];
    const conflits = [];
    let totalT = 0;
    coupes.forEach((c) => {
      lignes.push({ type: 'grp', cells: [c.culture] });
      c.coupes.forEach((cp) => {
        if (cp.estimee) estimee = true;
        totalT += cp.tonnes;
        cp.conflits.forEach((k) => conflits.push(`${k.nom} (${ORDINAL(cp.numero)} ${c.culture.toLowerCase()}) : ${k.valeurs.map(ha2).join(' / ')} ha, ${ha2(k.valeurs[0])} ha retenus`));
        lignes.push({ cells: [ORDINAL(cp.numero), t1(cp.surfaceHa) + et(cp.estimee), cp.tHa == null ? '—' : t1(cp.tHa) + et(cp.estimee), t1(cp.tonnes)] });
      });
    });
    lignes.push({ type: 'tot', cells: ['Total récolté', '', '', t1(totalT)] });
    p.tableau({ legende: 'Récoltes fourragères par coupe', colonnes: [{ label: 'Culture · coupe', w: 4 }, { label: 'ha', w: 1.4 }, { label: 't/ha', w: 1.4 }, { label: 't', w: 1.4 }], lignes });
    if (conflits.length) p.note(`Surfaces différentes déclarées pour une même coupe : ${conflits.join(' ; ')}.`);
  }
  if (estimee) p.note(NOTE_ESTIMEE);
  return p.terminer();
}
