// MCP Apps (SEP-1865) postMessage bridge — host side.
//
// Single source of truth for the iframe ↔ host JSON-RPC envelope routing.
// Owns the security-critical message validation: source-window identity
// check (srcdoc iframes have origin "null" so origin checks aren't
// meaningful — identity by `event.source` is the right gate), envelope
// shape validation, and a strict allowlist for proxied MCP calls.
//
// Out-of-spec methods, unsolicited responses, and methods not on the
// proxy allowlist all return JSON-RPC errors back to the iframe rather
// than being silently dropped, so a misbehaving widget surfaces clearly.
//
// What this bridge implements (host side of the protocol):
//   - ui/initialize   → respond with hostInfo + hostContext + capabilities
//   - ui/notifications/initialized → send the initial ui/notifications/tool-result
//   - ui/notifications/size-changed → fire size callback
//   - ui/notifications/sandbox-proxy-ready → ignored (web-host-only pattern)
//   - ui/open-link    → logged + rejected (needs shell:allow-open, deferred)
//   - ui/request-display-mode → rejected (only "inline" supported in v0)
//   - ui/update-model-context → rejected for v0
//   - ui/message      → rejected for v0
//   - tools/call      → proxied to host carrier
//   - resources/read  → proxied to host carrier
//   - ping            → pong
//   Anything else → JSON-RPC method-not-found error.

import { ipc } from "./ipc";

const PROTOCOL_VERSION = "2026-01-26";

const HOST_INFO = {
  name: "renderprotocol-host",
  version: "0.0.0",
} as const;

// Methods we will forward to the host's MCP client when a widget calls
// them via postMessage. Strict allowlist by design; any method not in
// this set returns -32601 (method not found).
const PROXY_ALLOWLIST = new Set<string>(["tools/call", "resources/read", "ping"]);

