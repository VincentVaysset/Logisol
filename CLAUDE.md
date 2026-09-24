# Logisol — directives de développement

Appli de gestion parcellaire/troupeau pour une exploitation ovine laitière
**Bio**, sœur indépendante d'Ovilog.

## Contrainte non négociable

> Le but est de pouvoir attribuer des actions aux parcelles liées aux
> cultures d'herbe, de céréales et de pâturage. Cette appli ne doit **en
> aucun cas** affecter le fonctionnement d'Ovilog ni interférer avec lui.

Conséquences concrètes :
- Même projet Firebase (`ovilog-15ef6`), mêmes comptes email/mot de passe,
  mais **collections strictement séparées** — préfixe `lgs_` pour tout ce qui
  est récent, jamais de lecture croisée avec les collections d'Ovilog.
- **Ne jamais déployer les règles Firestore depuis la CI.** Un déploiement
  remplace tout le jeu de règles du projet, Ovilog compris, qui n'est pas
  dans ce dépôt. Le déploiement reste une étape manuelle : coller
  `firestore-logisol.rules` (fichier complet et autonome, PAS
  `firestore.rules`) dans la console Firebase, en remplaçant tout (Ctrl+A).
- **Jamais de wildcard `match /{document=**}`** : ça ouvrirait toutes les
  collections d'Ovilog en lecture/écriture à tout utilisateur Logisol
  authentifié. Le joker générique n'autorise que `collection.matches('lgs_.*')`.

## Stack

Pure **HTML/CSS/JS, sans framework ni bundler**. Modules ES natifs
(`import`/`export`), chargés par balises `<script type="module">`.
Packaging **Capacitor 6** → APK Android via **GitHub Actions**
(`.github/workflows/build-android.yml`, artefact `logisol-debug-apk`).
Firebase SDK v10, Leaflet 1.9.4 + Leaflet.draw, **vendorisés dans
`www/vendor/`** (fonctionnement hors-ligne complet, y compris au chargement).

## Règles de conception qui ont fait leurs preuves

- **Un niveau de stock ne se saisit jamais directement** : il est toujours
  dérivé d'un journal de mouvements (`lgs_mouvements_stock`), rejoué
  chronologiquement. Le champ stocké sur le contenant n'est qu'un cache
  réécrit après chaque mouvement.
- **Firestore refuse les tableaux imbriqués.** Une géométrie GeoJSON se
  stocke en objets plats (`contour.anneaux[].sommets[].{lon,lat}`), jamais en
  `[[lon,lat]]`.
- **Le réel et le prévu ne se mélangent jamais.** Les implantations
  (`implantations`) disent ce qui pousse réellement, daté ; l'assolement
  prévisionnel (`lgs_assolement_previsionnel`) dit ce qui est prévu par
  campagne. Un écran qui montre les deux les affiche côte à côte, jamais fondus.
- **Toute action irréversible s'annonce avant d'être appliquée** (effet sur
  la culture en place, suppression) et reste **réversible** : l'entité qui a
  produit l'effet garde la trace de ce qu'elle a fait, pour pouvoir le
  défaire si elle est supprimée ou corrigée.
- **Un formulaire qui bloque doit dire quoi faire ET permettre de le faire
  sans perdre la saisie en cours** (ex. créer un bâtiment/contenant manquant
  depuis le tunnel d'activité, retour automatique avec la saisie intacte).
- Le vocabulaire de l'appli est celui du terrain (Luz 1-5, RG trèfle 1-3,
  Blé 1/2...), pas un vocabulaire générique inventé.
- Aucune exploitation Bio : pas de groupe Phyto/traitement des cultures.

## Tests

Interdiction stricte d'utiliser le navigateur ou de prendre des captures d'écran (économie de tokens vision).
Pas de suite automatisée committée. Vérification manuelle par scripts
Playwright jetables (harness dans `/tmp/.../scratchpad/harness.js`, stubs
Firebase inclus) : serveur HTTP local sur `www/`, scénarios end-to-end,
captures d'écran mobile/tablette. Toujours rejouer la suite de
non-régression existante avant de pousser.

## Workflow

- Une branche par tâche (voir consignes de session), jamais de commit direct
  sur la branche par défaut sans y avoir été invité.
- Commits explicites : le message raconte le pourquoi, pas seulement le quoi.
- Ne jamais déployer les règles Firestore automatiquement (voir plus haut).
