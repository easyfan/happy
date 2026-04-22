#!/bin/bash
set -euo pipefail

# Delete SessionMessage rows older than 60 days
DELETED=$(docker exec happy-postgres-1 psql -U handy handy -tAc \
    "WITH deleted AS (DELETE FROM \"SessionMessage\" WHERE \"createdAt\" < NOW() - INTERVAL '60 days' RETURNING 1) SELECT COUNT(*) FROM deleted;")

echo "$(date '+%Y-%m-%d %H:%M:%S') cleanup: deleted ${DELETED} rows from SessionMessage"
