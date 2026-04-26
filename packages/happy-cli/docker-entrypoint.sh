#!/bin/sh

HAPPY_CLI="node /app/happy/packages/happy-cli/bin/happy.mjs"
HAPPY_HOME="${HAPPY_HOME_DIR:-$HOME/.happy}"
STATEFILE="$HAPPY_HOME/daemon.state.json"
CHECK_INTERVAL=30

start_daemon() {
    rm -f "$STATEFILE" "$STATEFILE.lock" 2>/dev/null || true
    $HAPPY_CLI daemon start-sync
}

is_daemon_alive() {
    [ -f "$STATEFILE" ] || return 1
    PID=$(python3 -c "import json; d=json.load(open('$STATEFILE')); print(d.get('pid',''))" 2>/dev/null)
    [ -n "$PID" ] || return 1
    kill -0 "$PID" 2>/dev/null
}

echo "[entrypoint] Starting daemon..."
start_daemon

# Watchdog loop: check every 30s, restart daemon if dead
while true; do
    sleep $CHECK_INTERVAL
    if ! is_daemon_alive; then
        echo "[watchdog $(date)] Daemon not running, restarting..."
        start_daemon
    fi
done
