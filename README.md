# Logisol

Application Android de gestion parcellaire pour une exploitation agricole
(ovins laitiers), en complément de l'appli sœur **Ovilog** (troupeau).

Logisol est un **dépôt et une appli indépendants** : même projet Firebase
que Ovilog (mêmes comptes email/mot de passe), mais ses propres collections
Firestore (`parcelles`, `parcelles_config`), sans aucune lecture croisée
avec les collections d'Ovilog. Le dépôt Ovilog n'est ni modifié ni requis
pour faire fonctionner Logisol.

## Stack

- HTML/CSS/JS pur (pas de framework, pas de bundler), empaqueté en appli
  Android via [Capacitor](https://capacitorjs.com/)
- [Leaflet.js](https://leafletjs.com/) + [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw)
- Fonds de carte (tous gratuits, sans clé API), commutables via le bouton
  « calques » en haut à droite :
  - **Satellite IGN** (Géoplateforme, `ORTHOIMAGERY.ORTHOPHOTOS`) — par défaut
  - **Plan IGN** (`GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`)
  - **OpenStreetMap**
  - surcouche **« Noms de lieux et routes »** (étiquettes transparentes CARTO),
    activée par défaut : sans elle, l'ortho seule ne permet pas de se situer.
  pour le dessin de polygones
- [Firebase](https://firebase.google.com/) (Auth email/mot de passe +
  Firestore) — projet partagé `ovilog-15ef6`, collections dédiées à Logisol
- Build APK automatique via GitHub Actions (voir
  `.github/workflows/build-android.yml`)

## Module Parcelles

- Carte plein écran (fond satellite IGN Ortho) + vue liste (bouton bascule
  dans l'en-tête), une parcelle = un polygone coloré selon sa vocation et,
  si cultivée, la culture de la campagne en cours
- **Dessiner une parcelle** : dessin à la main sur la carte, surface en
  hectares calculée automatiquement à la fermeture du polygone
- **Importer un contour** : import d'un fichier GeoJSON (export xFarm ou
  Telepac/RPG) — **WGS84 uniquement** pour cette version (un export
  Lambert-93/RGF93 brut sera rejeté avec un message explicite)
- Clic sur une parcelle (carte ou liste) → fiche modifiable : nom, vocation
  (Culture / Prairie / Bâtiment / Bois / Autre — liste fixe), culture de la
  campagne en cours si vocation Culture/Prairie (liste modulable, "+
  Culture" pour en ajouter une à la volée), surface, couleur, notes
- Suppression d'une parcelle avec confirmation obligatoire
- L'historique culture/campagne (collection `assolements`) est séparé du
  document parcelle : une parcelle cultivée sans culture renseignée cette
  campagne apparaît en gris "à renseigner" plutôt que de bloquer la saisie

Objectif à terme (hors périmètre actuel) : un vrai journal d'actions
(semis, fauche, pâturage tournant, épandage, récolte...) daté, au-delà du
simple "une culture par parcelle et par campagne" actuel. Le modèle de
données (id de parcelle stable, assolements par campagne) est pensé pour ne
pas bloquer cette extension.

## Récupérer l'APK

Chaque push déclenche `.github/workflows/build-android.yml`, qui build un
APK debug. Pour le récupérer :

1. Onglet **Actions** du dépôt GitHub → ouvrir le run correspondant
2. Télécharger l'artefact `logisol-debug-apk`
3. Transférer le `.apk` sur le téléphone et l'installer — une réinstallation
   par-dessus une version déjà installée fonctionne normalement, **pas
   besoin de désinstaller d'abord** (autoriser "sources inconnues" si
   demandé la première fois)

⚠️ **`android/app/debug.keystore` est committé intentionnellement, ne pas
le supprimer ni le régénérer.** Sans keystore de debug fixe, chaque run
GitHub Actions (VM éphémère, sans `~/.android/debug.keystore` persistant)
signerait l'APK avec une clé différente à chaque build — Android refuse
alors de mettre à jour l'appli par-dessus l'ancienne (signatures
différentes) sans désinstallation manuelle au préalable, en silence et
sans message d'erreur explicite pour l'utilisateur. Le `versionCode` est
aussi désormais incrémenté automatiquement à chaque build CI (numéro de
run GitHub Actions), voir `android/app/build.gradle`.

## Mettre en place les règles Firestore (étape manuelle, à faire une fois)

⚠️ Le projet Firebase est **partagé avec Ovilog**. Firestore n'a qu'un seul
jeu de règles par projet (pas un fichier par appli), donc ce dépôt **ne
déploie jamais les règles automatiquement** — pour ne prendre aucun risque
de casser les règles existantes d'Ovilog.

1. Ouvrir la [console Firebase](https://console.firebase.google.com/) →
   projet `ovilog-15ef6` → Firestore Database → onglet **Règles**
2. **Ajouter** (sans supprimer les règles existantes d'Ovilog) le bloc
   présent dans [`firestore.rules`](./firestore.rules) de ce dépôt
   (collections `parcelles` et `parcelles_config`)
3. Publier

## Tester rapidement dans un navigateur (Firebase Hosting)

Pour éviter de repasser par un build APK complet à chaque changement,
`www/` peut être déployé tel quel sur Firebase Hosting (même projet
`ovilog-15ef6`, site Hosting dédié à Logisol pour rester isolé d'un
éventuel futur Hosting Ovilog). Un déploiement prend quelques secondes
(fichiers statiques uniquement, pas de build Android).

**Mise en place, une seule fois** (nécessite tes identifiants Firebase —
je ne peux pas le faire moi-même depuis cette session) :

1. En local : `npm install -g firebase-tools` puis `firebase login`
2. Créer le site Hosting dédié (le nom doit être unique sur tout Firebase —
   si `logisol-vincentvaysset` est déjà pris, choisis-en un autre et mets à
   jour `"site"` dans [`firebase.json`](./firebase.json) en conséquence) :
   ```bash
   firebase hosting:sites:create logisol-vincentvaysset --project ovilog-15ef6
   ```
3. Premier déploiement manuel, pour vérifier que tout est en place :
   ```bash
   firebase deploy --only hosting --project ovilog-15ef6
   ```
   L'URL est affichée à la fin (typiquement
   `https://logisol-vincentvaysset.web.app`).
4. Pour que la CI déploie automatiquement à chaque push (voir
   `.github/workflows/deploy-hosting.yml`) : générer un compte de service
   avec le rôle **Firebase Hosting Admin** sur le projet (le plus simple est
   `firebase init hosting:github` en local, qui crée le compte de service
   et ajoute le secret GitHub automatiquement), puis vérifier qu'il existe
   bien un secret de dépôt nommé `FIREBASE_SERVICE_ACCOUNT_OVILOG_15EF6`.
   Tant que ce secret n'existe pas, le workflow échoue à chaque push — c'est
   attendu, pas un bug à corriger côté code.

**Une fois en place**, le déploiement est automatique à chaque push
touchant `www/` — pas de commande à relancer.

⚠️ Comme pour les règles Firestore, ce site Hosting utilise le même projet
Firebase qu'Ovilog mais reste un site distinct : aucune interférence
possible avec Ovilog.

### Workflow de développement adopté à partir de maintenant

Pour chaque correctif :
1. Déploiement sur Firebase Hosting (automatique après push, ou
   `firebase deploy --only hosting` en local) → test dans un navigateur
2. L'APK n'est rebuild que lorsque plusieurs correctifs sont validés côté
   web et qu'on veut vérifier que l'emballage Capacitor/Android fonctionne
   toujours (le code JS/CSS/HTML est strictement le même dans les deux cas
   — seul l'emballage change)

## Développement local

```bash
npm install
npx cap sync android
npx cap open android   # ouvre le projet dans Android Studio (émulateur ou téléphone branché)
```

Le code source de l'appli est dans `www/` (`index.html`, `css/`, `js/`) —
c'est le `webDir` Capacitor, aucune étape de build n'est nécessaire côté web.
