#!/bin/bash
set -euo pipefail

# Clean JSONL session files older than 7 days from all running family containers.
# Only touches sessions/ — projects/ stores active CC memory/context and must NOT be deleted.
for container in $(docker ps --filter "name=happy-family-" --format "{{.Names}}" 2>/dev/null); do
  docker exec "${container}" find /root/.claude/sessions -name "*.jsonl" -mtime +7 -delete 2>/dev/null || true
done
