# Local Docker Test Guide (Production Simulation)

> 🇫🇷 [Lire en français](./TEST_LOCAL_DOCKER.fr.md)

This guide explains how to test the Docker configuration locally to simulate the production environment before deploying.

## 🎯 Goal

Verify that:
- Host logs are accessible from the container
- Docker paths are correctly converted
- Plugins can read log files
- The configuration matches production

## 📋 Prerequisites

1. Docker and Docker Compose installed
2. Read access to `/var/log` on the host
3. The project cloned locally

## 🚀 Test steps

### 1. Prepare the environment

```bash
# Go to the project directory
cd /path/to/LogviewR

# Create the .env file if needed
if [ ! -f .env ]; then
    echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
    echo "DASHBOARD_PORT=7501" >> .env
    echo "HOST_ROOT_PATH=/host" >> .env
fi
```

### 2. Build and start the local container

```bash
# Build the image locally
docker-compose -f docker-compose.local.yml build

# Start the container
docker-compose -f docker-compose.local.yml up -d

# Check that the container is running
docker ps | grep logviewr-local
```

### 3. Run the log access tests

```bash
# Run the test script
./scripts/test-local-docker.sh
```

This script checks:
- ✅ Access to `/host/var/log`
- ✅ Existence of the `/host/logs` symlink (optional)
- ✅ Reading common log files
- ✅ Access to Apache/Nginx logs
- ✅ Environment variables
- ✅ Docker path conversion

### 4. Additional manual tests

#### Check log access from the container

```bash
# List files in /host/var/log
docker exec logviewr-local ls -la /host/var/log

# Check the symlink (if it exists)
docker exec logviewr-local ls -la /host/logs

# Test reading a log file
docker exec logviewr-local head -n 5 /host/var/log/syslog

# Check Apache logs (if present)
docker exec logviewr-local ls -la /host/var/log/apache2
```

#### Test path conversion

```bash
# Test path conversion in Node.js
docker exec logviewr-local node -e "
const fs = require('fs');
const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';

function isDocker() {
    try { fs.accessSync('/.dockerenv'); return true; } catch { return false; }
}

function convertToDockerPath(filePath) {
    if (!isDocker()) return filePath;
    const DOCKER_LOG_PATH = '/host/logs';
    const STANDARD_LOG_PATH = '/var/log';
    if (filePath.startsWith(STANDARD_LOG_PATH)) {
        if (fs.existsSync(DOCKER_LOG_PATH)) {
            return filePath.replace(STANDARD_LOG_PATH, DOCKER_LOG_PATH);
        } else {
            return filePath.replace(STANDARD_LOG_PATH, \`\${HOST_ROOT_PATH}/var/log\`);
        }
    }
    return filePath;
}

const testPaths = ['/var/log', '/var/log/apache2', '/var/log/syslog'];
testPaths.forEach(p => {
    const converted = convertToDockerPath(p);
    const exists = fs.existsSync(converted);
    console.log(\`\${p} -> \${converted} (\${exists ? 'OK' : 'MISSING'})\`);
});
"
```

#### Check the container logs

```bash
# View the container logs
docker logs logviewr-local

# Follow the logs in real time
docker logs -f logviewr-local
```

### 5. Test the web application

```bash
# Open the application in your browser
# URL: http://localhost:7501 (or the port configured in DASHBOARD_PORT)

# Test the host-system plugin connection
# 1. Go to "Plugins" > "Host System"
# 2. Click "Options"
# 3. Check that the base path is detected
# 4. Click "Test connection"
# 5. Check there's no "Connection failed" error
```

### 6. Check the Docker Compose configuration

Compare `docker-compose.local.yml` with `docker-compose.yml` to make sure that:
- The volumes are identical (except the data volume name)
- The environment variables are consistent
- The ports differ (7501 for local, 7500 for prod)

## 🔍 Troubleshooting

### Issue: "Connection failed" in plugin options

**Possible causes:**
1. The container doesn't have access to `/host/var/log`
2. Permissions are incorrect
3. The `/host/logs` symlink doesn't exist and the fallback isn't working

**Solutions:**

```bash
# Check that /host/var/log is accessible
docker exec logviewr-local test -d /host/var/log && echo "OK" || echo "FAIL"

# Check permissions
docker exec logviewr-local ls -ld /host/var/log

# Manually create the symlink if needed (as root)
docker exec -u root logviewr-local ln -s /host/var/log /host/logs

# Check that the code uses the right path
docker exec logviewr-local node -e "
const fs = require('fs');
const paths = ['/host/logs', '/host/var/log'];
paths.forEach(p => console.log(p + ':', fs.existsSync(p) ? 'exists' : 'missing'));
"
```

### Issue: Logs don't display

**Checks:**

```bash
# Check that the log files exist
docker exec logviewr-local ls -la /host/var/log/syslog
docker exec logviewr-local ls -la /host/var/log/auth.log

# Check that the plugin can read them
docker exec logviewr-local node -e "
const fs = require('fs');
try {
    const content = fs.readFileSync('/host/var/log/syslog', 'utf8');
    console.log('OK: Can read syslog, first 100 chars:', content.substring(0, 100));
} catch (e) {
    console.log('ERROR:', e.message);
}
"
```

### Issue: The `/host/logs` symlink isn't created

**Cause:** The `/host` filesystem is read-only, so the symlink can't be created.

**Solution:** This is expected! The code automatically falls back to `/host/var/log`. Check that the fallback works:

```bash
# Check that the code correctly detects the path
docker exec logviewr-local node -e "
const fs = require('fs');
const HOST_ROOT_PATH = '/host';
const DOCKER_LOG_PATH = '/host/logs';
const directPath = \`\${HOST_ROOT_PATH}/var/log\`;

if (fs.existsSync(DOCKER_LOG_PATH)) {
    console.log('Using symlink:', DOCKER_LOG_PATH);
} else if (fs.existsSync(directPath)) {
    console.log('Using direct path (fallback):', directPath);
} else {
    console.log('ERROR: No log path available');
}
"
```

## ✅ Validation checklist

Before deploying to production, check:

- [ ] The container starts without errors
- [ ] `/host/var/log` is accessible from the container
- [ ] Log files can be read (syslog, auth.log, etc.)
- [ ] The host-system plugin can connect (test in the UI)
- [ ] Apache/Nginx logs are accessible (if present)
- [ ] Environment variables are correct (JWT_SECRET, HOST_ROOT_PATH)
- [ ] The test script passes all tests
- [ ] The web application works correctly
- [ ] No errors in the container logs

## 📝 Important notes

1. **Optional symlink**: The `/host/logs` symlink is created by `docker-entrypoint.sh`, but if it fails (read-only filesystem), the code automatically falls back to `/host/var/log`.

2. **Different port**: The local port (7501) differs from the production port (7500) to avoid conflicts.

3. **Environment variables**: Make sure `JWT_SECRET` is set in the `.env` file to avoid 401 errors.

4. **Permissions**: The container runs as the `node` user (non-root), so it can only read log files, not modify them.

## 🔗 Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker Configuration Guide](./DOCKER_MOUNT_FIX.md)
- [Log Access Guide](./HOW_LOGS_ACCESS_WORKS.md)
