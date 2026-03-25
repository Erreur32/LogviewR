# LogviewR - Log Viewer Application
> [!IMPORTANT]
>  PRE-REALEASE BETA , NOT FINISH !


<div align="center">

‼️ En cour de developpement ACTIF , Version BETA ‼️


<img src="LogviewR_banner.svg" alt="LogviewR" width="512" height="256" />

![LogviewR](https://img.shields.io/badge/LogviewR-0.4.6-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-DEVELOPMENT-374151?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-1f2937?style=for-the-badge&logo=docker&logoColor=38bdf8)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)
![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&color=111827&labelColor=111827&logoColor=white)

**Application de visualisation de logs en temps réel pour Apache, Nginx, NPM et logs système**

[Installation](#-installation) | [Fonctionnalités](#-fonctionnalités) | [Plugins](#-plugins) | [Configuration](#-configuration) | [Documentation](#-documentation)

</div>

---

## 📋 Table des matières

- [À propos](#-à-propos)
- [Fonctionnalités](#-fonctionnalités)
- [Plugins](#-plugins)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Options avancées](#-options-avancées)
- [Atouts](#-atouts)
- [Documentation](#-documentation)
- [Contribution](#-contribution)
- [Licence](#-licence)

---

## 🎯 À propos

**LogviewR** est une application web moderne et performante pour visualiser et analyser les logs en temps réel. Conçue pour les administrateurs système et les développeurs, elle offre une interface intuitive pour surveiller les logs de vos serveurs web et systèmes.

### Caractéristiques principales

- 🚀 **Temps réel** : Streaming WebSocket pour un suivi en direct des logs
- 🎨 **Interface moderne** : Design épuré avec thèmes personnalisables
- 🔍 **Recherche avancée** : Filtres multiples (niveau, date, IP, méthode HTTP, etc.)
- 📊 **Statistiques** : Tableaux de bord avec statistiques détaillées par plugin
- 🔐 **Sécurisé** : Authentification JWT, gestion des rôles, permissions par plugin
- 🐳 **Docker-ready** : Déploiement simplifié avec Docker Compose
- ⚡ **Performant** : Optimisations pour gérer des milliers de fichiers de logs (y compris fichiers volumineux 45 Mo+)

---

## ✨ Fonctionnalités

### Visualisation des logs

- **Tableau interactif** : Colonnes dynamiques selon le type de log
- **Tri adaptatif** : Tri automatique par type (date, nombre, IP, texte)
- **Badges colorés** : Visualisation intuitive des niveaux, codes HTTP, IP, hostnames
- **Fichier par défaut** : À la première utilisation, NPM/Nginx/Apache ouvrent automatiquement un access log par défaut (`default-host_access.log`, `access.log`)
- **Option « Sans vides »** : Toggle pour masquer les fichiers vides et .gz dans le sélecteur (préférence mémorisée)
 
### Filtres et recherche

- **Recherche texte** : Recherche dans tous les champs des logs
 
 

### Regex personnalisées

- **Éditeur intégré** : Éditeur de regex avec test en temps réel
- **Regex par fichier** : Configuration de regex personnalisées par fichier
 

### Statistiques et analytique

- **Statistiques par plugin** : Nombre de fichiers, fichiers lisibles/non lisibles
- **Plus gros fichiers** : Top 10 des fichiers les plus volumineux
- **Statistiques en temps réel** : Mise à jour automatique des statistiques
- **Tableaux de bord** : Vue d'ensemble de tous les plugins actifs
- **Analyse / Journaux d'erreur** : Carte dashboard qui scanne les fichiers d'erreur et access des plugins **Apache, Nginx, NPM** (tags [error]/[warn] + codes HTTP 3xx/4xx/5xx) et les **logs système (host-system)** (syslog, auth.log, kern.log, etc.) avec détection des tags error/warn au format syslog. Résultats par plugin, badges 4xx/5xx et error/warn, détail par fichier. Voir [Audit intégration host-system](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md).
- **Stats Logs (style GoAccess)** : Page plein écran avec graphiques (KPI, Stats KPI, timeline, Time Distribution, Unique Visitors, HTTP Status Codes, Referring Sites, Virtual Hosts, Referrer URLs, Requested Files, top panels), accessible via le bouton dans le footer à côté d'Analytique. Filtre plugin NPM/Apache. Courbes duales requêtes + visiteurs (sans dépendance graphique externe).

---

## 🔌 Plugins

LogviewR supporte plusieurs plugins pour différents types de logs :

<details>
<summary><strong>🖥️ Host System</strong> - Plugin pour les logs système Linux/Unix</summary>

- **Types de logs supportés** :
  - Syslog (`/var/log/syslog`, `/var/log/messages`)
  - Auth logs (`/var/log/auth.log`, `/var/log/secure`)
  - Kernel logs (`/var/log/kern.log`)
  - Daemon logs (`/var/log/daemon.log`)
  - Mail logs (`/var/log/mail.log`)
  - Logs personnalisés

- **Fonctionnalités** :
  - Détection automatique de l'environnement Docker
  - Support des formats syslog standard (RFC 3164, RFC 5424)
  - Parsing des timestamps avec gestion des timezones
  - Extraction des niveaux de sévérité
  - Fichiers personnalisés configurables

- **Configuration** :
  - Chemin de base configurable (par défaut : `/var/log` ou `/host/logs` en Docker)
  - Patterns de fichiers personnalisables
  - Regex personnalisées par type de log

</details>

<details>
<summary><strong>🌐 Apache</strong> - Plugin pour les logs Apache HTTP Server</summary>

- **Types de logs supportés** :
  - Access logs (formats Combined, Common, VHost)
  - Error logs (formats standard et étendus)

- **Fonctionnalités** :
  - Support des formats Virtual Host
  - Support IPv4 et IPv6
  - Extraction des champs : IP, timestamp, méthode HTTP, URL, code de statut, taille, referer, user-agent
  - Parsing des erreurs avec extraction du module, niveau, PID, TID, client IP
  - Regex par défaut pour chaque format
  - Regex personnalisées par fichier

- **Configuration** :
  - Fichiers de logs personnalisés configurables
  - Regex par défaut modifiables
  - Support des fichiers compressés (.gz)

</details>

<details>
<summary><strong>🚀 Nginx</strong> - Plugin pour les logs Nginx</summary>

- **Types de logs supportés** :
  - Access logs (formats Combined, Common, Main, Extended)
  - Error logs

- **Fonctionnalités** :
  - Support de multiples formats de logs Nginx
  - Extraction complète des champs HTTP
  - Parsing des timestamps avec gestion des timezones
  - Regex compatibles avec fail2ban et ELK
  - Regex par défaut pour chaque format

- **Configuration** :
  - Fichiers de logs personnalisés configurables
  - Regex par défaut modifiables
  - Support des fichiers compressés (.gz)

</details>

<details>
<summary><strong>🔄 Nginx Proxy Manager (NPM)</strong> - Plugin pour les logs Nginx Proxy Manager</summary>

- **Types de logs supportés** :
  - Access logs (formats standard avec cache, sans cache, custom combined, extended)
  - Error logs

- **Fonctionnalités** :
  - Support de 5 formats de logs NPM différents
  - Détection automatique du format
  - Extraction des champs : cache, upstream status, gzip ratio, etc.
  - Gestion des sous-domaines (proxy-host-xxx_access.log)
  - Regex par défaut pour chaque format

- **Configuration** :
  - Fichiers de logs personnalisés configurables
  - Regex par défaut modifiables
  - Support des fichiers compressés (.gz)

</details>

<details>
<summary><strong>🛡️ Fail2ban</strong> - Plugin for Fail2ban intrusion prevention monitoring</summary>

- **Features** :
  - Real-time jail monitoring (currently banned IPs, failed attempts, total bans)
  - Banned IP list per jail with unban action
  - IP tracker — full ban/unban/failure history with geolocation and hostname
  - IPTables and IPSet chain viewer
  - Ban history charts with configurable time periods (24h, 7d, 30d, 6m, 1y, all)
  - Recidivism detection with visual warnings

- **Tabs** :
  - **Jails** — status and stats for each active jail
  - **Tracker** — per-IP history across all jails
  - **History** — ban timeline with period selector
  - **IPTables** — active iptables chains
  - **IPSet** — ipset entries with fill rate bars
  - **Stats** — aggregate statistics

- **Requirements** :
  - Fail2ban installed and running on the host
  - Socket access: `/var/run/fail2ban/fail2ban.sock` (or host path in Docker)
  - SQLite database: `/var/lib/fail2ban/fail2ban.sqlite3`

- **Docker setup** — run the setup script on the host to configure permissions automatically:

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh)
```

> Creates the `fail2ban` group, updates the systemd drop-in, fixes socket/SQLite permissions, and writes `FAIL2BAN_GID` to your `.env`.
> Then add to `docker-compose.yml` under `group_add`: `- "${FAIL2BAN_GID:-}"`

- **Configuration** :
  - Configurable socket and database paths
  - Docker-aware path mapping (host paths via `/host/...`)
  - Sync interval configurable

</details>

---

---

<details>
<summary><strong>⚙️ Configuration</strong></summary>

### Variables d'environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `JWT_SECRET` | Secret pour signer les tokens JWT | - | ✅ Oui |
| `DASHBOARD_PORT` | Port du dashboard | `7500` | Non |
| `HOST_IP` | IP de la machine hôte | Auto-détection | Non |
| `CONFIG_FILE_PATH` | Chemin du fichier de configuration externe | `/app/config/logviewr.conf` | Non |
| `ADM_GID` | GID du groupe adm sur l'hôte (pour lire les fichiers de logs) | `4` | Non |
| `HOST_ROOT_PATH` | Chemin racine du système hôte monté dans le conteneur | `/host` | Non |

<details>
<summary><strong>Permissions des fichiers de logs système</strong></summary>

Le plugin **Host System Logs** nécessite l'accès en lecture aux fichiers de logs système. Par défaut, ces fichiers appartiennent à `root:adm` avec des permissions `640` (lecture pour root et le groupe adm).

#### Configuration automatique

Le conteneur Docker est automatiquement configuré pour :
- Ajouter l'utilisateur `node` au groupe `adm` (GID 4)
- Permettre la lecture des fichiers appartenant à `root:adm`

#### Vérification du GID du groupe adm

Pour vérifier que le GID correspond entre l'hôte et le conteneur :

```bash
# Sur l'hôte
getent group adm | cut -d: -f3

# Dans le conteneur
docker exec logviewr id
```

Si le GID est différent de 4, ajoutez dans votre fichier `.env` :
```bash
ADM_GID=votre_gid
```

#### Fichiers avec permissions restrictives

Certains fichiers de logs peuvent avoir des permissions plus restrictives (`600` - lecture/écriture pour root uniquement) :

**Exemples de fichiers problématiques :**
- `/var/log/php8.0-fpm.log` (appartient à `root:root` avec `600`)
- `/var/log/rkhunter.log.1` (appartient à `root:root` avec `600`)

**Solution :** Modifier les permissions sur l'hôte pour permettre la lecture par le groupe `adm` :

```bash
# Changer le groupe en adm et ajouter la lecture pour le groupe
sudo chgrp adm /var/log/php8.0-fpm.log*
sudo chmod 640 /var/log/php8.0-fpm.log*

sudo chgrp adm /var/log/rkhunter.log*
sudo chmod 640 /var/log/rkhunter.log*
```

**Vérification après modification :**
```bash
# Vérifier les permissions
ls -la /var/log/php8.0-fpm.log
ls -la /var/log/rkhunter.log.1

# Devrait afficher : -rw-r----- 1 root adm (640)
```

**Note de sécurité :** Modifier les permissions des fichiers de logs pour permettre la lecture par le groupe `adm` est une pratique standard sur les systèmes Linux. Le groupe `adm` est conçu pour permettre l'accès aux fichiers de logs aux administrateurs système.

</details>

### Configuration Docker

#### Montage des volumes

Le fichier `docker-compose.yml` configure automatiquement les montages nécessaires pour accéder aux logs du système hôte :

```yaml
volumes:
  # Montage du système de fichiers hôte (lecture seule)
  # Cela monte tout le système, y compris /var/log, sous /host
  - /:/host:ro
  
  # Montage séparé de /proc et /sys pour une meilleure compatibilité
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
```

**Important :** Le système utilise automatiquement `/host/var/log` pour accéder aux logs. Un symlink `/host/logs -> /host/var/log` est créé automatiquement par le script `docker-entrypoint.sh` si possible, mais le code utilise `/host/var/log` directement comme fallback.

**⚠️ Ne pas utiliser** le montage explicite `/var/log:/host/logs:ro` car il cause des erreurs "read-only file system" avec Docker.

#### Accès aux fichiers de logs

Les plugins accèdent aux fichiers de logs via les chemins suivants :
- **Host System** : `/host/var/log/syslog`, `/host/var/log/auth.log`, etc.
- **Apache** : `/host/var/log/apache2/access.log`, `/host/var/log/apache2/error.log`
- **Nginx** : `/host/var/log/nginx/access.log`, `/host/var/log/nginx/error.log`
- **NPM** : `/host/var/log/npm/*.log`

La conversion des chemins est automatique : si vous configurez `/var/log/apache2` dans un plugin, il sera automatiquement converti en `/host/var/log/apache2` (ou `/host/logs/apache2` si le symlink existe) dans le conteneur Docker.

### Configuration des plugins

Chaque plugin peut être configuré depuis l'interface d'administration :

1. **Accéder aux paramètres** : Menu → Paramètres → Plugins
2. **Sélectionner un plugin** : Cliquer sur la carte du plugin
3. **Configurer les options** :
   - Chemin de base des logs
   - Patterns de fichiers
   - Fichiers personnalisés
   - Regex par défaut
   - Option de lecture des fichiers compressés

#### Développement local (npm)

Pour que le dashboard (ex. carte « Fichiers avec erreurs ») et toutes les API fonctionnent, il faut lancer **à la fois** le serveur et le client :

```bash
npm run dev
```

Cela démarre le serveur API (port 3004 par défaut) et le client Vite (port 5175). Le proxy Vite redirige `/api` vers le backend.

Si vous lancez uniquement le client (`npm run dev:client`), les appels à `/api/*` échoueront (404 ou « Le serveur n'est pas disponible »). En cas de 404 sur `/api/log-viewer/error-summary`, vérifiez que le backend tourne et consultez les logs du terminal serveur ainsi que la console du navigateur (en dev, des messages `[ErrorFilesCard]` et `[API]` aident au diagnostic).

</details>

---

## 🌟 Atouts

<details>
<summary><strong>⚡ Performance</strong></summary>

- ⚡ **Chargement optimisé** : Mode quick pour affichage rapide
- 🚀 **Chargement en deux phases** : Quick stats → Complete stats
- 📊 **Gestion efficace** : Optimisé pour gérer des milliers de fichiers
- 💾 **Décompression intelligente** : Support `.gz` avec gestion mémoire optimisée

</details>

<details>
<summary><strong>🎨 Interface utilisateur</strong></summary>

- 🎨 **Design moderne** : Interface épurée et intuitive
- 🌈 **Thèmes personnalisables** : 6 thèmes disponibles (dark, glass, modern, nightly, neon, elegant)
- 📱 **Responsive** : Interface adaptée à tous les écrans
- 🔍 **Recherche avancée** : Filtres multiples et recherche texte
- 🎯 **Badges colorés** : Visualisation intuitive avec couleurs cohérentes

</details>

<details>
<summary><strong>🔐 Sécurité</strong></summary>

- 🔐 **Authentification JWT** : Tokens sécurisés avec expiration configurable
- 👥 **Gestion des rôles** : Admin, User, Viewer avec permissions granulaires
- 🛡️ **Protection CSRF** : Protection contre les attaques CSRF
- 🔒 **Mots de passe hashés** : Utilisation de bcrypt (10 rounds)
- 🚫 **Protection brute force** : Verrouillage de compte après tentatives échouées

</details>

<details>
<summary><strong>🔌 Extensibilité</strong></summary>

- 🔌 **Architecture modulaire** : Système de plugins extensible
- 📝 **Regex personnalisables** : Configuration flexible des patterns
- 🎛️ **Configuration par plugin** : Options spécifiques à chaque plugin
- 🔄 **API REST complète** : Intégration facile avec d'autres outils

</details>

<details>
<summary><strong>🔄 Fiabilité</strong></summary>

- 🔄 **Reconnexion automatique** : Gestion automatique des déconnexions WebSocket
- 📊 **Statistiques en temps réel** : Mise à jour automatique des métriques
- 🐛 **Gestion d'erreurs** : Gestion robuste des erreurs avec messages clairs
- 📈 **Monitoring** : Statistiques détaillées par plugin

</details>

---

## 📚 Documentation

### Guides utilisateur

- **[Guides des parsers](server/plugins/PARSERS_HELP.md)** : Guide général des parsers et formats supportés
- **[NPM Parser Help](server/plugins/npm/NPM_PARSER_HELP.md)** : Formats et regex pour NPM
- **[Nginx Parser Help](server/plugins/nginx/NGINX_PARSER_HELP.md)** : Formats et regex pour Nginx

### Audits et conception

- **[Audit intégration logs système (error summary)](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md)** : Intégration du plugin host-system dans le scan « Analyse / Journaux d'erreur », recherche des tags error/warn (formats Apache/Nginx/NPM et syslog).

### Animations et thème (sync MynetworK)

- **[Animations et thème](Docs/ANIMATIONS_AND_THEME_SYNC.md)** : Synchronisation du code des animations (AnimatedBackground) et schéma de la base thème (`theme_config`). Pour mettre à jour les animations depuis MynetworK : `node scripts/copy-animated-bg.js` (nécessite le dossier `mynetwork_app`).

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Pour plus d'informations sur la contribution.
---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 🙏 Remerciements

- [React](https://react.dev/) - Bibliothèque UI
- [Express.js](https://expressjs.com/) - Framework web Node.js
- [Tailwind CSS](https://tailwindcss.com/) - Framework CSS
- [Zustand](https://github.com/pmndrs/zustand) - Gestion d'état
- [Lucide React](https://lucide.dev/) - Icônes

---

<div align="center">

**Fait avec ❤️ pour les administrateurs système et développeurs**

[Issues](https://github.com/Erreur32/LogviewR/issues) | [Discussions](https://github.com/Erreur32/LogviewR/discussions) | [Wiki](https://github.com/Erreur32/LogviewR/wiki)

</div>
