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
   `sw.js`, `app-config.json`, `.htaccess`, `css/`, `js/`, `icons/`.
3. **Ouvrir** `https://mon-club.fr/arbatt/` : l'appli s'affiche. Sur mobile, le
   navigateur propose « Ajouter à l'écran d'accueil » / « Installer ».

**Pourquoi WordPress ne gêne pas :** son `.htaccess` ne réécrit que les URL qui
ne correspondent **pas** à un fichier ou dossier réel
(`RewriteCond %{REQUEST_FILENAME} !-f` / `!-d`). Un vrai dossier `arbatt/` avec
un `index.html` est donc servi **directement**. Le `.htaccess` fourni dans
`www/` désactive de plus toute réécriture à l'intérieur du dossier, par sécurité.

> Ne nommez pas le dossier comme une page/permalien WordPress existant
> (`/arbitrage/` si une page porte déjà ce slug, par exemple).

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
déploiement (par ex. après avoir changé une durée), lancez le serveur une fois :

```bash
python3 server.py    # écrit www/app-config.json, puis Ctrl-C
```

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

## Donner accès par QR code

Générez un QR code pointant vers l'URL de déploiement
(ex. `https://mon-club.fr/arbatt/`) et affichez-le dans la salle. N'importe quel
générateur de QR code fait l'affaire ; une génération intégrée est prévue dans
une prochaine version de arBATT.
