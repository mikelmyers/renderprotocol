// Carrier layer. v0 ships RoutingCarrier — connects to N hosting agents
// (declared in `config/hosting-agents.md`), aggregates their tool
// catalogs, picks a provider per call (lowest recent latency for shared
// tools), and records receipts in memory. Step 5 layers RouteRank on top
// of the same Receipt substrate.

pub mod keys;
pub mod lifecycle;
pub mod payments;
pub mod receipts;
pub mod registry;
pub mod routing;
pub mod scoring;
pub mod storage;
pub mod vouches;

#[derive(Debug, thiserror::Error)]
pub enum CarrierError {
    #[error(transparent)]
    Mcp(#[from] crate::protocols::mcp::McpError),
    #[error("no ready hosting agent provides: {0}")]
    NoProvider(String),
    #[error("carrier storage: {0}")]
    Storage(String),
}

pub trait CarrierRouter: Send + Sync {
    fn name(&self) -> &'static str;
}

pub use routing::{
    AgentStatusEntry, CarrierStatus, CatalogEntry, HostingAgent, RoutedResourceResult,
    RoutedToolCallResult, RoutingCarrier, ScoreSnapshotEntry,
};

impl CarrierRouter for RoutingCarrier {
    fn name(&self) -> &'static str {
        "routing"
    }
}
