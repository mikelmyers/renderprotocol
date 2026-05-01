#!/usr/bin/env bash
# Launch both the mock MCP server and the Tauri host. The host's Rust
# backend will retry-connect to the mock for a few seconds after boot, so
# starting the mock first is preferred but not required.
#
# Future increment: replace this with Tauri sidecar wiring (tauri.conf.json
# `bundle.externalBin` + `app.shell().sidecar(...)`) so the mock is
# bundled and supervised by Tauri itself.

set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" || true
  fi
}
trap cleanup EXIT INT TERM

echo "[dev] starting mock-mcp-server…"
pnpm --filter @renderprotocol/mock-mcp-server dev &
MOCK_PID=$!

echo "[dev] starting Tauri host…"
pnpm --filter @renderprotocol/host tauri dev