interface JsonRpcRequestLike {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcNotificationLike {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

interface ResourcesReadParams {
  uri: string;
}

export interface BridgeOptions {
  /// The iframe we're bridging to. Must already have its contentWindow
  /// (i.e. attached to the DOM, not just constructed).
  iframe: HTMLIFrameElement;
  /// Initial tool result to forward to the iframe via
  /// ui/notifications/tool-result once the iframe signals initialized.
  toolResult: unknown;
  /// Called when the iframe reports a new content size.
  onSizeChanged?: (width: number, height: number) => void;
}

export interface Bridge {
  detach: () => void;
}

export function attachBridge(opts: BridgeOptions): Bridge {
  const { iframe, toolResult, onSizeChanged } = opts;
  let detached = false;
  let initializedSent = false;
  // Held so a second initialize doesn't accidentally re-arm tool-result.
  let toolResultSent = false;

  const handler = (e: MessageEvent) => {
    if (detached) return;
    // Identity gate: only the iframe we own can talk to us.
    if (e.source !== iframe.contentWindow) return;
    const msg = e.data;
    if (!isJsonRpc(msg)) return;

    // Notifications first (no id).
    if (
      typeof (msg as { id?: unknown }).id === "undefined" &&
      typeof (msg as { method?: unknown }).method === "string"
    ) {
      handleNotification(msg as JsonRpcNotificationLike);
      return;
    }

    // Requests (have id + method).
    if (
      typeof (msg as { method?: unknown }).method === "string" &&
      hasId(msg)
    ) {
      void handleRequest(msg as JsonRpcRequestLike);
      return;
    }

    // Anything else — including unsolicited responses — gets dropped.
    // In v0 we don't issue any host-initiated requests that expect
    // responses, so unsolicited responses can't be legitimate.
  };

  function handleNotification(msg: JsonRpcNotificationLike): void {
    switch (msg.method) {
      case "ui/notifications/initialized": {
        initializedSent = true;
        sendInitialToolResult();
        break;
      }
      case "ui/notifications/size-changed": {
        const p = msg.params as { width?: unknown; height?: unknown } | undefined;
        const width = typeof p?.width === "number" ? p.width : 0;
        const height = typeof p?.height === "number" ? p.height : 0;
        onSizeChanged?.(width, height);
        break;
      }
      case "ui/notifications/sandbox-proxy-ready": {
        // Web-hosts-only sandbox handshake. Not applicable to our srcdoc
        // model; ignore silently per spec.
        break;
      }
      default:
        // Unknown notifications are tolerated per JSON-RPC.
        break;
    }
  }

  async function handleRequest(req: JsonRpcRequestLike): Promise<void> {
    try {
      switch (req.method) {
        case "ui/initialize":
          replyOk(req.id, buildInitializeResult());
          // If the iframe somehow skipped the `initialized` notification
          // (older clients), still arm the tool-result on initialize.
          if (!initializedSent) sendInitialToolResult();
          return;

        case "ui/open-link": {
          // External link opens require shell:allow-open which we haven't
          // granted in v0. Log + reject so the iframe can surface a
          // sensible "couldn't open" affordance.
          const p = req.params as { url?: string } | undefined;
          console.warn("[mcp-app] ui/open-link rejected (no shell:allow-open)", p?.url);
          replyError(req.id, -32000, "ui/open-link not enabled in this host");
          return;
        }

        case "ui/request-display-mode":
          replyError(req.id, -32000, "only `inline` display mode supported");
          return;

        case "ui/update-model-context":
          replyError(req.id, -32000, "ui/update-model-context not enabled in this host");
          return;

        case "ui/message":
          replyError(req.id, -32000, "ui/message not enabled in this host");
          return;

        case "ping":
          replyOk(req.id, {});
          return;

        case "tools/call": {
          if (!PROXY_ALLOWLIST.has(req.method)) {
            replyError(req.id, -32601, `method not allowed: ${req.method}`);
            return;
          }
          const p = req.params as ToolsCallParams | undefined;
          if (!p || typeof p.name !== "string") {
            replyError(req.id, -32602, "tools/call requires `name` (string)");
            return;
          }
          const res = await ipc.callTool(p.name, p.arguments);
          // Pass back the raw MCP response shape (what a standard MCP
          // client would have seen) — `raw` already includes content,
          // structuredContent, _meta, etc.
          replyOk(req.id, res.raw);
          return;
        }

        case "resources/read": {
          if (!PROXY_ALLOWLIST.has(req.method)) {
            replyError(req.id, -32601, `method not allowed: ${req.method}`);
            return;
          }
          const p = req.params as ResourcesReadParams | undefined;
          if (!p || typeof p.uri !== "string") {
            replyError(req.id, -32602, "resources/read requires `uri` (string)");
            return;
          }
          const res = await ipc.mcpReadResource(p.uri);
          replyOk(req.id, res);
          return;
        }

        default:
          replyError(req.id, -32601, `method not found: ${req.method}`);
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      replyError(req.id, -32603, `internal error: ${message}`);
    }
  }

  function buildInitializeResult(): unknown {
    return {
      protocolVersion: PROTOCOL_VERSION,
      hostCapabilities: {
        experimental: {},
        openLinks: {},
        serverTools: { listChanged: false },
        serverResources: { listChanged: false },
        logging: {},
        sandbox: {
          permissions: {},
          csp: {},
        },
      },
      hostInfo: HOST_INFO,
      hostContext: {
        toolInfo: {},
        theme: "light",
        styles: { variables: {}, css: { fonts: "" } },
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        containerDimensions: {
          width: iframe.clientWidth,
          height: iframe.clientHeight,
          maxWidth: iframe.clientWidth,
          maxHeight: iframe.clientHeight,
        },
        locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
        timeZone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        platform: "desktop",
        deviceCapabilities: { touch: false, hover: true },
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    };
  }

  function sendInitialToolResult(): void {
    if (toolResultSent || detached) return;
    toolResultSent = true;
    // The toolResult is the raw MCP tool response object, already shaped
    // as { content?, structuredContent?, _meta? } — exactly what
    // ui/notifications/tool-result expects per spec.
    sendNotification("ui/notifications/tool-result", toolResult);
  }

  function replyOk(id: number | string, result: unknown): void {
    sendRaw({ jsonrpc: "2.0", id, result });
  }

  function replyError(
    id: number | string,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    sendRaw({
      jsonrpc: "2.0",
      id,
      error: data === undefined ? { code, message } : { code, message, data },
    });
  }

  function sendNotification(method: string, params: unknown): void {
    sendRaw({ jsonrpc: "2.0", method, params });
  }

  function sendRaw(msg: unknown): void {
    const w = iframe.contentWindow;
    if (!w) return;
    try {
      w.postMessage(msg, "*");
    } catch (e) {
      console.warn("[mcp-app] postMessage to iframe failed", e);
    }
  }

  window.addEventListener("message", handler);

  return {
    detach() {
      if (detached) return;
      detached = true;
      // Fire-and-forget teardown notification so the iframe can clean up
      // before the DOM removes it. We don't await a response.
      try {
        sendRaw({
          jsonrpc: "2.0",
          id: -1,
          method: "ui/resource-teardown",
          params: {},
        });
      } catch {
        // The iframe may already be unreachable; that's fine.
      }
      window.removeEventListener("message", handler);
    },
  };
}

function isJsonRpc(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { jsonrpc?: unknown }).jsonrpc === "2.0"
  );
}

function hasId(v: unknown): v is { id: number | string } {
  if (typeof v !== "object" || v === null) return false;
  const id = (v as { id?: unknown }).id;
  return typeof id === "number" || typeof id === "string";
}
