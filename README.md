# LogviewR - Log Viewer Application
> [!IMPORTANT]
>  PRE-RELEASE BETA  


<div align="center">

 


<img src="LogviewR_banner.svg" alt="LogviewR" width="512" height="256" />

![LogviewR](https://img.shields.io/badge/LogviewR-0.6.9-111827?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-DEVELOPMENT-374151?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-1f2937?style=for-the-badge&logo=docker&logoColor=38bdf8)
![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=38bdf8)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-111827?style=for-the-badge&logo=typescript&logoColor=60a5fa)
![License](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge&color=111827&labelColor=111827&logoColor=white)

**Real-time log viewer for Apache, Nginx, NPM, system logs and Fail2ban**

[README en Français](README.fr.md) | [Installation](#-installation) | [Plugins](#-plugins) | [Configuration](#-configuration) | [Documentation](#-documentation)

</div>


---

## 📋 Table of Contents

- [Installation](#-installation)
- [Plugins](#-plugins)
- [Configuration](#-configuration)
- [Documentation](#-documentation)
- [Contribution](#-contribution)
- [License](#-license)

---

## 🎯 About

**LogviewR** — real-time log viewer for Apache, Nginx, NPM, system logs and Fail2ban.

- 🚀 **Real-time** via WebSocket
- 🔍 **Filters**: level, date, IP, HTTP method…
- 📊 **Statistics** and dashboards per plugin
- 🔐 **JWT auth**, role management
- 🐳 **Docker-ready**

---

## 🔌 Plugins

<details>
<summary><strong>🖥️ Host System</strong> — Linux/Unix system logs</summary>

- Syslog, auth, kernel, daemon, mail, custom logs
- Automatic Docker environment detection
- RFC 3164 / RFC 5424 support
- Configurable base path (`/var/log` or `/host/logs` in Docker)

</details>

<details>
<summary><strong>🌐 Apache</strong> — Apache HTTP Server logs</summary>

- Access logs (Combined, Common, VHost) + Error logs
- IP, timestamp, HTTP method, status code, referer, user-agent extraction
- Editable default regex, `.gz` support

</details>

<details>
<summary><strong>🚀 Nginx</strong> — Nginx logs</summary>

- Access logs (Combined, Common, Main, Extended) + Error logs
- Timestamp parsing with timezone handling
- Fail2ban and ELK compatible regex, `.gz` support

</details>

<details>
<summary><strong>🔄 Nginx Proxy Manager (NPM)</strong> — NPM logs</summary>

- 5 supported formats with automatic detection
- Fields: cache, upstream status, gzip ratio, subdomains
- `.gz` support

</details>

<details>
<summary><strong>🛡️ Fail2ban</strong> — jail monitoring and banned IPs</summary>

**Tabs**: Jails · Filters · Actions · IP Tracker · Map · Ban Manager · Stats · IPTables · IPSet · NFTables · Config · Audit

**Requirements:** fail2ban installed and active on the host. Host setup required — see [Installation Step 2](#-installation).

To verify: **Administration → Plugins → Fail2ban → Diagnostic**.

---

**Firewall tabs in Docker (IPTables · IPSet · NFTables)**

These tabs require two **cumulative** conditions — neither alone is sufficient:

| Condition | Role |
|-----------|------|
| `network_mode: host` | Shares host network namespace — container sees host iptables/ipset/nft rules |
| `cap_add: NET_ADMIN` | Linux capability required by the kernel for netfilter read/write |

> ⚠️ **Three incompatibilities to know:**
> - `network_mode: host` is **incompatible with `ports:`** — remove `ports:` and use `PORT=7500` in `environment:` instead
> - `security_opt: no-new-privileges:true` is **incompatible with firewall tabs** — `sudo` cannot elevate with this flag, breaking iptables/ipset/nft commands
> - To change the listen port: set `PORT=8080` in `.env` and point your reverse proxy to `127.0.0.1:8080`

`docker-compose.yml` configuration with Firewall tabs enabled:

```yaml
services:
  logviewr:
    image: ghcr.io/erreur32/logviewr:latest
    container_name: logviewr
    restart: unless-stopped
    # no ports: — incompatible with network_mode: host
    network_mode: host
    cap_add:
      - NET_ADMIN               # required for netfilter (iptables/ipset/nft)
    # no security_opt: no-new-privileges — incompatible with sudo (breaks firewall tabs)
    environment:
      JWT_SECRET: ${JWT_SECRET}
      PORT: ${PORT:-7500}       # direct listen port — change here + update reverse proxy
      HOST_IP: ${HOST_IP:-}
    group_add:
      - "${ADM_GID:-4}"
      - "${FAIL2BAN_GID:-}"
    volumes:
      - ./data:/app/data
      - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock
      - /:/host:ro          # :ro = more secure; disables Fail2ban VACUUM (see note below)
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      # Optional: enable Fail2ban SQLite VACUUM (long-form bind required — short-form does not override :ro)
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

Without these options, IPTables/IPSet/NFTables tabs will show a `Permission denied` or `no new privileges` error.

</details>

---



## 🚀 Installation

**Step 1 — Create `.env`**

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
```

**Step 2 — Fail2ban host setup** *(one-time — required only if using the Fail2ban plugin)*

```bash
curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash
```

> Run this **before** `docker compose up`, directly on the Docker host (not inside the container).
> Creates the `fail2ban` group, installs a systemd drop-in to persist socket permissions across reboots, and sets SQLite read access.
> **One-time only** — survives reboots and fail2ban restarts automatically.
> Re-run only if you reinstall fail2ban on the host.

**Step 3 — Create `docker-compose.yml`**

Download the production file directly:

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Erreur32/LogviewR/main/docker-compose.yml
```

Or copy the standard / firewall mode config from the [Configuration section](#%EF%B8%8F-configuration) below.

**Step 4 — Start**

```bash
docker compose up -d
```

Dashboard available at `http://your-ip:7500`


## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `JWT_SECRET` | Secret used to sign JWT tokens | — | ✅ Yes |
| `DASHBOARD_PORT` | Dashboard port (bridge mode with `ports:`) | `7500` | No |
| `PORT` | Direct listen port (`network_mode: host` mode) | `3000` | No |
| `HOST_IP` | Host machine IP address | Auto-detect | No |
| `CONFIG_FILE_PATH` | Path to external configuration file | `/app/config/logviewr.conf` | No |
| `ADM_GID` | GID of the `adm` group on the host (system logs) | `4` | No |
| `HOST_ROOT_PATH` | Host root path mounted in the container | `/host` | No |

### docker-compose.yml

**Standard mode** (without Firewall tabs):

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
      - "${ADM_GID:-4}"           # adm group — system log read access
    volumes:
      - ./data:/app/data
      - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock
      - /:/host:ro          # :ro = more secure; disables Fail2ban VACUUM (see note below)
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      # Optional: enable Fail2ban SQLite VACUUM (long-form bind required — short-form does not override :ro)
      - type: bind
        source: /var/lib/fail2ban
        target: /host/var/lib/fail2ban
        bind:
          propagation: shared

    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

**Firewall mode** (IPTables · IPSet · NFTables tabs enabled) — replace `ports:` with `network_mode: host`:

```yaml
services:
  logviewr:
    image: ghcr.io/erreur32/logviewr:latest
    container_name: logviewr
    restart: unless-stopped
    # ⚠️ no ports: — incompatible with network_mode: host
    network_mode: host
    cap_add:
      - NET_ADMIN
    environment:
      JWT_SECRET: ${JWT_SECRET}
      PORT: 7500                  # direct listen port (replaces ports: mapping)
      HOST_IP: ${HOST_IP:-}
    group_add:
      - "${ADM_GID:-4}"
    volumes:
      - ./data:/app/data
      - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock
      - /:/host:ro          # :ro = more secure; disables Fail2ban VACUUM (see note below)
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      # Optional: enable Fail2ban SQLite VACUUM (long-form bind required — short-form does not override :ro)
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

> **Fail2ban SQLite VACUUM**: The `:ro` flag prevents the container from writing to the host filesystem — recommended for security.
> However, it disables the **SQLite defragmentation (VACUUM)** feature in the Fail2ban Config tab.
> To enable VACUUM, uncomment the `type: bind` block above (`source: /var/lib/fail2ban`).
> A simple short-form mount (`- /var/lib/fail2ban:/host/var/lib/fail2ban`) does **not** work — Docker cannot override a `:ro` parent mount with a short-form rw entry.
> The long-form syntax with `propagation: shared` is required. It takes precedence over `/:/host:ro` for that path only.

**Changing the port**: only modify `PORT: 7500` → `PORT: 8080` (or any other), then point your reverse proxy to that port.

**Reverse proxy** (Nginx Proxy Manager, Caddy, Traefik…) with `network_mode: host`:

The container listens directly on the host — the reverse proxy connects via `127.0.0.1`:

```
# Nginx Proxy Manager
Forward Hostname : 127.0.0.1
Forward Port     : 7500        ← must match PORT=

# Manual Nginx
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

> The complete file with all comments is in [`docker-compose.yml`](docker-compose.yml) at the project root.

### System Log Access

The **Host System** plugin requires access to files owned by `root:adm` (permissions `640`).
The container automatically adds `node` to the `adm` group (GID 4).

If your system uses a different GID:
```bash
getent group adm | cut -d: -f3   # check the GID on the host
echo "ADM_GID=your_gid" >> .env
```

<details>
<summary>Files with restrictive permissions (600)</summary>

Some files (`/var/log/php8.0-fpm.log`, `/var/log/rkhunter.log`) are owned by `root:root 600`.
Solution:
```bash
sudo chgrp adm /var/log/php8.0-fpm.log* && sudo chmod 640 /var/log/php8.0-fpm.log*
```

</details>

---

## 📚 Documentation

- **[Parser guides](server/plugins/PARSERS_HELP.md)** — supported formats and regex
- **[NPM Parser Help](server/plugins/npm/NPM_PARSER_HELP.md)** — NPM formats
- **[Nginx Parser Help](server/plugins/nginx/NGINX_PARSER_HELP.md)** — Nginx formats
- **[Host-system integration audit](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md)** — error/warning scan

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
