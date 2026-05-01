// PassthroughCarrier — v0 placeholder.
// Forwards every tool call straight to the single MCP adapter. No discovery,
// no ranking, no fan-out, no receipts. The point is to occupy the seam so
// that when ranking/discovery land later, every call site already routes
// through the carrier.

use std::sync::Arc;

use serde_json::Value;

use super::{CarrierError, CarrierRouter};
use crate::protocols::mcp::{McpClient, ResourceReadResult, ToolCallResult};

pub struct PassthroughCarrier {
    mcp: Arc<McpClient>,
}

impl PassthroughCarrier {
    pub fn new(mcp: Arc<McpClient>) -> Self {
        Self { mcp }
    }

    pub async fn list_tools(&self) -> Result<Value, CarrierError> {
        Ok(self.mcp.list_tools().await?)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Option<Value>,
    ) -> Result<ToolCallResult, CarrierError> {
        Ok(self.mcp.call_tool(name, arguments).await?)
    }

    pub async fn read_resource(&self, uri: &str) -> Result<ResourceReadResult, CarrierError> {
        Ok(self.mcp.read_resource(uri).await?)
    }
}

impl CarrierRouter for PassthroughCarrier {
    fn name(&self) -> &'static str {
        "passthrough"
    }
}
