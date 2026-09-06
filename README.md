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
- [Leaflet.js](https://leafletjs.com/) + tuiles OpenStreetMap (gratuit,
  sans clé API) + [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw)
  pour le dessin de polygones
- [Firebase](https://firebase.google.com/) (Auth email/mot de passe +
  Firestore) — projet partagé `ovilog-15ef6`, collections dédiées à Logisol
- Build APK automatique via GitHub Actions (voir
  `.github/workflows/build-android.yml`)

## Module V1 : Parcelles

- Carte plein écran, une parcelle = un polygone coloré selon son type d'usage
- **Dessiner une parcelle** : dessin à la main sur la carte, surface en
  hectares calculée automatiquement à la fermeture du polygone
- **Importer un contour** : import d'un fichier GeoJSON (export xFarm ou
  Telepac/RPG) — **WGS84 uniquement** pour cette version (un export
  Lambert-93/RGF93 brut sera rejeté avec un message explicite)
- Clic sur une parcelle existante → fiche modifiable (nom, usage, surface,
  notes)
- Suppression d'une parcelle avec confirmation obligatoire
- Types d'usage modulables (pâture / fauche / culture par défaut, extensible
  depuis la fiche parcelle)

Objectif à terme (hors périmètre de ce module) : rattacher un journal
d'actions liées aux cultures (semis, fauche, pâturage tournant, épandage,
récolte...) à chaque parcelle. Le modèle de données actuel (id de parcelle
stable, `typeUsage`) est pensé pour ne pas bloquer cette extension.

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

## Développement local

```bash
npm install
npx cap sync android
npx cap open android   # ouvre le projet dans Android Studio (émulateur ou téléphone branché)
```

Le code source de l'appli est dans `www/` (`index.html`, `css/`, `js/`) —
c'est le `webDir` Capacitor, aucune étape de build n'est nécessaire côté web.
