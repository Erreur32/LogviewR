# Nginx Configuration for WebSocket

> 🇫🇷 [Lire en français](./NGINX_WEBSOCKET_CONFIG.fr.md)

## 🐛 Problem

WebSocket connections fail behind an nginx reverse proxy with an "Invalid frame header" error, because nginx doesn't forward the `Upgrade` and `Connection` headers required for the WebSocket handshake by default.

## ✅ Solution

### 1. Main `location /` block

```nginx
location / {
    proxy_pass http://127.0.0.1:7500;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 2. Dedicated `location /ws/` block (required)

```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:7500;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
```

**Key headers**:
- `proxy_set_header Upgrade $http_upgrade;` — forwards the `Upgrade` header requesting the protocol switch
- `proxy_set_header Connection "upgrade";` — forwards the `Connection: upgrade` header
- `proxy_read_timeout 86400;` — keeps the WebSocket connection open (24h)

## 📋 Full example — `mwk.myoueb.fr`

```nginx
server {
    listen 443 ssl http2;
    server_name mwk.myoueb.fr;

    ssl_certificate /etc/letsencrypt/live/mwk.myoueb.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mwk.myoueb.fr/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:7500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    listen 80;
    if ($scheme = http) {
        return 301 https://$host$request_uri;
    }
}
```

## 🔍 Verification

### 1. Test the nginx configuration

```bash
nginx -t
```

### 2. Reload nginx

```bash
systemctl reload nginx
# or
service nginx reload
```

### 3. Check that the WebSocket connects

Open the browser console (F12) and check for:
```
WebSocket connection to 'wss://mwk.myoueb.fr/ws/...' — should show "open", not "Invalid frame header"
```

### 4. Check nginx logs

```bash
tail -f /var/log/nginx/error.log
```

## ⚠️ Important notes

1. **`proxy_http_version 1.1` is required** — WebSocket requires HTTP/1.1 (not 1.0)
2. **A dedicated `location /ws/` block is required** — headers can't be conditionally applied within a single `location /` block
3. **`proxy_read_timeout`** — adjust based on how long you want idle WebSocket connections to be kept alive
4. If using **Cloudflare** or another CDN in front of nginx, make sure WebSocket support is enabled there too
