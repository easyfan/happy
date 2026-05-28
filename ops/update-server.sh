#!/bin/bash
# Deploy latest happy-server to production. Run locally: bash ops/update-server.sh
set -euo pipefail

echo "==> Pulling latest code on server..."
ssh happy "cd /opt/happy/src && git pull"

echo "==> Rebuilding Docker image (no cache to ensure fresh build)..."
ssh happy "cd /opt/happy && docker compose build --no-cache happy-server"

echo "==> Restarting happy-server container..."
ssh happy "cd /opt/happy && docker compose up -d happy-server"

echo "==> Waiting for server to start..."
sleep 5

echo "==> Checking server health..."
ssh happy "docker compose -f /opt/happy/docker-compose.yml logs --tail=20 happy-server"

echo ""
echo "Done. Verify at: https://api.happy.engineering/health"
