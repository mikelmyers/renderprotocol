// Thin JSON-RPC 2.0 client for MCP over Streamable HTTP.
//
// Surface for v0:
//   - initialize handshake (captures session id from response header)
//   - notifications/initialized (server-required follow-up)
//   - tools/list
//   - tools/call
//
// Server-initiated notifications (the GET /mcp SSE stream) and SEP-1865
// ui:// resource fetches arrive in the next increment. The client is built
// to make adding them mechanical, not architectural.
//
// Why custom rather than rmcp: see protocols/mcp/mod.rs.

use parking_lot::RwLock;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use thiserror::Error;

const MCP_SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Error)]
pub enum McpError {
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("server returned non-success status: {0}")]
    HttpStatus(reqwest::StatusCode),
    #[error("missing or invalid {MCP_SESSION_HEADER} header on initialize response")]
    MissingSession,
    #[error("server returned a JSON-RPC error: code={code} message={message}")]
    JsonRpc { code: i64, message: String, data: Option<Value> },
    #[error("response body was not valid JSON-RPC: {0}")]
    Malformed(String),
    #[error("client not initialized; call initialize() first")]
    NotInitialized,
}

#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: i64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification<'a> {
    jsonrpc: &'static str,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcErrorBody>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcErrorBody {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallResult {
    pub raw: Value,
    pub structured: Option<Value>,
    pub text: Option<String>,
}

pub struct McpClient {
    http: reqwest::Client,
    endpoint: String,
    session_id: Arc<RwLock<Option<String>>>,
    next_id: AtomicI64,
}

