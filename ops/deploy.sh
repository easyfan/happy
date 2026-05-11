#!/bin/bash
# Deploy ops scripts to server. Run locally: bash ops/deploy.sh
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Deploying ops scripts to happy server..."
scp "$SCRIPTS_DIR/backup.sh" "$SCRIPTS_DIR/cleanup.sh" "$SCRIPTS_DIR/update-server.sh" happy:/tmp/
ssh happy "sudo cp /tmp/backup.sh /tmp/cleanup.sh /tmp/update-server.sh /opt/happy/ && sudo chmod +x /opt/happy/backup.sh /opt/happy/cleanup.sh /opt/happy/update-server.sh"
echo "Done."
