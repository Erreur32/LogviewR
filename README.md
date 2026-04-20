# LogviewR - Log Viewer Application

<div align="center">

 


<img src="LogviewR_banner.svg" alt="LogviewR" width="512" height="256" />

![LogviewR](https://img.shields.io/badge/LogviewR-0.9.3-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-DEVELOPMENT-374151?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-1f2937?style=for-the-badge&logo=docker&logoColor=38bdf8)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)
![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&color=111827&labelColor=111827&logoColor=white)

[![Build](https://img.shields.io/github/actions/workflow/status/Erreur32/LogviewR/docker-publish.yml?style=for-the-badge&logo=github&logoColor=white&label=Build&color=111827)](https://github.com/Erreur32/LogviewR/actions/workflows/docker-publish.yml)
[![CodeQL](https://img.shields.io/badge/CodeQL-active-brightgreen?style=for-the-badge&logo=github)](https://github.com/Erreur32/LogviewR/security/code-scanning)
[![OSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/Erreur32/LogviewR?style=for-the-badge&label=Scorecard)](https://scorecard.dev/viewer/?uri=github.com/Erreur32/LogviewR)
[![SonarCloud](https://img.shields.io/sonar/quality_gate/Erreur32_LogviewR?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&logo=sonarcloud&logoColor=white&label=Sonar)](https://sonarcloud.io/summary/overall?id=Erreur32_LogviewR)
[![Snyk](https://img.shields.io/github/actions/workflow/status/Erreur32/LogviewR/snyk.yml?style=for-the-badge&logo=snyk&logoColor=white&label=Snyk&color=111827)](https://github.com/Erreur32/LogviewR/actions/workflows/snyk.yml)

**Real-time log viewer for Apache, Nginx, NPM, system logs and Fail2ban**

[README en Français](README.fr.md) | [Installation](#-installation) | [Plugins](#-plugins) | [Configuration](#%EF%B8%8F-configuration) | [Reverse Proxy](#-reverse-proxy) | [Documentation](#-documentation)

</div>


---

## 📋 Table of Contents

- [Installation](#-installation)
- [Plugins](#-plugins)
- [Configuration](#%EF%B8%8F-configuration)
- [Reverse Proxy](#-reverse-proxy)
- [System Log Access](#-system-log-access)
- [Documentation](#-documentation)
- [Contribution](#-contribution)
- [License](#-license)

---

## 🎯 About

**LogviewR** - real-time log viewer for Apache, Nginx, NPM, system logs and Fail2ban.

- 🚀 **Real-time** via WebSocket
- 🔍 **Filters**: level, date, IP, HTTP method…
- 📊 **Statistics** and dashboards per plugin
- 🔐 **JWT auth**, role management
- 🐳 **Docker-ready**

---

## 🔌 Plugins

<details>
<summary><strong>🖥️ Host System</strong> - Linux/Unix system logs</summary>

- Syslog, auth, kernel, daemon, mail, custom logs
- Automatic Docker environment detection
- RFC 3164 / RFC 5424 support
- Configurable base path (`/var/log` or `/host/logs` in Docker)

</details>

<details>
<summary><strong>🌐 Apache</strong> - Apache HTTP Server logs</summary>

- Access logs (Combined, Common, VHost) + Error logs
- IP, timestamp, HTTP method, status code, referer, user-agent extraction
- Editable default regex, `.gz` support

</details>

<details>
<summary><strong>🚀 Nginx</strong> - Nginx logs</summary>

- Access logs (Combined, Common, Main, Extended) + Error logs
- Timestamp parsing with timezone handling
- Fail2ban and ELK compatible regex, `.gz` support

</details>

<details>
<summary><strong>🔄 Nginx Proxy Manager (NPM)</strong> - NPM logs</summary>

- 5 supported formats with automatic detection
- Fields: cache, upstream status, gzip ratio, subdomains
- `.gz` support

</details>

<details>
<summary><strong>🛡️ Fail2ban</strong> - jail monitoring and banned IPs</summary>

**Tabs**: Jails · Filters · Actions · IP Tracker · Map · Ban Manager · Stats · IPTables · IPSet · NFTables · Config · Audit

**Requirements:** fail2ban installed and active on the host. Host setup required - see [Installation Step 2](#-installation).

To verify: **Administration → Plugins → Fail2ban → Diagnostic**.

---

**Firewall tabs in Docker (IPTables · IPSet · NFTables)**

These tabs require two **cumulative** conditions - neither alone is sufficient:

| Condition | Role |
|-----------|------|
| `network_mode: host` | Shares host network namespace - container sees host iptables/ipset/nft rules |
| `cap_add: NET_ADMIN` | Linux capability required by the kernel for netfilter read/write |

> ⚠️ **Three incompatibilities to know:**
> - `network_mode: host` is **incompatible with `ports:`** - remove `ports:` and use `PORT=7500` in `environment:` instead
> - `security_opt: no-new-privileges:true` is **incompatible with firewall tabs** - `sudo` cannot elevate with this flag, breaking iptables/ipset/nft commands
> - To change the listen port: set `PORT=8080` in `.env` and point your reverse proxy to `127.0.0.1:8080`

Use [`docker-compose.fail2ban.yml`](docker-compose.fail2ban.yml) — it includes `network_mode: host`, `NET_ADMIN`, and fail2ban socket/group already configured. See [Installation Step 2](#-installation).

Without these options, IPTables/IPSet/NFTables tabs will show a `Permission denied` or `no new privileges` error.

</details>

---



## 🚀 Installation

> **Fail2ban is optional.** LogviewR works out of the box for viewing Apache, Nginx, NPM and system logs — no extra setup needed. The Fail2ban plugin is a powerful addition that lets you fully manage fail2ban (jails, bans, IPSet lists, firewall rules) from the dashboard, but it is not required.

**Step 1 - Create the application directory**

```bash
mkdir -p /home/docker/logviewr && cd /home/docker/logviewr
```

**Step 2 - Create `.env` and choose your docker-compose file**

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
```

**Standard** — log viewer only (Apache, Nginx, NPM, system logs):

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Erreur32/LogviewR/main/docker-compose.yml
```

**Fail2ban + Firewall** — full fail2ban management + IPTables/IPSet/NFTables tabs:

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Erreur32/LogviewR/main/docker-compose.fail2ban.yml
# then run the setup script (one-time, sets permissions + writes FAIL2BAN_GID to .env):
curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash
```

> The setup script automatically creates the `fail2ban` group, sets socket/SQLite permissions, installs a systemd drop-in for persistence, and writes `FAIL2BAN_GID` to `.env`.
> Run it once on the Docker host — survives reboots automatically.

**Step 3 - Start**

```bash
docker compose up -d
```

Dashboard available at `http://your-ip:7500`


## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `JWT_SECRET` | Secret used to sign JWT tokens | - | ✅ Yes |
| `DASHBOARD_PORT` | Dashboard port (bridge mode with `ports:`) | `7500` | No |
| `PORT` | Direct listen port (`network_mode: host` mode) | `3000` | No |
| `HOST_IP` | Host machine IP address | Auto-detect | No |
| `CONFIG_FILE_PATH` | Path to external configuration file | `/app/config/logviewr.conf` | No |
| `ADM_GID` | GID of the `adm` group on the host (system logs) | `4` | No |
| `HOST_ROOT_PATH` | Host root path mounted in the container | `/host` | No |
| `TZ` | Container timezone — must match your host TZ so log timestamps (written by Apache/Nginx in host local time, without TZ info) are parsed correctly. Override if your host is not in Europe/Paris. | `Europe/Paris` | No |

### docker-compose files

Two ready-to-use files — download the one that matches your setup:

| File | Mode | What it does |
|------|------|-------------|
| [`docker-compose.yml`](docker-compose.yml) | **Standard** | Log viewer only (Apache, Nginx, NPM, system). Bridge network, `ports:` mapping. |
| [`docker-compose.fail2ban.yml`](docker-compose.fail2ban.yml) | **Fail2ban + Firewall** | Full fail2ban management + IPTables/IPSet/NFTables tabs. `network_mode: host` + `NET_ADMIN`. Requires `setup-fail2ban-access.sh`. |

See [Installation Step 2](#-installation) for download commands.

> **Fail2ban optional rw mounts** (fail2ban mode only): The host filesystem is mounted `:ro` for security.
> Two features need a dedicated rw bind mount (uncomment in `docker-compose.fail2ban.yml`):
>
> | Feature | Uncomment `source:` |
> |---------|---------------------|
> | SQLite VACUUM (Fail2ban Config tab) | `/var/lib/fail2ban` |
> | Config file editing from the UI (`jail.local` / `fail2ban.local`) | `/etc/fail2ban` |
>
> Short-form mounts cannot override a `:ro` parent — the long-form syntax with `propagation: shared` is required.

**Changing the port**:
- Standard mode: set `DASHBOARD_PORT=8080` in `.env`
- Fail2ban mode: set `PORT=8080` in `.env`, then point your reverse proxy to that port

---

## 🔀 Reverse Proxy

When using **fail2ban mode** (`network_mode: host`), there is no Docker port mapping — the container listens directly on the host. A reverse proxy connects via `127.0.0.1`:

In **standard mode** (`ports:` mapping), a reverse proxy can connect to `127.0.0.1:7500` the same way, or you can expose the port directly without a proxy.

### Nginx Proxy Manager

```
Forward Hostname : 127.0.0.1
Forward Port     : 7500        ← must match PORT= or DASHBOARD_PORT=
```

### Nginx (manual)

```nginx
server {
    listen 443 ssl;
    server_name logviewr.example.com;

    location / {
        proxy_pass http://127.0.0.1:7500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```
logviewr.example.com {
    reverse_proxy 127.0.0.1:7500
}
```

### Traefik

```yaml
http:
  routers:
    logviewr:
      rule: "Host(`logviewr.example.com`)"
      service: logviewr
  services:
    logviewr:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:7500"
```

---

## 📂 System Log Access

The **Host System** plugin reads log files owned by `root:adm` (permissions `640`).
The container automatically joins the `adm` group (GID 4) via `group_add` in docker-compose.

### Custom ADM GID

If your system uses a different GID for the `adm` group:

```bash
getent group adm | cut -d: -f3   # check the GID on the host
echo "ADM_GID=your_gid" >> .env
```

### Files with restrictive permissions (600)

Some files (`/var/log/php8.0-fpm.log`, `/var/log/rkhunter.log`) are owned by `root:root 600` and are not readable even with `adm` group membership.

Fix them on the host:

```bash
sudo chgrp adm /var/log/php8.0-fpm.log* && sudo chmod 640 /var/log/php8.0-fpm.log*
```

To make this persist across log rotation, add to `/etc/logrotate.d/php8.0-fpm`:
```
create 640 root adm
```

---

## 📚 Documentation

- **[Parser guides](server/plugins/PARSERS_HELP.md)** - supported formats and regex
- **[NPM Parser Help](server/plugins/npm/NPM_PARSER_HELP.md)** - NPM formats
- **[Nginx Parser Help](server/plugins/nginx/NGINX_PARSER_HELP.md)** - Nginx formats
- **[Host-system integration audit](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md)** - error/warning scan

---

## 🤝 Contribution

Contributions are welcome!

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

---

<div align="center">

**Made with ❤️ for system administrators and developers**

[Issues](https://github.com/Erreur32/LogviewR/issues) | [Discussions](https://github.com/Erreur32/LogviewR/discussions) | [Wiki](https://github.com/Erreur32/LogviewR/wiki)

</div>
