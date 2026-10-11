<!--
  arBATT - Table tennis club referee companion (PWA)

  Free software developed by Franck LEFEVRE for K1 ( https://k1info.com ),
  with the help of his team of kind and playful robots.
-->

# Déploiement de arBATT

arBATT est une **PWA 100 % statique** (HTML/CSS/JS). Le serveur Python
(`server.py`) n'est **nécessaire qu'en développement local** : pour la mise à
disposition publique, il suffit de servir le contenu du dossier **`www/`** par
n'importe quel serveur web en **HTTPS**.

> ⚠️ **HTTPS obligatoire.** Un service worker (et donc l'installation de la PWA
> + le mode hors-ligne) ne fonctionne que sur un site **sécurisé** (HTTPS) ou
> sur `localhost`.

---

## Option A — Sous-répertoire d'un site WordPress existant (le plus simple)

On profite du serveur web (Apache/nginx) qui fait déjà tourner WordPress, sans
toucher à WordPress lui-même.

1. **Choisir une URL**, par exemple `https://mon-club.fr/arbatt/`.
2. **Téléverser** tout le contenu de `www/` dans un dossier `arbatt/` à la
   racine web du site (via FTP/SFTP ou le gestionnaire de fichiers de
   l'hébergeur). Le dossier doit contenir `index.html`, `manifest.webmanifest`,
   `sw.js`, `app-config.json`, `.htaccess`, `scoreboard.html`, `css/`, `js/`,
   `icons/`, `media/` et `api/` (avec son `.htaccess` : fichier caché, pensez à
   afficher les fichiers cachés dans votre client FTP).
3. **Ouvrir** `https://mon-club.fr/arbatt/` : l'appli s'affiche. Sur mobile, le
   navigateur propose « Ajouter à l'écran d'accueil » / « Installer ».

**Pourquoi WordPress ne gêne pas :** son `.htaccess` ne réécrit que les URL qui
ne correspondent **pas** à un fichier ou dossier réel
(`RewriteCond %{REQUEST_FILENAME} !-f` / `!-d`). Un vrai dossier `arbatt/` avec
un `index.html` est donc servi **directement**. Le `.htaccess` fourni dans
`www/` désactive de plus toute réécriture à l'intérieur du dossier, par sécurité.

> Ne nommez pas le dossier comme une page/permalien WordPress existant
> (`/arbitrage/` si une page porte déjà ce slug, par exemple).

## Option A-bis — Mise à jour par `git pull` en SSH (recommandé si vous avez SSH)

Vous avez un **accès SSH** au serveur ? On peut faire en sorte qu'une **seule
commande `git pull`** mette l'appli à jour.

### Méthode recommandée : dépôt hors du web + lien symbolique

On clone le dépôt **en dehors** de la racine web (pour n'exposer que `www/`), et
on fait pointer le dossier public vers `www/` par un lien symbolique.

```bash
# --- installation (une seule fois) ---
cd ~                                # au-dessus de ~/www
git clone https://github.com/francklefevre/arBATT.git arbatt-src
ln -s ~/arbatt-src/www ~/www/arbatt

# L'appli est alors servie sur :  https://VOTRE-SITE/arbatt/
```

```bash
# --- mise à jour (LA commande git) ---
cd ~/arbatt-src && git pull
```

Le `git pull` met à jour `www/` en place ; comme le dossier public est un lien
vers `www/`, **l'appli est mise à jour instantanément**. Le dépôt étant public,
aucun identifiant n'est nécessaire. `www/app-config.json` étant versionné,
l'arbre de travail reste propre (pas de conflit au `pull`).

> Si votre hébergement **ne suit pas les liens symboliques** (rare, mais OVH
> mutualisé peut être capricieux selon la config), utilisez la méthode copie
> ci-dessous.

### Variante sans lien symbolique : le script `deploy/update.sh`

```bash
# installation (une fois)
cd ~
git clone https://github.com/francklefevre/arBATT.git arbatt-src

# mise à jour (une commande) — pull + régénération + copie vers le dossier public
~/arbatt-src/deploy/update.sh ~/www/arbatt
```

`update.sh` fait `git pull`, régénère `www/app-config.json` depuis
`config/param.json` (si `python3` est présent) puis copie `www/` vers le dossier
indiqué. URL : `https://VOTRE-SITE/arbatt/`.

### Variante « tout simple » : cloner directement dans le web

```bash
cd ~/www
git clone https://github.com/francklefevre/arBATT.git arbatt
# URL :  https://VOTRE-SITE/arbatt/www/      (mise à jour : cd ~/www/arbatt && git pull)
```

Ici l'URL contient `/www/` (le QR code la « cache » de toute façon) et les
fichiers de dev du dépôt (public) sont visibles — sans gravité, mais moins
propre que le lien symbolique.

> **Dépôt privé ?** Utilisez une **clé SSH de déploiement** ou un token, et
> clonez via `git@github.com:francklefevre/arBATT.git`.

## Option B — Sous-domaine dédié

Plus propre et isolé : créez un sous-domaine (ex. `arbatt.mon-club.fr`) pointant
vers un dossier, et déposez-y le contenu de `www/`. Mêmes prérequis (HTTPS).

## Option C — Hébergement statique pur

GitHub Pages, Netlify, Cloudflare Pages, un bucket S3+CDN, etc. : publiez le
dossier `www/` tel quel. (HTTPS est fourni automatiquement par ces plateformes.)

---

## Points de vérification

| Point | Détail |
|-------|--------|
| **HTTPS** | Indispensable pour le service worker. |
| **Type MIME du manifest** | `.webmanifest` doit être servi en `application/manifest+json`. Le `.htaccess` fourni s'en charge sur Apache. |
| **Chemins relatifs** | arBATT utilise `scope: "./"` et `start_url: "./index.html"` : il fonctionne dans **n'importe quel** sous-répertoire sans modification. |
| **Portée du service worker** | Limitée au dossier de déploiement (ex. `/arbatt/`) — c'est voulu. |
| **`app-config.json`** | Fichier livré avec l'appli (version + durées). En statique, il est lu tel quel. |

### Le fichier `app-config.json`

Il contient la version et les durées paramétrables, lues par la PWA :

```json
{ "version": "x.y.z", "warmupSeconds": 120, "timeoutSeconds": 60,
  "restSeconds": 60, "accelReturns": 13, "gameMinutes": 10,
  "accelPointsThreshold": 18 }
```

Pour **régénérer** ce fichier à partir de `config/param.json` avant un
déploiement (par ex. après avoir changé une durée) :

```bash
python3 arbatt_config.py --write    # écrit www/app-config.json
```

(`server.py` et `deploy/update.sh` utilisent ce même générateur. La liste des
clés publiées est `ARBATT_APP_CONFIG_KEYS` dans `config/param.json`.)

puis téléversez le dossier `www/` mis à jour.

### Mise à jour d'une version déjà déployée

Le service worker met en cache les fichiers de l'appli. Après un nouveau
déploiement :

- `sw.js` et `app-config.json` sont servis en `no-cache` (voir `.htaccess`),
  donc la nouvelle version est détectée rapidement ;
- le numéro de cache du service worker (`CACHE_VERSION` dans `sw.js`) change à
  chaque version, ce qui purge automatiquement les anciens caches ;
- côté utilisateur, **fermer puis rouvrir** l'appli installée suffit en général
  à récupérer la mise à jour.

---

## Ce qu'il ne faut PAS faire

- **Plugins « PWA pour WordPress »** (SuperPWA, etc.) : ils transforment **tout
  le site WordPress** en PWA — ce n'est pas le but ici (on sert *notre* appli).
- **iframe dans une page WordPress** : complique la portée du service worker et
  l'installation. À éviter.

---

## Mode scoreboard / OBS : quel déploiement ?

*(v0.1.12, relais PHP en v0.1.13.)* L'affichage public `scoreboard.html` et le
relais PHP `api/live.php` (+ `api/.htaccess`) sont livrés avec `www/` : **rien
à ajouter**.

| Hébergement | Arbitre et OBS sur **deux appareils** | Même navigateur (2 fenêtres) |
|-------------|---------------------------------------|------------------------------|
| **Apache + PHP ≥ 7.4** (OVH, WordPress — options A, A-bis, B) | ✅ relais **PHP** `api/live.php` | ✅ |
| **`python3 server.py`** (PC de diffusion, réseau local, sans Internet) | ✅ relais **Python** | ✅ |
| **Statique pur** sans PHP (GitHub Pages, Netlify… — option C) | ❌ (`/api/live/` → 404) | ✅ BroadcastChannel |

### Relais PHP : prérequis et vérification

- **PHP ≥ 7.4**, **mod_rewrite** autorisé dans les `.htaccess` (c'est le cas
  dès que WordPress fonctionne). `www/api/.htaccess` réactive la réécriture
  pour ce seul dossier (le `.htaccess` de l'appli la désactive) et route
  `api/live/<…>` vers `live.php`.
- Vérification : `https://VOTRE-SITE/arbatt/api/live/_info` doit répondre
  `{"relay":true,"tokenRequired":false}` (puis `true` une fois le jeton posé).
- Si cette URL répond **`400 Bad Request`** alors que
  `…/api/live.php?path=_info` fonctionne, c'est la négociation de contenu
  (**MultiViews**, active chez OVH) qui court-circuite la réécriture.
  `www/api/.htaccess` la désactive (`Options -MultiViews`, depuis v0.1.16).
- Si l'overlay ne se met à jour que **par paquets toutes les ~25 s**,
  l'hébergeur retient la sortie PHP tant qu'elle est petite (OVH : ~4 Ko).
  Chaque événement est suivi d'un remplissage de `ARBATT_LIVE_PHP_PAD_BYTES`
  octets (4096 par défaut, v0.1.17) ; augmentez-le si besoin.
- Les données (un petit fichier par canal) vont par défaut dans le dossier
  temporaire du système (`/tmp/arbatt-live`), **hors du web**. Pour un autre
  dossier : `ARBATT_LIVE_PHP_DATA_DIR` (jamais sous `www/`).
- Le `.htaccess` désactive la compression et le cache sur `api/` (sinon le
  flux SSE arriverait par paquets). Testé derrière Apache 2.4 + `mod_deflate`
  avec des règles WordPress à la racine.

### Protéger la publication par un jeton (recommandé en ligne)

Sans jeton, toute personne connaissant l'adresse d'un canal (un UUID, donc
difficile à deviner) pourrait y publier. Pour l'exiger :

- **Lien symbolique / clone** (le relais trouve `config/` du dépôt) : mettez
  `"ARBATT_LIVE_TOKEN": "<jeton>"` dans `~/arbatt-src/config/secret.json`
  (copie de `secret.json.example`).
- **Copie** (`deploy/update.sh`) : idem dans le `config/secret.json` du dépôt ;
  `update.sh` ajoute à chaque mise à jour, dans `<dossier web>/api/.htaccess`,
  `SetEnv ARBATT_CONFIG_DIR <dépôt>/config` pour que le relais le trouve.
- Ou directement en variable d'environnement : `SetEnv ARBATT_LIVE_TOKEN …`
  dans `api/.htaccess` (attention : écrasé par `update.sh` à chaque copie).

L'arbitre saisit ensuite le même jeton dans le panneau **📺 Diffusion**.

> ⚠️ Variante « cloner directement dans le web » (`~/www/arbatt/`) : le dossier
> `config/` y est **public**. N'y créez pas de `secret.json` ; passez le jeton
> par `SetEnv ARBATT_LIVE_TOKEN` dans `www/api/.htaccess`, ou préférez la
> méthode du lien symbolique.

### Relais Python (sans Internet)

Lancez `python3 server.py` **sur le PC OBS** et ouvrez l'appli sur le
téléphone via `http://<IP-du-PC>:8080/`. En HTTP sur une IP locale le service
worker ne s'installe pas (pas de mode hors-ligne), ce qui est sans conséquence
ici : le PC est sur place. Derrière un proxy **nginx**, gardez le *buffering*
désactivé pour `/api/live/*/events` (le serveur envoie `X-Accel-Buffering: no`).

Le service worker ne met **jamais** `/api/` en cache (données temps réel).

---

## Donner accès par QR code

Générez un QR code pointant vers l'URL de déploiement
(ex. `https://mon-club.fr/arbatt/`) et affichez-le dans la salle. N'importe quel
générateur de QR code fait l'affaire ; une génération intégrée est prévue dans
une prochaine version de arBATT.
