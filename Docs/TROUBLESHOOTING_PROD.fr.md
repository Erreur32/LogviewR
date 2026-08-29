# Dépannage Production Docker

> 🇬🇧 [Read in English](./TROUBLESHOOTING_PROD.md)

## 🔴 Problème 1 : WebSocket "Invalid frame header"

### Symptôme
```
WebSocket connection to 'wss://mwk.myoueb.fr/ws/connection' failed: Invalid frame header
[WS Client] Disconnected: 1006
```

### Cause
Nginx n'est pas configuré pour gérer l'upgrade WebSocket.

### Solution
Voir le guide complet : `Docs/NGINX_WEBSOCKET_CONFIG.fr.md`

**Configuration nginx minimale :**
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

**Après modification :**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔴 Problème 2 : UniFi ne fonctionne pas en production

### Diagnostic

**1. Vérifier les logs du serveur :**
```bash
docker logs viewerlog | grep -i unifi
```

**2. Vérifier la connectivité réseau depuis le conteneur :**
```bash
docker exec viewerlog wget -O- https://votre-controller-unifi:8443
# ou
docker exec viewerlog curl -k https://votre-controller-unifi:8443
```

**3. Vérifier la configuration UniFi :**
- URL du controller (doit être accessible depuis le conteneur)
- Identifiants (username/password)
- Site name

### Causes possibles

#### 1. Problème de réseau Docker
Le conteneur ne peut pas accéder au controller UniFi.

**Solution :** Vérifier que le controller UniFi est accessible depuis l'hôte :
```bash
# Depuis l'hôte
curl -k https://votre-controller-unifi:8443
```

Si ça fonctionne depuis l'hôte mais pas depuis le conteneur, c'est un problème de réseau Docker.

#### 2. Problème SSL/TLS
Erreur SSL dans les logs.

**Solution :** Essayer avec `http://` au lieu de `https://` si le controller le permet.

#### 3. Configuration différente entre dev et prod
Les configurations sont dans `./data/dashboard.db` qui est monté différemment.

**Vérifier :**
```bash
# Vérifier que la config UniFi est bien dans la DB prod
docker exec viewerlog ls -la /app/data/
```

#### 4. Controller UniFi derrière un firewall
Le controller bloque les connexions depuis le conteneur Docker.

**Solution :** Autoriser l'IP de l'hôte Docker dans le firewall du controller.

### Commandes de diagnostic

```bash
# 1. Logs UniFi
docker logs viewerlog 2>&1 | grep -i unifi

# 2. Test de connexion depuis le conteneur
docker exec viewerlog wget --no-check-certificate -O- https://votre-controller:8443

# 3. Vérifier la configuration dans la DB
docker exec viewerlog cat /app/data/dashboard.db | strings | grep -i unifi

# 4. Vérifier les variables d'environnement
docker exec viewerlog env | grep -i unifi
```

---

## 🔍 Différences Dev vs Prod

| Aspect | Docker Dev | Docker Prod |
|--------|------------|-------------|
| **Réseau** | Accès direct au réseau hôte | Réseau bridge Docker (peut être isolé) |
| **Volumes** | `./data` (montage local) | `./data` (montage local) |
| **Code source** | Monté en volume (hot reload) | Copié dans l'image |
| **Node modules** | Préservé dans le conteneur | Installé dans l'image |

### Impact sur UniFi

En **Docker prod**, le conteneur peut être sur un réseau Docker isolé qui ne peut pas accéder au controller UniFi local.

**Solution :** Utiliser `network_mode: host` dans `docker-compose.yml` (si le controller est sur le même réseau) :

```yaml
services:
  viewerlog:
    # ...
    network_mode: host  # Accès direct au réseau hôte
```

**⚠️ Attention :** Avec `network_mode: host`, le mapping de ports est ignoré. L'application écoutera directement sur le port 3000 de l'hôte.

---

## ✅ Checklist de vérification

- [ ] Nginx configuré pour WebSocket (voir `Docs/NGINX_WEBSOCKET_CONFIG.fr.md`)
- [ ] Logs UniFi vérifiés : `docker logs viewerlog | grep -i unifi`
- [ ] Controller UniFi accessible depuis l'hôte
- [ ] Controller UniFi accessible depuis le conteneur : `docker exec viewerlog wget ...`
- [ ] Configuration UniFi correcte dans l'interface admin
- [ ] Test de connexion UniFi effectué depuis l'interface

