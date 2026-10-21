// Contenu des deux PDF des Rapports (onglet affiché = PDF exporté), posés par
// pdf-charte.js. Mêmes données que l'écran (ui-rapports.js) ; le papier a la
// largeur d'en dire plus par ligne (variété, date, t/ha réel en colonnes).
import { creerPdfCharte } from './pdf-charte.js';
import { syntheseStocks } from './realise-calc.js';
import { noteTardives } from './syntheses-calc.js';
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
export function nomFichierPdf(vue, camp, aujourdhui, theme = '') {
  return `bilan-${vue === 'realise' ? 'realise' : 'previsionnel'}${theme ? `-${theme}` : ''}_campagne-${camp}_${aujourdhui}.pdf`;
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
// maquette-syntheses-pdf.html : tout déplié — une ligne de sous-total par
// groupe (culture, fourrage · coupe, parcelle), le détail en dessous.
const ORD = (n) => (n == null ? 'coupe ?' : ORDINAL(n));
const sepP = (...xs) => xs.filter((x) => x != null && x !== '').join(' · ');
const nb = (v, f = t1) => (v == null ? '' : f(v));

export const THEMES_REALISE = [
  { id: 'semis', label: 'Semis' }, { id: 'epandages', label: 'Épandages' }, { id: 'fourrages', label: 'Fourrages' },
  { id: 'cereales', label: 'Céréales' }, { id: 'travaux', label: 'Travaux' }, { id: 'stocks', label: 'Stocks' }
];

/** @param {string[]} [themes]  thèmes à inclure (tous par défaut) ; un thème par page s'il y en a plusieurs. */
export function pdfRealise({ camp, syn, stocks, arreteLe, exploitation, aujourdhui, themes = THEMES_REALISE.map((t) => t.id) }) {
  const seul = themes.length === 1 ? THEMES_REALISE.find((t) => t.id === themes[0]) : null;
  const p = creerPdfCharte({ jsPDF: jsPDFCharge(), titre: seul ? `Bilan réalisé — ${seul.label}` : 'Bilan réalisé', sousTitre: `Campagne ${camp} · arrêté au ${dateFr(arreteLe)}`,
    exploitation, edition: `Édité le ${dateFr(aujourdhui)}`, pied: `Logisol — Bilan réalisé · Campagne ${camp}` });
  const { semis: se, epandages: ep, fourrages: fo, cereales: ce, travaux: tr } = syn;
  const et = (x) => (x ? '*' : '');
  const gris = (t) => ({ t, cls: 'na' });
  const SUITE = 63 + 18 + 48;

  const sections = {
    semis: (n) => {
    // 1. Semis : par culture, parcelles en détail
    p.section(n, 'Semis', 'Source : activités de semis', SUITE);
    if (se.groupes.length || se.derobees.length) {
      p.tuiles([
        { teinte: 'vert', valeur: `${ha2(se.ha)}${et(se.estimee)} ha`, label: 'Surface semée' },
        { teinte: '', valeur: se.kg == null ? '—' : `${entier(se.kg)} kg`, label: se.kgPartiel && se.kg != null ? 'Semence (partiel)' : 'Semence' }
      ]);
      const lignes = [];
      se.groupes.forEach((g) => {
        lignes.push({ type: 'sstot', cells: [g.nom, '', '', ha2(g.ha) + et(g.estimee), g.dose == null ? '' : libre(g.dose), g.kg == null ? '' : entier(g.kg)] });
        g.lignes.forEach((l) => lignes.push({ type: 'det', cells: [l.parcelle, jourMois(l.date), l.semence || '', ha2(l.ha) + et(l.estimee),
          l.dose == null ? gris('—') : libre(l.dose), l.kg == null ? gris('—') : entier(l.kg)] }));
      });
      lignes.push({ type: 'tot', cells: ['Total', '', '', ha2(se.ha) + et(se.estimee), '', se.kg == null ? '' : entier(se.kg) + (se.kgPartiel ? ' (partiel)' : '')] });
      p.tableau({ colonnes: [{ label: 'Culture / parcelle', w: 3.4 }, { label: 'Date', w: 1 }, { label: 'Variété', w: 2.6, align: 'left' },
        { label: 'ha', w: 1.1 }, { label: 'kg/ha', w: 1.1 }, { label: 'kg', w: 1.3 }], lignes });
      if (se.derobees.length) {
        const ld = [];
        se.derobees.forEach((g) => {
          ld.push({ type: 'sstot', cells: [g.nom, '', '', ha2(g.ha), g.dose == null ? '' : libre(g.dose), g.kg == null ? '' : entier(g.kg)] });
          g.lignes.forEach((l) => ld.push({ type: 'det', cells: [l.parcelle, jourMois(l.date), l.semence || '', ha2(l.ha),
            l.dose == null ? gris('—') : libre(l.dose), l.kg == null ? gris('—') : entier(l.kg)] }));
        });
        p.tableau({ legende: `Dérobées · ${ha2(se.derobeesHa)} ha (hors total : la parcelle garde sa culture principale)`,
          colonnes: [{ label: 'Culture / parcelle', w: 3.4 }, { label: 'Date', w: 1 }, { label: 'Variété', w: 2.6, align: 'left' },
            { label: 'ha', w: 1.1 }, { label: 'kg/ha', w: 1.1 }, { label: 'kg', w: 1.3 }], lignes: ld });
      }
      p.note('Dose d\'une culture affichée seulement si identique sur toutes ses parcelles (pas de moyenne).');
    } else p.note(`Aucun semis enregistré pour ${camp}.`);
    },
    epandages: (n) => {
    // 2. Épandages : totaux par produit, puis détail par parcelle
    p.section(n, 'Épandages', 'Source : activités d\'épandage', SUITE);
    if (ep.parcelles.length) {
      p.tableau({ legende: 'Totaux exploitation par produit',
        colonnes: [{ label: 'Produit', w: 3 }, { label: 'Parcelles', w: 1.4 }, { label: 'ha', w: 1.4 }, { label: 'Quantité (t)', w: 1.6 }],
        lignes: ep.parProduit.map((x) => ({ cells: [x.produit, String(x.nbParcelles), ha2(x.ha), t1(x.t)] })) });
      const lignes = [];
      ep.parcelles.forEach((x) => {
        lignes.push({ type: 'sstot', cells: [sepP(x.parcelle, x.culture), '', ha2(x.ha), '', t1(x.t)] });
        x.lignes.forEach((l) => lignes.push({ type: 'det', cells: [l.produit, jourMois(l.date), '', l.tHa == null ? gris('—') : `${t1(l.tHa)} t`, l.t == null ? gris('—') : t1(l.t)] }));
      });
      p.tableau({ legende: 'Détail par parcelle',
        colonnes: [{ label: 'Parcelle / produit', w: 4 }, { label: 'Date', w: 1 }, { label: 'ha', w: 1 }, { label: 'Dose /ha', w: 1.3 }, { label: 'Quantité (t)', w: 1.5 }], lignes });
    } else p.note(`Aucun épandage enregistré pour ${camp}.`);
    },
    fourrages: (n) => {
    // 3. Fourrages : par fourrage · coupe, puis par parcelle
    p.section(n, 'Fourrages récoltés', 'Source : pressages et séchages', SUITE);
    if (fo.parCoupe.length) {
      p.tuiles([
        { teinte: 'vert', valeur: `${t1(fo.t)} t`, label: 'Récolté' },
        { teinte: '', valeur: `${t1(fo.tSeche)} t`, label: 'Séché grange' },
        { teinte: '', valeur: `${t1(fo.tBottes)} t`, label: fo.nbBottes ? `En bottes · ${entier(fo.nbBottes)}` : 'En bottes' }
      ]);
      const lA = [];
      fo.parCoupe.forEach((g) => {
        lA.push({ type: 'sstot', cells: [`${g.fourrage} · ${ORD(g.coupe)}`, '', g.mode, ha2(g.ha) + et(g.estimee), nb(g.tHa), t1(g.t)] });
        g.lignes.forEach((l) => lA.push({ type: 'det', cells: [l.parcelle, jourMois(l.date),
          l.unites == null ? l.mode : `${libre(l.unites)} ${l.seche ? 'remorques' : 'bottes'}`, ha2(l.ha) + et(l.estimee),
          l.t != null && l.ha > 0 ? t1(l.t / l.ha) : '', l.t == null ? gris('—') : t1(l.t)] }));
      });
      lA.push({ type: 'tot', cells: ['Total', '', '', '', '', t1(fo.t)] });
      p.tableau({ legende: 'Par fourrage et coupe',
        colonnes: [{ label: 'Fourrage · coupe / parcelle', w: 3.6 }, { label: 'Date', w: 1 }, { label: 'Mode', w: 1.6, align: 'left' },
          { label: 'ha', w: 1 }, { label: 't/ha', w: 1 }, { label: 't', w: 1.1 }], lignes: lA });
      const lB = [];
      fo.parParcelle.forEach((x) => {
        lB.push({ type: 'sstot', cells: [sepP(x.parcelle, x.culture, `${ha2(x.ha)} ha`), '', '', t1(x.t), nb(x.tHa)] });
        x.lignes.forEach((l) => lB.push({ type: 'det', cells: [sepP(ORD(l.coupe), l.fourrage), jourMois(l.date), l.mode, l.t == null ? gris('—') : t1(l.t),
          l.t != null && l.ha > 0 ? t1(l.t / l.ha) : ''] }));
      });
      p.tableau({ legende: 'Par parcelle',
        colonnes: [{ label: 'Parcelle / coupe', w: 4.4 }, { label: 'Date', w: 1 }, { label: 'Mode', w: 1.2, align: 'left' }, { label: 't', w: 1.1 }, { label: 't/ha', w: 1 }], lignes: lB });
    } else p.note(`Aucune récolte de fourrage enregistrée pour ${camp}.`);
    },
    cereales: (n) => {
    // 4. Céréales & paille : par culture
    p.section(n, 'Céréales & paille', 'Source : moissons et pressages de paille', SUITE);
    if (ce.groupes.length) {
      p.tuiles([
        { teinte: 'bleu', valeur: ce.grainT == null ? '—' : `${t1(ce.grainT)} t`, label: 'Grain' },
        { teinte: 'ambre', valeur: ce.pailleT == null ? '—' : `${t1(ce.pailleT)} t`, label: ce.bottes ? `Paille · ${entier(ce.bottes)} bottes` : 'Paille' }
      ]);
      const lignes = [];
      ce.groupes.forEach((g) => {
        lignes.push({ type: 'sstot', cells: [g.nom, '', ha2(g.ha), nb(g.grainT), g.qHa == null ? '' : entier(g.qHa), nb(g.bottes, entier), nb(g.pailleT)] });
        g.lignes.forEach((l) => lignes.push({ type: 'det', cells: [l.parcelle, jourMois(l.date), ha2(l.ha), l.grainT == null ? gris('—') : t1(l.grainT),
          l.qHa == null ? '' : entier(l.qHa), nb(l.bottes, entier), nb(l.pailleT)] }));
      });
      lignes.push({ type: 'tot', cells: ['Total', '', ha2(ce.ha), nb(ce.grainT), '', nb(ce.bottes, entier), nb(ce.pailleT)] });
      p.tableau({ colonnes: [{ label: 'Culture / parcelle', w: 3.4 }, { label: 'Moisson', w: 1.1 }, { label: 'ha', w: 1 }, { label: 'Grain t', w: 1.1 },
        { label: 'q/ha', w: 0.9 }, { label: 'Bottes', w: 1 }, { label: 'Paille t', w: 1.1 }], lignes });
    } else p.note(`Aucune moisson ni paille enregistrée pour ${camp}.`);
    },
    travaux: (n) => {
    // 5. Travaux : par type, puis par parcelle
    p.section(n, 'Travaux', 'Source : journal des activités', SUITE);
    if (tr.parParcelle.length) {
      if (tr.parType.length) p.tableau({ legende: 'Par type',
        colonnes: [{ label: 'Travail', w: 2.4 }, { label: 'Parcelles', w: 5.2, align: 'left' }, { label: 'ha', w: 1 }],
        lignes: tr.parType.map((g) => ({ cells: [g.type, g.parcellesNoms.join(', '), ha2(g.ha)] })) });
      const lignes = [];
      tr.parParcelle.forEach((x) => {
        lignes.push({ type: 'sstot', cells: [sepP(x.parcelle, `${ha2(x.ha)} ha`, x.culture), '', '', ''] });
        x.lignes.forEach((l) => lignes.push({ type: 'det', cells: [l.type, jourMois(l.date), sepP(l.tracteur, l.outil) || gris('—'), l.chauffeur || gris('—')] }));
      });
      p.tableau({ legende: 'Par parcelle',
        colonnes: [{ label: 'Parcelle / travail', w: 3.6 }, { label: 'Date', w: 1 }, { label: 'Tracteur · outil', w: 3, align: 'left' }, { label: 'Chauffeur', w: 1.4, align: 'left' }], lignes });
    } else p.note(`Aucun travail enregistré pour ${camp}.`);
    },
    stocks: (n) => {
    // 6. Bilan stocks
    const { lignes: lst, tot } = syntheseStocks(stocks.groupes);
    p.section(n, 'Bilan stocks', 'Source : journal des mouvements de stock', SUITE);
    p.tuiles([
      { teinte: 'vert', valeur: `${t1(tot.entrees)} t`, label: 'Disponible' },
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
      const tard = noteTardives(syn.tardives, camp);
      if (tard) p.note(tard);
    },
  };
  const choisis = THEMES_REALISE.map((t) => t.id).filter((id) => themes.includes(id));
  choisis.forEach((id, i) => {
    if (i > 0) p.saut();
    sections[id](choisis.length > 1 ? i + 1 : 1);
  });
  if ((choisis.includes('semis') && se.estimee) || (choisis.includes('fourrages') && fo.estimee)) p.note(NOTE_ESTIMEE);
  return p.terminer();
}
