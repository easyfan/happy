#!/bin/sh

# HAPPY_CLI env can be overridden at container run time; default uses the
# in-image build at /app (ensures linux-arm64 SDK binary is present).
HAPPY_CLI="${HAPPY_CLI:-node /app/packages/happy-cli/bin/happy.mjs}"
HAPPY_HOME="${HAPPY_HOME_DIR:-$HOME/.happy}"
STATEFILE="$HAPPY_HOME/daemon.state.json"
CHECK_INTERVAL=30

start_daemon() {
    rm -f "$STATEFILE" "$STATEFILE.lock" 2>/dev/null || true
    # BUG-07: clear zombie running sessions. The container's PID 1 is this
    # entrypoint, so on restart every prior session child process is already
    # dead, but sessions.json may still record them as "running" — which
    # surfaces as zombie active UI in the web app (BUG-06). Mark any leftover
    # running session as terminated before the daemon starts.
    node -e "
      const fs=require('fs'), p='$HAPPY_HOME/sessions.json';
      if(!fs.existsSync(p)) process.exit(0);
      const d=JSON.parse(fs.readFileSync(p,'utf8'));
      let n=0;
      for(const s of Object.values(d.sessions||{}))
        if(s.metadata && s.metadata.lifecycleState==='running'){
          s.metadata.lifecycleState='terminated';
          s.metadata.lifecycleStateSince=Date.now(); n++;
        }
      if(n>0) fs.writeFileSync(p,JSON.stringify(d,null,2));
      console.log('[entrypoint] Cleared '+n+' zombie session(s)');
    " 2>/dev/null || true
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
