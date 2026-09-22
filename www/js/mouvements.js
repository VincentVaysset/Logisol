// Journal des mouvements de stock (collection Firestore "mouvements_stock").
//
// C'est LE registre : le niveau d'une cellule ou d'un emplacement n'est jamais
// saisi, il se calcule toujours comme « somme des entrées moins somme des
// sorties ». Un mouvement est donc un fait daté qu'on peut relire, corriger ou
// supprimer, et le niveau suit ; l'inverse — un niveau modifiable à la main
// doublé d'un journal — finit systématiquement par diverger sans qu'on sache
// laquelle des deux valeurs croire.
//
// UNITÉS : tonnes pour le grain, nombre de bottes pour le fourrage, comme
// spécifié. La conversion du fourrage en tonnes se fait via le poids des
// bottes porté par chaque entrée.
import { db, auth } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "../vendor/firebase/firebase-firestore.js";
import { setQuantite, getCelluleById } from './cellules.js';
import { setNiveau, getEmplacementById } from './emplacements.js';

const COL = collection(db, 'lgs_mouvements_stock');

/**
 * @typedef {'ENTREE_RECOLTE'|'ENTREE_ACHAT'|'SORTIE_ALIMENTATION'|'PERTE'|'TRANSFERT'|'INVENTAIRE'} TypeMouvement
 * @typedef {'PARCELLE'|'CELLULE'|'EMPLACEMENT_FOURRAGE'|'FOURNISSEUR'} SourceType
 * @typedef {'CELLULE'|'EMPLACEMENT_FOURRAGE'|'LOT_BERGERIE'|'AUTRE'} DestinationType
 *
 * @typedef {object} MouvementStock
 * @property {string} id
 * @property {string} date
 * @property {TypeMouvement} typeMouvement
 * @property {SourceType} sourceType
 * @property {string} [sourceId]
 * @property {DestinationType} destinationType
 * @property {string} [destinationId]
 * @property {number} quantite              tonnes (grain) ou bottes (fourrage)
 * @property {string} libelle
 * @property {string} [intervenant]
 */

// TRANSFERT et INVENTAIRE s'ajoutent aux quatre types demandés :
//   * TRANSFERT — vider un silo dans un autre est un geste courant, et le
//     saisir comme une perte suivie d'un achat fausserait les deux compteurs ;
//   * INVENTAIRE — un re-comptage qui ne colle pas au calcul doit laisser une
//     trace explicite plutôt que d'être corrigé en douce.
export const TYPES_MOUVEMENT = [
  { value: 'ENTREE_RECOLTE',      label: 'Entrée — récolte',      sens: 1,  icone: '🌾' },
  { value: 'ENTREE_ACHAT',        label: 'Entrée — achat',        sens: 1,  icone: '🛒' },
  { value: 'TRANSFERT',           label: 'Transfert',             sens: 0,  icone: '🔁' },
  { value: 'SORTIE_ALIMENTATION', label: 'Sortie — alimentation', sens: -1, icone: '🐑' },
  { value: 'PERTE',               label: 'Perte / déchet',        sens: -1, icone: '🗑️' },
  { value: 'INVENTAIRE',          label: 'Correction d\'inventaire', sens: 0, icone: '📋' }
];

export function typeMouvement(value) {
  return TYPES_MOUVEMENT.find((t) => t.value === value) || TYPES_MOUVEMENT[0];
}

const CONTENANTS = ['CELLULE', 'EMPLACEMENT_FOURRAGE'];

let courants = [];
const listeners = new Set();

export function getMouvements() { return courants; }
export function onMouvementsChange(cb) { listeners.add(cb); cb(courants); return () => listeners.delete(cb); }

export function watchMouvements() {
  return onSnapshot(COL, (snap) => {
    courants = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : msDe(b.creeLe) - msDe(a.creeLe)));
    listeners.forEach((cb) => cb(courants));
  });
}

