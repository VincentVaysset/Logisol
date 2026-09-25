// Calculs du module "Rapports & Synthèses" — pur, sans DOM, à l'image
// d'assolement-previsionnel.js dont il réutilise le référentiel. Aucune
// écriture Firestore ici : ce module ne fait que relire des données déjà
// saisies ailleurs (assolement prévisionnel, fiche parcelle) pour les
// restituer sous forme de bilans.
import {
  culturePrev, prevision, estSemisDeLAnnee, syntheseSurfaces
} from './assolement-previsionnel.js';
import { getImplantations, implantationEnCours } from './implantations.js';
import { getCultureById } from './cultures-config.js';

function r(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// Saison de semis par famille prévisionnelle. Seules les familles où un
// chantier de semis se programme réellement y figurent : PN et
// Fétuque/Trèfle sont pérennes (pas de semis à planifier chaque campagne).
// Sur ce dossier, céréales et RG trèfle se sèment à l'automne, la luzerne
// (Luz 0, seule "année de semis" du référentiel) au printemps.
const SAISON_PAR_FAMILLE = { CEREALES: 'automne', PRAIRIE_COURTE: 'automne', SEMIS_PRAIRIE: 'printemps' };

// Sous-totaux du semis d'automne : deux familles y sèment, mais ce ne sont
// pas le même chantier — un semoir à céréales et un semoir à prairie ne se
// commandent pas ensemble, et le tonnage de semence non plus. D'où deux
// lignes à part dans le tableau, en plus du total.
const GROUPE_AUTOMNE = {
  CEREALES: { cle: 'cereales', label: 'Céréales / Annuelles' },
  PRAIRIE_COURTE: { cle: 'prairies', label: 'Prairies temporaires & Fourrages' }
};

/**
 * Chantiers de semis à venir pour une campagne : surfaces prévisionnelles à
 * semer, regroupées par saison (avec, pour l'automne, le sous-total
 * Céréales/Annuelles et celui des Prairies temporaires & Fourrages), plus
 * les dérobées/couverts RÉELLEMENT en place (champ vivant de la fiche
 * parcelle — jamais fondues dans le total prévisionnel, cf. CLAUDE.md : le
 * réel et le prévu ne se mélangent jamais).
 */
export function calendrierSemis(parcelles, campagne, liste, implantations = getImplantations()) {
  const automne = new Map();
  const printemps = new Map();
  const sousTotauxAutomne = new Map();
  let haAutomne = 0;
  let haPrintemps = 0;
  parcelles.forEach((p) => {
    const prev = prevision(p.id, campagne, liste);
    const c = prev && prev.cultureCode ? culturePrev(prev.cultureCode) : null;
    if (!c || !estSemisDeLAnnee(c.code)) return;
    const saison = SAISON_PAR_FAMILLE[c.famille];
    if (!saison) return;
    const ha = Number(p.surfaceHa) || 0;
    const bucket = saison === 'automne' ? automne : printemps;
    bucket.set(c.code, (bucket.get(c.code) || 0) + ha);
    if (saison === 'automne') {
      haAutomne += ha;
      const groupe = GROUPE_AUTOMNE[c.famille];
      if (groupe) sousTotauxAutomne.set(groupe.cle, (sousTotauxAutomne.get(groupe.cle) || 0) + ha);
    } else {
      haPrintemps += ha;
    }
  });
  const details = (m) => Array.from(m.entries())
    .map(([code, ha]) => ({ code, label: culturePrev(code).label, ha: r(ha) }))
    .sort((a, b) => b.ha - a.ha);
  const sousTotaux = Object.values(GROUPE_AUTOMNE)
    .map((g) => ({ cle: g.cle, label: g.label, ha: r(sousTotauxAutomne.get(g.cle) || 0) }))
    .filter((g) => g.ha > 0);

  // Réellement en place, pas juste tapé sur la fiche parcelle : lit
  // l'implantation en cours (collection "implantations") plutôt que l'ancien
  // champ texte libre p.derobee, qui restait vide tant que personne ne
  // retapait à la main le nom d'une dérobée/CIPAN/couvert déjà semé via le
  // tunnel d'activité — un semis bien enregistré comme réel disparaissait
  // silencieusement de cette synthèse.
  const enDerobee = [];
  parcelles.forEach((p) => {
    const impl = implantationEnCours(p.id, undefined, implantations);
    const culture = impl ? getCultureById(impl.cultureId) : null;
    if (culture && culture.famille === 'derobee') {
      enDerobee.push({ nom: p.nom || 'Sans nom', derobee: culture.nom, ha: r(Number(p.surfaceHa) || 0) });
    }
  });
  const derobees = {
    ha: r(enDerobee.reduce((n, p) => n + p.ha, 0)),
    parcelles: enDerobee
  };

  return {
    automne: { ha: r(haAutomne), details: details(automne), sousTotaux },
    printemps: { ha: r(haPrintemps), details: details(printemps) },
    derobees
  };
}

/**
 * Synthèse par catégorie PAC (PP / PT / Céréales / Autre), avec Luzerne
 * détaillée à part (LUZ0 compris) et validation de la surface totale contre
 * la surface enregistrée sur les fiches parcelles — c'est la seule référence
 * "cadastrale/PAC" que l'appli connaisse (pas de champ séparé), donc l'écart
 * signalé ici est un vrai garde-fou : toute parcelle non affectée à une
 * campagne fausserait sinon silencieusement le total.
 */
export function syntheseCategories(parcelles, campagne, liste) {
  const s = syntheseSurfaces(parcelles, campagne, liste);
  const totalEnregistre = r(parcelles.reduce((n, p) => n + (Number(p.surfaceHa) || 0), 0));
  const luzerneHa = r((s.parFamille.get('LUZERNE') || 0) + (s.parFamille.get('SEMIS_PRAIRIE') || 0));
  return {
    parGroupe: s.parGroupe,
    luzerneHa,
    cerealesHa: r(s.parFamille.get('CEREALES') || 0),
    nonRenseigneHa: s.nonRenseigne,
    totalPrevisionnel: s.total,
    totalEnregistre,
    coherent: Math.abs(s.total - totalEnregistre) < 0.01
  };
}

/**
 * Plan de fertilisation : dose (t/ha) × surface = tonnage à épandre,
 * parcelle par parcelle, pour la campagne donnée. Ne retient que les
 * parcelles avec une dose renseignée (fumier ou chaux) — une liste de
 * toutes les parcelles à zéro n'aiderait personne à commander le bon
 * tonnage.
 */
export function planFertilisation(parcelles, campagne, liste) {
  const lignes = parcelles
    .map((p) => {
      const prev = prevision(p.id, campagne, liste) || {};
      const surfaceHa = Number(p.surfaceHa) || 0;
      const fumierTHa = Number(prev.fumierTHa) || 0;
      const chauxTHa = Number(prev.chauxTHa) || 0;
      return {
        parcelleId: p.id, nom: p.nom || 'Sans nom', numero: p.numero || '',
        surfaceHa, fumierTHa, chauxTHa,
        fumierT: r(fumierTHa * surfaceHa), chauxT: r(chauxTHa * surfaceHa)
      };
    })
    .filter((l) => l.fumierTHa > 0 || l.chauxTHa > 0);
  return {
    lignes,
    totalFumierT: r(lignes.reduce((n, l) => n + l.fumierT, 0)),
    totalChauxT: r(lignes.reduce((n, l) => n + l.chauxT, 0))
  };
}
