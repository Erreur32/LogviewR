# Fixing 401 (Unauthorized) Errors

> 🇫🇷 [Lire en français](./JWT_SECRET_FIX.fr.md)

## 🐛 Problem

401 errors on all API requests:
```
GET http://192.168.1.150:7500/api/plugins 401 (Unauthorized)
GET http://192.168.1.150:7500/api/log-viewer/plugins/apache/detected-files 401 (Unauthorized)
POST http://192.168.1.150:7500/api/plugins/apache/test 401 (Unauthorized)
```

## 🔍 Cause

`JWT_SECRET` isn't set in the Docker container. The code then generates a random secret on every restart:

```typescript
// If JWT_SECRET isn't set, generate a random secret
const generatedSecret = crypto.randomBytes(48).toString('base64');
this.jwtSecret = generatedSecret;
```

**Consequence**:
- JWT tokens created with the previous secret are no longer valid
- The user has to log in again after every restart
- 401 errors on all API requests

## ✅ Solution

### 1. Create the `.env` file

```bash
# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET" > .env
echo "DASHBOARD_PORT=7500" >> .env
```

### 2. Restart the container

```bash
docker-compose down
docker-compose up -d
```

### 3. Log in again

Once the container has restarted with a fixed `JWT_SECRET`:
1. Open the app in your browser
2. The login modal should appear automatically
3. Log in with your credentials
4. The new token will be created with the fixed secret

## 🔐 Verification

To verify that `JWT_SECRET` is properly set:

```bash
# Check inside the container
docker exec logviewr env | grep JWT_SECRET

# Should show:
# JWT_SECRET=your_generated_secret (not empty)
```

## ⚠️ Important

- **Never commit the `.env` file** (already in `.gitignore`)
- **Use a different secret for each environment** (dev, staging, prod)
- **Never use default values in production**

## 📝 Note

The `.env` file must be created in the same directory as `docker-compose.yml` so Docker Compose loads it automatically.
