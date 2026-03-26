# LogviewR - Log Viewer Application
> [!IMPORTANT]
>  PRE-REALEASE BETA , NOT FINISH !


<div align="center">

‼️ En cour de developpement ACTIF , Version BETA ‼️


<img src="LogviewR_banner.svg" alt="LogviewR" width="512" height="256" />

![LogviewR](https://img.shields.io/badge/LogviewR-0.4.11-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-DEVELOPMENT-374151?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-1f2937?style=for-the-badge&logo=docker&logoColor=38bdf8)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)
![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&color=111827&labelColor=111827&logoColor=white)

**Application de visualisation de logs en temps réel pour Apache, Nginx, NPM, logs système et Fail2ban**

[Installation](#-installation) | [Plugins](#-plugins) | [Configuration](#-configuration) | [Documentation](#-documentation)

</div>

---

## 🚀 Installation

```bash
# 1. Créer le fichier .env
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env

# 2. Lancer
docker compose up -d
```

Dashboard disponible sur `http://your-ip:7500`

---

## 📋 Table des matières

- [Installation](#-installation)
- [Plugins](#-plugins)
- [Configuration](#-configuration)
- [Documentation](#-documentation)
- [Contribution](#-contribution)
- [Licence](#-licence)

---

## 🎯 À propos

**LogviewR** — visualisation de logs en temps réel pour Apache, Nginx, NPM, logs système et Fail2ban.

- 🚀 **Temps réel** via WebSocket
- 🔍 **Filtres** : niveau, date, IP, méthode HTTP…
- 📊 **Statistiques** et tableaux de bord par plugin
- 🔐 **Auth JWT**, gestion des rôles
- 🐳 **Docker-ready**

---

## 🔌 Plugins

<details>
<summary><strong>🖥️ Host System</strong> — logs système Linux/Unix</summary>

- Syslog, auth, kernel, daemon, mail, logs personnalisés
- Détection automatique de l'environnement Docker
- Support RFC 3164 / RFC 5424
- Chemin de base configurable (`/var/log` ou `/host/logs` en Docker)

</details>

<details>
<summary><strong>🌐 Apache</strong> — logs Apache HTTP Server</summary>

- Access logs (Combined, Common, VHost) + Error logs
- Extraction IP, timestamp, méthode HTTP, code statut, referer, user-agent
- Regex par défaut modifiables, support `.gz`

</details>

<details>
<summary><strong>🚀 Nginx</strong> — logs Nginx</summary>

- Access logs (Combined, Common, Main, Extended) + Error logs
- Parsing timestamps avec gestion timezones
- Regex compatibles fail2ban et ELK, support `.gz`

</details>

<details>
<summary><strong>🔄 Nginx Proxy Manager (NPM)</strong> — logs NPM</summary>

- 5 formats supportés avec détection automatique
- Champs : cache, upstream status, gzip ratio, sous-domaines
- Support `.gz`

</details>

<details>
<summary><strong>🛡️ Fail2ban</strong> — surveillance des jails et IPs bannies</summary>

**Onglets** : Jails · Filtres · Actions · Tracker IPs · Carte · Ban Manager · Stats · IPTables · IPSet · NFTables · Config · Audit

**Prérequis** : Fail2ban installé et actif sur le host.

**Setup (une seule fois sur le host) :**

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh)
```

Ce script crée le groupe `fail2ban`, installe le drop-in systemd pour que le socket soit accessible au conteneur, et ajuste les permissions SQLite. Le conteneur détecte ensuite automatiquement le GID au démarrage — aucune variable `.env` supplémentaire requise.

Pour vérifier l'état : **Administration → Plugins → Fail2ban → Diagnostic**.

</details>

---

## ⚙️ Configuration

### Variables d'environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `JWT_SECRET` | Secret pour signer les tokens JWT | — | ✅ Oui |
| `DASHBOARD_PORT` | Port du dashboard | `7500` | Non |
| `HOST_IP` | IP de la machine hôte | Auto-détection | Non |
| `CONFIG_FILE_PATH` | Chemin du fichier de configuration externe | `/app/config/logviewr.conf` | Non |
| `ADM_GID` | GID du groupe `adm` sur l'hôte (logs système) | `4` | Non |
| `HOST_ROOT_PATH` | Chemin racine hôte monté dans le conteneur | `/host` | Non |

### docker-compose.yml

```yaml
services:
  logviewr:
    image: ghcr.io/erreur32/logviewr:latest
    container_name: logviewr
    restart: unless-stopped
    ports:
      - "${DASHBOARD_PORT:-7500}:3000"
    environment:
      JWT_SECRET: ${JWT_SECRET}
      DASHBOARD_PORT: ${DASHBOARD_PORT:-7500}
      HOST_IP: ${HOST_IP:-}
    group_add:
      - "${ADM_GID:-4}"           # groupe adm — lecture des logs système
    volumes:
      - ./data:/app/data
      - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock
      - /:/host:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

> Le fichier complet avec tous les commentaires est dans [`docker-compose.yml`](docker-compose.yml) à la racine du projet.

### Accès aux logs système

Le plugin **Host System** nécessite l'accès aux fichiers appartenant à `root:adm` (permissions `640`).
Le conteneur ajoute automatiquement `node` au groupe `adm` (GID 4).

Si votre système utilise un GID différent :
```bash
getent group adm | cut -d: -f3   # vérifier le GID sur le host
echo "ADM_GID=votre_gid" >> .env
```

<details>
<summary>Fichiers avec permissions restrictives (600)</summary>

Certains fichiers (`/var/log/php8.0-fpm.log`, `/var/log/rkhunter.log`) appartiennent à `root:root 600`.
Solution :
```bash
sudo chgrp adm /var/log/php8.0-fpm.log* && sudo chmod 640 /var/log/php8.0-fpm.log*
```

</details>

### Développement local

```bash
npm run dev   # démarre backend (port 3004) + frontend Vite (port 5175)
```

---

## 📚 Documentation

- **[Guides des parsers](server/plugins/PARSERS_HELP.md)** — formats supportés et regex
- **[NPM Parser Help](server/plugins/npm/NPM_PARSER_HELP.md)** — formats NPM
- **[Nginx Parser Help](server/plugins/nginx/NGINX_PARSER_HELP.md)** — formats Nginx
- **[Audit intégration host-system](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md)** — scan erreurs/warnings

---

## 🤝 Contribution

Les contributions sont les bienvenues !

---

## 📄 Licence

Ce projet est sous licence MIT. Voir [LICENSE](LICENSE).

---

<div align="center">

**Fait avec ❤️ pour les administrateurs système et développeurs**

[Issues](https://github.com/Erreur32/LogviewR/issues) | [Discussions](https://github.com/Erreur32/LogviewR/discussions) | [Wiki](https://github.com/Erreur32/LogviewR/wiki)

</div>
