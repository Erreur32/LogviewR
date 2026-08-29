# Environment Variables - Complete Guide

> 🇫🇷 [Lire en français](./VARIABLES_ENVIRONNEMENT.fr.md)

**Date**: $(date)
**Goal**: Explain where environment variables come from depending on the run mode

---

## 🔍 Where do the `${DASHBOARD_PORT:-3000}` values in Docker Compose come from?

### Priority order (Docker Compose)

Docker Compose reads environment variables in this order (highest to lowest priority):

1. **Shell environment variables** (exported before the command)
   ```bash
   export DASHBOARD_PORT=4000
   docker-compose -f docker-compose.dev.yml up
   ```

2. **`.env` file** (at the project root, next to `docker-compose.yml`)
   ```bash
   # .env file
   DASHBOARD_PORT=4000
   SERVER_PORT=3004
   ```
   Docker Compose automatically reads this file if it exists.

3. **`--env-file` flag** (custom file)
   ```bash
   docker-compose -f docker-compose.dev.yml --env-file .env.local up
   ```

4. **Default values** in `docker-compose.yml` (`${VAR:-default}` syntax)
   ```yaml
   ports:
     - "${DASHBOARD_PORT:-3000}:${DASHBOARD_PORT:-3000}"
   ```
   If `DASHBOARD_PORT` isn't set, `3000` is used by default.

---

## 📋 Run modes

### Mode 1: `npm run dev` (Local development - WITHOUT Docker)

**Command**:
```bash
npm run dev
```

**What happens**:
- Runs `concurrently "npm run dev:server" "npm run dev:client"`
- **Backend**: `npm run dev:server` → `tsx watch server/index.ts`
- **Frontend**: `npm run dev:client` → `vite`

**Environment variables**:
- ✅ Automatically reads the `.env` file (via `dotenv/config` in `server/index.ts`)
- ✅ Shell variables (`export PORT=3003`)
- ✅ Default values in the code

**Configuration used**:
- ❌ **Does NOT use** `docker-compose.dev.yml`
- ✅ Uses the configuration files directly:
  - `vite.config.ts` for the frontend
  - `server/config.ts` for the backend
  - System environment variables

**Default ports**:
- Frontend (Vite): `5173` (set in `vite.config.ts`)
- Backend: `3003` (set in `server/config.ts`)

**Example configuration**:
```bash
# .env file (at the root)
PORT=3003
SERVER_PORT=3003
VITE_PORT=5173
JWT_SECRET=dev_secret
```

---

### Mode 2: `docker-compose -f docker-compose.dev.yml` (Docker development)

**Command**:
```bash
docker-compose -f docker-compose.dev.yml up --build
```

**What happens**:
- Runs a Docker container with hot reload
- Mounts the source code into the container
- Runs `npm run dev` **inside the container**

**Environment variables**:
- ✅ Variables defined in `docker-compose.dev.yml` (`environment:` section)
- ✅ Shell variables (exported before the command)
- ✅ `.env` file (if present at the root)
- ✅ `--env-file` flag (if used)

**Configuration used**:
- ✅ **Uses** `docker-compose.dev.yml`
- ✅ Variables are passed to the container via the `environment:` section
- ✅ The code inside the container also reads `.env` (if mounted)

**Default ports**:
- Frontend (Vite): `3000` (mapped from the container)
- Backend: `3003` (mapped from the container)

**Example configuration**:
```bash
# .env file (optional, for overrides)
DASHBOARD_PORT=3000
SERVER_PORT=3003
JWT_SECRET=dev_secret
```

---

## 🔄 Mode comparison

| Aspect | `npm run dev` | `docker-compose -f docker-compose.dev.yml` |
|--------|---------------|--------------------------------------------|
| **Environment** | Host machine (direct Node.js) | Docker container |
| **Configuration** | `vite.config.ts` + `server/config.ts` | `docker-compose.dev.yml` + configs |
| **Variables** | `.env` + shell + defaults | `.env` + shell + `docker-compose.dev.yml` |
| **Frontend port** | `5173` (Vite default) | `3000` (set in docker-compose) |
| **Backend port** | `3003` (config.ts default) | `3003` (set in docker-compose) |
| **Hot Reload** | ✅ Yes | ✅ Yes (via volume mount) |
| **Isolation** | ❌ No (uses local node_modules) | ✅ Yes (isolated container) |

