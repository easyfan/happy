#!/bin/sh
set -e

HAPPY_CLI="node /app/happy/packages/happy-cli/bin/happy.mjs"

# Start the daemon (spawns a detached child and exits)
$HAPPY_CLI daemon start-sync

# Keep container alive by following the daemon log
# The daemon writes logs to $HAPPY_HOME_DIR/logs/; wait for the first log file to appear
LOGS_DIR="${HAPPY_HOME_DIR:-$HOME/.happy}/logs"
for i in $(seq 1 10); do
    LOGFILE=$(ls -t "$LOGS_DIR"/*.log 2>/dev/null | head -1)
    [ -n "$LOGFILE" ] && break
    sleep 1
done

if [ -n "$LOGFILE" ]; then
    exec tail -f "$LOGFILE"
else
    # Fallback: just sleep forever
    exec sleep infinity
fi
