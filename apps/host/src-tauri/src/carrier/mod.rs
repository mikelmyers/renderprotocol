// Carrier layer. v0 ships a passthrough implementation that forwards user-agent
// calls directly to the configured MCP adapter with no routing logic — no
// discovery, no ranking, no federation. The seam exists so the eventual
// RouteRank-style carrier slots in here without touching call sites in
// `commands/` or the bus.
//
// The trait is the contract for that future swap.

pub mod passthrough;

use crate::protocols::mcp::ToolCallResult;
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum CarrierError {
    #[error(transparent)]
    Mcp(#[from] crate::protocols::mcp::McpError),
}

pub trait CarrierRouter: Send + Sync {
    fn name(&self) -> &'static str;
}

// v0: the carrier exposes a small async surface. We keep it as inherent
// methods on the concrete `PassthroughCarrier` rather than forcing them
// through a `dyn`-safe trait — the trait gains shape once the second
// implementation arrives and we can see what actually generalizes.
pub use passthrough::PassthroughCarrier;
