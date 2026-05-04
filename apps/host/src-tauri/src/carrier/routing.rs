// RoutingCarrier — connects to N hosting agents, aggregates their tool
// catalogs, and decides which agent answers each tool/resource call.
//
// Routing logic for v0:
//   - Tools with one provider → trivial.
//   - Tools with multiple providers → pick by lowest recent successful
//     latency (cold-start providers preferred to gather a sample).
//   - Resources → no per-resource provider map yet; try ready agents in
//     registry order until one answers.
//
// RouteRank's full surface (Bayesian smoothing, authority/PageRank,
// adversarial-resistance, online learning) lands in step 5 on top of the
// same Receipt substrate.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::receipts::{Receipt, ReceiptStore};
use super::registry::HostingAgentSpec;
use super::CarrierError;
use crate::commands::mcp::McpConnectionState;
use crate::protocols::mcp::{McpClient, ToolCallResult};

/// One hosting agent the carrier routes to. Each holds its own MCP
/// client + connection state; the carrier never reaches into another
/// agent's session.
pub struct HostingAgent {
    pub id: String,
    pub endpoint: String,
    pub client: Arc<McpClient>,
    pub state: Arc<RwLock<McpConnectionState>>,
}

pub struct RoutingCarrier {
    agents: Vec<HostingAgent>,
    /// tool_name → indices into `agents` that provide it. Populated as
    /// each agent finishes its initialize → tools/list flow.
    catalog: RwLock<HashMap<String, Vec<usize>>>,
    receipts: RwLock<ReceiptStore>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoutedToolCallResult {
    /// Raw MCP tool result (the same shape McpClient::call_tool returns)
    /// flattened into the response so the React side can read served_by
    /// and tool fields side-by-side.
    #[serde(flatten)]
    pub tool_call: ToolCallResult,
    pub served_by: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoutedResourceResult {
    /// Full resources/read response object (typically `{ contents: [...] }`).
    pub response: Value,
    pub served_by: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CarrierStatus {
    pub agents: Vec<AgentStatusEntry>,
    pub catalog: Vec<CatalogEntry>,
    pub receipt_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatusEntry {
    pub id: String,
    pub endpoint: String,
    pub state: McpConnectionState,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogEntry {
    pub tool: String,
    pub providers: Vec<String>,
}

impl RoutingCarrier {
    pub fn new(specs: Vec<HostingAgentSpec>) -> Self {
        let agents = specs
            .into_iter()
            .map(|s| HostingAgent {
                id: s.id,
                endpoint: s.endpoint.clone(),
                client: Arc::new(McpClient::new(s.endpoint)),
                state: Arc::new(RwLock::new(McpConnectionState::Connecting)),
            })
            .collect();
        Self {
            agents,
            catalog: RwLock::new(HashMap::new()),
            receipts: RwLock::new(ReceiptStore::new()),
        }
    }

    /// Spawn one async init task per agent. Each retries the MCP
    /// initialize handshake briefly, then on success refreshes the
    /// catalog with this agent's tools/list response, then emits the
    /// per-agent ready event (and the legacy `mcp:ready` aggregate).
    pub fn spawn_init_tasks(self: &Arc<Self>, app: AppHandle) {
        for idx in 0..self.agents.len() {
            let carrier = Arc::clone(self);
            let app_for = app.clone();
            tauri::async_runtime::spawn(async move {
                carrier.init_one(idx, app_for).await;
            });
        }
    }

    async fn init_one(self: Arc<Self>, idx: usize, app: AppHandle) {
        let agent = &self.agents[idx];
        let id = agent.id.clone();
        let endpoint = agent.endpoint.clone();
        tracing::info!(agent = %id, endpoint = %endpoint, "initializing hosting agent");
        let mut attempts = 0u32;
        loop {
            attempts += 1;
            match agent.client.initialize().await {
                Ok(_) => {
                    tracing::info!(agent = %id, "hosting agent initialized");
                    *agent.state.write() = McpConnectionState::Ready;
                    if let Err(e) = self.refresh_catalog_for(idx).await {
                        tracing::warn!(agent = %id, error = %e, "tools/list after init failed");
                    }
                    let _ = app.emit("agent:ready", json!({ "agent": id }));
                    // Legacy single-agent event — keeps the existing
                    // connection-strip wiring lighting up on first ready.
                    let _ = app.emit(
                        "mcp:ready",
                        json!({ "session": agent.client.session_id(), "agent": id }),
                    );
                    return;
                }
                Err(e) if attempts < 20 => {
                    tracing::debug!(agent = %id, error = %e, attempt = attempts, "init retry");
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                Err(e) => {
                    tracing::error!(agent = %id, error = %e, "init gave up");
                    let msg = e.to_string();
                    *agent.state.write() = McpConnectionState::Error { message: msg.clone() };
                    let _ = app.emit("agent:error", json!({ "agent": id, "error": msg }));
                    return;
                }
            }
        }
    }

    async fn refresh_catalog_for(&self, idx: usize) -> Result<(), CarrierError> {
        let agent = &self.agents[idx];
        let value = agent.client.list_tools().await?;
        let Some(tools) = value.get("tools").and_then(|v| v.as_array()) else {
            return Ok(());
        };
        let mut catalog = self.catalog.write();
        for tool in tools {
            if let Some(name) = tool.get("name").and_then(Value::as_str) {
                let entry = catalog.entry(name.to_string()).or_default();
                if !entry.contains(&idx) {
                    entry.push(idx);
                }
            }
        }
        Ok(())
    }

    /// Aggregate tools/list across all ready agents. Dedupe by tool name;
    /// the first agent in registry order with a given tool wins for the
    /// canonical metadata (description, _meta, etc). React's useTools
    /// reads this — `_meta.ui.resourceUri` therefore reflects the agent
    /// that actually serves the UI resource (which is what we want).
    pub async fn list_tools(&self) -> Result<Value, CarrierError> {
        let mut seen: HashMap<String, Value> = HashMap::new();
        for agent in &self.agents {
            if !matches!(*agent.state.read(), McpConnectionState::Ready) {
                continue;
            }
            let res = agent.client.list_tools().await?;
            if let Some(arr) = res.get("tools").and_then(|v| v.as_array()) {
                for t in arr {
                    if let Some(name) = t.get("name").and_then(Value::as_str) {
                        seen.entry(name.to_string()).or_insert_with(|| t.clone());
                    }
                }
            }
        }
        Ok(json!({ "tools": seen.into_values().collect::<Vec<Value>>() }))
    }

    /// Pick the agent index that should answer this tool call. Returns
    /// None when no ready agent provides the tool.
    fn pick_provider(&self, tool: &str) -> Option<usize> {
        let catalog = self.catalog.read();
        let providers = catalog.get(tool)?;
        let ready: Vec<usize> = providers
            .iter()
            .copied()
            .filter(|&i| matches!(*self.agents[i].state.read(), McpConnectionState::Ready))
            .collect();
        if ready.is_empty() {
            return None;
        }
        if ready.len() == 1 {
            return Some(ready[0]);
        }
        // Multi-provider: lowest last-successful-call latency wins.
        // Cold-start (no successes yet) sorts to "0" — preferred so we
        // gather a sample. Step 5 replaces this with Bayesian-smoothed
        // multi-dimensional ranking.
        let receipts = self.receipts.read();
        let mut best = ready[0];
        let mut best_score = receipts
            .last_success(&self.agents[best].id, tool)
            .map(|r| r.latency_ms)
            .unwrap_or(0);
        for &i in &ready[1..] {
            let score = receipts
                .last_success(&self.agents[i].id, tool)
                .map(|r| r.latency_ms)
                .unwrap_or(0);
            if score < best_score {
                best = i;
                best_score = score;
            }
        }
        Some(best)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Option<Value>,
    ) -> Result<RoutedToolCallResult, CarrierError> {
        let idx = self
            .pick_provider(name)
            .ok_or_else(|| CarrierError::NoProvider(name.to_string()))?;
        let agent = &self.agents[idx];
        let started = Instant::now();
        let result = agent.client.call_tool(name, arguments).await;
        let latency_ms = started.elapsed().as_millis() as u64;
        let ts_ms = chrono_ms();

        match result {
            Ok(tool_call) => {
                self.receipts.write().record(Receipt {
                    agent_id: agent.id.clone(),
                    tool: name.to_string(),
                    success: true,
                    latency_ms,
                    ts_ms,
                });
                Ok(RoutedToolCallResult {
                    tool_call,
                    served_by: agent.id.clone(),
                    latency_ms,
                })
            }
            Err(e) => {
                self.receipts.write().record(Receipt {
                    agent_id: agent.id.clone(),
                    tool: name.to_string(),
                    success: false,
                    latency_ms,
                    ts_ms,
                });
                Err(e.into())
            }
        }
    }

    /// Try each ready agent in registry order until one returns the
    /// resource. v0 doesn't yet associate resources with specific
    /// agents — when capability declarations land (step 5+), this
    /// becomes a direct lookup.
    pub async fn read_resource(
        &self,
        uri: &str,
    ) -> Result<RoutedResourceResult, CarrierError> {
        let mut last_err: Option<CarrierError> = None;
        for agent in &self.agents {
            if !matches!(*agent.state.read(), McpConnectionState::Ready) {
                continue;
            }
            let started = Instant::now();
            match agent.client.read_resource(uri).await {
                Ok(v) => {
                    let latency_ms = started.elapsed().as_millis() as u64;
                    return Ok(RoutedResourceResult {
                        response: v,
                        served_by: agent.id.clone(),
                        latency_ms,
                    });
                }
                Err(e) => {
                    tracing::debug!(agent = %agent.id, uri, error = %e, "resources/read miss; trying next agent");
                    last_err = Some(e.into());
                }
            }
        }
        Err(last_err.unwrap_or_else(|| CarrierError::NoProvider(format!("resource: {}", uri))))
    }

    pub fn status(&self) -> CarrierStatus {
        let catalog = self.catalog.read();
        let agents: Vec<AgentStatusEntry> = self
            .agents
            .iter()
            .map(|a| AgentStatusEntry {
                id: a.id.clone(),
                endpoint: a.endpoint.clone(),
                state: a.state.read().clone(),
            })
            .collect();
        let mut catalog_entries: Vec<CatalogEntry> = catalog
            .iter()
            .map(|(tool, indices)| CatalogEntry {
                tool: tool.clone(),
                providers: indices.iter().map(|&i| self.agents[i].id.clone()).collect(),
            })
            .collect();
        catalog_entries.sort_by(|a, b| a.tool.cmp(&b.tool));
        CarrierStatus {
            agents,
            catalog: catalog_entries,
            receipt_count: self.receipts.read().len(),
        }
    }

    /// Used by mcp_status for the binary connection strip — true once
    /// any agent has finished its initialize handshake.
    pub fn any_ready(&self) -> bool {
        self.agents
            .iter()
            .any(|a| matches!(*a.state.read(), McpConnectionState::Ready))
    }
}

fn chrono_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
