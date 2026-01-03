#!/bin/bash
# Script to test Docker setup locally (simulating production)
# This helps verify Docker configuration before deploying

set -e

CONTAINER_NAME="logviewr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "Testing Docker Setup Locally"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}❌ Container ${CONTAINER_NAME} is not running${NC}"
    echo ""
    echo "To start the container:"
    echo "  cd $PROJECT_DIR"
    echo "  docker-compose up -d"
    exit 1
fi

echo -e "${GREEN}✅ Container ${CONTAINER_NAME} is running${NC}"
echo ""

# Test 1: Check /host/var/log access
echo "Test 1: Checking /host/var/log access..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log; then
    echo -e "${GREEN}✅ /host/var/log exists and is accessible${NC}"
    docker exec "$CONTAINER_NAME" ls -ld /host/var/log
else
    echo -e "${RED}❌ /host/var/log does not exist${NC}"
    exit 1
fi
echo ""

# Test 2: Check /host/logs symlink
echo "Test 2: Checking /host/logs symlink..."
if docker exec "$CONTAINER_NAME" test -e /host/logs; then
    echo -e "${GREEN}✅ /host/logs exists${NC}"
    docker exec "$CONTAINER_NAME" ls -ld /host/logs
else
    echo -e "${YELLOW}⚠️  /host/logs does not exist (symlink not created)${NC}"
    echo "   → The application will use /host/var/log directly as fallback"
fi
echo ""

# Test 3: List some log files
echo "Test 3: Listing some log files in /host/var/log..."
docker exec "$CONTAINER_NAME" ls -lah /host/var/log | head -20
echo ""

# Test 4: Test read access to common log files
echo "Test 4: Testing read access to common log files..."
for log_file in syslog auth.log messages; do
    if docker exec "$CONTAINER_NAME" test -r "/host/var/log/$log_file"; then
        size=$(docker exec "$CONTAINER_NAME" stat -c%s "/host/var/log/$log_file" 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✅ /host/var/log/$log_file is readable${NC}"
        echo "   Size: $size bytes"
    else
        echo -e "${YELLOW}⚠️  /host/var/log/$log_file is not readable${NC}"
    fi
done
echo ""

# Test 5: Check Apache logs
echo "Test 5: Checking Apache logs..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log/apache2; then
    echo -e "${GREEN}✅ /host/var/log/apache2 exists${NC}"
    docker exec "$CONTAINER_NAME" ls -lah /host/var/log/apache2 | head -10
else
    echo -e "${YELLOW}⚠️  /host/var/log/apache2 does not exist${NC}"
fi
echo ""

# Test 6: Check Nginx logs
echo "Test 6: Checking Nginx logs..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log/nginx; then
    echo -e "${GREEN}✅ /host/var/log/nginx exists${NC}"
    docker exec "$CONTAINER_NAME" ls -lah /host/var/log/nginx | head -10
else
    echo -e "${YELLOW}⚠️  /host/var/log/nginx does not exist${NC}"
fi
echo ""

# Test 7: Check environment variables
echo "Test 7: Checking environment variables..."
JWT_SECRET=$(docker exec "$CONTAINER_NAME" env | grep "^JWT_SECRET=" | cut -d'=' -f2 || echo "")
HOST_ROOT_PATH=$(docker exec "$CONTAINER_NAME" env | grep "^HOST_ROOT_PATH=" | cut -d'=' -f2 || echo "/host")

if [ -n "$JWT_SECRET" ]; then
    echo -e "${GREEN}✅ JWT_SECRET is set${NC}"
else
    echo -e "${YELLOW}⚠️  JWT_SECRET is not set${NC}"
fi
echo "HOST_ROOT_PATH=$HOST_ROOT_PATH"
echo ""

# Test 8: Test path conversion logic
echo "Test 8: Testing path conversion logic..."
docker exec "$CONTAINER_NAME" node -e "
const fs = require('fs');

console.log('Testing paths:');
const paths = [
    '/host/logs',
    '/host/var/log',
    '/var/log'
];

paths.forEach(path => {
    const exists = fs.existsSync(path);
    const isDir = exists && fs.statSync(path).isDirectory();
    const isSymlink = exists && fs.lstatSync(path).isSymbolicLink();
    const status = exists ? (isSymlink ? 'symlink' : (isDir ? 'directory' : 'file')) : 'missing';
    console.log(\`  \${path}: \${status}\`);
});
"
echo ""

# Test 9: Test plugin path detection
echo "Test 9: Testing plugin path detection..."
docker exec "$CONTAINER_NAME" node -e "
const fs = require('fs');

function isDocker() {
    try {
        fs.accessSync('/.dockerenv');
        return true;
    } catch {
        return false;
    }
}

function convertToDockerPath(filePath) {
    if (!isDocker()) {
        return filePath;
    }
    
    const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';
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

const testPaths = [
    '/var/log',
    '/var/log/apache2',
    '/var/log/nginx',
    '/var/log/syslog'
];

console.log('Path conversion test:');
testPaths.forEach(originalPath => {
    const converted = convertToDockerPath(originalPath);
    const exists = fs.existsSync(converted);
    console.log(\`  \${originalPath} -> \${converted} (\${exists ? 'exists' : 'missing'})\`);
});
"
echo ""

# Test 10: Check entrypoint script execution
echo "Test 10: Checking entrypoint script execution..."
if docker exec "$CONTAINER_NAME" test -f /app/docker-entrypoint.sh; then
    echo -e "${GREEN}✅ Entrypoint script exists${NC}"
    echo "Checking if symlink creation was attempted..."
    docker exec "$CONTAINER_NAME" sh -c "if [ -d /host/var/log ] && [ ! -e /host/logs ]; then echo 'Symlink should be created but does not exist'; else echo 'Symlink exists or /host/var/log missing'; fi"
else
    echo -e "${YELLOW}⚠️  Entrypoint script not found in container${NC}"
fi
echo ""

echo "=========================================="
echo "Summary:"
echo "=========================================="
echo -e "${GREEN}✅ Host logs are accessible at /host/var/log${NC}"

if docker exec "$CONTAINER_NAME" test -e /host/logs; then
    echo -e "${GREEN}✅ Symlink /host/logs exists${NC}"
else
    echo -e "${YELLOW}⚠️  Symlink /host/logs does not exist, but fallback to /host/var/log should work${NC}"
fi

echo ""
echo "To manually create the symlink (if needed):"
echo "  docker exec -u root $CONTAINER_NAME ln -s /host/var/log /host/logs"
echo ""
echo "To view container logs:"
echo "  docker logs $CONTAINER_NAME"
echo ""
echo "To restart the container:"
echo "  cd $PROJECT_DIR"
echo "  docker-compose restart"
echo ""
