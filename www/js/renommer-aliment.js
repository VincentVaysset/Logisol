// Renommer un aliment acheté PARTOUT d'un coup : l'appli reconnaît un aliment
// acheté à son nom (stocks.js/cleAchat), donc changer le nom d'un seul achat
// créait une nouvelle ligne de stock. Ici, même identité réécrite dans tous
// ses mouvements, toutes les rations des lots et les stocks de départ des
// clôtures : aucune quantité ne change, seulement le nom (et la clé).
import { db } from './firebase-config.js';
import { doc, writeBatch } from '../vendor/firebase/firebase-firestore.js';
import { ecrire } from './ecriture-locale.js';
import { getMouvements } from './mouvements.js';
import { getLots } from './lots.js';
import { getClotures, COL_CLOTURES } from './verrou-campagne.js';
import { cleAchat, typeAchatDeCle } from './stocks.js';
import { toastSucces, toastErreur } from './toast.js';

const remplacer = (comps, ancienne, cle, nom) => comps.map((c) => (c.stockCle === ancienne ? { ...c, stockCle: cle, stockLabel: nom } : c));

/** Ce que le renommage toucherait : { cle, achats, rations, clotures, conflit }. */
export function apercuRenommage(ancienne, nouveauNom) {
  const nom = String(nouveauNom || '').trim();
  const type = typeAchatDeCle(ancienne);
  if (!type || !nom) return null;
  const cle = cleAchat(type, nom);
  const conflit = cle !== ancienne && getMouvements().some((m) => m.categorieCle === cle);
  const mouvements = getMouvements().filter((m) => m.categorieCle === ancienne);
  const lots = getLots().filter((l) => (l.affectations || []).some((a) => [...(a.composants || []), ...(a.snapshot || [])].some((c) => c.stockCle === ancienne)));
  const clotures = getClotures().filter((c) => (c.lignes || []).some((l) => l.cle === ancienne));
  return { cle, nom, conflit, mouvements, lots, clotures };
}

export async function renommerAliment(ancienne, nouveauNom) {
  const a = apercuRenommage(ancienne, nouveauNom);
  if (!a) throw new Error('Nom vide ou aliment non acheté.');
  if (a.conflit) throw new Error(`Un autre aliment acheté s'appelle déjà « ${a.nom} ».`);
  const ops = [];
  a.mouvements.forEach((m) => ops.push([doc(db, 'lgs_mouvements_stock', m.id), { categorieCle: a.cle, categorieLabel: a.nom }]));
  a.lots.forEach((l) => ops.push([doc(db, 'lots_animaux', l.id), {
    affectations: l.affectations.map((x) => ({
      ...x,
      ...(Array.isArray(x.composants) ? { composants: remplacer(x.composants, ancienne, a.cle, a.nom) } : {}),
      ...(Array.isArray(x.snapshot) ? { snapshot: remplacer(x.snapshot, ancienne, a.cle, a.nom) } : {})
    }))
  }]));
  a.clotures.forEach((c) => ops.push([doc(db, COL_CLOTURES, c.id), {
    lignes: c.lignes.map((l) => (l.cle === ancienne ? { ...l, cle: a.cle, label: a.nom } : l))
  }]));
  // writeBatch : 500 écritures maximum par lot.
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach(([ref, data]) => batch.update(ref, data));
    await ecrire(ops[i][0], batch.commit(), 'Renommage d\'aliment');
  }
  return a;
}

/** Demande le nouveau nom, annonce l'effet, renomme. Retourne la nouvelle clé ou null. */
export async function demanderRenommage(cle, nomActuel) {
  const nom = prompt('Nouveau nom de l\'aliment :', String(nomActuel || '').replace(/ · acheté$/, ''));
  if (nom == null || !nom.trim()) return null;
  const a = apercuRenommage(cle, nom);
  if (!a) return null;
  if (a.conflit) { toastErreur(`Un autre aliment acheté s'appelle déjà « ${a.nom} ».`); return null; }
  if (!confirm(`Renommer en « ${a.nom} » ? ${a.mouvements.length} mouvement(s), ${a.lots.length} lot(s) (rations) et ${a.clotures.length} clôture(s) seront mis à jour. Aucune quantité ne change.`)) return null;
  try {
    await renommerAliment(cle, nom);
    toastSucces('Aliment renommé.');
    return a;
  } catch (err) {
    toastErreur('Renommage impossible : ' + ((err && err.message) || err));
    return null;
  }
}
