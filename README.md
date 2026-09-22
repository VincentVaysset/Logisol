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


## Stockage de la géométrie des parcelles

Firestore **interdit les tableaux imbriqués** : un tableau ne peut pas contenir
directement un autre tableau. Une géométrie GeoJSON `Polygon` est pourtant
exactement cela (anneaux → sommets → `[lon, lat]`), donc elle ne peut pas être
enregistrée telle quelle.

Les documents de `parcelles` stockent donc le contour sous forme d'objets,
dans le champ `contour` :

```
contour: {
  type: "Polygon",
  anneaux: [ { sommets: [ { lon: 3.87, lat: 43.62 }, ... ] } ]
}
```

La conversion dans les deux sens est faite par `www/js/geometrie.js`, appelée
uniquement depuis `www/js/parcelles.js` (le seul module qui parle à Firestore).
Tout le reste de l'appli — carte, dessin, import GeoJSON, fiche — continue de
manipuler du GeoJSON standard via le champ `coordonnees`.

## Modules

### Vue Ferme (écran d'accueil)
Carte en haut avec toutes les parcelles nommées et colorées par culture en
cours, fil des dernières activités en dessous (toutes parcelles mélangées, les
plus récentes en premier). Taper une activité l'ouvre en modification ; taper
une parcelle ouvre son aperçu (nom, surface, culture en cours, durée
d'implantation) avec accès direct à « Ajouter une note » et « Nouvelle
activité ».

### Implantations (collection `implantations`)
Une culture est une **période**, pas une année civile :

```
{ parcelleId, cultureId, dateSemis: "2025-10-12", dateFin: null }
```

`dateFin: null` signifie « toujours en place ». Ce modèle couvre les cas du
terrain qu'un cycle calendaire ne sait pas représenter : ray-grass et céréales
semés à l'automne et récoltés l'année suivante, luzerne en place 4 à 5 ans,
inter-culture de quelques mois intercalée entre deux. La culture en cours, la
durée d'implantation et l'assolement d'une année donnée s'en déduisent — rien
n'est stocké en double, et **seul le réel est enregistré** (pas de prévisionnel).

Les anciens documents `assolements` (une culture par année civile) sont repris
automatiquement au démarrage, une seule fois, et marqués comme tels.

### Journal d'interventions (collections `interventions`, `interventions_types`)
Une intervention porte sur **une ou plusieurs parcelles** (`parcelleIds` est
toujours un tableau) : un épandage couvre souvent tout un secteur. Champs :
date, type, produit + quantité + unité, matériel, temps passé, météo, photo,
notes.

- **Types** : liste prédéfinie (Note, Semis, Épandage, Fauche, Pressage,
  Épierrage…) complétable depuis l'appli. Chaque type déclare les champs qu'il
  affiche : une note n'a ni produit, ni matériel, ni durée.
- **Météo** : relevée automatiquement par géolocalisation via
  [Open-Meteo](https://open-meteo.com/) (gratuit, sans clé). Aucune saisie
  manuelle. Le relevé du jour utilise la météo de l'instant, une date passée le
  relevé quotidien. **Jamais bloquant** : sans position ni réseau,
  l'intervention s'enregistre quand même.
- **Photo** : redimensionnée à 1200 px et ré-encodée en JPEG avant d'être
  stockée dans le document (un document Firestore est plafonné à 1 Mio, une
  photo de tablette pèse plusieurs Mo). Une photo par intervention.

## ⚠️ Règles Firestore à ajouter

Trois collections s'ajoutent avec ce lot. Sans elles, rien ne s'enregistre :

```
match /implantations/{docId}       { allow read, write: if request.auth != null; }
match /interventions/{docId}       { allow read, write: if request.auth != null; }
match /interventions_types/{docId} { allow read, write: if request.auth != null; }
```

À **ajouter** aux règles existantes dans la console Firebase du projet
`ovilog-15ef6`, sans toucher à celles d'Ovilog. Le fichier `firestore.rules`
de ce dépôt contient l'ensemble à jour (il n'est jamais déployé
automatiquement, volontairement).

### Stocks (collection `stocks`)
Un document = **une récolte sur une parcelle**, saisie en une fois en fin de
récolte. Le tonnage n'est jamais saisi à la main pour les bottes et la grange :
il se déduit de ce qui est compté au champ.

| Type | Saisie | Tonnage |
|---|---|---|
| Foin en botte | nombre de bottes × poids d'une botte (kg) | déduit |
| Foin séché en grange | nombre de remorques × matière sèche par remorque (kg) | déduit |
| Paille | comme le foin en botte | déduit |
| Céréales | surface (ha) + tonnage | saisi |

Le poids par botte est **ressaisi à chaque récolte, sans valeur par défaut** :
il varie d'une coupe à l'autre. Pour la grange, la dernière estimation de
matière sèche est simplement rappelée sous le champ, sans pré-remplissage.

Le foin conserve le croisement **coupe (1ʳᵉ / 2ᵉ / 3ᵉ) × type de fourrage**
(ray-grass, luzerne, prairie naturelle, ou tout autre nommé à la volée). La
synthèse d'exploitation est l'agrégation de ces récoltes par **catégorie de
stock** — c'est la clé qui relie un stock à ce que le troupeau y prélève :

```
foin|grange|c1|luzerne   →  « Foin Luzerne — 1ʳᵉ coupe — séché en grange »
```

Deux modes de conservation d'un même fourrage et d'une même coupe restent donc
deux catégories distinctes, parce qu'ils ne se consomment pas pareil.

### Alimentation du troupeau (collections `stades_config`, `lots_animaux`, `prelevements`)
Huit stades physiologiques dans l'ordre de l'année (début/milieu/fin gestation,
début/fin allaitement, début traite, pâture, fin de traite). Chacun porte sa
**ration journalière par brebis**, ajustable depuis l'appli.

Un **lot** est un groupe de brebis au même stade, nourries ensemble. Son besoin
journalier vaut `ration du stade × effectif`, et il est prélevé sur **une
catégorie de stock précise, choisie manuellement** — rien n'est affecté
automatiquement.

Chaque affectation est une **période** (`prelevements`), pas un champ
écrasable : `{ lotId, categorieCle, debut, fin }`, `fin` exclue. Basculer d'un
stock à l'autre clôture la période en cours à la date de bascule et en ouvre
une nouvelle — le jour de bascule compte pour le nouveau stock, jamais pour les
deux. Sans cet historique, tout ce qu'un lot a consommé sur son stock précédent
disparaîtrait du calcul le jour où l'on change.

Chaque période **fige la ration et l'effectif du moment** : corriger une ration
ou un effectif ne réécrit pas ce qui a déjà été mangé, mais ouvre une nouvelle
période à partir d'aujourd'hui au nouveau rythme.

La consommation se déduit donc de ces périodes, **sans aucune saisie
quotidienne** : `ration × effectif × jours`. Le tableau croisé stades × stocks
en donne la lecture directe — ce que chaque stade tire sur quel stock, ce qu'il
reste par catégorie, l'autonomie en jours et la date d'épuisement estimée.

Deux chiffres à ne pas confondre dans les tuiles : **besoin / jour** est ce dont
le troupeau a besoin (lots sans stock affecté compris), **tiré des stocks** est
ce qui en sort réellement. Un lot sans stock affecté est signalé en tête de
vue — sa consommation n'est comptée nulle part.

## ⚠️ Règles Firestore — quatre collections de plus

```
match /stocks/{docId}        { allow read, write: if request.auth != null; }
match /stades_config/{docId} { allow read, write: if request.auth != null; }
match /lots_animaux/{docId}  { allow read, write: if request.auth != null; }
match /prelevements/{docId}  { allow read, write: if request.auth != null; }
```

### Bâtiments, silos et hangars
Trois collections de structure — `batiments`, `cellules_grain`,
`emplacements_fourrage` — et une de journal, `mouvements_stock`.

Un **bâtiment** (`BERGERIE`, `STOCKAGE_GRAIN`, `STOCKAGE_FOURRAGE`, `MIXTE`)
peut porter, selon son type, des cellules à grain, des emplacements de
fourrage et des lots d'animaux. Sa position est facultative ; renseignée, il
apparaît sur la carte des vues Ferme et Carte, et se touche comme une parcelle.

**Les niveaux ne se saisissent jamais** : ils se calculent comme « somme des
entrées moins somme des sorties » sur le journal des mouvements. Un niveau
modifiable à la main doublé d'un journal finit toujours par diverger, sans
qu'on sache laquelle des deux valeurs croire. Le champ
`quantiteActuelleTonnes` (resp. `nbBottesActuel`) existe dans le document,
mais n'est qu'un cache réécrit à chaque mouvement.

Types de mouvement : `ENTREE_RECOLTE`, `ENTREE_ACHAT`, `SORTIE_ALIMENTATION`,
`PERTE`, plus deux ajouts nécessaires — `TRANSFERT` (vider un silo dans un
autre, que saisir comme une perte suivie d'un achat fausserait des deux côtés)
et `INVENTAIRE` (un re-comptage qui ne colle pas au calcul doit laisser une
trace, pas être corrigé en douce : un inventaire **remplace** le niveau au lieu
de s'y ajouter).

Unités : **tonnes** pour le grain, **nombre de bottes** pour le fourrage.
`poidsMoyenBotteKg` n'est pas une constante saisie : c'est la moyenne pondérée
des poids réellement portés par les entrées de l'emplacement, recalculée à
chaque mouvement — le poids d'une botte change à chaque récolte.

## ⚠️ Règles Firestore — quatre collections de plus

```
match /batiments/{docId}             { allow read, write: if request.auth != null; }
match /cellules_grain/{docId}        { allow read, write: if request.auth != null; }
match /emplacements_fourrage/{docId} { allow read, write: if request.auth != null; }
match /mouvements_stock/{docId}      { allow read, write: if request.auth != null; }
```
