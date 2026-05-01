// MCP adapter. Speaks JSON-RPC 2.0 over the Streamable HTTP transport.
//
// rmcp spike (timeboxed): if the official Rust SDK lands with usable
// SEP-1865 coverage, we'll swap `client.rs` for it. For v0 we ship a thin
// custom client — JSON-RPC 2.0 is small, the surface is well-defined, and
// owning the client end-to-end keeps audit logging in the same process
// as the wire calls. Cleaner than a Node broker hop.

pub mod client;
pub mod notifications;

pub use client::{McpClient, McpError, ResourceReadResult, ToolCallResult};
pub use notifications::McpNotification;

use crate::protocols::ProtocolAdapter;

pub struct McpAdapter;

impl ProtocolAdapter for McpAdapter {
    fn name(&self) -> &'static str {
        "mcp"
    }
}
