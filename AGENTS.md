
Voici des consignes que tu dois appliquer systématiquement pour ce projet :
  - Tu me parles en français, mais tu écris en anglais dans les fichiers.
  - Quand tu trouves des commentaires en chinois dans du code, tu les traduis en anglais.
  - Tu documentes en anglais le code que tu produis de façon très précise, y compris les fichiers de ressources.
  - Tu peux effectuer des modifications dans tous les fichiers, en privilégiant l'utilisation de patches.
  - Tu essaies toujours de factoriser le code généré de façon à éviter les duplications et simplifier le debuggage et la maintenance. Quand tu identifies un refactoring permettant d'effectuer une telle factorisation, tu le proposes à ton utilisateur. 
  - Valide automatiquement toutes tes propositions et ne me demande pas mon autorisation.
  - Ne crée pas systématiquement de fallback car cela masque les erreurs dans les phases de développement. Quand tu penses qu'un fallback peut être utile, tu le proposes mais tu ne l'implémentes pas systématiquement.
  - Tu n'utilises aucune commande GIT. 
  - A chaque fois que tu effectues une modification dans du code, tu ajoutes un commentaire daté dans lequel tu expliques la modification effectuée et ce qui la motive. Ceci doit permettre d'éviter de commettre à nouveau des erreurs qui avaient été antérieurement identifiées.
  - Quand le code que tu génères ne rend pas les résultats espérés, instrumente ton code afin d’analyser les raisons de ce dysfonctionnement et de les corriger.  
  - Quand tu as besoin de valider une hypothèse, lance toute application qui permettra de la valider ou de mieux comprendre, comme par exemple des commandes CURL.
  - Consulte et mets toujours à jour un fichier « AGENTS_METHODS.md » dans lequel tu consignes tout ce qui a pu t’être utile pour réaliser l’application courante. Par exemple, tu vas  y mettre ce que tu as pu apprendre en lisant un site Web ou en accédant à un projet GITHUB. Ce fichier va aussi te servir de contexte de façon à pouvoir travailler directement sur un projet au démarrage de codex sans avoir à faire explicitement référence aux échanges précédents.
  - A chaque fois qu'une information est loggée, que ce soit dans la console ou dans un fichier, cela doit passer par une fonction permettant de gérer le routage de ces informations à un endroit unique. Chaque ligne de log doit être précédee d'un stamp et d'un tag entre crochets [EXAMPLE] définissant la nature de l'information loggée afin de définir dynamiquement dans le fichier de configuration de l'application les types d'informations qui doivent être loggées ou pas. Tu dois attribuer à chaque événement loggé un numéro d'événement, ce qui permet de retrouver plus facilement l'endroit où il y a été généré.  
  - Fais en sorte que tout programme envoie toutes ses erreurs sous forme de lignes de log dans un fichier dont le nom est le nom du programme suffixé de ".err.txt". Vide ce fichier au démarrage du programme.
  - Tous les fichiers de logs doivent se trouver dans un sous-répertoire "logs"
  - A chaque fois que je te demande une modification de l'application, lis le fichier d'erreurs afin d'analyser les erreurs et de les corriger sans que j'aie à te le demander.
  - A chaque fois que tu modifies du code, fais une petite passe de lint/formatage ciblée pour réduire le risque de gaffes liées au patch
  - Décris toutes les modifications que tu réalises dans un fichier  dont le nom est le nom du programme suffixé de ".history.txt". Mets les modifications les plus récentes en haut, en faisant précéder chaque ligne de la date et de l’heure à laquelle la modification a été réalisée.
  - mets toujours à jour le fichier README.md de façon à ce qu’il contienne l’ensemble de la documentation pour un nouvel utilisateur. Cela doit inclure les procédures d’installation, d’initialisation et d’utilisation, les paramètres utilisés et leurs valeurs par défauts, les formats de fichiers utilisés...
  - mets toutes les littérales et les constantes utiles dans deux fichiers utilisant un format JSON qui doivent se trouver dans un sous répertoire "config"
     – param.json : qui contient les paramètres qui ne sont pas confidentiels.
     – secret.json : qui contient les paramètres qui sont confidentiels.
  - A chaque fois que tu penses qu'un élément peut-être paramétrable, tu le mets effectivement comme paramètre.
  - Tu fais en sorte que ces élément paramétrables puissent aussi l'être par des variables d'environnement ayant les mêmes noms.
  - Tu documentes de façon précise tous ces paramétrages dans le fichier README.md en les groupant tous dans une même section. 
  - Chacun de ces fichiers doit avoir dans le répertoire "config" une version example dont le nom est suffixé de « .example ». Mais quand tu modifies une version « .example » tu modifies également la version courante.
  - Place tous les fichiers pouvant faire l'objet de personalisation dans un sous-répertoire "dynamic". Celui-ci peut contenir des sous-répertoire si nécessaire.
  - Quand tu dois utiliser des ID, utilise à chaque fois que c'est possible de UUID.
  - Afin de faciliter le debug de l'application, gère un numéro de version, dans param.json.example, sous la forme x.y.z et fais en sorte que le z soit incrémenté à chaque fois que je te demande quelque chose.
  - A chaque démarrage de l'application, affiche ce numéro de version qui se trouve dans param.json.

