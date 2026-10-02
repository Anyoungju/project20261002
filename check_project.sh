#!/usr/bin/env bash
# Buildcare AI 서비스 제어 — pm2 `buildcare` (deploy/pm2.config.cjs)
#   ./check_project.sh start|stop|restart|status|logs [--build]
#   --build : start/restart 전에 backend·frontend 를 빌드한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=buildcare
CONFIG="$ROOT/deploy/pm2.config.cjs"
PORT="${BUILDCARE_PORT:-9503}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

usage() {
  echo "사용법: $0 {start|stop|restart|status|logs} [--build]" >&2
  exit 1
}

command -v pm2 >/dev/null 2>&1 || { echo "pm2 가 설치되어 있지 않습니다 (npm i -g pm2)." >&2; exit 1; }

ACTION="${1:-}"
BUILD=0
[[ "${2:-}" == "--build" ]] && BUILD=1

is_registered() { pm2 describe "$APP" >/dev/null 2>&1; }

build() {
  echo "▶ 빌드: backend"
  (cd "$ROOT/backend" && npm run build)
  echo "▶ 빌드: frontend"
  (cd "$ROOT/frontend" && npm run build)
}

check_artifacts() {
  [[ -f "$ROOT/backend/dist/server.js" ]] || { echo "backend/dist/server.js 가 없습니다. --build 옵션을 붙여 실행하세요." >&2; exit 1; }
  [[ -d "$ROOT/frontend/dist" ]] || echo "⚠ frontend/dist 가 없습니다. SPA 가 제공되지 않습니다 (--build 권장)." >&2
}

health() {
  for _ in $(seq 1 15); do
    if body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
      echo "✔ health OK ($HEALTH_URL): $body"
      return 0
    fi
    sleep 1
  done
  echo "✘ health 응답 없음 ($HEALTH_URL) — 로그 확인: $0 logs" >&2
  return 1
}

case "$ACTION" in
  start)
    (( BUILD )) && build
    check_artifacts
    if is_registered; then
      pm2 restart "$APP" --update-env
    else
      pm2 start "$CONFIG"
    fi
    pm2 save >/dev/null
    health
    ;;
  stop)
    if is_registered; then
      pm2 stop "$APP"
      pm2 save >/dev/null
    else
      echo "$APP 은(는) pm2 에 등록되어 있지 않습니다."
    fi
    ;;
  restart)
    (( BUILD )) && build
    check_artifacts
    if is_registered; then
      pm2 restart "$APP" --update-env
    else
      pm2 start "$CONFIG"
    fi
    pm2 save >/dev/null
    health
    ;;
  status)
    if is_registered; then
      pm2 list | grep -E "name|$APP" || true
      health || exit 1
    else
      echo "$APP 은(는) pm2 에 등록되어 있지 않습니다."
      exit 1
    fi
    ;;
  logs)
    pm2 logs "$APP" --lines 100
    ;;
  *)
    usage
    ;;
esac
