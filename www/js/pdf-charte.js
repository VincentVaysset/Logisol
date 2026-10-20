// Mise en page des PDF à la charte Ovilog (docs/maquettes/exemple-pdf-realise-
// 2027.pdf) : A4 portrait en points, marges 36 pt, 56 pt réservés en bas pour
// le pied, Helvetica / Helvetica-Bold, palette PDF_CHARTE et rien d'autre.
// Moteur sans données : ui-rapports.js décide du contenu, ce module ne fait
// que le poser (en-têtes de page, sections, tuiles, tableaux paginés, pied).

export const PDF_CHARTE = {
  vert: '#357f4b', vertFonce: '#2f6e44', vertPastel: '#e3f3e6',
  bleu: '#1f5a8a', bleuPastel: '#e6f0fa',
  ambre: '#b5701c', ambrePastel: '#fbeed7',
  rouge: '#a33a31', rougePastel: '#fbe3e0',
  ligneAlt: '#f6f1e4', texte: '#2b261c', texte2: '#5e5b47', icone: '#8a8670', bord: '#e6ddc9'
};
const C = PDF_CHARTE;
const BLANC = '#ffffff';
const LIGNE_PAIRE = '#fbf8f1';

const PAGE_L = 595.28;
const PAGE_H = 841.89;
const M = 36;
const BAS = 56;
const LARG = PAGE_L - 2 * M;
const DROITE = PAGE_L - M;
const LIMITE = PAGE_H - BAS;
const H_TUILE = 50;
const H_ENTETE = 18;
const H_LIGNE = 16;
const TEINTES = {
  vert: [C.vertPastel, C.vertFonce], bleu: [C.bleuPastel, C.bleu], ambre: [C.ambrePastel, C.ambre], '': [C.ligneAlt, C.icone]
};

// Helvetica standard = WinAnsi : ni espace fine insécable (séparateur de
// milliers fr-FR), ni vrai signe moins, ni lettres en exposant.
export function texteWinAnsi(s) {
  return String(s == null ? '' : s).replace(/[  ]/g, ' ').replace(/−/g, '-')
    .replace(/ʳᵉ/g, 're').replace(/ᵉ/g, 'e');
}

/**
 * @param {object} o
 * @param {Function} o.jsPDF       constructeur jsPDF
 * @param {string} o.titre         « Bilan réalisé »
 * @param {string} o.sousTitre     « Campagne 2027 · arrêté au 19/10/2026 »
 * @param {string} o.exploitation  nom de la ferme (vide : rien)
 * @param {string} o.edition       « Édité le 19/10/2026 »
 * @param {string} o.pied          « Logisol — Bilan réalisé · Campagne 2027 »
 */
