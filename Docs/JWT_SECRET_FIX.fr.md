# Correction des erreurs 401 (Unauthorized)

> 🇬🇧 [Read in English](./JWT_SECRET_FIX.md)

## 🐛 Problème

Erreurs 401 sur toutes les requêtes API :
```
GET http://192.168.1.150:7500/api/plugins 401 (Unauthorized)
GET http://192.168.1.150:7500/api/log-viewer/plugins/apache/detected-files 401 (Unauthorized)
POST http://192.168.1.150:7500/api/plugins/apache/test 401 (Unauthorized)
```

## 🔍 Cause

Le `JWT_SECRET` n'est pas défini dans le conteneur Docker. Le code génère alors un secret aléatoire à chaque redémarrage :

```typescript
// Si JWT_SECRET n'est pas défini, génère un secret aléatoire
const generatedSecret = crypto.randomBytes(48).toString('base64');
this.jwtSecret = generatedSecret;
```

**Conséquence** :
- Les tokens JWT créés avec l'ancien secret ne sont plus valides
- L'utilisateur doit se reconnecter à chaque redémarrage
- Erreurs 401 sur toutes les requêtes API

## ✅ Solution

### 1. Créer le fichier `.env`

```bash
# Générer un secret JWT sécurisé
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET" > .env
echo "DASHBOARD_PORT=7500" >> .env
```

### 2. Redémarrer le conteneur

```bash
docker-compose down
docker-compose up -d
```

### 3. Se reconnecter

Une fois le conteneur redémarré avec un `JWT_SECRET` fixe :
1. Ouvrez l'application dans le navigateur
2. Le modal de connexion devrait s'afficher automatiquement
3. Connectez-vous avec vos identifiants
4. Le nouveau token sera créé avec le secret fixe

## 🔐 Vérification

Pour vérifier que `JWT_SECRET` est bien défini :

```bash
# Vérifier dans le conteneur
docker exec logviewr env | grep JWT_SECRET

# Devrait afficher :
# JWT_SECRET=votre_secret_genere (pas vide)
```

## ⚠️ Important

- **Ne jamais commit le fichier `.env`** (déjà dans `.gitignore`)
- **Utiliser un secret différent pour chaque environnement** (dev, staging, prod)
- **Ne jamais utiliser les valeurs par défaut en production**

## 📝 Note

Le fichier `.env` doit être créé dans le même répertoire que `docker-compose.yml` pour que Docker Compose le charge automatiquement.
