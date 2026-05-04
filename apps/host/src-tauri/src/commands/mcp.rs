// Tauri commands the React frontend invokes for MCP work.
// Every command routes through the carrier — even passthrough — so when
// ranking/discovery/federation arrive later there is no call-site rewrite.

use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

use crate::carrier::{CarrierStatus, RoutedResourceResult, RoutedToolCallResult};
use crate::AppState;

/// Connection state of an MCP client (one per hosting agent). Shared
/// between init tasks (writers) and `mcp_status` / `carrier_status`
/// (readers) so a frontend that mounts after `agent:ready` already fired
/// can still learn the current state.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum McpConnectionState {
    Connecting,
    Ready,
    Error { message: String },
}

pub type McpConnectionHandle = Arc<RwLock<McpConnectionState>>;

pub fn new_connection_handle() -> McpConnectionHandle {
    Arc::new(RwLock::new(McpConnectionState::Connecting))
}

#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .carrier
        .list_tools()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, AppState>,
    name: String,
    arguments: Option<Value>,
) -> Result<RoutedToolCallResult, String> {
    state
        .carrier
        .call_tool(&name, arguments)
        .await
        .map_err(|e| e.to_string())
}

/// Hard cap on the size of any single text-content field returned by
/// resources/read. A hostile or buggy hosting agent shouldn't be able to
/// OOM the host with a giant document. v0 enforces post-parse; a future
/// hard cap at the HTTP transport level lands when streaming reads are
/// wired in. 1 MiB is generous for typical UI resource HTML.
const MAX_RESOURCE_TEXT_BYTES: usize = 1_048_576;

#[tauri::command]
pub async fn mcp_read_resource(
    state: State<'_, AppState>,
    uri: String,
) -> Result<RoutedResourceResult, String> {
    let routed = state
        .carrier
        .read_resource(&uri)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(arr) = routed.response.get("contents").and_then(Value::as_array) {
        for item in arr {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                if text.len() > MAX_RESOURCE_TEXT_BYTES {
                    return Err(format!(
                        "resource content exceeds size cap ({} > {} bytes) from agent {}",
                        text.len(),
                        MAX_RESOURCE_TEXT_BYTES,
                        routed.served_by,
                    ));
                }
            }
        }
    }

    Ok(routed)
}

#[tauri::command]
pub fn mcp_status(state: State<'_, AppState>) -> McpConnectionState {
    // v0: binary aggregate — connected if any hosting agent is ready.
    // The richer per-agent view lives in carrier_status.
    if state.carrier.any_ready() {
        McpConnectionState::Ready
    } else {
        McpConnectionState::Connecting
    }
}

#[tauri::command]
pub fn carrier_status(state: State<'_, AppState>) -> CarrierStatus {
    state.carrier.status()
}

// Admin / vouching surface (RouteRank step 5b).
//
// These commands are the v0 demo affordance for exercising the
// vouching + Forfeit mechanics without modeling the full vouching UX.
// Real vouching lands when capability declarations spec themselves
// (post-5c). Admin Forfeit stays available as a manual escape hatch.

#[tauri::command]
pub fn carrier_admin_vouch(
    state: State<'_, AppState>,
    voucher_id: String,
    vouchee_id: String,
) -> String {
    let outcome = state.carrier.submit_vouch(&voucher_id, &vouchee_id);
    format!("{:?}", outcome)
}

#[tauri::command]
pub fn carrier_admin_revoke_vouch(
    state: State<'_, AppState>,
    voucher_id: String,
    vouchee_id: String,
) -> String {
    let outcome = state.carrier.revoke_vouch(&voucher_id, &vouchee_id);
    format!("{:?}", outcome)
}

#[tauri::command]
pub fn carrier_admin_forfeit(state: State<'_, AppState>, agent_id: String) -> bool {
    state.carrier.admin_forfeit(&agent_id)
}

// ACP-compatible inbound surface (RouteRank step 5c.3 — minimal).
//
// The Agentic Commerce Protocol (Apache 2.0, ACP spec `2026-04-17`) is the
// public-interface protocol the carrier speaks for paid agent
// transactions. v0 implements the minimal `checkout` flow: a calling
// agent POSTs an intent + payment-token, the carrier translates it into a
// routed tool call against the appropriate hosting agent, settles the
// carrier's take rate via the configured payments backend, and returns
// the ACP-shape response.
//
// Real ACP requires a richer state machine (cart, tax, OAuth identity
// linking, order tracking webhooks). v0 covers the minimum viable shape
// — enough to demonstrate the architecture and unblock follow-up PRs
// that fill in the rest. See `route_rank_plan.md §6` for what's
// deferred.

#[derive(Debug, serde::Deserialize)]
pub struct AcpCheckoutRequest {
    /// The tool the calling agent wants to invoke (translated to MCP
    /// tool name). v0 only accepts requests that map 1:1 to a known
    /// tool in the carrier's catalog.
    pub tool: String,
    /// Tool arguments, JSON. Forwarded to the hosting agent unmodified.
    #[serde(default)]
    pub arguments: Option<Value>,
    /// SPT / payment token from the calling side. v0 logs but doesn't
    /// validate — TAP signature verification is deferred to a later PR.
    #[serde(default)]
    pub payment_token: Option<String>,
    /// Gross amount in cents the calling side authorizes.
    #[serde(default)]
    pub amount_cents: Option<i64>,
}

#[derive(Debug, serde::Serialize)]
pub struct AcpCheckoutResponse {
    pub status: String,
    pub served_by: Option<String>,
    pub charge_id: Option<String>,
    /// Echoes the underlying tool result so the caller can render it
    /// without making a second round-trip. Optional — clients can
    /// treat the receipt as authoritative and ignore the body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}

#[tauri::command]
pub async fn acp_checkout(
    state: State<'_, AppState>,
    request: AcpCheckoutRequest,
) -> Result<AcpCheckoutResponse, String> {
    let routed = state
        .carrier
        .call_tool(&request.tool, request.arguments)
        .await
        .map_err(|e| e.to_string())?;

    // v0 take-rate settlement. The picker chose a specific provider
    // (`served_by`); their pricing terms come from the spec we boot
    // with. v0 routes through the stub backend by default — logs but
    // doesn't actually charge anyone — until real Stripe wiring lands.
    let charge_id = if let Some(amount_cents) = request.amount_cents {
        if amount_cents > 0 {
            let take_rate_bps = state
                .carrier
                .agent_spec(&routed.served_by)
                .map(|s| s.carrier_take_rate_bps as i64)
                .unwrap_or(100);
            let cut_cents = amount_cents.saturating_mul(take_rate_bps) / 10_000;
            let merchant_account_id = state
                .carrier
                .agent_spec(&routed.served_by)
                .map(|s| s.merchant_account_id.clone())
                .unwrap_or_default();
            match state.carrier.payments().settle_take_rate(
                crate::carrier::payments::TakeRateSplit {
                    gross: crate::carrier::payments::Amount::usd(amount_cents),
                    carrier_cut: crate::carrier::payments::Amount::usd(cut_cents),
                    merchant_account_id,
                },
            ) {
                Ok(id) => Some(id.0),
                Err(e) => {
                    tracing::warn!(error = %e, "acp_checkout: take-rate settle failed");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(AcpCheckoutResponse {
        status: "ok".into(),
        served_by: Some(routed.served_by),
        charge_id,
        result: serde_json::to_value(routed.tool_call).ok(),
    })
}