export function creerPdfCharte({ jsPDF, titre, sousTitre, exploitation, edition, pied }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 0;

  const police = (gras, taille, couleur) => {
    doc.setFont('helvetica', gras ? 'bold' : 'normal');
    doc.setFontSize(taille);
    doc.setTextColor(couleur);
  };
  const ecrire = (s, x, yy, opts) => doc.text(texteWinAnsi(s), x, yy, opts);
  const largeur = (s) => doc.getTextWidth(texteWinAnsi(s));
  const filet = (yy, epaisseur, couleur) => {
    doc.setDrawColor(couleur); doc.setLineWidth(epaisseur); doc.line(M, yy, DROITE, yy);
  };
  // Tronque avec « … » plutôt que de déborder sur la colonne voisine.
  const ajuster = (s, max) => {
    let t = texteWinAnsi(s);
    if (doc.getTextWidth(t) <= max) return t;
    while (t.length > 1 && doc.getTextWidth(t + '…') > max) t = t.slice(0, -1);
    return t + '…';
  };

  function entetePremiere() {
    police(true, 8.5, C.vertFonce); ecrire('LOGISOL', M, 44);
    police(true, 18, C.texte); ecrire(titre, M, 64);
    police(false, 10, C.texte2); ecrire(sousTitre, M, 79);
    if (exploitation) { police(true, 10.5, C.texte); ecrire(ajuster(exploitation, 220), DROITE, 54, { align: 'right' }); }
    police(false, 8.5, C.texte2); ecrire(edition, DROITE, 67, { align: 'right' });
    filet(90, 2.2, C.vert);
    y = 100;
  }
  function enteteSuite() {
    police(true, 8.5, C.vertFonce); ecrire('LOGISOL', M, 44);
    const x = M + largeur('LOGISOL') + 14;
    police(false, 9, C.texte2); ecrire(`${titre} (suite)`, x, 44);
    filet(52, 1.2, C.vert);
    y = 62;
  }
  function nouvellePage() { doc.addPage(); enteteSuite(); }
  const place = (h) => y + h <= LIMITE;

  entetePremiere();

  return {
    /**
     * Titre de section numéroté, source à droite. `suite` : hauteur du début
     * de contenu (tuiles + début de tableau) qui doit tenir avec le titre,
     * sinon toute la section passe à la page suivante.
     */
    section(numero, libelle, source, suite = 0) {
      if (!place(27 + suite)) nouvellePage();
      police(true, 12, C.vertFonce); ecrire(`${numero}.  ${libelle}`, M, y + 15);
      if (source) { police(false, 8.5, C.texte2); ecrire(source, DROITE, y + 14, { align: 'right' }); }
      y += 27;
    },
    /** @param {Array<{teinte:'vert'|'bleu'|'ambre'|'', valeur:string, label:string}>} liste */
    tuiles(liste) {
      if (!place(H_TUILE)) nouvellePage();
      const gap = 10;
      const w = (LARG - gap * (liste.length - 1)) / liste.length;
      liste.forEach((t, i) => {
        const x = M + i * (w + gap);
        const [fond, trait] = TEINTES[t.teinte || ''];
        doc.setFillColor(fond); doc.rect(x, y, w, H_TUILE, 'F');
        doc.setFillColor(trait); doc.rect(x, y, 4, H_TUILE, 'F');
        police(false, 8, C.texte2); ecrire(ajuster(t.label, w - 22), x + 13, y + 14);
        // La valeur rétrécit plutôt que d'être coupée.
        let taille = 15;
        police(true, taille, t.teinte ? trait : C.texte2);
        while (taille > 8 && largeur(t.valeur) > w - 22) { taille -= 0.5; doc.setFontSize(taille); }
        ecrire(t.valeur, x + 13, y + 35);
      });
      y += H_TUILE + 13;
    },
    /**
     * Tableau paginé (en-tête répété à chaque nouvelle page).
     * @param {object} t
     * @param {string} [t.legende]
     * @param {Array<{label:string, w:number, align?:'left'|'right'}>} t.colonnes  w relatifs
     * @param {Array<{type?:'grp'|'tot'|'na'|'vide'|'rouge', cells:Array<string|{t:string, sous?:string, cls?:'na'|'ec-p'|'ec-m'}>}>} t.lignes
     *   `sous` : petite ligne sous la valeur (semence sous la culture) ; la ligne s'agrandit.
     */
    tableau({ legende, colonnes, lignes }) {
      const total = colonnes.reduce((n, c) => n + c.w, 0);
      const ws = colonnes.map((c) => (c.w / total) * LARG);
      const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((n, v) => n + v, 0));
      const align = (i) => colonnes[i].align || (i === 0 ? 'left' : 'right');
      const xTexte = (i) => (align(i) === 'right' ? xs[i] + ws[i] - 6 : xs[i] + 6);

      const entete = () => {
        doc.setFillColor(C.vert);
        doc.roundedRect(M, y, LARG, H_ENTETE, 5, 5, 'F');
        doc.rect(M, y + 5, LARG, H_ENTETE - 5, 'F');
        colonnes.forEach((c, i) => {
          // Libellé jamais coupé : la police descend jusqu'à 6 pt.
          let taille = 8.5;
          police(true, taille, BLANC);
          while (taille > 6 && largeur(c.label) > ws[i] - 12) { taille -= 0.5; doc.setFontSize(taille); }
          ecrire(c.label, xTexte(i), y + 12, { align: align(i) });
        });
        y += H_ENTETE;
      };

      if (legende) {
        if (!place(18 + H_ENTETE + H_LIGNE * Math.min(3, lignes.length))) nouvellePage();
        police(true, 9.5, C.texte); ecrire(legende, M, y + 10);
        y += 18;
      }
      if (!place(H_ENTETE + H_LIGNE * Math.min(2, lignes.length))) nouvellePage();
      entete();
      let rang = 0;
      lignes.forEach((l) => {
        const h = l.cells.some((c) => c && typeof c === 'object' && c.sous) ? H_LIGNE + 9 : H_LIGNE;
        if (!place(h)) { nouvellePage(); entete(); rang = 0; }
        const type = l.type || '';
        if (type === 'vide') {
          doc.setFillColor(LIGNE_PAIRE); doc.rect(M, y, LARG, H_LIGNE, 'F');
          police(false, 9, C.icone); ecrire(ajuster(l.cells[0], LARG - 12), M + 6, y + 11.5);
          y += H_LIGNE;
          return;
        }
        if (type === 'grp') {
          police(true, 7.5, C.texte2);
          ecrire(ajuster(String(l.cells[0]).toUpperCase(), LARG - 12), M + 6, y + 12);
          y += H_LIGNE;
          return;
        }
        if (type === 'tot') {
          doc.setFillColor(C.vertPastel);
          doc.roundedRect(M, y, LARG, H_LIGNE, 5, 5, 'F');
          doc.rect(M, y, LARG, H_LIGNE - 5, 'F');
        } else {
          doc.setFillColor(rang % 2 === 0 ? LIGNE_PAIRE : BLANC);
          doc.rect(M, y, LARG, h, 'F');
          rang++;
        }
        l.cells.forEach((cell, i) => {
          const c = typeof cell === 'object' && cell ? cell : { t: cell };
          if (c.t == null || c.t === '') return;
          let couleur = C.texte;
          let gras = type === 'tot';
          if (i === 0 && type !== 'tot') { gras = true; couleur = C.vertFonce; }
          if (type === 'na' || c.cls === 'na') couleur = C.icone;
          if (type === 'rouge') couleur = C.rouge;
          if (c.cls === 'ec-p') couleur = C.vertFonce;
          if (c.cls === 'ec-m') couleur = C.ambre;
          police(gras, 9, couleur);
          ecrire(ajuster(c.t, ws[i] - 12), xTexte(i), y + 11.5, { align: align(i) });
          if (c.sous) { police(false, 7.5, C.texte2); ecrire(ajuster(c.sous, ws[i] - 12), xTexte(i), y + 20.5, { align: align(i) }); }
        });
        y += h;
      });
      y += 12;
    },
    note(texte) {
      police(false, 8.5, C.texte2);
      doc.splitTextToSize(texteWinAnsi(texte), LARG).forEach((ligne) => {
        if (!place(11)) nouvellePage();
        doc.text(ligne, M, y + 8);
        y += 11;
      });
      y += 6;
    },
    espace(h) { y += h; },
    /** Pied de chaque page (Page n/N) puis renvoie le document jsPDF. */
    terminer() {
      const n = doc.internal.getNumberOfPages();
      for (let p = 1; p <= n; p++) {
        doc.setPage(p);
        filet(PAGE_H - 46, 0.6, C.bord);
        police(false, 8, C.icone);
        ecrire(pied, M, PAGE_H - 28);
        ecrire(`Page ${p}/${n}`, DROITE, PAGE_H - 28, { align: 'right' });
      }
      return doc;
    }
  };
}
