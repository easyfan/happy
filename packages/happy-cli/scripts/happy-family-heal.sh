#!/bin/bash
set -euo pipefail

# Wait for Docker daemon to be truly ready.
# colima status "Running" does not mean Docker is ready — must probe with docker info.
for i in $(seq 1 18); do
  docker info >/dev/null 2>&1 && exit 0
  sleep 5
done

# 90 seconds elapsed and Docker is still not available — assume broken Colima state.
# Stop all family containers first to avoid interrupting active tasks mid-operation.
docker ps --filter "name=happy-family-" -q 2>/dev/null | xargs -r docker stop
colima stop --force 2>/dev/null || true
colima start
