// Génération et remise du PDF "Rapports & Synthèses" — 100% local (jsPDF
// vendorisé, aucun appel réseau), et surtout 100% fiable sur mobile.
//
// POURQUOI PAS window.print()/window.open() EN PREMIER RECOURS
// Dans la WebView Capacitor (pas un vrai navigateur), window.print() n'a
// souvent aucun moteur d'impression système à piloter (silencieux : aucune
// erreur, aucun document), et window.open() se heurte au bloqueur de
// popups sur mobile. jsPDF construit le fichier .pdf lui-même, en mémoire
// (Blob) : rien à ouvrir dans une fenêtre tierce. window.print() reste
// disponible en repli manuel (bouton secondaire), utile sur desktop où il
// fonctionne bien.
import {
  calendrierSemis, syntheseCategories, planFertilisation
} from './rapports.js';

const MARGE = 14; // mm, aligné sur @page { margin: 14mm } du CSS d'impression
const LARGEUR_PAGE = 210; // A4 portrait
const HAUTEUR_PAGE = 297;
const LARGEUR_UTILE = LARGEUR_PAGE - MARGE * 2;

function formatHa(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

// Curseur d'écriture avec pagination automatique : évite de dupliquer la
// logique "si ça dépasse la page, addPage() et repartir en haut" à chaque
// section.
function creerCurseur(doc) {
  let y = MARGE;
  function sautDePageSiBesoin(hauteurLigne) {
    if (y + hauteurLigne > HAUTEUR_PAGE - MARGE) {
      doc.addPage();
      y = MARGE;
    }
  }
  return {
    titre(texte) {
      sautDePageSiBesoin(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(5, 150, 105);
      doc.text(texte, MARGE, y);
      y += 8;
      doc.setTextColor(30, 41, 59);
    },
    sousTitre(texte) {
      sautDePageSiBesoin(7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
      doc.text(texte, MARGE, y);
      y += 6;
      doc.setTextColor(30, 41, 59);
    },
    section(texte) {
      y += 2;
      sautDePageSiBesoin(9);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 59);
      doc.text(texte, MARGE, y);
      y += 2;
      doc.setDrawColor(5, 150, 105);
      doc.setLineWidth(0.4);
      doc.line(MARGE, y, LARGEUR_PAGE - MARGE, y);
      y += 6;
    },
    ligne(texte, opts = {}) {
      doc.setFont('helvetica', opts.gras ? 'bold' : 'normal');
      doc.setFontSize(opts.taille || 10);
      const largeur = LARGEUR_UTILE - (opts.indent || 0);
      const morceaux = doc.splitTextToSize(String(texte), largeur);
      morceaux.forEach((m) => {
        sautDePageSiBesoin(5.5);
        doc.text(m, MARGE + (opts.indent || 0), y);
        y += 5.2;
      });
    },
    espace(mm = 3) { y += mm; },
    // Tableau simple, colonnes proportionnelles — suffisant pour des
    // libellés + chiffres, pas de fusion de cellules ni de styles par
    // colonne : ce dont ce rapport a besoin, rien de plus.
    tableau(entetes, lignes, largeursRatio) {
      const total = largeursRatio.reduce((n, v) => n + v, 0);
      const largeurs = largeursRatio.map((r) => (r / total) * LARGEUR_UTILE);
      const xDe = (i) => MARGE + largeurs.slice(0, i).reduce((n, v) => n + v, 0);

      sautDePageSiBesoin(8);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
      doc.setFillColor(5, 150, 105);
      doc.rect(MARGE, y - 4.2, LARGEUR_UTILE, 6.2, 'F');
      entetes.forEach((h, i) => doc.text(String(h), xDe(i) + 1.5, y));
      y += 5;
      doc.setTextColor(30, 41, 59);

      lignes.forEach((cols, idx) => {
        sautDePageSiBesoin(6);
        if (idx % 2 === 1) {
          doc.setFillColor(241, 245, 249);
          doc.rect(MARGE, y - 4, LARGEUR_UTILE, 5.6, 'F');
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        cols.forEach((c, i) => doc.text(String(c), xDe(i) + 1.5, y));
        y += 5.6;
      });
      y += 3;
    },
    finPage() { return y; }
  };
}

/**
 * Construit le PDF du rapport (mêmes données que l'écran Rapports &
 * Synthèses, cf. ui-rapports.js) et le renvoie en Blob — jamais écrit sur
 * disque ni ouvert ici : c'est exporterPdf() qui décide comment le remettre
 * à l'utilisateur.
 */
export function genererRapportPdf({ parcelles, campagne, previsions }) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("Générateur PDF indisponible (jsPDF non chargé).");
  }
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const c = creerCurseur(doc);
  const maintenant = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const dateEdition = `${p2(maintenant.getDate())}/${p2(maintenant.getMonth() + 1)}/${maintenant.getFullYear()} à ${p2(maintenant.getHours())}:${p2(maintenant.getMinutes())}`;

  c.titre('Logisol — Rapports & Synthèses');
  c.sousTitre(`Campagne ${campagne} — Édité le ${dateEdition}`);
  c.espace(2);

  const cal = calendrierSemis(parcelles, campagne, previsions);
  const cat = syntheseCategories(parcelles, campagne, previsions);
  const plan = planFertilisation(parcelles, campagne, previsions);

  // --- Assolement & calendrier des semis ---
  c.section('Assolement & calendrier des semis');
  c.ligne(`🍂 Semis d'automne : ${formatHa(cal.automne.ha)} ha`, { gras: true });
  if (cal.automne.details.length) {
    c.ligne(cal.automne.details.map((d) => `${d.label} : ${formatHa(d.ha)} ha`).join('  ·  '), { indent: 4, taille: 9 });
  }
  cal.automne.sousTotaux.forEach((g) => {
    c.ligne(`— ${g.label} : ${formatHa(g.ha)} ha`, { indent: 4, taille: 9 });
  });
  c.espace(1);
  c.ligne(`🌱 Semis de printemps : ${formatHa(cal.printemps.ha)} ha`, { gras: true });
  if (cal.printemps.details.length) {
    c.ligne(cal.printemps.details.map((d) => `${d.label} : ${formatHa(d.ha)} ha`).join('  ·  '), { indent: 4, taille: 9 });
  }
  c.espace(1);
  c.ligne(`🟣 Dérobées / couverts en place (réel) : ${formatHa(cal.derobees.ha)} ha`, { gras: true });
  if (cal.derobees.parcelles.length) {
    c.ligne(cal.derobees.parcelles.map((p) => `${p.nom} : ${p.derobee}`).join('  ·  '), { indent: 4, taille: 9 });
  }
  c.espace(4);

  const groupe = (g) => cat.parGroupe.get(g) || 0;
  c.tableau(
    ['Catégorie', `${campagne} (ha)`],
    [
      ['Prairie permanente', formatHa(groupe('PRAIRIE_PERMANENTE'))],
      ['Prairie temporaire', formatHa(groupe('PRAIRIE_TEMPORAIRE'))],
      ['  dont Luzerne (Luz 0 à 5)', formatHa(cat.luzerneHa)],
      ['Céréales', formatHa(cat.cerealesHa)],
      ['Dérobées / couverts (réel)', formatHa(cal.derobees.ha)],
      ['Autre', formatHa(groupe('AUTRE'))],
      ...(cat.nonRenseigneHa ? [['Culture non renseignée', formatHa(cat.nonRenseigneHa)]] : [])
    ],
    [3, 1]
  );
  c.ligne(
    cat.coherent
      ? `✅ Total conforme à la surface enregistrée (${formatHa(cat.totalEnregistre)} ha).`
      : `⚠️ Écart de ${formatHa(Math.abs(cat.totalEnregistre - cat.totalPrevisionnel))} ha avec la surface enregistrée (${formatHa(cat.totalEnregistre)} ha).`,
    { taille: 9 }
  );

  // --- Plan de fertilisation ---
  c.espace(4);
  c.section('Plan de fertilisation');
  c.ligne(`💩 Fumier à épandre : ${formatHa(plan.totalFumierT)} t   —   🪨 Chaux à épandre : ${formatHa(plan.totalChauxT)} t`, { gras: true });
  c.espace(3);
  if (plan.lignes.length) {
    c.tableau(
      ['Parcelle', 'Surface (ha)', 'Fumier (t/ha)', 'Fumier (t)', 'Chaux (t/ha)', 'Chaux (t)'],
      plan.lignes.map((l) => [
        l.nom, formatHa(l.surfaceHa),
        l.fumierTHa ? formatHa(l.fumierTHa) : '—', l.fumierTHa ? formatHa(l.fumierT) : '—',
        l.chauxTHa ? formatHa(l.chauxTHa) : '—', l.chauxTHa ? formatHa(l.chauxT) : '—'
      ]),
      [2.4, 1, 1, 1, 1, 1]
    );
  } else {
    c.ligne(`Aucune dose de fumier ou de chaux renseignée pour ${campagne}.`, { taille: 9 });
  }

  return doc.output('blob');
}

/**
 * Remet le PDF déjà généré à l'utilisateur, avec la méthode la plus fiable
 * disponible sur l'appareil :
 *   1) Web Share API avec fichier (mobile/PWA) : ouvre le sélecteur natif
 *      (lecteur PDF, Fichiers, envoi...) — la meilleure expérience quand
 *      elle existe.
 *   2) Sinon, lien de téléchargement temporaire (<a download>) sur une URL
 *      Blob locale : fonctionne aussi bien en WebView qu'en navigateur,
 *      sans dépendre d'une fenêtre popup (jamais bloqué par un bloqueur de
 *      popups, contrairement à window.open()).
 * Ne lève jamais d'exception : renvoie { ok, methode } ou { ok:false,
 * erreur } pour que l'appelant affiche un retour explicite (cf. ticket,
 * "message d'erreur explicite si la création du fichier échoue").
 */
export async function exporterPdf(blob, nomFichier) {
  try {
    if (navigator.canShare && navigator.share) {
      const fichier = new File([blob], nomFichier, { type: 'application/pdf' });
      if (navigator.canShare({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: nomFichier });
        return { ok: true, methode: 'partage' };
      }
    }
  } catch (e) {
    // AbortError = l'utilisateur a fermé le sélecteur de partage sans rien
    // choisir : ce n'est pas un échec à signaler, juste un renoncement.
    if (e && e.name === 'AbortError') return { ok: true, methode: 'annule' };
    // Tout autre échec du partage retombe sur le téléchargement direct
    // plutôt que d'abandonner l'export.
  }
  try {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    // Révoqué après un court délai (pas immédiatement) : certains
    // navigateurs/WebViews démarrent le téléchargement de façon
    // asynchrone après le click().
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, methode: 'telechargement' };
  } catch (e) {
    return { ok: false, erreur: (e && e.message) || 'Échec du téléchargement.' };
  }
}