function msDe(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

// --- Calcul des niveaux ---------------------------------------------------

/**
 * Niveau d'un contenant, reconstruit depuis le journal.
 * Un mouvement compte EN PLUS s'il arrive dans ce contenant, EN MOINS s'il en
 * part — ce qui traite au passage les transferts sans règle particulière.
 * @returns {{quantite:number, poidsMoyenBotteKg:number, nbMouvements:number}}
 */
export function niveauContenant(type, id, liste = courants) {
  let quantite = 0;
  let kgTotal = 0;      // pour la moyenne pondérée des poids de botte
  let bottesPesees = 0;
  let nbMouvements = 0;

  // ORDRE CHRONOLOGIQUE OBLIGATOIRE.
  // La liste de travail est triée du plus RÉCENT au plus ancien (c'est ce que
  // veut l'affichage du journal). La replier telle quelle donnerait un résultat
  // faux dès qu'un inventaire est présent : l'inventaire, traité en premier,
  // fixerait le niveau, puis les mouvements ANTÉRIEURS viendraient s'ajouter
  // par-dessus. On replie donc toujours du plus ancien au plus récent, quel que
  // soit l'ordre reçu.
  const chronologique = liste
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : msDe(a.creeLe) - msDe(b.creeLe)));

  chronologique.forEach((m) => {
    const entre = m.destinationType === type && m.destinationId === id;
    const sort = m.sourceType === type && m.sourceId === id;
    if (!entre && !sort) return;
    nbMouvements++;
    const q = Number(m.quantite) || 0;

    if (m.typeMouvement === 'INVENTAIRE' && entre) {
      // Un inventaire ne s'ajoute pas : il REMPLACE le niveau constaté.
      quantite = q;
      return;
    }
    quantite += entre ? q : -q;

    if (entre && m.poidsBotteKg) {
      kgTotal += q * Number(m.poidsBotteKg);
      bottesPesees += q;
    }
  });

  return {
    quantite: Math.round(quantite * 1000) / 1000,
    poidsMoyenBotteKg: bottesPesees > 0 ? Math.round((kgTotal / bottesPesees) * 10) / 10 : 0,
    nbMouvements
  };
}

export function mouvementsDuContenant(type, id, liste = courants) {
  return liste.filter(
    (m) => (m.destinationType === type && m.destinationId === id) ||
           (m.sourceType === type && m.sourceId === id)
  );
}

// Réécrit le cache de niveau des contenants touchés par un mouvement.
//
// "liste" est OBLIGATOIRE et doit déjà contenir le mouvement tel qu'il sera
// après l'écriture : onSnapshot ne s'est pas encore déclenché à cet instant,
// donc recalculer depuis la liste courante ignorerait purement et simplement
// le mouvement qu'on vient d'enregistrer, et le cache resterait en retard
// d'un cran à chaque saisie.
//
// Les erreurs sont avalées volontairement : le journal fait foi, un cache non
// réécrit n'est qu'un affichage périmé, jamais une donnée perdue.
async function rafraichirContenants(ids, liste) {
  const vus = new Set();
  for (const { type, id } of ids) {
    if (!id || !CONTENANTS.includes(type)) continue;
    const cle = type + '|' + id;
    if (vus.has(cle)) continue;   // un transfert peut désigner deux fois le
    vus.add(cle);                 // même contenant via des entrées distinctes
    const n = niveauContenant(type, id, liste);
    try {
      if (type === 'CELLULE') {
        const c = getCelluleById(id);
        await setQuantite(id, n.quantite, grainEntrant(type, id, liste) || (c ? c.typeGrainActuel : undefined));
      } else {
        await setNiveau(id, n.quantite, n.poidsMoyenBotteKg);
      }
    } catch (err) {
      if (window.__logisolDebug) window.__logisolDebug('Cache de niveau non réécrit : ' + ((err && err.message) || err));
    }
  }
}

// Liste de travail pour le recalcul, contenant le mouvement TEL QU'IL SERA
// après l'écriture — en un seul exemplaire.
//
// Le dédoublonnage par id n'est pas une précaution théorique : selon que
// Firestore a déjà appliqué sa compensation de latence ou non, "courants"
// contient déjà le mouvement, ou pas encore. Concaténer sans vérifier le
// comptait donc deux fois une fois sur deux — reproduit en test : un
// transfert de 20 t en retirait 40 du silo de départ et en ajoutait 40 à
// celui d'arrivée, et une entrée de 150 bottes en inscrivait 300.
function avec(liste, mouvement) {
  return [mouvement].concat(liste.filter((x) => x.id !== mouvement.id));
}
function sans(liste, id) {
  return liste.filter((x) => x.id !== id);
}