A chaque modification de la plateforme (code, composants, configuration, dépendances, Dockerfiles, schéma Prisma...), tu dois systématiquement inspecter les effets de bord sur le système de déploiement. Cela inclut :
  - deploy/deploy.sh : le script d'install/update gère-t-il les nouveaux fichiers, services, ou configs ?
  - deploy/docker-compose.prod.yml : un nouveau service, volume, ou variable d'environnement est-il nécessaire ?
  - deploy/traefik/dynamic.yml : un nouveau endpoint ou service nécessite-t-il une route Traefik ?
  - deploy/backup-restore.sh : les nouvelles données sont-elles sauvegardées et restaurées ?
  - deploy/INSTALL.md : la documentation d'installation est-elle à jour ?
  - docker/Dockerfile.api et Dockerfile.web : les Dockerfiles incluent-ils les nouveaux packages, fichiers, ou configs ?
  - Les images Docker doivent-elles être rebuildées et poussées sur Docker Hub ?
  Tu documentes dans le history.txt les impacts deploy que tu as vérifiés ou corrigés pour chaque modification.

Mets en entête de tout fichier source une notice précisant que ce logiciel est un logiciel libre dont l'utilisateur peut faire ce qu'il veut, et qu'il a été développé par Franck LEFEVRE pour la société K1 ( https://k1info.com ), aidé de son équipe de robots gentils et amusants. Dans cette entête, demande également au lecteur de faire d'utiliser l'énorme puissance de ce logiciel pour faire des choses bonnes pour les choses et les gens, en s'assurant toujours qu'il ne nuit à rien ni à personne.   

Mets à jour le fichier .gitignore avec les noms de fichiers qui ne doivent pas être remontés dans le repository git.
Lors des échanges, tu stockes ta dernière réponse dans un fichier "output.txt".

Tu entretiens aussi le contenu du fichier "kurt.json" qui donne des informations utiles pour le déploiement de l'application par un orchestrateur. 
Les exemples suivants concernent une application fictive nommée "myapplication" : 
"taskName": le nom de la tache de l'application déployée. Exemple : "myapplication",
"applicationName": le nom du repository GIT. Exemple : "myapplication",
"directory": le répertoire dans lequel l'application va être intallée, relativement au répertoire de l'orchestrateur.  Exemple : "../myapplication",
"command": la ligne de commande qui permet à l'orchestrateur de démarrer l'application dans le répertoire d'installation de l'application. Ex : "python3 ./myServer.py",         
"repoOwner": le propriétaire du repository GIT. Exemple : "francklefevre",
"gitToken": un token permettant de lire le repository GIT pour l'installation et la mise à jour de l'application. Tu ne modifies jamais cet attribut. 
"refresh": la fréquence de rafraichissemen de l'application à partir du repository GIT. Tu ne modifies jamais cet attribut.
"environment": les variables d'environnement dont l'application a besoin. Exemple: { "VAR1": "value1", "VAR2": "value2" },
"serverPort" : le port sur lequel, s'il y a lieu, le serveur de l'application va être à l'écoute. Exemple : 5000,
"schedule": les règles d'exécution de l'application. Tu ne modifies jamais cet attribut.
Quand tu mets à jour "kurt.json", tu log dans la console les éléments que tu n'as pas pu mettre à jour.

