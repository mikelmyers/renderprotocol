// RoutingCarrier — connects to N hosting agents, aggregates their tool
// catalogs, and decides which agent answers each tool/resource call.
//
// Routing logic (RouteRank step 5a, see `docs/route_rank_plan.md §3`):
//   - Tools with one provider → trivial.
//   - Tools with multiple providers → pick the argmax of
//     `scoring::score(...)` — Thompson-sampled reliability × latency
//     term × authority. Cold-start exploration falls out of the wide
//     Beta(1,1) posterior on agents with no per-(agent,tool) history.
//   - Resources → no per-resource provider map yet; try ready agents in
//     registry order until one answers.
//
// 5b layers adversarial resistance + vouching on the same scoring
// substrate; 5c persists receipts + signs them.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use rand::{thread_rng, Rng};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::keys::KeyStore;
use super::lifecycle::{
    AgentLifecycle, ForfeitReason, EXPLORATION_ALLOCATION_FRACTION,
    TIER1_RECOVERY_AR_THRESHOLD, TIER1_RECOVERY_DURATION_MS, TIER1_SUSPEND_AR_THRESHOLD,
};
use super::payments::{PaymentBackend, StubBackend};
use super::receipts::{ErrorKind, Receipt, ReceiptStore};
use super::registry::HostingAgentSpec;
use super::scoring::{self, AgentScoreSnapshot};
use super::storage::Storage;
use super::vouches::{Vouch, VouchStore};
use super::CarrierError;
use crate::commands::mcp::McpConnectionState;
use crate::protocols::mcp::{McpClient, McpError, ToolCallResult};

/// How many new receipts to accumulate before recomputing the
/// network-wide authority cache. 50 keeps recompute amortized while
/// staying responsive enough for v0 demo traffic. Pure scoring
/// implementation in `scoring::authority` — this just gates how often
/// it runs.
const AUTHORITY_RECOMPUTE_INTERVAL: usize = 50;

/// Probability that a routing decision picks uniformly at random across
/// all eligible providers, regardless of their score or lifecycle state.
/// Standard ε-greedy on top of Thompson sampling. Without this the
/// score-max picker compounds its own observations and locks onto the
/// winner of the first coin flip — see `pick_provider`'s ε-greedy block
/// for the bug this closes.
const EPSILON_EXPLORE: f64 = 0.05;

/// One hosting agent the carrier routes to. Each holds its own MCP
/// client + connection state; the carrier never reaches into another
/// agent's session. 5b adds the lifecycle state — Exploration /
/// Production / Forfeit — which gates routing eligibility and the
/// exploratory flag stamped on receipts.
pub struct HostingAgent {
    pub id: String,
    pub endpoint: String,
    pub client: Arc<McpClient>,
    pub state: Arc<RwLock<McpConnectionState>>,
    pub spec: HostingAgentSpec,
    pub lifecycle: Arc<RwLock<AgentLifecycle>>,
}

pub struct RoutingCarrier {
    agents: Vec<HostingAgent>,
    /// tool_name → indices into `agents` that provide it. Populated as
    /// each agent finishes its initialize → tools/list flow.
    catalog: RwLock<HashMap<String, Vec<usize>>>,
    receipts: RwLock<ReceiptStore>,
    vouches: RwLock<VouchStore>,
    /// Cached network-wide authority scores. Recomputed every
    /// `AUTHORITY_RECOMPUTE_INTERVAL` new receipts (lazy, on the read
    /// path). Empty until the first refresh after a receipt lands.
    authority_cache: RwLock<AuthorityCache>,
    /// 5c: durable substrate. Receipts and vouches mirror to the
    /// `Storage` write-through; the in-memory stores remain the hot
    /// read path.
    storage: Arc<Storage>,
    keys: Arc<KeyStore>,
    payments: Arc<dyn PaymentBackend>,
}

