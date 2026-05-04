#!/usr/bin/env bash
# Launch both mock hosting agents (alpha on 4717, beta on 4718) and the
# Tauri host. The host's Rust carrier connects to both at boot — see
# config/hosting-agents.md for the registry it reads.

set -euo pipefail

cd "$(dirname "$0")/.."

PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "[dev] starting mock-mcp-server (alpha) on :4717…"
pnpm --filter @renderprotocol/mock-mcp-server run dev:alpha &
PIDS+=("$!")

echo "[dev] starting mock-mcp-server (beta) on :4718…"
pnpm --filter @renderprotocol/mock-mcp-server run dev:beta &
PIDS+=("$!")

echo "[dev] starting Tauri host…"
pnpm --filter @renderprotocol/host tauri dev
