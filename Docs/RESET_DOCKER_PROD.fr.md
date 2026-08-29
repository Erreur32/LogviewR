# Réinitialisation complète Docker Production

> 🇬🇧 [Read in English](./RESET_DOCKER_PROD.md)

## 🔄 Procédure pour repartir à zéro

### 1. Arrêter et supprimer le conteneur

```bash
docker compose down
```

### 2. Supprimer le volume (efface toutes les données)

⚠️ **ATTENTION** : Cette commande supprime **TOUTES** les données :
- Base de données SQLite (`dashboard.db`)
- Token Freebox (`freebox_token.json`)
- Toutes les configurations sauvegardées

```bash
docker compose down -v
```

Ou pour supprimer uniquement le volume spécifique :

```bash
docker volume rm viewerlog_data
```

### 3. Récupérer la dernière image depuis le registry

```bash
docker compose pull
```

### 4. Vérifier la configuration

Assurez-vous d'avoir un fichier `.env` (optionnel mais recommandé) :

```bash
# Créer un fichier .env avec vos variables
cat > .env << EOF
DASHBOARD_PORT=7505
FREEBOX_HOST=mafreebox.freebox.fr
JWT_SECRET=$(openssl rand -base64 32)
EOF
```

**Important** : Générer un nouveau `JWT_SECRET` sécurisé pour la production !

### 5. Relancer Docker

```bash
docker compose up -d
```

### 6. Vérifier les logs

```bash
docker logs -f viewerlog
```

---

## 📋 Commandes complètes (copier-coller)

```bash
# 1. Arrêter et supprimer tout
docker compose down -v

# 2. Récupérer la dernière image
docker compose pull

# 3. (Optionnel) Créer/éditer le fichier .env
nano .env  # ou votre éditeur préféré

# 4. Relancer
docker compose up -d

# 5. Voir les logs
docker logs -f viewerlog
```

---

## 🔍 Vérifications après redémarrage

### Vérifier que le conteneur tourne

```bash
docker ps | grep viewerlog
```

### Vérifier les volumes

```bash
docker volume ls | grep viewerlog
```

### Vérifier l'accès au dashboard

```bash
curl http://localhost:7505/api/health
```

---

## ⚠️ Notes importantes

1. **JWT_SECRET** : Après réinitialisation, tous les utilisateurs devront se reconnecter (les tokens JWT précédents seront invalides)

2. **Token Freebox** : Vous devrez reconfigurer l'authentification Freebox (créer un nouvel app_token)

3. **Base de données** : Toutes les données (utilisateurs, plugins, configurations) seront perdues

4. **Backup** : Si vous voulez sauvegarder avant de tout effacer :
   ```bash
   # Sauvegarder le volume
   docker run --rm -v viewerlog_data:/data -v $(pwd):/backup alpine tar czf /backup/viewerlog_backup_$(date +%Y%m%d_%H%M%S).tar.gz /data
   ```