// Le contenu d'un silo est celui de la dernière entrée : remplir une cellule
// d'orge en fait une cellule d'orge, sans avoir à le ressaisir à côté.
function grainEntrant(type, id, liste) {
  if (type !== 'CELLULE') return undefined;
  const entrees = liste
    .filter((m) => m.destinationType === 'CELLULE' && m.destinationId === id && m.typeGrain)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return entrees.length ? entrees[0].typeGrain : undefined;
}

function nettoyer(data) {
  const m = {
    date: data.date,
    typeMouvement: data.typeMouvement,
    sourceType: data.sourceType || null,
    sourceId: data.sourceId || null,
    destinationType: data.destinationType || null,
    destinationId: data.destinationId || null,
    quantite: Number(data.quantite) || 0,
    libelle: String(data.libelle || '').trim(),
    intervenant: String(data.intervenant || '').trim()
  };
  // Copies figées : le journal doit rester lisible même si un contenant, une
  // parcelle ou un lot est renommé ou supprimé plus tard.
  m.sourceNom = data.sourceNom || '';
  m.destinationNom = data.destinationNom || '';
  m.unite = data.unite || (data.destinationType === 'EMPLACEMENT_FOURRAGE' || data.sourceType === 'EMPLACEMENT_FOURRAGE' ? 'bottes' : 't');
  const p = Number(data.poidsBotteKg);
  m.poidsBotteKg = isFinite(p) && p > 0 ? p : null;
  m.typeGrain = data.typeGrain || null;
  return m;
}

function valider(m) {
  if (!m.date) throw new Error('La date est obligatoire.');
  if (!m.typeMouvement) throw new Error('Choisis un type de mouvement.');
  if (!(m.quantite > 0)) throw new Error('La quantité doit être supérieure à 0.');
  const t = typeMouvement(m.typeMouvement);
  const versContenant = CONTENANTS.includes(m.destinationType) && m.destinationId;
  const depuisContenant = CONTENANTS.includes(m.sourceType) && m.sourceId;
  if (t.sens === 1 && !versContenant) {
    throw new Error('Une entrée doit aller vers une cellule ou un emplacement.');
  }
  if (t.sens === -1 && !depuisContenant) {
    throw new Error('Une sortie doit partir d\'une cellule ou d\'un emplacement.');
  }
  if (m.typeMouvement === 'TRANSFERT' && !(versContenant && depuisContenant)) {
    throw new Error('Un transfert demande un contenant de départ ET un contenant d\'arrivée.');
  }
  if (m.typeMouvement === 'TRANSFERT' && m.sourceId === m.destinationId) {
    throw new Error('Le contenant de départ et celui d\'arrivée doivent être différents.');
  }
  if (m.typeMouvement === 'INVENTAIRE' && !versContenant) {
    throw new Error('Un inventaire porte sur une cellule ou un emplacement.');
  }
}

export async function createMouvement(data) {
  const m = nettoyer(data);
  valider(m);
  const ref = await addDoc(COL, {
    ...m, creeLe: serverTimestamp(), majLe: serverTimestamp(),
    creePar: auth.currentUser ? auth.currentUser.uid : null
  });
  await rafraichirContenants(
    [{ type: m.destinationType, id: m.destinationId },
     { type: m.sourceType, id: m.sourceId }],
    avec(courants, { id: ref.id, ...m })
  );
  return ref;
}

export async function updateMouvement(id, data) {
  const m = nettoyer(data);
  valider(m);
  const avant = courants.find((x) => x.id === id);
  await updateDoc(doc(db, 'lgs_mouvements_stock', id), { ...m, majLe: serverTimestamp() });
  // On rafraîchit AUSSI les contenants d'avant modification : déplacer un
  // mouvement d'un silo à un autre doit corriger les deux, pas seulement le
  // nouveau.
  await rafraichirContenants(
    [{ type: m.destinationType, id: m.destinationId },
     { type: m.sourceType, id: m.sourceId },
     ...(avant ? [{ type: avant.destinationType, id: avant.destinationId },
                  { type: avant.sourceType, id: avant.sourceId }] : [])],
    avec(courants, { id, ...m })
  );
}

export async function deleteMouvement(id) {
  const avant = courants.find((x) => x.id === id);
  await deleteDoc(doc(db, 'lgs_mouvements_stock', id));
  if (avant) {
    await rafraichirContenants(
      [{ type: avant.destinationType, id: avant.destinationId },
       { type: avant.sourceType, id: avant.sourceId }],
      sans(courants, id)
    );
  }
}
