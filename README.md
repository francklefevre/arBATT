<!--
  arBATT - Table tennis club referee companion (PWA)

  Free software developed by Franck LEFEVRE for K1 ( https://k1info.com ),
  with the help of his team of kind and playful robots.
  Please use the enormous power of this software to do good things for things
  and people, always making sure it harms nothing and no one.
-->

# arBATT — l'assistant de l'arbitre de club de tennis de table

**arBATT** est une **PWA** (Progressive Web App) qui accompagne un·e arbitre de
club de tennis de table pendant ses parties. Elle est pensée pour être ouverte
instantanément en scannant un simple **QR code**, puis utilisée d'une seule main
à la table de marque, y compris **hors-ligne** une fois installée.

L'application démarre sur un **menu** proposant plusieurs activités. La première
et la plus aboutie est le **comptage des points**, sujet riche que arBATT gère
en appliquant les règles du *Manuel pratique d'arbitre de club* de la FFTT
(édition 2025/2026, fourni dans `doc/`).

> En toutes circonstances… **RESTEZ SPORT !**

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture du projet](#architecture-du-projet)
- [Installation](#installation)
- [Démarrage du serveur](#démarrage-du-serveur)
- [Utilisation](#utilisation)
- [Règles de comptage implémentées](#règles-de-comptage-implémentées)
- [Paramètres de configuration](#paramètres-de-configuration)
- [Formats de fichiers](#formats-de-fichiers)
- [Journalisation (logs)](#journalisation-logs)
- [Tests](#tests)
- [Feuille de route](#feuille-de-route)
- [Licence](#licence)

---

## Fonctionnalités

- 📱 **PWA installable** (manifest + service worker) utilisable **hors-ligne**.
- 🏓 **Comptage des points en simple ET en double** : score, manches, service,
  camps, égalité (deuce), temps morts, annulation (undo), annonce du score.
  En double : rotation des 4 serveurs/relanceurs, désignation du service à
  chaque manche, inversion des relanceurs à 5 points en manche décisive.
- ⏱️ **Chronomètres** : période d'adaptation (2 min) et temps mort (1 min),
  avec anneau de progression, bip et vibration en fin de décompte.
- ⏩ **Règle d'accélération** : service à chaque point + compteur de 13 renvois
  (le serveur perd le point au 13e renvoi du relanceur).
- 🟨 **Cartons & sanctions** : échelle jaune → jaune+rouge (+1) → jaune+rouge
  (+2) → rouge (juge-arbitre), avec points de pénalité attribués à l'adversaire.
- ⏲️ **Chronométrie des manches** : horloge de manche (10 min) sur le tableau de
  marque, qui **déclenche automatiquement** l'accélération à la limite si moins
  de 18 points ont été marqués.
- 🦇 Aux couleurs du club : logo **BATT-Man** (Bayard Argentan Tennis de Table).
- 📋 **Déroulé de la partie** : les étapes d'une partie dans l'ordre, chacune
  avec un encadré « À ce stade je ne dois pas oublier ».
- 📖 **Aide-mémoire** des règles clés directement dans l'app.
- 🔒 **Serveur web minimal en Python** servant un **unique répertoire**
  (`www/`) de façon **hermétique** (aucun accès hors de ce répertoire).
- ⚙️ Tout est **paramétrable** (port, en-tête `Server`, web-root, logs…), via
  fichiers JSON **et** variables d'environnement.

## Architecture du projet

```
arBATT/
├── server.py               # Serveur web statique minimal et hermétique
├── arbatt_config.py        # Chargement de la configuration (JSON + env)
├── arbatt_log.py           # Journalisation centralisée (routage unique)
├── config/
│   ├── param.json(.example)    # Paramètres non confidentiels
│   └── secret.json(.example)   # Paramètres confidentiels (git-ignoré)
├── www/                    # ★ UNIQUE répertoire servi (web-root)
│   ├── index.html              # Menu + écrans (setup, score, fin, règles, déroulé)
│   ├── manifest.webmanifest    # Manifest PWA
│   ├── sw.js                   # Service worker (offline)
│   ├── app-config.json         # Généré au démarrage depuis param.json
│   ├── css/style.css
│   ├── js/log.js               # Logger client (routage unique)
│   ├── js/timer.js             # Moteur de compte à rebours (chronos)
│   ├── js/scorer.js            # Moteur de comptage SIMPLE (machine à états)
│   ├── js/doubles.js           # Moteur de comptage DOUBLE (machine à états)
│   ├── js/app.js               # Contrôleur d'interface (2 modes)
│   └── icons/                  # Icônes PWA (svg + png 192/512/maskable)
├── dynamic/                # Données personnalisées (git-ignoré)
├── logs/                   # Tous les fichiers de logs (git-ignoré)
├── package.json            # Scripts npm + dépendance de dev jsdom
├── tests/                  # Tests headless (Node)
│   ├── run_all.js              # Lance toutes les suites (npm test)
│   ├── test_scorer.js          # Moteur simple
│   ├── test_timer.js           # Chronomètres
│   ├── test_doubles.js         # Moteur double
│   ├── test_acceleration.js    # Règle d'accélération
│   ├── test_sanctions.js       # Cartons & sanctions
│   ├── test_chrono.js          # Chronométrie + accélération auto
│   ├── dom_harness.js          # Harnais jsdom partagé
│   └── test_ui_dom.js          # Intégration UI (jsdom)
└── doc/manuel AC.pdf       # Manuel officiel de référence
```

## Installation

**Pré-requis :** Python ≥ 3.8 (testé avec 3.12). Aucune dépendance externe pour
faire tourner le serveur. (PIL/Pillow n'est utilisé qu'une fois pour générer les
icônes ; les icônes générées sont déjà incluses.)

```bash
# 1. Récupérer le projet
cd arBATT

# 2. Préparer la configuration
cp config/param.json.example  config/param.json     # déjà présent par défaut
cp config/secret.json.example config/secret.json    # déjà présent par défaut
#   puis éditez config/param.json selon vos besoins (port, etc.)
```

## Démarrage du serveur

```bash
python3 server.py
```

Au démarrage, le serveur **affiche le numéro de version** (tag `[BOOT]`), purge
le fichier d'erreurs `logs/server.err.txt`, génère `www/app-config.json` depuis
`config/param.json`, puis écoute sur `http://HOST:PORT/`.

Par défaut : <http://0.0.0.0:8080/>.

Vous pouvez tout surcharger par variable d'environnement, par exemple :

```bash
ARBATT_PORT=8099 ARBATT_SERVER_HEADER="ma-salle" python3 server.py
```

> 💡 **Servir la PWA depuis un autre serveur** : le contenu de `www/` est
> entièrement statique. Vous pouvez aussi le déposer tel quel comme documents
> sur n'importe quel hébergement web. Le service worker exige un contexte
> sécurisé (HTTPS ou `localhost`).

## Utilisation

1. Ouvrez l'URL (ou scannez le QR code) sur un smartphone.
2. *(facultatif)* « **Installer l'application** » depuis le menu du navigateur
   pour l'usage hors-ligne et plein écran.
3. Menu → **Comptage des points** → renseignez les joueurs, le **format**
   (manches gagnantes, points par manche) et le **tirage au sort** (premier
   serveur et côté gauche au départ), puis **Démarrer**.
4. Sur le tableau de marque :
   - **Touchez la carte d'un joueur** pour lui attribuer le point.
   - La carte au **service** est encadrée en jaune ; le sens de jeu
     (Gauche/Droite) est rappelé en bas de chaque carte.
   - L'**annonce** (serveur d'abord) s'affiche sous le tableau.
   - Boutons : **Annuler** (undo), **Temps mort A/B** (1 par joueur), **Menu**.
   - Indices contextuels : **essuyage** (tous les 6 points), **égalité** à 10-10.
5. À la fin, l'écran récapitule le score et le détail des manches.

Le menu propose aussi la **Période d'adaptation** (chrono 2 min), le **Déroulé
de la partie** (étapes + rappels « À ce stade je ne dois pas oublier ») et un
**Aide-mémoire** des règles.

## Règles de comptage implémentées

Conformément au manuel FFTT (voir `doc/`), en **simple** :

- Manche gagnée à **11 points** avec **2 points d'écart** minimum.
- À **10-10** (égalité), le jeu continue jusqu'à **2 points d'écart**.
- Le **service change tous les 2 points** ; à partir de **10-10**, il change à
  **chaque point**.
- Le **premier serveur alterne** à chaque manche.
- **Changement de camp** à chaque manche ; dans la **manche décisive**, on
  change de camp dès qu'un joueur atteint **5 points**.
- Le score est **annoncé serveur en premier**, puis relanceur.
- **1 temps mort** par joueur et par partie.
- **Essuyage** signalé tous les **6 points**.

Le serveur et les camps sont **dérivés du score** : l'annulation (undo) restitue
donc toujours un état exact.

### En double

- Le service va en **diagonale** ; le **serveur change tous les 2 points**, le
  relanceur devenant alors serveur (rotation des **4 joueurs**).
- La paire qui sert **désigne son serveur** au début de chaque manche ; arBATT
  ouvre automatiquement un sélecteur de désignation (corrigeable via 🔁 Service).
- Dans la **manche décisive**, à **5 points** : changement de camp **et**
  **inversion de l'ordre des relanceurs**.
- **1 temps mort par paire** et par partie.

### Chronomètres

- **Période d'adaptation** : 2 min (depuis le menu ou l'écran de préparation).
- **Temps mort** : 1 min (déclenché par les boutons « Temps mort »).
- Anneau de progression, alerte sous 10 s, **bip** et **vibration** à la fin.
- Durées **paramétrables** (voir `ARBATT_WARMUP_SECONDS` / `ARBATT_TIMEOUT_SECONDS`).

### Règle d'accélération

- Activée par l'arbitre (bouton **⏩ Accélération**) ; **une fois active, elle le
  reste** jusqu'à la fin de la partie.
- Le **serveur change à chaque point** (le moteur le gère automatiquement, même
  si la règle est activée en cours de manche).
- Un **compteur de renvois** apparaît : à chaque renvoi du relanceur, l'arbitre
  appuie sur **+1 renvoi** ; au **13e** (paramétrable), le point est attribué au
  **relanceur** et le compteur est remis à zéro. Un point « normal » (tap sur la
  carte) remet aussi le compteur à zéro.

> Le déclenchement automatique (10 min de jeu, < 18 points) sera branché quand
> la chronométrie des manches sera ajoutée ; en attendant, l'activation est
> manuelle, ce qui est réglementaire (« à la demande des 2 joueurs »).

### Chronométrie & accélération automatique

Le tableau de marque affiche une **horloge de manche** (comptage croissant) avec
un bouton pause/reprise. Quand elle atteint **`ARBATT_GAME_MINUTES`** (10 min) et
que moins de **`ARBATT_ACCEL_POINTS_THRESHOLD`** (18) points ont été marqués dans
la manche, la **règle d'accélération s'active automatiquement** (bip + vibration).
L'horloge se réinitialise à chaque manche et se met en pause pendant les
chronos de temps mort / période d'adaptation.

### Cartons & sanctions

Depuis le tableau de marque, bouton **🟨 Carton** → choisir le joueur fautif.
L'échelle (manuel p.13) est appliquée automatiquement :

| Faute | Carton(s) | Pénalité |
|------:|-----------|----------|
| 1re   | 🟨 jaune | aucun point |
| 2e    | 🟨🟥 jaune + rouge | **+1 point** à l'adversaire |
| 3e    | 🟨🟥 jaune + rouge | **+2 points** à l'adversaire |
| 4e    | 🟥 rouge | **recours au juge-arbitre** (partie perdue par pénalité) |

Les cartons accumulés sont affichés sur chaque carte. En double, le compte est
**par joueur** et les points de pénalité vont à la **paire adverse**. L'undo
annule une sanction (carton **et** point de pénalité).

*Non encore couvert (voir [Feuille de route](#feuille-de-route))* : la
chronométrie des manches.

## Paramètres de configuration

Tous les paramètres vivent dans `config/param.json` (non confidentiel) et
`config/secret.json` (confidentiel, git-ignoré). **Chaque paramètre peut être
surchargé par une variable d'environnement portant le même nom.** L'ordre de
priorité est : `param.json` → `secret.json` → variable d'environnement.

| Paramètre                | Type    | Défaut        | Description |
|--------------------------|---------|---------------|-------------|
| `version`                | string  | `0.1.0`       | Version `x.y.z` affichée au démarrage et dans la PWA. |
| `ARBATT_HOST`            | string  | `0.0.0.0`     | Interface d'écoute du serveur. |
| `ARBATT_PORT`            | int     | `8080`        | Port d'écoute. |
| `ARBATT_WEBROOT`         | string  | `www`         | **Unique** répertoire servi (hermétique). |
| `ARBATT_SERVER_HEADER`   | string  | `arBATT`      | Valeur renvoyée dans l'en-tête HTTP `Server`. |
| `ARBATT_DEFAULT_DOCUMENT`| string  | `index.html`  | Document servi pour un répertoire. |
| `ARBATT_WARMUP_SECONDS`  | int     | `120`         | Durée du chrono de période d'adaptation (s). |
| `ARBATT_TIMEOUT_SECONDS` | int     | `60`          | Durée du chrono de temps mort (s). |
| `ARBATT_ACCEL_RETURNS`   | int     | `13`          | Nombre de renvois du relanceur donnant le point (règle d'accélération). |
| `ARBATT_GAME_MINUTES`    | int     | `10`          | Durée de manche (min) avant déclenchement de l'accélération. |
| `ARBATT_ACCEL_POINTS_THRESHOLD` | int | `18`       | Seuil de points sous lequel l'accélération se déclenche à la limite de temps. |
| `ARBATT_LOG_DIR`         | string  | `logs`        | Répertoire de tous les fichiers de logs. |
| `ARBATT_LOG_TO_CONSOLE`  | bool    | `true`        | Écho des logs activés sur la console. |
| `ARBATT_LOG_TO_FILE`     | bool    | `true`        | Écriture des logs dans `logs/server.log`. |
| `ARBATT_LOG_TAGS`        | object  | voir fichier  | Active/désactive chaque catégorie de log (`BOOT`, `CONFIG`, `HTTP`, `SECURITY`, `ERROR`, `WARN`, `INFO`, `DEBUG`). |
| `ARBATT_ADMIN_TOKEN`     | string  | *(vide)*      | *(secret, réservé pour un usage futur)* |

> Pour surcharger un paramètre objet comme `ARBATT_LOG_TAGS` via l'environnement,
> fournissez une valeur **JSON** : `ARBATT_LOG_TAGS='{"DEBUG":true}'`.

## Formats de fichiers

- **`config/*.json`** — objets JSON. Les clés commençant par `_` sont purement
  documentaires (notice de licence, description) et sont ignorées au chargement.
- **`www/app-config.json`** — `{"version", "warmupSeconds", "timeoutSeconds",
  "accelReturns", "gameMinutes", "accelPointsThreshold"}`, **généré** au
  démarrage depuis `param.json` (lu par la PWA).
- **`logs/server.log`** — une ligne par événement :
  `STAMP [TAG] #NNNN message` (voir ci-dessous).
- **`logs/server.err.txt`** — mêmes lignes mais limitées aux `ERROR`/`WARN` ;
  **vidé à chaque démarrage**.

## Journalisation (logs)

Toute information loggée (serveur **et** PWA) passe par une **fonction de routage
unique**. Chaque ligne est préfixée par :

```
2026-06-02T16:12:34.015 [HTTP] #1004 200 /js/scorer.js (10247 bytes, ...)
└─ horodatage          └ tag  └ n°évt └ message
```

- Le **tag** (`[HTTP]`, `[BOOT]`, `[SECURITY]`…) décrit la nature de
  l'information ; il peut être **activé/désactivé** dynamiquement via
  `ARBATT_LOG_TAGS`.
- Le **numéro d'événement** (`#NNNN`) identifie le point d'émission dans le code
  (convention : `1xxx` serveur, `2xxx` app PWA, `3xxx` moteur de comptage).
- Tous les fichiers de logs sont dans `logs/`. Les erreurs sont en plus
  recopiées dans `<programme>.err.txt`.

Côté PWA, le logger est accessible depuis la console du navigateur
(`arbattLog(tag, eid, msg)`, configuration live dans `ARBATT_LOG`).

## Tests

Toute la suite de tests (Node.js) :

```bash
npm test                      # lance les 5 suites et affiche un résumé
# ou individuellement :
node tests/test_scorer.js        # simple
node tests/test_timer.js         # chronomètres (horloge simulée)
node tests/test_doubles.js       # double
node tests/test_acceleration.js  # règle d'accélération
node tests/test_sanctions.js     # cartons & sanctions
node tests/test_chrono.js        # chronométrie + accélération auto
node tests/test_ui_dom.js        # intégration UI (jsdom)
```

Pré-requis pour `test_ui_dom.js` : **jsdom** (dépendance de dev). Installez les
dépendances une fois avec `npm install`.

Ils couvrent : l'alternance du service, l'égalité (deuce), la fin de
manche/partie, l'alternance du premier serveur, les changements de camp (dont à
5 points en manche décisive), l'annulation, les temps morts, la rotation des 4
joueurs en double (vérifiée contre l'exemple du manuel), l'inversion des
relanceurs en manche décisive, le compte à rebours (pause/reprise, bornes), la
règle d'accélération (service à chaque point, persistance, compteur de 13
renvois), et le **câblage de l'interface** de bout en bout (navigation, saisie
des points, mode simple/double, désignation du service, panneau d'accélération).

## Feuille de route

- [x] Comptage en **double** (rotation, désignation, inversion à 5 en décisive).
- [x] **Chronomètres** : période d'adaptation (2 min) et temps mort (1 min).
- [x] **Règle d'accélération** (service à chaque point, compteur de 13 renvois).
- [x] **Cartons & sanctions** (jaune, jaune+rouge, pénalités de points).
- [x] **Chronométrie des manches** (10 min) + déclenchement **automatique** de
      l'accélération.
- [ ] **Repos entre manches** (1 min) automatisé et chronométrage fin (pauses).
- [ ] **Sauvegarde** des parties dans `dynamic/` et feuille de partie.
- [ ] Génération du **QR code** de mise à disposition.

## Licence

Logiciel **libre** : vous pouvez en faire ce que vous voulez. Développé par
**Franck LEFEVRE** pour la société **K1** ( <https://k1info.com> ), aidé de son
équipe de robots gentils et amusants. Utilisez l'énorme puissance de ce logiciel
pour faire des choses **bonnes** pour les choses et les gens, en vous assurant
toujours qu'il ne nuit à rien ni à personne.