---

## 📝 Configuration files

### 1. `.env` (Optional - at the root)

This file is read by:
- ✅ Docker Compose (automatically)
- ✅ `npm run dev` (via `dotenv/config` in `server/index.ts`)
- ✅ Vite (if configured, but not by default)

**Example**:
```bash
# .env
PORT=3003
SERVER_PORT=3003
VITE_PORT=5173
DASHBOARD_PORT=3000
JWT_SECRET=dev_secret_change_me
FREEBOX_HOST=mafreebox.freebox.fr
```

### 2. `docker-compose.dev.yml`

Defines variables for the Docker container:
```yaml
environment:
  - PORT=${SERVER_PORT:-3003}
  - SERVER_PORT=${SERVER_PORT:-3003}
  - VITE_PORT=${DASHBOARD_PORT:-3000}
```

### 3. `vite.config.ts`

Vite (frontend) configuration:
```typescript
port: parseInt(process.env.VITE_PORT || '5173', 10),
proxy: {
  '/api': {
    target: `http://localhost:${process.env.SERVER_PORT || process.env.PORT || '3003'}`,
  }
}
```

### 4. `server/config.ts`

Backend configuration:
```typescript
port: parseInt(
  process.env.PORT || 
  process.env.SERVER_PORT || 
  (process.env.NODE_ENV === 'production' ? '3000' : '3003'), 
  10
),
```

---

## 🎯 Answers to common questions

### Question 1: Where does `${DASHBOARD_PORT:-3000}` come from?

**Answer**: Docker Compose looks for the variable in this order:
1. Shell environment variable: `export DASHBOARD_PORT=4000`
2. `.env` file at the root: `DASHBOARD_PORT=4000`
3. `--env-file` flag: `docker-compose --env-file .env.local`
4. Default value: `3000` (in `${DASHBOARD_PORT:-3000}`)

**The `.env` file isn't required**, but if it exists, Docker Compose reads it automatically.

### Question 2: Does `npm run dev` use `docker-compose.dev.yml`?

**Answer**: **NO** ❌

- `npm run dev`: Runs Node.js/Vite directly on the host machine, **without Docker**
- `docker-compose -f docker-compose.dev.yml`: Runs inside a Docker container

**These are two different modes**:
- **Local mode** (`npm run dev`): Faster, uses local node_modules
- **Docker mode** (`docker-compose.dev.yml`): More isolated, reproduces the production environment

---

## 🔧 Practical examples

### Example 1: Local development (`npm run dev`)

```bash
# 1. Create a .env file (optional)
cat > .env << EOF
PORT=3003
SERVER_PORT=3003
VITE_PORT=5173
JWT_SECRET=dev_secret
EOF

# 2. Run in local dev mode
npm run dev

# Frontend: http://localhost:5173
# Backend: http://localhost:3003
```

### Example 2: Docker development (`docker-compose.dev.yml`)

```bash
# 1. Create a .env file (optional)
cat > .env << EOF
DASHBOARD_PORT=3000
SERVER_PORT=3003
JWT_SECRET=dev_secret
EOF

# 2. Run with Docker
docker-compose -f docker-compose.dev.yml up --build

# Frontend: http://localhost:3000
# Backend: http://localhost:3003
```

### Example 3: Override with shell variables

```bash
# Override ports via shell variables
DASHBOARD_PORT=4000 SERVER_PORT=3004 docker-compose -f docker-compose.dev.yml up

# Frontend: http://localhost:4000
# Backend: http://localhost:3004
```

---

## ⚠️ Points of attention

1. **`.env` file**:
   - ✅ Automatically read by Docker Compose
   - ✅ Automatically read by `npm run dev` (via dotenv)
   - ⚠️ Must **NEVER** be committed to Git (added to `.gitignore`)

2. **Variables in `docker-compose.dev.yml`**:
   - Variables in the `environment:` section are passed **to the container**
   - The container can also read a `.env` file mounted as a volume

3. **Priority order**:
   - Shell variables > `.env` > default values
   - In `docker-compose.yml`, `environment:` variables take priority over shell ones

---

## 📚 References

- [Docker Compose - Environment Variables](https://docs.docker.com/compose/environment-variables/)
- [dotenv - npm](https://www.npmjs.com/package/dotenv)
- [Vite - Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

---

**Document automatically generated to clarify environment variable handling**
