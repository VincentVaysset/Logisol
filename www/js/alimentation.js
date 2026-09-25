// Croisement stades physiologiques × stocks : le cœur du module Alimentation.
//
// Ce que ce module calcule, à partir des seules saisies existantes (récoltes,
// lots, périodes de prélèvement) et SANS aucune saisie quotidienne :
//   * le besoin journalier de chaque lot  = ration du stade × effectif ;
//   * ce que chaque catégorie de stock a déjà servi, en cumulant les périodes
//     de prélèvement (ration et effectif figés au moment de chaque période) ;
//   * ce qu'il reste, et combien de jours ça tient au rythme actuel.
//
// L'affectation reste MANUELLE, comme demandé : rien ne choisit un stock à la
// place de Vincent. Ce module ne fait que rendre visibles les conséquences de
// ses choix.
import { joursNourris, tonnesConsommees, besoinJournalierKg, prelevementsActifs, stadeActifId } from './lots.js';
import { aujourdhui } from './implantations.js';
import { familleAffichage, FAMILLES_AFFICHAGE } from './stocks.js';

function arrondi3(v) { return Math.round(v * 1000) / 1000; }

/**
 * Construit le tableau croisé.
 * @param {object} d
 * @param {Array} d.categories   sortie de stocks.agregerParCategorie()
 * @param {Array} d.lots
 * @param {Array} d.stades
 * @param {Array} d.prelevements
 * @param {string} [d.date]      date d'évaluation (aujourd'hui par défaut)
 */
export function construireTableau({ categories, lots, stades, prelevements, date = aujourdhui() }) {
  const stadeById = new Map(stades.map((s) => [s.id, s]));

  // 1) Consommation cumulée et besoin journalier courant, par catégorie.
  const parCategorie = new Map();
  categories.forEach((c) => {
    parCategorie.set(c.cle, {
      ...c,
      recolte: c.tonnes,
      consomme: 0,
      restant: c.tonnes,
      besoinJourKg: 0,
      lotsActifs: [],
      autonomieJours: null,
      dateEpuisement: null
    });
  });

  // Une catégorie peut avoir été consommée alors qu'aucune récolte ne la
  // porte plus (récolte supprimée, catégorie renommée) : on la fait quand même
  // apparaître, en négatif, plutôt que de perdre silencieusement la trace.
  // Un aliment du commerce (cle "commerce|...") n'a lui JAMAIS de récolte : il
  // est acheté au besoin, sans notion de stock qui s'épuise.
  const assurer = (cle, label) => {
    if (!parCategorie.has(cle)) {
      const commerce = String(cle).startsWith('commerce|');
      parCategorie.set(cle, {
        cle, label: label || cle, categorie: commerce ? 'commerce' : null, conservation: null, coupe: null,
        fourrage: null, espece: null, tonnes: 0, nbRecoltes: 0, nbBottes: 0,
        nbRemorques: 0, surfaceHa: 0, lignes: [],
        recolte: 0, consomme: 0, restant: 0, besoinJourKg: 0,
        lotsActifs: [], autonomieJours: null, dateEpuisement: null,
        orpheline: !commerce, commerce
      });
    }
    return parCategorie.get(cle);
  };

  prelevements.forEach((p) => {
    const c = assurer(p.categorieCle, p.categorieLabel);
    c.consomme = arrondi3(c.consomme + tonnesConsommees(p, date));
    if (p.debut <= date && (!p.fin || p.fin > date)) {
      c.besoinJourKg += besoinJournalierKg(p);
      c.lotsActifs.push(p);
    }
  });

  parCategorie.forEach((c) => {
    if (c.commerce) {
      // Illimité par nature : acheté à mesure du besoin, jamais épuisé.
      c.restant = null;
      c.autonomieJours = null;
      c.dateEpuisement = null;
      return;
    }
    c.restant = arrondi3(c.recolte - c.consomme);
    if (c.besoinJourKg > 0) {
      const jours = Math.floor((c.restant * 1000) / c.besoinJourKg);
      c.autonomieJours = jours;
      c.dateEpuisement = decalerJours(date, Math.max(0, jours));
    }
  });

  // 2) Lignes du tableau : un stade, ses lots, leur besoin et les stocks
  // puisés — un lot peut désormais puiser sur PLUSIEURS composants
  // simultanément (fourrage + céréale + commerce), donc plusieurs lignes de
  // prélèvement actives à la fois.
  const lignes = stades.map((stade) => {
    const lotsDuStade = lots.filter((l) => (stadeActifId(l.id, prelevements, date) || l.stadeId) === stade.id);
    const details = lotsDuStade.map((lot) => {
      const actifs = prelevementsActifs(lot.id, prelevements, date);
      const besoinJourKg = actifs.length
        ? actifs.reduce((n, p) => n + besoinJournalierKg(p), 0)
        : (Number(stade.rationKgParBrebis) || 0) * (Number(lot.nbBrebis) || 0);
      return {
        lot,
        prelevements: actifs,
        besoinJourKg,
        categoriesCles: actifs.map((p) => p.categorieCle),
        joursNourris: actifs.length ? joursNourris(actifs[0], date) : 0
      };
    });
    return {
      stade,
      lots: details,
      nbBrebis: lotsDuStade.reduce((n, l) => n + (Number(l.nbBrebis) || 0), 0),
      besoinJourKg: details.reduce((n, d) => n + d.besoinJourKg, 0),
      // Besoin par catégorie de stock, pour remplir les cellules du croisement.
      parCategorie: details.reduce((acc, d) => {
        d.prelevements.forEach((p) => {
          acc[p.categorieCle] = (acc[p.categorieCle] || 0) + besoinJournalierKg(p);
        });
        return acc;
      }, {})
    };
  });

  const colonnes = Array.from(parCategorie.values()).sort((a, b) => {
    // Les catégories réellement utilisées en premier : ce sont celles que
    // Vincent regarde. Les autres suivent, par ordre alphabétique.
    const ua = a.besoinJourKg > 0 ? 0 : 1;
    const ub = b.besoinJourKg > 0 ? 0 : 1;
    return ua - ub || String(a.label).localeCompare(String(b.label), 'fr');
  });

  const totaux = {
    recolte: arrondi3(colonnes.reduce((n, c) => n + c.recolte, 0)),
    consomme: arrondi3(colonnes.reduce((n, c) => n + c.consomme, 0)),
    restant: arrondi3(colonnes.reduce((n, c) => n + c.restant, 0)),
    // Deux chiffres DIFFÉRENTS, à ne pas confondre :
    //   tireJourKg   = ce qui sort effectivement des stocks aujourd'hui ;
    //   besoinJourKg = ce dont le troupeau a besoin, lots sans stock affecté
    //                  compris. Afficher le premier comme « besoin » ferait
    //                  sous-estimer les besoins de tout lot non encore
    //                  rattaché à un stock.
    tireJourKg: colonnes.reduce((n, c) => n + c.besoinJourKg, 0),
    besoinJourKg: lignes.reduce((n, l) => n + l.besoinJourKg, 0),
    nbBrebis: lignes.reduce((n, l) => n + l.nbBrebis, 0)
  };

  return { colonnes, lignes, totaux, date };
}

