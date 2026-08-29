# Full Docker Production Reset

> 🇫🇷 [Lire en français](./RESET_DOCKER_PROD.fr.md)

## 🔄 Procedure to start from scratch

### 1. Stop and remove the container

```bash
docker compose down
```

### 2. Remove the volume (erases all data)

⚠️ **WARNING**: This command deletes **ALL** data:
- SQLite database (`dashboard.db`)
- Freebox token (`freebox_token.json`)
- All saved configuration

```bash
docker compose down -v
```

Or to remove only the specific volume:

```bash
docker volume rm viewerlog_data
```

### 3. Pull the latest image from the registry

```bash
docker compose pull
```

### 4. Check the configuration

Make sure you have a `.env` file (optional but recommended):

```bash
# Create a .env file with your variables
cat > .env << EOF
DASHBOARD_PORT=7505
FREEBOX_HOST=mafreebox.freebox.fr
JWT_SECRET=$(openssl rand -base64 32)
EOF
```

**Important**: Generate a new secure `JWT_SECRET` for production!

### 5. Restart Docker

```bash
docker compose up -d
```

### 6. Check the logs

```bash
docker logs -f viewerlog
```

---

## 📋 Full commands (copy-paste)

```bash
# 1. Stop and remove everything
docker compose down -v

# 2. Pull the latest image
docker compose pull

# 3. (Optional) Create/edit the .env file
nano .env  # or your preferred editor

# 4. Restart
docker compose up -d

# 5. Watch the logs
docker logs -f viewerlog
```

---

## 🔍 Post-restart checks

### Check that the container is running

```bash
docker ps | grep viewerlog
```

### Check the volumes

```bash
docker volume ls | grep viewerlog
```

### Check dashboard access

```bash
curl http://localhost:7505/api/health
```

---

## ⚠️ Important notes

1. **JWT_SECRET**: After a reset, all users will need to log in again (previous JWT tokens will be invalid)

2. **Freebox token**: You'll need to reconfigure Freebox authentication (create a new app_token)

3. **Database**: All data (users, plugins, configuration) will be lost

4. **Backup**: If you want to back up before wiping everything:
   ```bash
   # Back up the volume
   docker run --rm -v viewerlog_data:/data -v $(pwd):/backup alpine tar czf /backup/viewerlog_backup_$(date +%Y%m%d_%H%M%S).tar.gz /data
   ```
