#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

LLM_FILE="llm.md"
TIMESTAMP="$(date -u +"%Y-%m-%d %H:%M:%SZ")"

if [[ ! -f "$LLM_FILE" ]]; then
  cat > "$LLM_FILE" <<'HEADER'
# Taxmate LLM Context

## Current Snapshot

## Completed

## In Progress

## Next Tasks

## Blockers

## Commands
HEADER
fi

cat >> "$LLM_FILE" <<TEMPLATE

---
### Update @ ${TIMESTAMP}

## Current Snapshot
- (replace) Short summary of current repository state.

## Completed
- (replace) Completed tasks with file paths.

## In Progress
- (replace) Work underway.

## Next Tasks
- (replace) Ordered actionable next steps.

## Blockers
- (replace) Any blocker; use "None" if no blockers.

## Commands
- (replace) Exact commands to continue from this point.
TEMPLATE

echo "Updated ${LLM_FILE} at ${TIMESTAMP}"