// Regroupe les colonnes PRÉCISES de construireTableau() (une par lot de
// stock exact) en familles d'affichage (stocks.js/familleAffichage), pour le
// tableau croisé "Ration actuelle par stade" — jamais pour le détail par lot
// (ui-alimentation.js/renderLots), qui garde le stock précis, plus parlant
// à l'échelle d'un lot d'animaux. Un aliment du commerce reste sa PROPRE
// colonne, jamais fondu : chacun a déjà un nom choisi par l'exploitant.
export function regrouperColonnesParFamille(colonnes, date = aujourdhui()) {
  const parFamille = new Map();
  colonnes.forEach((c) => {
    const famille = c.commerce ? c.label : familleAffichage(c);
    if (!parFamille.has(famille)) {
      parFamille.set(famille, {
        cle: famille, label: famille, commerce: !!c.commerce,
        membres: [], recolte: 0, consomme: 0, restant: 0, besoinJourKg: 0
      });
    }
    const g = parFamille.get(famille);
    g.membres.push(c.cle);
    if (!c.commerce) {
      g.recolte = arrondi3(g.recolte + c.recolte);
      g.consomme = arrondi3(g.consomme + c.consomme);
      g.restant = arrondi3(g.restant + c.restant);
    }
    g.besoinJourKg += c.besoinJourKg;
  });
  parFamille.forEach((g) => {
    if (g.commerce) { g.restant = null; g.autonomieJours = null; g.dateEpuisement = null; return; }
    g.autonomieJours = null;
    g.dateEpuisement = null;
    if (g.besoinJourKg > 0) {
      const jours = Math.floor((g.restant * 1000) / g.besoinJourKg);
      g.autonomieJours = jours;
      g.dateEpuisement = decalerJours(date, Math.max(0, jours));
    }
  });
  const ordre = (label) => {
    const i = FAMILLES_AFFICHAGE.indexOf(label);
    return i === -1 ? FAMILLES_AFFICHAGE.length : i;
  };
  return Array.from(parFamille.values()).sort((a, b) => {
    const ua = a.besoinJourKg > 0 ? 0 : 1;
    const ub = b.besoinJourKg > 0 ? 0 : 1;
    return ua - ub || ordre(a.label) - ordre(b.label) || a.label.localeCompare(b.label, 'fr');
  });
}

// Lots sans stock affecté : c'est l'oubli le plus probable, et il rend le
// tableau muet pour ces animaux. On le signale au lieu de le laisser passer.
export function lotsSansStock(lots, prelevements) {
  return lots.filter((l) => !prelevementsActifs(l.id, prelevements).length);
}

export function decalerJours(dateIso, jours) {
  const d = new Date(dateIso + 'T12:00:00');
  d.setDate(d.getDate() + jours);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "2 mois et 10 j", "18 j" — une autonomie se lit mieux ainsi qu'en jours secs
// quand elle dépasse le trimestre.
export function autonomieLisible(jours) {
  if (jours == null) return '—';
  if (jours < 0) return 'dépassé';
  if (jours < 60) return jours + ' j';
  if (jours >= 365) {
    const ans = Math.floor(jours / 365);
    const mois = Math.floor((jours - ans * 365) / 30.44);
    const partAns = ans === 1 ? '1 an' : `${ans} ans`;
    return mois ? `${partAns} et ${mois} mois` : partAns;
  }
  const mois = Math.floor(jours / 30.44);
  const reste = Math.round(jours - mois * 30.44);
  return reste ? `${mois} mois et ${reste} j` : `${mois} mois`;
}
