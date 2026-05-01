# protocols/

Each protocol the host speaks lives as a sibling module here. The seam is
designed so adding a new protocol does not require restructuring existing
code or call sites.

## v0

- `mcp/` — MCP core (JSON-RPC 2.0 over Streamable HTTP) and MCP Apps (SEP-1865)
  ui:// resource fetching. The only adapter shipped in v0.

## Adding a new adapter (the contract)

When ACP, MPP, x402, TAP, or our own carrier protocol comes online:

1. Create a new sibling module (e.g. `protocols/acp/`).
2. Implement the `ProtocolAdapter` trait in `mod.rs` (just a name + lifecycle
   today — the trait may grow as the registry needs richer behavior).
3. Expose the protocol's typed API through public functions on the module.
   Do not try to force unrelated protocols through one fat trait — that
   couples them and makes the trait useless.
4. Register the adapter with the app state in `main.rs::run`. Tauri
   commands that need it pull it from `State`.
5. Where the carrier needs to invoke the protocol on the user's behalf,
   add a thin call site in `carrier/passthrough.rs` (or whatever ranking
   carrier replaces it later).

The carrier's `route_*` methods are the integration point. New protocols
plug in there without touching Tauri commands or the bus.

## What does not belong here

- Business logic. Protocols are wire-format adapters; composition,
  audit, and approval logic lives elsewhere.
- UI rendering. Even SEP-1865 ui:// resources are *fetched* here and
  *rendered* by the frontend's `McpAppFrame`.
