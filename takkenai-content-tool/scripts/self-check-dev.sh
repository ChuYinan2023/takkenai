#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/Users/yoyomm/claude-dir/takkenai-content-tool"
AGENT_PLIST="$HOME/Library/LaunchAgents/com.yoyomm.takkenai-content-tool.plist"
AGENT_LABEL="com.yoyomm.takkenai-content-tool"
BASE_URL="http://127.0.0.1:3001"
DEV_DIST_DIR=".next-dev"

check_http() {
  local url="$1"
  curl -fsS -m 4 -I "$url" >/dev/null
}

restart_and_rebuild_next_cache() {
  local uid ts
  uid="$(id -u)"
  ts="$(date +%Y%m%d-%H%M%S)"

  launchctl bootout "gui/$uid/$AGENT_LABEL" >/dev/null 2>&1 || true
  sleep 1

  cd "$APP_DIR"
  if [ -d "$DEV_DIST_DIR" ]; then
    mv "$DEV_DIST_DIR" "${DEV_DIST_DIR}.corrupt-$ts"
  elif [ -d ".next" ]; then
    # Backward compatibility: recover from legacy cache dir too.
    mv ".next" ".next.corrupt-$ts"
  fi

  launchctl bootstrap "gui/$uid" "$AGENT_PLIST"
  launchctl kickstart -k "gui/$uid/$AGENT_LABEL"
  sleep 3
}

main() {
  local healthy="true"

  if ! check_http "$BASE_URL"; then
    healthy="false"
  fi

  if ! check_http "$BASE_URL/day/2026-02-09"; then
    healthy="false"
  fi

  if ! check_http "$BASE_URL/day/2026-02-09/ameba"; then
    healthy="false"
  fi

  if [ "$healthy" = "false" ]; then
    echo "[self-check] detected unhealthy dev server, starting self-heal..."
    restart_and_rebuild_next_cache
  else
    echo "[self-check] dev server healthy."
  fi

  check_http "$BASE_URL"
  check_http "$BASE_URL/day/2026-02-09"
  check_http "$BASE_URL/day/2026-02-09/ameba"
  echo "[self-check] passed."
}

main
