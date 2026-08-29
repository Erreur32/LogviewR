# Docker Production Troubleshooting

> 🇫🇷 [Lire en français](./TROUBLESHOOTING_PROD.fr.md)

## 🔴 Issue 1: WebSocket "Invalid frame header"

### Symptom
```
WebSocket connection to 'wss://mwk.myoueb.fr/ws/connection' failed: Invalid frame header
[WS Client] Disconnected: 1006
```

### Cause
Nginx isn't configured to handle the WebSocket upgrade.

### Solution
See the full guide: `Docs/NGINX_WEBSOCKET_CONFIG.md`

**Minimal nginx configuration:**
```nginx
location /ws/ {
    proxy_pass http://localhost:7505;
    proxy_http_version 1.1;
    
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
```

**After the change:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔴 Issue 2: UniFi doesn't work in production

### Diagnosis

**1. Check the server logs:**
```bash
docker logs viewerlog | grep -i unifi
```

**2. Check network connectivity from the container:**
```bash
docker exec viewerlog wget -O- https://your-unifi-controller:8443
# or
docker exec viewerlog curl -k https://your-unifi-controller:8443
```

**3. Check the UniFi configuration:**
- Controller URL (must be reachable from the container)
- Credentials (username/password)
- Site name

### Possible causes

#### 1. Docker network issue
The container can't reach the UniFi controller.

**Solution:** Check that the UniFi controller is reachable from the host:
```bash
# From the host
curl -k https://your-unifi-controller:8443
```

If it works from the host but not from the container, it's a Docker networking issue.

#### 2. SSL/TLS issue
SSL error in the logs.

**Solution:** Try `http://` instead of `https://` if the controller allows it.

#### 3. Different configuration between dev and prod
The configurations live in `./data/dashboard.db`, which is mounted differently.

**Check:**
```bash
# Check that the UniFi config is present in the prod DB
docker exec viewerlog ls -la /app/data/
```

#### 4. UniFi controller behind a firewall
The controller blocks connections from the Docker container.

**Solution:** Allow the Docker host's IP through the controller's firewall.

### Diagnostic commands

```bash
# 1. UniFi logs
docker logs viewerlog 2>&1 | grep -i unifi

# 2. Connection test from the container
docker exec viewerlog wget --no-check-certificate -O- https://your-controller:8443

# 3. Check the configuration in the DB
docker exec viewerlog cat /app/data/dashboard.db | strings | grep -i unifi

# 4. Check environment variables
docker exec viewerlog env | grep -i unifi
```

---

## 🔍 Dev vs Prod differences

| Aspect | Docker Dev | Docker Prod |
|--------|------------|-------------|
| **Network** | Direct access to the host network | Docker bridge network (may be isolated) |
| **Volumes** | `./data` (local mount) | `./data` (local mount) |
| **Source code** | Mounted as a volume (hot reload) | Copied into the image |
| **Node modules** | Preserved in the container | Installed in the image |

### Impact on UniFi

In **Docker prod**, the container may sit on an isolated Docker network that can't reach the local UniFi controller.

**Solution:** Use `network_mode: host` in `docker-compose.yml` (if the controller is on the same network):

```yaml
services:
  viewerlog:
    # ...
    network_mode: host  # Direct access to the host network
```

**⚠️ Warning:** With `network_mode: host`, port mapping is ignored. The application will listen directly on the host's port 3000.

---

## ✅ Verification checklist

- [ ] Nginx configured for WebSocket (see `Docs/NGINX_WEBSOCKET_CONFIG.md`)
- [ ] UniFi logs checked: `docker logs viewerlog | grep -i unifi`
- [ ] UniFi controller reachable from the host
- [ ] UniFi controller reachable from the container: `docker exec viewerlog wget ...`
- [ ] UniFi configuration correct in the admin interface
- [ ] UniFi connection test performed from the interface
