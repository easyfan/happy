#!/usr/bin/env bash
# health-monitor.sh -- Check Docker container health and alert on unhealthy state.
#
# Usage:
#   ./ops/health-monitor.sh [CONTAINER_NAME_PATTERN]
#
# Environment variables:
#   LOG_FILE            Path for log output; defaults to /var/log/happy-health.log
#                       (falls back to /tmp/happy-health.log if /var/log is not writable)
#   ALERT_WEBHOOK_URL   (optional) Webhook URL for Slack/Feishu/DingTalk alerts
#   CHECK_INTERVAL      (optional) Seconds between checks in daemon mode; default 60
#
# Exit codes:
#   0  All containers healthy (or starting)
#   1  One or more containers unhealthy or not found

set -euo pipefail

CONTAINER_PATTERN="${1:-happy-server}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# Resolve log file path with writable fallback
_DEFAULT_LOG=/var/log/happy-health.log
if [[ -z "${LOG_FILE:-}" ]]; then
    if [[ -w "$(dirname "$_DEFAULT_LOG")" ]]; then
        LOG_FILE="$_DEFAULT_LOG"
    else
        LOG_FILE="/tmp/happy-health.log"
    fi
fi

log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$message"
    echo "$message" >> "$LOG_FILE" 2>/dev/null || true
}

send_alert() {
    local message="$1"
    log "ALERT: $message"
    if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
        curl -s -X POST "$ALERT_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"[happy-server] $message\"}" \
            --max-time 10 || true
    fi
}

check_container_health() {
    local container="$1"
    local health_status
    health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "not_found")

    case "$health_status" in
        healthy)
            log "OK: $container is healthy"
            return 0
            ;;
        unhealthy)
            local failing_streak
            failing_streak=$(docker inspect --format='{{.State.Health.FailingStreak}}' "$container" 2>/dev/null || echo "?")
            send_alert "$container is UNHEALTHY (failing streak: $failing_streak)"
            return 1
            ;;
        starting)
            log "INFO: $container is starting (health check pending)"
            return 0
            ;;
        none)
            log "WARN: $container has no HEALTHCHECK configured"
            return 0
            ;;
        not_found)
            send_alert "$container not found -- container may be down"
            return 1
            ;;
        *)
            log "WARN: $container health status unknown: $health_status"
            return 0
            ;;
    esac
}

main() {
    log "Starting health monitor (pattern: $CONTAINER_PATTERN)"
    log "Log file: $LOG_FILE"

    # Find containers matching pattern
    local containers
    containers=$(docker ps --filter "name=$CONTAINER_PATTERN" --format '{{.Names}}' 2>/dev/null)

    if [[ -z "$containers" ]]; then
        send_alert "No containers found matching pattern: $CONTAINER_PATTERN"
        exit 1
    fi

    local exit_code=0
    while IFS= read -r container; do
        check_container_health "$container" || exit_code=1
    done <<< "$containers"

    exit "$exit_code"
}

main "$@"
