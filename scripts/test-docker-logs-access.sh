#!/bin/bash
# Script to test Docker container access to host log files
# Usage: ./scripts/test-docker-logs-access.sh [container_name]

CONTAINER_NAME="${1:-logviewr}"

echo "=========================================="
echo "Testing Docker Container Log Access"
echo "Container: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Error: Container '$CONTAINER_NAME' is not running"
    echo "   Start it with: docker-compose up -d"
    exit 1
fi

echo "✅ Container is running"
echo ""

# Test 1: Check if /host/var/log exists
echo "Test 1: Checking /host/var/log access..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log; then
    echo "✅ /host/var/log exists and is accessible"
    docker exec "$CONTAINER_NAME" ls -ld /host/var/log
else
    echo "❌ /host/var/log does not exist or is not accessible"
fi
echo ""

# Test 2: Check if /host/logs exists (symlink)
echo "Test 2: Checking /host/logs symlink..."
if docker exec "$CONTAINER_NAME" test -e /host/logs; then
    echo "✅ /host/logs exists"
    docker exec "$CONTAINER_NAME" ls -ld /host/logs
    if docker exec "$CONTAINER_NAME" test -L /host/logs; then
        echo "   → It's a symlink (good!)"
        docker exec "$CONTAINER_NAME" readlink -f /host/logs
    else
        echo "   ⚠️  It's not a symlink (unexpected)"
    fi
else
    echo "⚠️  /host/logs does not exist (symlink not created)"
    echo "   → The application will use /host/var/log directly as fallback"
fi
echo ""

# Test 3: List some log files
echo "Test 3: Listing some log files in /host/var/log..."
docker exec "$CONTAINER_NAME" ls -la /host/var/log | head -20
echo ""

# Test 4: Test reading a specific log file
echo "Test 4: Testing read access to common log files..."
for log_file in "/host/var/log/syslog" "/host/var/log/auth.log" "/host/var/log/messages"; do
    if docker exec "$CONTAINER_NAME" test -r "$log_file"; then
        echo "✅ $log_file is readable"
        file_size=$(docker exec "$CONTAINER_NAME" stat -c%s "$log_file" 2>/dev/null || echo "unknown")
        echo "   Size: $file_size bytes"
    else
        echo "⚠️  $log_file is not readable (may not exist or permission issue)"
    fi
done
echo ""

# Test 5: Check Apache logs if they exist
echo "Test 5: Checking Apache logs..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log/apache2; then
    echo "✅ /host/var/log/apache2 exists"
    docker exec "$CONTAINER_NAME" ls -la /host/var/log/apache2 | head -10
else
    echo "⚠️  /host/var/log/apache2 does not exist"
fi
echo ""

# Test 6: Check Nginx logs if they exist
echo "Test 6: Checking Nginx logs..."
if docker exec "$CONTAINER_NAME" test -d /host/var/log/nginx; then
    echo "✅ /host/var/log/nginx exists"
    docker exec "$CONTAINER_NAME" ls -la /host/var/log/nginx | head -10
else
    echo "⚠️  /host/var/log/nginx does not exist"
fi
echo ""

# Test 7: Check environment variables
echo "Test 7: Checking environment variables..."
docker exec "$CONTAINER_NAME" env | grep -E "(HOST_ROOT_PATH|DOCKER|JWT_SECRET)" || echo "No relevant env vars found"
echo ""

# Test 8: Check if entrypoint script ran
echo "Test 8: Checking if entrypoint script created symlink..."
docker exec "$CONTAINER_NAME" sh -c 'if [ -L /host/logs ]; then echo "✅ Symlink exists"; readlink -f /host/logs; else echo "⚠️  Symlink does not exist (entrypoint may have failed or /host is read-only)"; fi'
echo ""

# Summary
echo "=========================================="
echo "Summary:"
echo "=========================================="
if docker exec "$CONTAINER_NAME" test -d /host/var/log; then
    echo "✅ Host logs are accessible at /host/var/log"
    if docker exec "$CONTAINER_NAME" test -L /host/logs; then
        echo "✅ Symlink /host/logs -> /host/var/log exists"
    else
        echo "⚠️  Symlink /host/logs does not exist, but fallback to /host/var/log should work"
    fi
else
    echo "❌ Host logs are NOT accessible"
    echo "   Check your docker-compose.yml volume mounts"
fi
echo ""
echo "To manually create the symlink (if needed):"
echo "  docker exec -u root $CONTAINER_NAME ln -s /host/var/log /host/logs"
echo ""
echo "To test the application's path conversion:"
echo "  docker exec $CONTAINER_NAME node -e \"const fs=require('fs'); console.log('Testing paths:'); ['/host/logs','/host/var/log','/var/log'].forEach(p=>console.log(p+':',fs.existsSync(p)?'exists':'missing'))\""
echo ""
