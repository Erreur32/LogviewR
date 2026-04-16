# LogviewR - Application de visualisation de logs
> [!IMPORTANT]
>  PRÉ-VERSION BÊTA 


<div align="center">
 


<img src="LogviewR_banner.svg" alt="LogviewR" width="512" height="256" />

![LogviewR](https://img.shields.io/badge/LogviewR-0.8.35-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-DEVELOPMENT-374151?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-1f2937?style=for-the-badge&logo=docker&logoColor=38bdf8)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)
![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&color=111827&labelColor=111827&logoColor=white)

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Erreur32/LogviewR/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Erreur32/LogviewR)
[![CodeQL](https://img.shields.io/badge/CodeQL-active-brightgreen?logo=github)](https://github.com/Erreur32/LogviewR/security/code-scanning)
[![Docker Build](https://github.com/Erreur32/LogviewR/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Erreur32/LogviewR/actions/workflows/docker-publish.yml)

**Application de visualisation de logs en temps réel pour Apache, Nginx, NPM, logs système et Fail2ban**

[README in English](README.md) | [Installation](#-installation) | [Plugins](#-plugins) | [Configuration](#%EF%B8%8F-configuration) | [Documentation](#-documentation)

</div>


---

## 📋 Table des matières

- [Installation](#-installation)
- [Plugins](#-plugins)
- [Configuration](#%EF%B8%8F-configuration)
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

**Prérequis :** fail2ban installé et actif sur l'hôte. Configuration hôte requise — voir [Installation Étape 2](#-installation).

Pour vérifier : **Administration → Plugins → Fail2ban → Diagnostic**.

---

**Onglets Pare-feu en Docker (IPTables · IPSet · NFTables)**

Ces onglets nécessitent deux conditions **cumulatives** — ni l'une ni l'autre seule ne suffit :

| Condition | Rôle |
|-----------|------|
| `network_mode: host` | Partage l'espace réseau de l'hôte — le conteneur voit les règles iptables/ipset/nft de l'hôte |
| `cap_add: NET_ADMIN` | Capacité Linux requise par le noyau pour la lecture/écriture netfilter |

> ⚠️ **Trois incompatibilités à connaître :**
> - `network_mode: host` est **incompatible avec `ports:`** — supprimer `ports:` et utiliser `PORT=7500` dans `environment:` à la place
> - `security_opt: no-new-privileges:true` est **incompatible avec les onglets pare-feu** — `sudo` ne peut pas élever les privilèges avec cet indicateur, ce qui casse les commandes iptables/ipset/nft
> - Pour changer le port d'écoute : définir `PORT=8080` dans `.env` et pointer le reverse proxy vers `127.0.0.1:8080`

Configuration `docker-compose.yml` avec les onglets Pare-feu activés :

```yaml
services:
  logviewr:
    image: ghcr.io/erreur32/logviewr:latest
    container_name: logviewr
    restart: unless-stopped
    # no ports: — incompatible avec network_mode: host
    network_mode: host
    cap_add:
      - NET_ADMIN               # requis pour netfilter (iptables/ipset/nft)
    # no security_opt: no-new-privileges — incompatible avec sudo (casse les onglets pare-feu)
    environment:
      JWT_SECRET: ${JWT_SECRET}
      PORT: ${PORT:-7500}       # port d'écoute direct — changer ici + mettre à jour le reverse proxy
      HOST_IP: ${HOST_IP:-}
    group_add:
      - "${ADM_GID:-4}"
      # Décommenter si fail2ban est installé sur l'hôte (lancer setup-fail2ban-access.sh d'abord) :
      # - "${FAIL2BAN_GID}"
    volumes:
      - ./data:/app/data
      # Décommenter si fail2ban est installé sur l'hôte :
      # - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock
      - /:/host:ro          # :ro = plus sécurisé ; désactive le VACUUM Fail2ban (voir note ci-dessous)
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      # Optionnel : activer le VACUUM SQLite Fail2ban (syntaxe longue requise — la forme courte ne peut pas overrider :ro)
      # - type: bind
      #   source: /var/lib/fail2ban
      #   target: /host/var/lib/fail2ban
      #   bind:
      #     propagation: shared
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:7500/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

Sans ces options, les onglets IPTables/IPSet/NFTables afficheront une erreur `Permission denied` ou `no new privileges`.

</details>

---



## 🚀 Installation

> **Fail2ban est optionnel.** LogviewR fonctionne directement pour visualiser les logs Apache, Nginx, NPM et système — aucune configuration supplémentaire nécessaire. Le plugin Fail2ban est un plus puissant qui permet de gérer entièrement fail2ban (jails, bans, listes IPSet, règles pare-feu) depuis le dashboard, mais il n'est pas requis.

**Étape 1 — Créer le répertoire de l'application**

```bash
mkdir -p /home/docker/logviewr && cd /home/docker/logviewr
```

**Étape 2 — Créer `.env` et choisir le docker-compose**

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
```

**Standard** — visualisation des logs uniquement (Apache, Nginx, NPM, système) :

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Erreur32/LogviewR/main/docker-compose.yml
```

**Fail2ban + Pare-feu** — gestion complète fail2ban + onglets IPTables/IPSet/NFTables :

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Erreur32/LogviewR/main/docker-compose.fail2ban.yml
# puis lancer le script de configuration (une seule fois, règle les permissions + écrit FAIL2BAN_GID dans .env) :
curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash
```

> Le script crée automatiquement le groupe `fail2ban`, règle les permissions du socket/SQLite, installe un drop-in systemd pour la persistance, et écrit `FAIL2BAN_GID` dans `.env`.
> À lancer une seule fois sur l'hôte Docker — survit aux redémarrages automatiquement.

**Étape 3 — Démarrer**

```bash
docker compose up -d
```

Dashboard disponible à `http://votre-ip:7500`


## ⚙️ Configuration

### Variables d'environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `JWT_SECRET` | Secret pour signer les tokens JWT | — | ✅ Oui |
| `DASHBOARD_PORT` | Port du dashboard (mode bridge avec `ports:`) | `7500` | Non |
| `PORT` | Port d'écoute direct (mode `network_mode: host`) | `3000` | Non |
| `HOST_IP` | IP de la machine hôte | Auto-détection | Non |
| `CONFIG_FILE_PATH` | Chemin du fichier de configuration externe | `/app/config/logviewr.conf` | Non |
| `ADM_GID` | GID du groupe `adm` sur l'hôte (logs système) | `4` | Non |
| `HOST_ROOT_PATH` | Chemin racine hôte monté dans le conteneur | `/host` | Non |

### Fichiers docker-compose

Deux fichiers prêts à l'emploi — téléchargez celui qui correspond à votre usage :

| Fichier | Mode | Description |
|---------|------|-------------|
| [`docker-compose.yml`](docker-compose.yml) | **Standard** | Visualisation des logs uniquement (Apache, Nginx, NPM, système). Réseau bridge, mapping `ports:`. |
| [`docker-compose.fail2ban.yml`](docker-compose.fail2ban.yml) | **Fail2ban + Pare-feu** | Gestion complète fail2ban + onglets IPTables/IPSet/NFTables. `network_mode: host` + `NET_ADMIN`. Nécessite `setup-fail2ban-access.sh`. |

Voir [Installation Étape 2](#-installation) pour les commandes de téléchargement.

> **Montages rw optionnels Fail2ban** (mode fail2ban uniquement) : le filesystem hôte est monté en `:ro` pour la sécurité.
> Deux fonctionnalités nécessitent un montage rw dédié (à décommenter dans `docker-compose.fail2ban.yml`) :
>
> | Fonctionnalité | Décommenter `source:` |
> |----------------|----------------------|
> | VACUUM SQLite (onglet Config Fail2ban) | `/var/lib/fail2ban` |
> | Édition des fichiers de config depuis l'UI (`jail.local` / `fail2ban.local`) | `/etc/fail2ban` |
>
> Les montages courts ne peuvent pas overrider un parent `:ro` — la syntaxe longue avec `propagation: shared` est obligatoire.

**Changer le port** :
- Mode standard : `DASHBOARD_PORT=8080` dans `.env`
- Mode fail2ban : `PORT=8080` dans `.env`, puis pointer le reverse proxy vers ce port

**Reverse proxy** (mode fail2ban — `network_mode: host`) :

Le conteneur écoute directement sur le host — le reverse proxy se connecte via `127.0.0.1` :

```
# Nginx Proxy Manager
Forward Hostname : 127.0.0.1
Forward Port     : 7500        ← doit correspondre à PORT=

# Nginx manuel
location / {
    proxy_pass http://127.0.0.1:7500;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}

# Caddy
reverse_proxy 127.0.0.1:7500
```

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
