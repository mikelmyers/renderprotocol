// Server-initiated MCP notifications.
//
// The Streamable HTTP transport surfaces server → client messages over a
// long-lived `GET /mcp` SSE stream. We open it after `initialize`
// succeeds, parse each `data:` line as a JSON-RPC envelope, and
// re-emit notifications to the frontend as Tauri events.
//
// The frontend's notifications bridge (`lib/notifications.ts`) routes
// from there: `notifications/resources/updated` triggers React Query
// cache invalidation; custom methods like
// `notifications/renderprotocol/data_updated` flow into topic-keyed
// subscribers (e.g. the LiveFeedView).

use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::client::McpClient;
use crate::audit::NewEvent;
use crate::AppState;

const SSE_RECONNECT_DELAY: Duration = Duration::from_secs(2);
const SSE_RECONNECT_MAX: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpNotification {
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

/// Spawn a long-lived listener that reconnects on failure with exponential
/// backoff. Returns immediately; the task lives for the app's lifetime.
pub fn spawn(app: AppHandle, client: Arc<McpClient>, endpoint: String) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = SSE_RECONNECT_DELAY;
        loop {
            match listen_once(&app, &client, &endpoint).await {
                Ok(_) => {
                    // Stream ended cleanly; reconnect after a short delay.
                    tracing::debug!("MCP notifications stream ended; reconnecting");
                    backoff = SSE_RECONNECT_DELAY;
                }
                Err(e) => {
                    tracing::warn!(error = %e, backoff_s = backoff.as_secs(), "MCP notifications stream error");
                }
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(SSE_RECONNECT_MAX);
        }
    });
}

async fn listen_once(
    app: &AppHandle,
    client: &McpClient,
    endpoint: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Wait until the client has a session id — listener is no use before
    // initialize completes.
    let session = match client.session_id() {
        Some(s) => s,
        None => {
            return Err("session id not yet available".into());
        }
    };

    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert("mcp-session-id", HeaderValue::from_str(&session)?);

    // No request-wide timeout: this is a long-lived stream. Default
    // reqwest client has no timeout, but we build explicitly so the
    // intent is documented.
    let http = reqwest::Client::builder().build()?;

    let response = http.get(endpoint).headers(headers).send().await?;
    if !response.status().is_success() {
        return Err(format!("notifications GET returned {}", response.status()).into());
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        let text = std::str::from_utf8(&bytes)?;
        buf.push_str(text);

        // SSE events are separated by a blank line. We process every
        // complete event and leave any partial event in `buf`.
        loop {
            let Some(idx) = find_event_boundary(&buf) else {
                break;
            };
            let event_text = buf[..idx].to_string();
            buf.drain(..idx + boundary_len(&buf, idx));

            for line in event_text.lines() {
                if let Some(rest) = line.strip_prefix("data:") {
                    let payload = rest.trim();
                    if payload.is_empty() {
                        continue;
                    }
                    process_payload(app, payload);
                }
                // Other SSE field lines (event:, id:, retry:) ignored —
                // we only need data: payloads for v0.
            }
        }
    }

    Ok(())
}

fn process_payload(app: &AppHandle, payload: &str) {
    let value: Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, payload, "failed to parse SSE payload");
            return;
        }
    };

    // JSON-RPC notifications have no `id`; messages with `id` are
    // request/response and don't fan out to the bridge.
    let has_id = value.get("id").is_some();
    let method = value.get("method").and_then(Value::as_str);

    if has_id || method.is_none() {
        // Server requests / responses to client requests aren't routed to
        // the notifications bridge in v0. They land here when the
        // server speaks back over SSE — log for now.
        tracing::debug!(payload, "non-notification SSE message");
        return;
    }

    let method_str = method.unwrap().to_string();
    let params = value.get("params").cloned();

    // Audit before emit so the drawer can show notifications even if the
    // frontend listener is paused or temporarily disconnected.
    if let Some(state) = app.try_state::<AppState>() {
        state.audit.record(NewEvent::of(
            format!("mcp.notification.{}", sanitize_kind(&method_str)),
            json!({
                "method": &method_str,
                "params": params.clone().unwrap_or(Value::Null),
            }),
        ));
    }

    let n = McpNotification {
        method: method_str,
        params,
    };

    if let Err(e) = app.emit("mcp:notification", &n) {
        tracing::warn!(error = %e, "failed to emit mcp:notification");
    }
}

fn sanitize_kind(method: &str) -> String {
    // Audit kinds are flat strings; preserve the method shape but drop
    // path-style separators so SQL prefix searches stay intuitive.
    method.replace('/', ".")
}

fn find_event_boundary(s: &str) -> Option<usize> {
    // Either "\n\n" or "\r\n\r\n" terminates an SSE event.
    if let Some(i) = s.find("\n\n") {
        return Some(i);
    }
    s.find("\r\n\r\n")
}

fn boundary_len(s: &str, idx: usize) -> usize {
    if s[idx..].starts_with("\r\n\r\n") {
        4
    } else {
        2
    }
}