impl McpClient {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .build()
                .expect("reqwest client must build"),
            endpoint: endpoint.into(),
            session_id: Arc::new(RwLock::new(None)),
            next_id: AtomicI64::new(1),
        }
    }

    pub fn session_id(&self) -> Option<String> {
        self.session_id.read().clone()
    }

    pub async fn initialize(&self) -> Result<Value, McpError> {
        // SEP-1865: declare the MCP Apps extension so servers know we can
        // render their `ui://` resources. The extension identifier and
        // mimeType allowlist are spec-mandated.
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {
                "extensions": {
                    "io.modelcontextprotocol/ui": {
                        "mimeTypes": ["text/html;profile=mcp-app"]
                    }
                }
            },
            "clientInfo": {
                "name": "renderprotocol-host",
                "version": "0.0.0",
            },
        });

        let id = self.alloc_id();
        let body = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: Some(params),
        };

        let response = self
            .http
            .post(&self.endpoint)
            .headers(default_headers())
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(McpError::HttpStatus(response.status()));
        }

        let session = response
            .headers()
            .get(MCP_SESSION_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or(McpError::MissingSession)?;
        *self.session_id.write() = Some(session);

        let payload = decode_response(response).await?;
        let result = unwrap_jsonrpc(payload)?;

        // Per MCP, the client must send notifications/initialized before
        // issuing further requests. Fire-and-forget; surface failures via tracing.
        if let Err(e) = self.notify("notifications/initialized", None).await {
            tracing::warn!(error = %e, "notifications/initialized failed");
        }

        Ok(result)
    }

    pub async fn list_tools(&self) -> Result<Value, McpError> {
        let result = self.request("tools/list", Some(json!({}))).await?;
        Ok(result)
    }

    /// Standard MCP `resources/read`. Returns the raw response (typically
    /// `{ contents: [...] }`); host-side code applies any further validation
    /// such as size caps before handing the content to UI primitives.
    pub async fn read_resource(&self, uri: &str) -> Result<Value, McpError> {
        let result = self
            .request("resources/read", Some(json!({ "uri": uri })))
            .await?;
        Ok(result)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Option<Value>,
    ) -> Result<ToolCallResult, McpError> {
        let params = json!({
            "name": name,
            "arguments": arguments.unwrap_or_else(|| json!({})),
        });
        let raw = self.request("tools/call", Some(params)).await?;

        // Tools may return structuredContent (preferred for parsing) and/or
        // a content[] array of blocks. Pull both forms out so the host can
        // pick the cheapest.
        let structured = raw.get("structuredContent").cloned();
        let text = raw
            .get("content")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.iter().find(|b| b.get("type").and_then(Value::as_str) == Some("text")))
            .and_then(|b| b.get("text").and_then(Value::as_str))
            .map(str::to_string);

        Ok(ToolCallResult { raw, structured, text })
    }

    /// Wrapper that recovers from session invalidation. The server can lose
    /// our session for several reasons in practice — server restart (common
    /// in dev), session expiry, network drop. On a 4xx from the server we
    /// clear the cached session, call `initialize()` once, and retry the
    /// request. A second 4xx propagates as an error.
    ///
    /// Concurrent re-initializes are not gated; at worst two requests
    /// re-init in parallel and last write wins. Acceptable for v0; a Notify
    /// barrier or single-flight pattern lands when production load matters.
    async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, McpError> {
        match self.try_request(method, params.clone()).await {
            Ok(v) => Ok(v),
            Err(McpError::HttpStatus(status)) if status.is_client_error() => {
                tracing::info!(
                    %status,
                    method,
                    "session likely invalid; re-initializing and retrying"
                );
                *self.session_id.write() = None;
                self.initialize().await?;
                self.try_request(method, params).await
            }
            Err(e) => Err(e),
        }
    }

    async fn try_request(&self, method: &str, params: Option<Value>) -> Result<Value, McpError> {
        let session = self.session_id.read().clone().ok_or(McpError::NotInitialized)?;
        let id = self.alloc_id();
        let body = JsonRpcRequest { jsonrpc: "2.0", id, method, params };

        let mut headers = default_headers();
        headers.insert(MCP_SESSION_HEADER, HeaderValue::from_str(&session).expect("ascii session id"));

        let response = self.http.post(&self.endpoint).headers(headers).json(&body).send().await?;
        if !response.status().is_success() {
            return Err(McpError::HttpStatus(response.status()));
        }

        let payload = decode_response(response).await?;
        unwrap_jsonrpc(payload)
    }

    async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), McpError> {
        let session = self.session_id.read().clone().ok_or(McpError::NotInitialized)?;
        let body = JsonRpcNotification { jsonrpc: "2.0", method, params };
        let mut headers = default_headers();
        headers.insert(MCP_SESSION_HEADER, HeaderValue::from_str(&session).expect("ascii session id"));

        let response = self.http.post(&self.endpoint).headers(headers).json(&body).send().await?;
        if !response.status().is_success() && response.status().as_u16() != 202 {
            return Err(McpError::HttpStatus(response.status()));
        }
        Ok(())
    }

    fn alloc_id(&self) -> i64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }
}

fn default_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    // Accept both forms so the server may upgrade to SSE later without
    // requiring client changes; for v0 we only consume application/json.
    h.insert(ACCEPT, HeaderValue::from_static("application/json, text/event-stream"));
    h
}

async fn decode_response(response: reqwest::Response) -> Result<Value, McpError> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let bytes = response.bytes().await?;

    if content_type.starts_with("text/event-stream") {
        // Single-message SSE stream — parse the first `data:` line as JSON.
        // Multi-message streaming arrives in a later increment.
        let text = std::str::from_utf8(&bytes).map_err(|e| McpError::Malformed(e.to_string()))?;
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                let trimmed = rest.trim();
                if trimmed.is_empty() { continue; }
                return serde_json::from_str(trimmed)
                    .map_err(|e| McpError::Malformed(e.to_string()));
            }
        }
        Err(McpError::Malformed("event-stream contained no data line".into()))
    } else {
        serde_json::from_slice(&bytes).map_err(|e| McpError::Malformed(e.to_string()))
    }
}

fn unwrap_jsonrpc(payload: Value) -> Result<Value, McpError> {
    let resp: JsonRpcResponse = serde_json::from_value(payload)
        .map_err(|e| McpError::Malformed(e.to_string()))?;
    if let Some(err) = resp.error {
        return Err(McpError::JsonRpc { code: err.code, message: err.message, data: err.data });
    }
    Ok(resp.result.unwrap_or(Value::Null))
}
