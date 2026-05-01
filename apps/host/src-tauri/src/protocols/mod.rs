// Protocol adapter registry. The extensibility seam.
//
// v0 ships only the `mcp` adapter (MCP core + SEP-1865 MCP Apps). Future
// adapters — ACP, MPP, x402, TAP, and our own carrier protocol — implement
// `ProtocolAdapter` and register themselves with the app state alongside
// `mcp`. Adding a new protocol is a sibling module under `protocols/`,
// not a restructuring.
//
// The trait deliberately stays small: name + lifecycle. Each adapter exposes
// its own typed surface (the MCP adapter's tool/resource API differs from
// what an ACP adapter would expose). Tauri commands route to the right
// adapter via app state, not via dynamic dispatch on a fat trait.

pub mod mcp;

pub trait ProtocolAdapter: Send + Sync {
    fn name(&self) -> &'static str;
}
