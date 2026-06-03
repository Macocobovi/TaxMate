#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[taxmate] validating tools"
for bin in node npm; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin"
    exit 1
  fi
done

echo "[taxmate] installing workspace dependencies"
npm install --workspace frontend
npm install --workspace backend

echo "[taxmate] validating backend env"
if [[ ! -f backend/.env ]]; then
  echo "backend/.env missing. Copy backend/.env.example -> backend/.env"
fi

echo "[taxmate] running static checks"
npm run typecheck --workspace backend || true
npm run lint --workspace backend || true
npm run lint --workspace frontend || true

echo "[taxmate] next steps"
echo "1) npm run dev --workspace backend"
echo "2) npm run dev --workspace frontend"
echo "3) npm run db:migrate --workspace backend"
