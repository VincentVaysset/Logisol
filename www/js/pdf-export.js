// Génération et remise du PDF "Rapports & Synthèses" — 100% local (jsPDF
// vendorisé, aucun appel réseau), et surtout 100% fiable sur mobile.
//
// POURQUOI PAS window.print()/window.open()
// Dans la WebView Capacitor (pas un vrai navigateur), window.print() n'a
// souvent aucun moteur d'impression système à piloter (silencieux : aucune
// erreur, aucun document), et window.open() se heurte au bloqueur de
// popups sur mobile. jsPDF construit le fichier .pdf lui-même, en mémoire.
//
// POURQUOI PAS <a download>/navigator.share EN PREMIER RECOURS NON PLUS
// Dans l'app installée, une WebView Capacitor brute n'a souvent aucun
// gestionnaire de téléchargement à piloter pour un <a download> (le clic
// "réussit" sans erreur JS, mais rien n'est jamais écrit sur l'appareil), et
// navigator.share/canShare peuvent être absents ou limités selon la version
// de WebView embarquée. exporterPdf() écrit donc le fichier via le pont
// natif Capacitor (plugins officiels Filesystem + Share, cf. plus bas)
// quand l'app est installée — Web Share puis <a download> restent en repli
// pour le test en navigateur (app non installée).
// Mise en page et contenu : pdf-charte.js / pdf-rapports.js.

/**
 * Remet le PDF déjà généré à l'utilisateur, avec la méthode la plus fiable
 * disponible :
 *   1) App installée (pont natif Capacitor, Filesystem + Share) : écrit le
 *      fichier via l'API Android native (aucune dépendance à ce que la
 *      WebView sache gérer un téléchargement), puis ouvre le sélecteur de
 *      partage natif sur ce fichier réel — l'utilisateur choisit de
 *      l'enregistrer dans Fichiers, de l'ouvrir dans un lecteur PDF, etc.
 *      NÉCESSAIRE car dans une WebView Capacitor brute, ni <a download> ni
 *      la Web Share API du navigateur embarqué n'aboutissent de façon
 *      fiable : le clic "réussit" en apparence (aucune erreur JS) mais rien
 *      n'est jamais réellement écrit sur l'appareil — cause du bug remonté
 *      ("le téléchargement se lance mais rien n'est nulle part").
 *   2) Hors app installée (navigateur de test) : Web Share API avec fichier,
 *      puis lien de téléchargement temporaire (<a download>) sur une URL
 *      Blob locale en dernier recours.
 * Ne lève jamais d'exception : renvoie { ok, methode } ou { ok:false,
 * erreur } pour que l'appelant affiche un retour explicite (cf. ticket,
 * "message d'erreur explicite si la création du fichier échoue").
 */
export async function exporterPdf(doc, nomFichier) {
  const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  const Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  if (Filesystem && Share) {
    try {
      const datauri = doc.output('datauristring');
      const base64 = datauri.slice(datauri.indexOf(',') + 1);
      // Répertoire Cache : privé à l'appli, aucune permission de stockage à
      // demander sur aucune version d'Android — suffisant puisque le fichier
      // n'a besoin d'exister que le temps du partage qui suit immédiatement.
      const { uri } = await Filesystem.writeFile({ path: nomFichier, data: base64, directory: 'CACHE' });
      await Share.share({ title: nomFichier, dialogTitle: 'Enregistrer ou ouvrir le PDF', files: [uri] });
      return { ok: true, methode: 'partage' };
    } catch (e) {
      // Partage fermé sans rien choisir : un renoncement, pas un échec.
      if (/cancel|annul/i.test((e && (e.message || e.errorMessage)) || '')) return { ok: true, methode: 'annule' };
      return { ok: false, erreur: (e && e.message) || "Échec de l'enregistrement." };
    }
  }

  const blob = doc.output('blob');
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
