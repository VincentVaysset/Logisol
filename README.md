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


## Fonctionnement hors-ligne

Les librairies (Firebase SDK, Leaflet, Leaflet.draw) sont **embarquées dans
`www/vendor/`**, donc dans l'APK. Avant cela, elles étaient chargées depuis un
CDN : sans réseau, le premier `import` échouait et l'appli ne démarrait pas du
tout — aucun cache de données n'y aurait changé quoi que ce soit.

Firestore est initialisé avec un **cache persistant** (IndexedDB) : les
documents déjà vus restent lisibles sans réseau, et les écritures faites hors
couverture sont mises en file puis envoyées au retour du signal. `onSnapshot`
répond depuis le cache, si bien que l'interface se comporte de la même façon
dans les deux cas.

Ce qui reste tributaire du réseau, et ne peut pas en être affranchi :
- **les tuiles de la carte** — il s'agit de l'imagerie aérienne de la France
  entière, elle ne peut pas être embarquée. Les parcelles, elles, restent
  dessinées et cliquables sur fond vide ;
- **le relevé météo** — sans réseau, l'activité s'enregistre simplement sans
  météo, sans jamais bloquer la saisie ;
- **la première connexion** sur un appareil. Une fois connecté, Firebase Auth
  conserve la session et l'appli s'ouvre hors-ligne.

## Règles Firestore — quel fichier coller

👉 **`firestore-logisol.rules`** : jeu **complet**, à coller en **remplaçant
tout** (Ctrl+A puis coller). Il reprend l'intégralité des règles en place,
Ovilog compris, et se suffit à lui-même — plus aucune insertion manuelle dans
un bloc existant, c'est là que tout s'est joué.

`firestore.rules` ne sert que de référence pour les seules collections
Logisol.

### Le piège qui a coûté plusieurs allers-retours

Les règles Firestore n'ont que deux niveaux qui comptent :

```
service cloud.firestore {              // niveau 1 — rien d'utile ici
  match /databases/{database}/documents {   // niveau 2
     ... TOUTES les règles doivent être ICI ...
  }
}
```

Une règle écrite au **niveau 1**, hors du conteneur `documents`, est
syntaxiquement acceptée et **publiée sans erreur** — mais elle ne correspond à
aucun document réel et ne s'applique jamais. Une accolade fermante placée
trop tôt suffit à faire basculer tout ce qui suit dans ce niveau mort, sans
le moindre avertissement.

C'est exactement ce qui s'était produit : `stocks`, `stades_config`,
`lots_animaux`, `prelevements` et le joker `lgs_` se retrouvaient au
niveau 1. D'où un refus à l'enregistrement d'une récolte alors que les règles
semblaient correctes et publiées.

Après publication, les règles s'appliquent **immédiatement côté serveur** :
ni réinstallation ni redémarrage. Le bouton « 🔄 Revérifier » du bandeau
d'alerte le confirme sur place.

## Règles Firestore — un seul collage, définitif

Le fichier `firestore.rules` contient un **joker cadré par un préfixe** :
toute collection dont le nom commence par `lgs_` est autorisée d'avance. Les
prochains modules n'exigeront donc plus aucune intervention dans la console.

Le joker large `match /{document=**}` est **volontairement écarté** : les
règles Firestore s'additionnent (dès qu'une règle autorise, l'accès est
accordé et rien ne peut le reprendre), et le projet héberge aussi Ovilog. Un
tel joker ouvrirait l'intégralité des collections d'Ovilog en lecture et en
écriture à toute personne connectée depuis Logisol.

Le déploiement automatique des règles depuis la CI reste écarté pour la même
raison : déployer remplace le jeu de règles **entier** du projet, donc celles
d'Ovilog, qui ne figurent pas dans ce dépôt.

En complément, `www/js/diagnostic-regles.js` teste chaque collection au
démarrage et affiche, le cas échéant, **quelle** collection est refusée et quoi
coller — au lieu d'un « permission-denied » muet.

## Tunnel de saisie d'activité

Trois étapes, dont la troisième n'apparaît que si l'activité déplace du stock :

1. **Cible** (parcelle ou bergerie) puis **activité**, en grands boutons
   tactiles regroupés par catégorie. Choisir l'activité fait passer
   directement à l'étape 2.
2. **En-tête commun** — date (aujourd'hui par défaut), campagne, nombre
   d'heures, matériel, chauffeur — puis le **statut** (Terminé / À faire), le
   **bloc propre au groupe d'activité** (bottes, bennes, remorques, dose,
   surface…) et une note facultative. Météo et photo restent repliées derrière
   « ＋ Détails ». Aucune heure de début ou de fin n'est demandée.