#[derive(Default)]
struct AuthorityCache {
    scores: HashMap<String, f64>,
    receipts_at_last_compute: usize,
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
    pub vouch_count: usize,
    /// 5b: kernel members per the trust seed-set (config-anchored +
    /// auto-promoted). Surfaced for the eventual ranking-debug drawer.
    pub kernel_members: Vec<String>,
    /// Per-(agent, tool) score breakdown — pure data infrastructure for
    /// a future ranking-debug drawer. Read from the scoring substrate,
    /// no allocation in the picker hot path.
    pub scores: Vec<ScoreSnapshotEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScoreSnapshotEntry {
    pub agent_id: String,
    pub tool: String,
    pub reliability_alpha: f64,
    pub reliability_beta: f64,
    pub latency_p50_ms: Option<f64>,
    pub latency_p95_ms: Option<f64>,
    pub authority: f64,
    pub adversarial_resistance: f64,
    pub vouch_boost: f64,
}

impl From<AgentScoreSnapshot> for ScoreSnapshotEntry {
    fn from(s: AgentScoreSnapshot) -> Self {
        ScoreSnapshotEntry {
            agent_id: s.agent_id,
            tool: s.tool,
            reliability_alpha: s.reliability_alpha,
            reliability_beta: s.reliability_beta,
            latency_p50_ms: s.latency_p50_ms,
            latency_p95_ms: s.latency_p95_ms,
            authority: s.authority,
            adversarial_resistance: s.adversarial_resistance,
            vouch_boost: s.vouch_boost,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatusEntry {
    pub id: String,
    pub endpoint: String,
    pub state: McpConnectionState,
    /// 5b: lifecycle (Exploration / Production / Suspended / Forfeit).
    pub lifecycle: AgentLifecycle,
    pub vouches_received: usize,
    pub vouches_made: usize,
    pub is_kernel_member: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogEntry {
    pub tool: String,
    pub providers: Vec<String>,
}

impl RoutingCarrier {
    /// Construct a `RoutingCarrier` backed by a fresh in-memory store.
    /// Tests and tools that don't need persistence go through this; the
    /// production boot path uses `with_storage` so receipts and vouches
    /// survive restart.
    pub fn new(specs: Vec<HostingAgentSpec>) -> Self {
        let storage = Arc::new(
            Storage::open_in_memory_for_runtime()
                .expect("in-memory SQLite open should never fail"),
        );
        let now_ms = chrono_ms();
        let keys = Arc::new(
            KeyStore::new(Arc::clone(&storage), now_ms)
                .expect("key store init from fresh in-memory storage"),
        );
        let payments: Arc<dyn PaymentBackend> = Arc::new(StubBackend::new());
        Self::assemble(specs, storage, keys, payments, /* hydrate */ false)
    }

    /// Production constructor — opens (or creates) the SQLite file and
    /// hydrates the in-memory stores from disk so reputation survives
    /// restart.
    pub fn with_storage(
        specs: Vec<HostingAgentSpec>,
        storage: Arc<Storage>,
        payments: Arc<dyn PaymentBackend>,
    ) -> Result<Self, CarrierError> {
        let now_ms = chrono_ms();
        let keys = Arc::new(
            KeyStore::new(Arc::clone(&storage), now_ms)
                .map_err(|e| CarrierError::Storage(e.to_string()))?,
        );
        Ok(Self::assemble(specs, storage, keys, payments, /* hydrate */ true))
    }

    fn assemble(
        specs: Vec<HostingAgentSpec>,
        storage: Arc<Storage>,
        keys: Arc<KeyStore>,
        payments: Arc<dyn PaymentBackend>,
        hydrate: bool,
    ) -> Self {
        let now_ms = chrono_ms();
        // Eager keygen for every declared agent — keypairs persist to
        // SQLite. v0 single-party signing means the carrier holds both
        // halves; future MCP receipt-signing extension will rotate the
        // private half out.
        for spec in &specs {
            let _ = keys.ensure_keypair(&spec.id, now_ms);
        }
        // Lifecycle hydration: load any persisted state. Agents with no
        // persisted record fall through to AgentLifecycle::initial. This
        // is the load side of the write-through pair that makes Forfeit
        // (and Suspended, and exploration counters) survive restart.
        let persisted_lifecycles: HashMap<String, AgentLifecycle> = if hydrate {
            match storage.load_all_lifecycles() {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(error = %e, "failed to load lifecycles on boot; using initial states");
                    HashMap::new()
                }
            }
        } else {
            HashMap::new()
        };
        let agents: Vec<HostingAgent> = specs
            .into_iter()
            .map(|s| {
                let lifecycle = persisted_lifecycles
                    .get(&s.id)
                    .cloned()
                    .unwrap_or_else(|| AgentLifecycle::initial(s.seed, now_ms));
                HostingAgent {
                    id: s.id.clone(),
                    endpoint: s.endpoint.clone(),
                    client: Arc::new(McpClient::new(s.endpoint.clone())),
                    state: Arc::new(RwLock::new(McpConnectionState::Connecting)),
                    lifecycle: Arc::new(RwLock::new(lifecycle)),
                    spec: s,
                }
            })
            .collect();
        let mut receipts = ReceiptStore::new();
        let mut vouches = VouchStore::new();
        if hydrate {
            // Receipts: load + verify; quarantine any that fail.
            match storage.load_all_receipts() {
                Ok(stored) => {
                    let mut quarantined = 0_usize;
                    for sr in stored {
                        if !keys.verify_receipt(
                            &sr.receipt,
                            sr.carrier_sig.as_deref(),
                            sr.agent_sig.as_deref(),
                        ) {
                            quarantined += 1;
                            continue;
                        }
                        receipts.record(sr.receipt);
                    }
                    if quarantined > 0 {
                        tracing::warn!(
                            count = quarantined,
                            "receipts quarantined: signature verification failed"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to load receipts on boot");
                }
            }
            // Vouches: load + verify (only signed vouches are trusted;
            // unsigned legacy vouches are dropped).
            match storage.load_all_vouches() {
                Ok(stored) => {
                    let mut quarantined = 0_usize;
                    for sv in stored {
                        let sig_ok = sv
                            .signature_bytes
                            .as_deref()
                            .map(|s| keys.verify_vouch(&sv.vouch, s))
                            .unwrap_or(false);
                        if !sig_ok {
                            quarantined += 1;
                            continue;
                        }
                        vouches.insert_loaded(sv.vouch);
                    }
                    if quarantined > 0 {
                        tracing::warn!(
                            count = quarantined,
                            "vouches quarantined: signature verification failed"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to load vouches on boot");
                }
            }
        }
        Self {
            agents,
            catalog: RwLock::new(HashMap::new()),
            receipts: RwLock::new(receipts),
            vouches: RwLock::new(vouches),
            authority_cache: RwLock::new(AuthorityCache::default()),
            storage,
            keys,
            payments,
        }
    }

    /// Snapshot every agent's lifecycle and spec into HashMaps keyed by
    /// agent id. Scoring functions take these by reference.
    fn lifecycle_snapshot(&self) -> HashMap<String, AgentLifecycle> {
        self.agents
            .iter()
            .map(|a| (a.id.clone(), a.lifecycle.read().clone()))
            .collect()
    }

    fn specs_snapshot(&self) -> HashMap<String, HostingAgentSpec> {
        self.agents
            .iter()
            .map(|a| (a.id.clone(), a.spec.clone()))
            .collect()
    }

    fn specs_vec(&self) -> Vec<HostingAgentSpec> {
        self.agents.iter().map(|a| a.spec.clone()).collect()
    }

    fn kernel_snapshot(&self, now_ms: i64) -> HashSet<String> {
        let lifecycles = self.lifecycle_snapshot();
        let receipts = self.receipts.read();
        scoring::kernel_members(&self.specs_vec(), &lifecycles, &receipts, now_ms)
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

    /// Refresh the authority cache if enough new receipts have landed
    /// since the last compute. Lazy and on the read path so picker
    /// callers don't pay BiRank cost per call.
    fn maybe_refresh_authority(&self) {
        let receipts_len = self.receipts.read().len();
        let needs_refresh = {
            let cache = self.authority_cache.read();
            cache.scores.is_empty() && receipts_len > 0
                || receipts_len.saturating_sub(cache.receipts_at_last_compute)
                    >= AUTHORITY_RECOMPUTE_INTERVAL
        };
        if !needs_refresh {
            return;
        }
        let now_ms = chrono_ms();
        let new_scores = {
            let receipts = self.receipts.read();
            let vouches = self.vouches.read();
            scoring::authority(&receipts, &vouches, now_ms)
        };
        let mut cache = self.authority_cache.write();
        cache.scores = new_scores;
        cache.receipts_at_last_compute = receipts_len;
    }

    /// Pick the agent index that should answer this tool call. Returns
    /// `None` when no eligible agent provides the tool.
    ///
    /// Picker logic:
    ///   1. Filter to agents that are MCP-Ready AND lifecycle-routable
    ///      (Exploration or Production; Suspended/Forfeit are excluded).
    ///   2. ε-greedy noise: with probability `EPSILON_EXPLORE`, pick
    ///      uniformly at random across all eligible providers. Closes
    ///      the "loser of the first coin flip never gets sampled"
    ///      lockout that pure score-max creates, per `§4.1 Component 5`'s
    ///      "exploration noise injection so new candidates keep getting
    ///      evaluated."
    ///   3. With probability `EXPLORATION_ALLOCATION_FRACTION`, force a
    ///      random Exploration-state pick if any are eligible. This is
    ///      the §3.2 bonded-exposure mechanism — cold-start agents
    ///      get sampled at a guaranteed floor regardless of score.
    ///   4. Otherwise: argmax of `scoring::score(...)` across remaining
    ///      eligible providers.
    fn pick_provider(&self, tool: &str) -> Option<(usize, bool)> {
        let catalog = self.catalog.read();
        let providers = catalog.get(tool)?;
        let eligible: Vec<usize> = providers
            .iter()
            .copied()
            .filter(|&i| {
                matches!(*self.agents[i].state.read(), McpConnectionState::Ready)
                    && self.agents[i].lifecycle.read().is_routable()
            })
            .collect();
        if eligible.is_empty() {
            return None;
        }
        drop(catalog);

        let mut rng = thread_rng();

        // ε-greedy exploration noise across ALL eligible providers,
        // independent of lifecycle state. This is the noise-injection
        // tier from `§4.1 Component 5`. Without it, score-argmax + the
        // recursive amplification of authority/latency observations
        // locks the picker onto whoever wins the first Thompson roll.
        if rng.gen::<f64>() < EPSILON_EXPLORE {
            let pick = eligible[rng.gen_range(0..eligible.len())];
            let exploratory = self.agents[pick].lifecycle.read().is_exploration();
            return Some((pick, exploratory));
        }

        // Forced exploration allocation (§3.2 bounded exposure).
        let exploration_eligible: Vec<usize> = eligible
            .iter()
            .copied()
            .filter(|&i| self.agents[i].lifecycle.read().is_exploration())
            .collect();
        if !exploration_eligible.is_empty()
            && rng.gen::<f64>() < EXPLORATION_ALLOCATION_FRACTION
        {
            let pick = exploration_eligible[rng.gen_range(0..exploration_eligible.len())];
            return Some((pick, true));
        }

        if eligible.len() == 1 {
            let only = eligible[0];
            let exploratory = self.agents[only].lifecycle.read().is_exploration();
            return Some((only, exploratory));
        }

        self.maybe_refresh_authority();
        let now_ms = chrono_ms();
        let lifecycles = self.lifecycle_snapshot();
        let kernel = self.kernel_snapshot(now_ms);
        let receipts = self.receipts.read();
        let vouches = self.vouches.read();
        let cache = self.authority_cache.read();

        let scored = |i: usize| -> f64 {
            let agent = &self.agents[i];
            let life = lifecycles.get(&agent.id);
            scoring::score(
                &agent.id,
                tool,
                &receipts,
                &vouches,
                &cache.scores,
                &kernel,
                life,
                Some(&agent.spec),
                now_ms,
            )
        };

        let mut best_idx = eligible[0];
        let mut best_score = scored(best_idx);
        for &i in &eligible[1..] {
            let s = scored(i);
            if s > best_score {
                best_idx = i;
                best_score = s;
            }
        }
        let exploratory = self.agents[best_idx].lifecycle.read().is_exploration();
        Some((best_idx, exploratory))
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Option<Value>,
    ) -> Result<RoutedToolCallResult, CarrierError> {
        let (idx, exploratory) = self
            .pick_provider(name)
            .ok_or_else(|| CarrierError::NoProvider(name.to_string()))?;
        let agent = &self.agents[idx];
        let started = Instant::now();
        let result = agent.client.call_tool(name, arguments).await;
        let latency_ms = started.elapsed().as_millis() as u64;
        let ts_ms = chrono_ms();

        let success = result.is_ok();

        // Record the receipt first so subsequent lifecycle/AR computation
        // sees it. Receipts are signed (carrier + agent both, single-party
        // v0) and mirrored to durable storage write-through.
        let error_kind = result.as_ref().err().map(classify_mcp_error);
        let receipt = Receipt {
            agent_id: agent.id.clone(),
            tool: name.to_string(),
            success,
            latency_ms,
            ts_ms,
            error_kind,
            exploratory,
        };
        let (carrier_sig, agent_sig) = match self.keys.sign_receipt(&receipt, ts_ms) {
            Ok((c, a)) => (Some(c), Some(a)),
            Err(e) => {
                tracing::warn!(error = %e, "receipt signing failed; continuing unsigned");
                (None, None)
            }
        };
        if let Err(e) = self.storage.insert_receipt(
            &receipt,
            carrier_sig.as_deref(),
            agent_sig.as_deref(),
        ) {
            tracing::warn!(error = %e, "receipt persistence failed; continuing in-memory only");
        }
        self.receipts.write().record(receipt);

        // Lifecycle transitions: only consequential when this call was
        // exploratory or when the agent is currently Suspended (and might
        // be eligible to resume). Production-state agents only respond
        // to Tier 1 trips, evaluated below.
        self.update_lifecycle_for(idx, exploratory, success, ts_ms);

        match result {
            Ok(tool_call) => Ok(RoutedToolCallResult {
                tool_call,
                served_by: agent.id.clone(),
                latency_ms,
            }),
            Err(e) => Err(e.into()),
        }
    }

    /// Drive lifecycle transitions for one agent after a call completes.
    /// Mutates `lifecycle` based on:
    ///   - This call's outcome (exploration counters, AR observation).
    ///   - Tier 1 trip (any state → Suspended when AR < 0.3).
    ///   - Tier 1 recovery (Suspended → Exploration when AR ≥ 0.6 for
    ///     the recovery duration).
    ///   - Promotion gate (Exploration → Production when all four
    ///     gates hold).
    fn update_lifecycle_for(&self, idx: usize, exploratory: bool, success: bool, now_ms: i64) {
        let agent = &self.agents[idx];
        // Compute current AR. Cheap on small graphs; unavoidable since
        // every transition decision depends on it.
        let lifecycles = self.lifecycle_snapshot();
        let kernel = self.kernel_snapshot(now_ms);
        let current_ar = {
            let receipts = self.receipts.read();
            let vouches = self.vouches.read();
            scoring::adversarial_resistance(
                &agent.id,
                &receipts,
                &vouches,
                lifecycles.get(&agent.id),
                Some(&agent.spec),
                &kernel,
                now_ms,
            )
        };

        // Compute the new state under the write guard, then persist
        // the snapshot outside the guard. The branches are mutually
        // exclusive: Tier 1 trip fires from Exploration/Production
        // only (Suspended is not routable); Tier 1 recovery fires from
        // Suspended only; exploration accounting fires from Exploration
        // only. else-if chain enforces single-branch entry per call.
        let snapshot: AgentLifecycle = {
            let mut life = agent.lifecycle.write();

            if life.is_routable() && current_ar < TIER1_SUSPEND_AR_THRESHOLD {
                // Tier 1 trip: any routable state with AR below the
                // threshold moves to Suspended. Applies to Production
                // too — research consensus is that established agents
                // also benefit from soft-suspend on adversarial signals.
                tracing::warn!(
                    agent = %agent.id,
                    ar = current_ar,
                    "Tier 1 suspension: AR below threshold"
                );
                *life = AgentLifecycle::Suspended {
                    since_ms: now_ms,
                    ar_at_suspension: current_ar,
                    ar_recovery_started_ms: None,
                };
            } else if let AgentLifecycle::Suspended {
                since_ms,
                ar_at_suspension,
                ar_recovery_started_ms,
            } = *life
            {
                // Tier 1 recovery: Suspended agents resume when AR has
                // been above the recovery threshold for the recovery
                // duration.
                if current_ar >= TIER1_RECOVERY_AR_THRESHOLD {
                    let started = ar_recovery_started_ms.unwrap_or(now_ms);
                    if now_ms - started >= TIER1_RECOVERY_DURATION_MS {
                        tracing::info!(
                            agent = %agent.id,
                            ar = current_ar,
                            "Tier 1 recovery: resuming to Exploration with reset counters"
                        );
                        *life = AgentLifecycle::Exploration {
                            successes_so_far: 0,
                            failures_so_far: 0,
                            entered_at_ms: now_ms,
                            min_ar_observed: 1.0,
                        };
                    } else {
                        *life = AgentLifecycle::Suspended {
                            since_ms,
                            ar_at_suspension,
                            ar_recovery_started_ms: Some(started),
                        };
                    }
                } else {
                    // AR still below recovery threshold; reset the timer.
                    *life = AgentLifecycle::Suspended {
                        since_ms,
                        ar_at_suspension,
                        ar_recovery_started_ms: None,
                    };
                }
            } else if exploratory {
                if let AgentLifecycle::Exploration {
                    successes_so_far,
                    failures_so_far,
                    entered_at_ms,
                    min_ar_observed,
                } = *life
                {
                    let new_succ = successes_so_far + if success { 1 } else { 0 };
                    let new_fail = failures_so_far + if success { 0 } else { 1 };
                    let new_min_ar = min_ar_observed.min(current_ar);
                    let total_calls = new_succ + new_fail;

                    let bayes_ok = scoring::promotion_gate_satisfied(
                        new_succ,
                        new_fail,
                        super::lifecycle::PROMOTION_RELIABILITY_THRESHOLD,
                        super::lifecycle::PROMOTION_CONFIDENCE,
                    );
                    let count_ok = total_calls >= super::lifecycle::PROMOTION_MIN_CALLS;
                    let tenure_ok = (now_ms - entered_at_ms)
                        >= super::lifecycle::PROMOTION_MIN_TENURE_MS;
                    let ar_ok = new_min_ar >= super::lifecycle::PROMOTION_MIN_AR;

                    if count_ok && bayes_ok && tenure_ok && ar_ok {
                        tracing::info!(
                            agent = %agent.id,
                            successes = new_succ,
                            failures = new_fail,
                            min_ar = new_min_ar,
                            "Exploration → Production: all four gates satisfied"
                        );
                        *life = AgentLifecycle::Production { since_ms: now_ms };
                    } else {
                        *life = AgentLifecycle::Exploration {
                            successes_so_far: new_succ,
                            failures_so_far: new_fail,
                            entered_at_ms,
                            min_ar_observed: new_min_ar,
                        };
                    }
                }
            }

            life.clone()
        };

        // Persist whatever the in-memory state now is. v0 is generous
        // about persisting "no change" snapshots — they're idempotent
        // upserts. If persistence fails the in-memory state is still
        // correct for this session; restart-survival is what gets
        // affected.
        if let Err(e) = self
            .storage
            .upsert_lifecycle(&agent.id, &snapshot, now_ms)
        {
            tracing::warn!(error = %e, agent = %agent.id, "lifecycle persistence failed");
        }
    }

    // ---- Admin / vouch surface ------------------------------------------

    /// Submit a vouch from `voucher_id` to `vouchee_id`. Eligibility is
    /// computed from the voucher's current lifecycle, overall reliability,
    /// and tenure. Ineligible vouches are silently dropped (return value
    /// is for telemetry only — UI should not surface threshold details).
    /// Eligible vouches are signed by the voucher's key and mirrored to
    /// durable storage.
    pub fn submit_vouch(
        &self,
        voucher_id: &str,
        vouchee_id: &str,
    ) -> super::vouches::VouchInsertOutcome {
        let now_ms = chrono_ms();
        let in_production = self
            .agents
            .iter()
            .find(|a| a.id == voucher_id)
            .map(|a| a.lifecycle.read().is_production())
            .unwrap_or(false);
        let receipts = self.receipts.read();
        let overall_rel = scoring::overall_reliability(voucher_id, &receipts, 100, now_ms);
        let prod_calls = scoring::successful_production_calls(voucher_id, &receipts);
        drop(receipts);
        let eligible = VouchStore::is_voucher_eligible(in_production, overall_rel, prod_calls);
        let outcome = self
            .vouches
            .write()
            .insert(voucher_id, vouchee_id, now_ms, eligible);
        if matches!(outcome, super::vouches::VouchInsertOutcome::Inserted) {
            let v = Vouch {
                voucher_id: voucher_id.to_string(),
                vouchee_id: vouchee_id.to_string(),
                ts_ms: now_ms,
                revoked_at_ms: None,
                signature: None,
            };
            let signature = match self.keys.sign_vouch(&v, now_ms) {
                Ok(s) => Some(s),
                Err(e) => {
                    tracing::warn!(error = %e, "vouch signing failed; persisting unsigned");
                    None
                }
            };
            if let Err(e) = self.storage.insert_vouch(&v, signature.as_deref()) {
                tracing::warn!(error = %e, "vouch persistence failed; in-memory only");
            }
        }
        outcome
    }

    /// Revoke a previously-submitted vouch. Persists the revocation to
    /// storage when successful. Returns the outcome so the admin caller
    /// can distinguish NotFound / CooldownActive from the successful
    /// Revoked.
    pub fn revoke_vouch(
        &self,
        voucher_id: &str,
        vouchee_id: &str,
    ) -> super::vouches::VouchRevokeOutcome {
        let now_ms = chrono_ms();
        let outcome = self.vouches.write().revoke(voucher_id, vouchee_id, now_ms);
        if matches!(outcome, super::vouches::VouchRevokeOutcome::Revoked) {
            if let Err(e) = self
                .storage
                .mark_vouch_revoked(voucher_id, vouchee_id, now_ms)
            {
                tracing::warn!(error = %e, "vouch revocation persistence failed");
            }
        }
        outcome
    }

    /// Roll up receipts older than `cutoff_ms` into per-(agent, tool)
    /// summary rows. Called on a periodic schedule by the host (or
    /// manually for tests). Idempotent.
    pub fn rotate_old_receipts(&self, cutoff_ms: i64) -> Result<usize, CarrierError> {
        self.storage
            .rotate_old_receipts(cutoff_ms)
            .map_err(|e| CarrierError::Storage(e.to_string()))
    }

    /// Look up a hosting agent's spec by id. Used by the ACP take-rate
    /// settlement path to read pricing/merchant-account fields without
    /// reaching into the agent's runtime state.
    pub fn agent_spec(&self, agent_id: &str) -> Option<HostingAgentSpec> {
        self.agents
            .iter()
            .find(|a| a.id == agent_id)
            .map(|a| a.spec.clone())
    }

    /// Access to the keystore for surfacing public keys in
    /// `carrier_status`.
    pub fn keys(&self) -> &KeyStore {
        &self.keys
    }

    /// Access to the payments backend for the eventual capability +
    /// take-rate hooks.
    pub fn payments(&self) -> &dyn PaymentBackend {
        self.payments.as_ref()
    }

    /// Manually forfeit an agent's bond — the v0 stand-in for the 5c
    /// categorical-evidence-gated auto-Forfeit. The agent transitions to
    /// `Forfeit` regardless of current state and is excluded from the
    /// picker. No automatic reverse-out — Forfeit is permanent.
    ///
    /// Calls into the payments backend to settle the bond. With the
    /// stub backend this is a logged no-op; with real Stripe (deferred)
    /// it issues an actual reversal.
    pub fn admin_forfeit(&self, agent_id: &str) -> bool {
        let Some(agent) = self.agents.iter().find(|a| a.id == agent_id) else {
            return false;
        };
        let now_ms = chrono_ms();
        // v0: bond ids aren't yet tracked per-agent (the `bond_amount`
        // field on HostingAgentSpec is a placeholder until lifecycle
        // integration with the payments backend lands as a follow-up).
        // Synthetic bond id keeps the stub backend's history coherent.
        let synthetic_bond = super::payments::BondId(format!("agent_{}_forfeit", agent_id));
        if let Err(e) = self.payments.forfeit_bond(&synthetic_bond) {
            tracing::warn!(error = %e, agent = %agent_id, "payments.forfeit_bond failed");
        }
        let new_state = AgentLifecycle::Forfeit {
            at_ms: now_ms,
            reason: ForfeitReason::Manual,
        };
        *agent.lifecycle.write() = new_state.clone();
        if let Err(e) = self.storage.upsert_lifecycle(agent_id, &new_state, now_ms) {
            tracing::warn!(error = %e, agent = %agent_id, "Forfeit persistence failed");
        }
        tracing::warn!(agent = %agent_id, "manual admin Forfeit applied");
        true
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
        let now_ms = chrono_ms();
        let kernel = self.kernel_snapshot(now_ms);
        let lifecycles = self.lifecycle_snapshot();
        let specs_by_id = self.specs_snapshot();

        let catalog = self.catalog.read();
        let agents: Vec<AgentStatusEntry> = self
            .agents
            .iter()
            .map(|a| {
                let life = a.lifecycle.read().clone();
                let vouches = self.vouches.read();
                let vouches_received = vouches.active_for_vouchee(&a.id).len();
                let vouches_made = vouches.active_by_voucher(&a.id).len();
                AgentStatusEntry {
                    id: a.id.clone(),
                    endpoint: a.endpoint.clone(),
                    state: a.state.read().clone(),
                    lifecycle: life,
                    vouches_received,
                    vouches_made,
                    is_kernel_member: kernel.contains(&a.id),
                }
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

        let pairs: Vec<(String, String)> = catalog
            .iter()
            .flat_map(|(tool, indices)| {
                indices
                    .iter()
                    .map(|&i| (self.agents[i].id.clone(), tool.clone()))
                    .collect::<Vec<_>>()
            })
            .collect();
        drop(catalog);

        self.maybe_refresh_authority();
        let receipts = self.receipts.read();
        let vouches = self.vouches.read();
        let cache = self.authority_cache.read();
        let scores: Vec<ScoreSnapshotEntry> = scoring::snapshot_all(
            pairs,
            &receipts,
            &vouches,
            &cache.scores,
            &kernel,
            &lifecycles,
            &specs_by_id,
            now_ms,
        )
        .into_iter()
        .map(ScoreSnapshotEntry::from)
        .collect();
        let receipt_count = receipts.len();
        let vouch_count = vouches.len();
        drop(receipts);
        drop(vouches);
        drop(cache);

        let mut kernel_members: Vec<String> = kernel.into_iter().collect();
        kernel_members.sort();

        CarrierStatus {
            agents,
            catalog: catalog_entries,
            receipt_count,
            vouch_count,
            kernel_members,
            scores,
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

/// Map `McpError` variants into the coarse `ErrorKind` recorded on
/// failure receipts. The classification is informational for now —
/// 5b/5c will weight scoring by error kind (e.g. `Transport` failures
/// from a flaky network shouldn't penalize an agent the same way a
/// `JsonRpc` error indicating a server-side disagreement does).
fn classify_mcp_error(e: &McpError) -> ErrorKind {
    match e {
        // reqwest exposes an `is_timeout()` helper; surface that as
        // Timeout so 5b can analyze latency-vs-availability separately.
        McpError::Transport(req_err) if req_err.is_timeout() => ErrorKind::Timeout,
        McpError::Transport(_) | McpError::HttpStatus(_) => ErrorKind::Transport,
        McpError::JsonRpc { .. } => ErrorKind::JsonRpc,
        McpError::Malformed(_) | McpError::MissingSession | McpError::NotInitialized => {
            ErrorKind::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::carrier::payments::StubBackend;
    use crate::carrier::registry::HostingAgentSpec;
    use crate::carrier::storage::Storage;

    fn spec(id: &str) -> HostingAgentSpec {
        HostingAgentSpec {
            id: id.into(),
            endpoint: format!("http://127.0.0.1:0/{}", id),
            description: None,
            bond_amount: 0,
            onboarded_at_ms: 0,
            seed: true,
            price_per_call_cents: 0,
            carrier_take_rate_bps: 100,
            merchant_account_id: String::new(),
        }
    }

    /// End-to-end: applying admin_forfeit on one agent persists the
    /// lifecycle. Reopening the carrier on the same Storage hydrates
    /// that agent in Forfeit state. The other agent (no transition
    /// applied) initializes fresh as Production via the seed path.
    /// This is the property the deferred-12 follow-up was missing —
    /// without it, an attacker recovers Forfeit by simply restarting.
    #[test]
    fn forfeit_persists_across_carrier_restart() {
        let storage = Arc::new(Storage::in_memory().unwrap());
        let payments: Arc<dyn PaymentBackend> = Arc::new(StubBackend::new());

        let carrier1 = RoutingCarrier::with_storage(
            vec![spec("alpha"), spec("beta")],
            Arc::clone(&storage),
            Arc::clone(&payments),
        )
        .expect("carrier 1 construction");
        assert!(carrier1.admin_forfeit("beta"));
        let s1 = carrier1.status();
        let beta1 = s1.agents.iter().find(|a| a.id == "beta").unwrap();
        assert!(matches!(beta1.lifecycle, AgentLifecycle::Forfeit { .. }));
        drop(carrier1);

        // Reopen on the same storage — beta should hydrate as Forfeit;
        // alpha should initialize fresh as Production (seed=true).
        let carrier2 = RoutingCarrier::with_storage(
            vec![spec("alpha"), spec("beta")],
            storage,
            payments,
        )
        .expect("carrier 2 construction");
        let s2 = carrier2.status();
        let beta2 = s2.agents.iter().find(|a| a.id == "beta").unwrap();
        let alpha2 = s2.agents.iter().find(|a| a.id == "alpha").unwrap();
        assert!(
            matches!(
                beta2.lifecycle,
                AgentLifecycle::Forfeit {
                    reason: ForfeitReason::Manual,
                    ..
                }
            ),
            "beta should hydrate as Forfeit, got {:?}",
            beta2.lifecycle
        );
        assert!(
            matches!(alpha2.lifecycle, AgentLifecycle::Production { .. }),
            "alpha should still be Production after restart, got {:?}",
            alpha2.lifecycle
        );
    }
}
