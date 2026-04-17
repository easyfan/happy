#!/bin/bash
set -euo pipefail

COMMAND="${1:-}"
shift || true

usage() {
  echo "Usage:"
  echo "  happy-family start <name>    # Start (or resume) a family member container"
  echo "  happy-family stop <name>     # Stop a running container"
  echo "  happy-family auth <name>     # Re-authenticate (family member changed phone)"
  echo "  happy-family cleanup <name>  # Delete session JSONL files older than 7 days"
  echo "  happy-family list            # List all family containers"
  exit 1
}

# Run happy auth login in a temporary interactive container.
# Writes credentials into the named volume; exits when auth completes.
# Requires a real TTY (must be run from an interactive terminal).
run_auth() {
  local name="$1"
  echo "Starting interactive auth for ${name} (requires TTY)..."
  docker run --rm -it \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -e HAPPY_SERVER_URL=https://happy.easyfan.info \
    -e HAPPY_WEBAPP_URL=https://app.easyfan.info \
    -v ~/happy:/app/happy:ro \
    -v "happy-credentials-${name}":/root/.happy \
    --entrypoint node \
    happy-family:latest \
    /app/happy/packages/happy-cli/bin/happy.mjs auth login
  echo "Auth complete."
}

# Check whether the happy credentials file (access.key) exists in the named volume.
# Returns 0 (true) if access.key is present, 1 (false) otherwise.
has_credentials() {
  local name="$1"
  docker run --rm \
    --entrypoint sh \
    -v "happy-credentials-${name}":/root/.happy \
    happy-family:latest \
    -c 'test -f /root/.happy/access.key' 2>/dev/null
}

case "${COMMAND}" in
  start)
    name="${1:?Usage: happy-family start <name>}"
    container="happy-family-${name}"
    status=$(docker inspect --format '{{.State.Status}}' "${container}" 2>/dev/null || true)

    if [ "${status}" = "running" ]; then
      echo "${container} is already running"
      exit 0
    elif [ "${status}" = "exited" ] || [ "${status}" = "created" ]; then
      echo "${container} exists (stopped) — resuming..."
      docker start "${container}"
    elif [ -n "${status}" ]; then
      # restarting / paused / dead — do not attempt forced operation
      echo "[ERROR] ${container} is in an unexpected state (${status})"
      echo "        Resolve manually: docker rm ${container}"
      exit 1
    else
      # Container does not exist — first-time creation.
      # Auth must happen before daemon start: the daemon crashes without credentials
      # because its first-run auth flow uses an Ink interactive UI that requires a TTY,
      # which is unavailable in detached (-d) mode.
      mkdir -p "${HOME}/${name}"

      if ! has_credentials "${name}"; then
        echo "No credentials found for ${name} — running auth setup first."
        run_auth "${name}"
      fi

      # Clear stale daemon state from the credentials volume.
      # The daemon writes daemon.state.json with its PID. In a fresh container,
      # a leftover PID (usually 1, the entrypoint process) will be alive again,
      # causing the daemon to think another instance is running and exit 0.
      docker run --rm \
        --entrypoint sh \
        -v "happy-credentials-${name}":/root/.happy \
        happy-family:latest \
        -c 'rm -f /root/.happy/daemon.state.json /root/.happy/daemon.state.json.lock'

      # 从 ~/.claude/settings.json 的 env 字段提取所有环境变量写入临时 env-file。
      # settings.json 不直接挂载容器（CC 运行时写入会触发 EROFS），改为在此读取后注入。
      # ⚠️  env vars 仍以明文出现在 docker inspect .Config.Env，不要将 inspect 输出共享给不可信方。
      ENVFILE="$(mktemp)"
      trap 'rm -f "${ENVFILE}"' EXIT
      python3 -c "
import json, os, sys
p = os.path.expanduser('~/.claude/settings.json')
env = json.load(open(p)).get('env', {})
if not env:
    sys.exit('~/.claude/settings.json 中没有 env 字段')
for k, v in env.items():
    print(f'{k}={v}')
" > "${ENVFILE}" || { echo "[ERROR] 无法从 ~/.claude/settings.json 读取 env 配置"; exit 1; }

      docker run -d \
        --name "${container}" \
        --restart unless-stopped \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --memory 1500m \
        --memory-swap 1500m \
        --log-driver json-file \
        --log-opt max-size=50m \
        --log-opt max-file=3 \
        --env-file "${ENVFILE}" \
        -v ~/happy:/app/happy:ro \
        -v ~/.claude/commands:/root/.claude/commands:ro \
        -v ~/.claude/agents:/root/.claude/agents:ro \
        -v ~/.claude/skills:/root/.claude/skills:ro \
        -v ~/.claude/plugins:/root/.claude/plugins:ro \
        -v ~/.claude/CLAUDE.md:/root/.claude/CLAUDE.md:ro \
        -v "happy-credentials-${name}":/root/.happy \
        -v "happy-projects-${name}":/root/.claude/projects \
        -v "happy-sessions-${name}":/root/.claude/sessions \
        -v "${HOME}/${name}":/workspace \
        happy-family:latest
    fi

    echo "Daemon started: ${container}"
    ;;

  stop)
    name="${1:?Usage: happy-family stop <name>}"
    docker stop "happy-family-${name}"
    ;;

  auth)
    # Re-authenticate — used when a family member gets a new phone.
    # Stops the daemon first so auth can write credentials without conflict,
    # then restarts the daemon.
    #
    # ⚠️  Key rotation note: docker start reuses the existing container config and does NOT
    #     re-inject env vars. To rotate ANTHROPIC_AUTH_TOKEN:
    #       docker rm "happy-family-<name>" && happy-family start <name>
    name="${1:?Usage: happy-family auth <name>}"
    container="happy-family-${name}"

    status=$(docker inspect --format '{{.State.Status}}' "${container}" 2>/dev/null || true)
    if [ "${status}" = "running" ]; then
      echo "Stopping ${container} for re-auth..."
      docker stop "${container}"
    fi

    run_auth "${name}"

    if [ -n "${status}" ]; then
      echo "Restarting daemon..."
      docker start "${container}"
      echo "${container} restarted."
    fi
    ;;

  cleanup)
    # Delete JSONL files older than 7 days from sessions/ only.
    # Do NOT touch projects/ — it stores active project state (CC memory/context).
    # Deleting projects/ causes the family member to report "Claude forgot everything".
    name="${1:?Usage: happy-family cleanup <name>}"
    docker exec "happy-family-${name}" \
      find /root/.claude/sessions -name "*.jsonl" -mtime +7 -delete
    ;;

  list)
    docker ps \
      --filter "name=happy-family-" \
      --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}"
    ;;

  *)
    usage
    ;;
esac