3. **Mouvement de stock**, pour les seules activités concernées :
   - *Pressage, Séchage en grange, Moisson* → où est rentrée la récolte
     (**obligatoire** quand l'activité est terminée) ;
   - *Distribution alimentation* → depuis quel stock, vers quel lot.

L'activité crée alors le mouvement correspondant — les saisir séparément
serait le meilleur moyen d'en oublier un. Une activité **« À faire » ne bouge
rien** : son intention (quantité, destination) est conservée sur l'activité
elle-même et le mouvement n'est créé qu'au passage à « Terminé ».


## Parc matériel (`lgs_materiel`)

Suivi volontairement minimal — nom, marque, catégorie, largeur de travail,
dernier graissage, note d'entretien — parce que c'est ce qui se tient à jour.
Heures moteur, factures et pièces seraient de la saisie que personne ne
maintient.

### Parc amorcé au premier lancement

Le parc réel de l'exploitation est créé automatiquement, rangé par catégorie :

| Catégorie | Matériels |
|---|---|
| Manutention | Télescopique Agri JCB |
| Tracteurs | Case Puma 165, Case Maxxum 130 |
| Travail du sol / Semis | Charrue Kubota 5 socs réversibles, Déchaumeur 3 m, Vibroculteur Kubota 7 m, Tasse avant 3 m, Semoir Kubota soufflerie 3 m, Broyeuse de pierres Bugnot (CUMA), Aligneuse de pierres, Rouleau 6 m 30 |
| Fourrage / Récolte | Pirouette Pottinger 10 m, Andaineur Pottinger, Autochargeuse Pottinger, Presse (Entreprise), Moisson (Entreprise) |
| Épandage | Épandeur Deguillaume (2006) |

**Tout reste modifiable, supprimable et complétable depuis l'onglet
Bâtiments.** L'amorçage est idempotent et non destructif :

- un matériel déjà présent (même nom) n'est jamais réécrit — seules sa
  catégorie et ses actions conseillées sont complétées si elles manquent ;
- un matériel du parc par défaut **supprimé par l'exploitant ne revient
  pas**. Un document marqueur (`lgs_materiel/_seed`, filtré de toutes les
  listes) retient ce qui a déjà été semé une fois ; sans lui, chaque
  lancement rendrait la suppression impossible.

### Matériel conseillé par action

Chaque matériel porte une liste **« Conseillé pour »** (éditable dans sa
fiche, alimentée par les types d'activité réels). Dans le tunnel de saisie, le
sélecteur remonte ces outils dans un groupe en tête — la pirouette pour un
fanage, la charrue pour un labour, l'épandeur pour le fumier. **Rien n'est
filtré** : tout le parc reste sélectionnable dans un second groupe, parce
qu'un chantier sort souvent de l'usage prévu. Le matériel reste facultatif.

Chaque fiche et chaque carte portent un bouton **« 🛢️ Graissé »** qui inscrit
la date du jour en un geste. Le délai écoulé est affiché en clair (« il y a
2 mois ») **sans seuil d'alerte inventé** : la fréquence de graissage dépend
de l'outil et de l'usage, et une couleur d'alarme posée au hasard finirait
ignorée.

Le matériel s'associe à une intervention par un sélecteur, dans les détails du
tunnel de saisie. Son nom est figé sur l'intervention : le fil reste lisible
même si l'outil est renommé ou sorti du parc.

## Vocabulaire des activités — exploitation Bio

Les actions reprennent les termes exacts de l'exploitation, regroupées par
chantier :

| Groupe | Actions | Saisie propre au groupe |
|---|---|---|
| 🌱 Semis | Semis (semoir + tasse-avant) | semence ou mélange avec %, dose kg/ha, **photo de l'étiquette de semence** |
| 🌾 Fourrages | Fauche, Pirouette / Fanage, Andainage | surface travaillée (ha), **partielle possible** |
| 📦 Récolte fourrages | **Pressage (bottes)**, **Séchage en grange** | bottes + poids estimé · remorques + poids (t) |
| 🌽 Moisson | **Moisson** | bennes × tonnage benne, PS facultatif |
| 💩 Épandage | Épandage fumier | épandeurs × tonnage épandeur |
| ⚙️ Travail du sol & entretien | Déchaumage, Alignement pierres, Broyage pierres (casseuse), Labour, Vibroculteur, Roulage, Chaulage | Chaulage : dose t/ha |
| 🐑 Troupeau | Pâturage, Distribution alimentation, Allotement, Soin, Traitement sanitaire | — |

**Aucun groupe Protection / Phyto** : l'exploitation est en Bio. Les anciens
types de traitement des cultures (Désherbage, Traitement) sont **masqués du
choix, pas supprimés** — des interventions y sont peut-être rattachées, et
effacer un type rendrait leur historique incohérent. « Traitement sanitaire »,
qui concerne le troupeau, reste proposé.

### En-tête commun à toutes les activités

Parcelles (multi-sélection, étape 1), puis à l'étape 2 : **date** (jour même
par défaut), **campagne** (année de la date, corrigeable — un semis d'automne
peut être rattaché à la campagne suivante), **nombre d'heures** (facultatif),
**matériel** (facultatif, conseillé en tête), **chauffeur** (facultatif, avec
la liste de ceux déjà saisis — aucune table à tenir à jour).

### Règle : une récolte rentre obligatoirement en stock

Pressage, Séchage en grange et Moisson **ne peuvent pas être enregistrés en
« Terminé » sans quantité ni destination**. C'est ce qui garantit que les
tonnages relevés au champ alimentent l'onglet Stocks, puis les rations. Une
activité laissée **« À faire »** y échappe : on ne connaît ni le tonnage ni la
cellule avant d'avoir récolté — l'intention est conservée et le mouvement est
créé le jour où elle passe à « Terminé ».

La quantité envoyée en stock est **calculée** depuis le comptage de l'étape 2
(bottes, remorques × t, bennes × t) et affichée en clair. Le champ de saisie
libre disparaît alors : deux endroits où saisir la même quantité, ce sont deux
valeurs qui finissent par diverger.

La destination proposée dépend du chantier — cellule à grain pour une moisson,
cellule de séchage pour un séchage en grange, emplacement (en bottes) pour un
pressage.

### Créer le contenant sans quitter la saisie

Si aucun contenant du bon type n'existe, l'étape 3 ouvre d'elle-même un bloc
**« Créer l'emplacement de stockage »**. Le tunnel s'efface le temps du
formulaire (les deux panneaux couvrent l'écran), puis revient **tel quel**,
avec le contenant tout neuf déjà sélectionné. S'il n'y a pas non plus de
bâtiment adapté, la création du bâtiment enchaîne directement sur celle du
contenant. Annuler à n'importe quel moment ramène au tunnel sans rien perdre.

Sans cela, l'obligation d'entrée en stock devenait un cul-de-sac : le message
disait quoi créer, mais il fallait annuler l'activité en cours pour aller le
faire. Quand des contenants existent déjà, le bloc se réduit à un lien
discret, pour ne pas encombrer le cas courant.

Une **cellule de séchage en grange vit dans un bâtiment de stockage
fourrage** : le bouton « ➕ Cellule (séchage) » y est donc proposé, au même
titre que « ➕ Cellule » sur un bâtiment à grain. Le contenu est pré-réglé
d'après le type de bâtiment.

Fauche, fanage et andainage **ne rentrent rien** : ils préparent l'andain.
Rattacher un stock à la fauche ferait compter le fourrage deux fois.

### Ce qui a été retiré des formulaires

- **Semis** : plus de champ engrais / amendement (sans objet en Bio ; le
  chaulage a sa propre dose).
- **Moisson** : plus d'Espèce, de Variété ni d'Humidité. L'espèce est
  **déduite de l'implantation en cours de la parcelle** pour étiqueter la
  cellule. Elle n'est redemandée que si la parcelle n'a aucune implantation
  renseignée — sinon le silo resterait marqué « — » sans que rien n'indique ce
  qu'il contient.
- **Pressage** : le poids de botte n'est plus redemandé à l'étape 3, il vient
  du comptage.

### Cellules : grain ou fourrage

Une cellule se compte **en tonnes**, qu'elle contienne du grain (silo) ou du
foin rentré en vrac (séchage en grange). Un champ **Contenu** (`contenu`,
`GRAIN` par défaut) distingue les deux ; c'est lui qui filtre les destinations
du tunnel et choisit le vocabulaire affiché. Un second type de contenant
aurait dupliqué tout le journal des mouvements pour rien.

### Héritage

Les anciens types génériques (Travail du sol, Épierrage, Irrigation,
Fertilisation) sont **conservés** et rangés en fin de liste dans « Divers ».
Sept libellés ont été précisés sur place, sans changer de document : Récolte →
Moisson, Fauche / Enrubannage → Fauche, Épandage → Épandage fumier, Fanage →
Pirouette / Fanage, Pressage → Pressage (bottes), Semis → Semis (semoir +
tasse-avant), Ramassage vrac (séchage en grange) → Séchage en grange.

Une **action sur mesure** peut être créée depuis l'étape 1 du tunnel (nom,
icône, groupe) : elle est aussitôt sélectionnée, réutilisable, et devient
rattachable à un matériel dans le champ « Conseillé pour ».

## Placement d'un bâtiment

Deux voies, au choix :
- **📍 Ma position** — relève le GPS de l'appareil ;
- **🗺️ Placer sur la carte** — bascule en vue Carte, un tap pose le repère,
  un second le déplace, et on peut le faire glisser au doigt pour ajuster.

Tous les bâtiments ne se pointent pas depuis l'intérieur, et le GPS d'une
tablette est imprécis à quelques mètres : un tap sur l'ortho est plus juste, et
permet aussi de **corriger** un bâtiment déjà placé. Le formulaire est effacé
le temps du placement (il couvre l'écran) puis restauré avec tout ce qui y
avait déjà été saisi.


## Numéro de build affiché dans l'appli

La barre du bandeau de diagnostic affiche en permanence le build installé
(« ▼ Diagnostic — build 20 · 23a62ee »). Il est injecté par la CI dans
`www/version.js` **avant** `cap sync`.

Sans cela, un symptôme corrigé dans le code mais persistant sur la tablette
était indiscernable d'un correctif qui ne fonctionne pas : on cherche dans le
code un problème déjà réglé, simplement pas encore installé. Le numéro de
build répond à la question en un coup d'œil.

En cas de refus Firestore, le message **nomme la collection** concernée et
rappelle de vérifier ce numéro.
