import { useEffect, useMemo, useRef, useState } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { ipc } from "../../../lib/ipc";
import type { McpAppMessage } from "@renderprotocol/protocol-types";

// SEP-1865 MCP Apps host primitive. Fetches a `ui://` resource from the
// MCP server, renders it in a sandboxed iframe via `srcdoc`, and brokers
// bidirectional postMessage between the iframe and the host.
//
// Sandbox is `allow-scripts` only — no `allow-same-origin`. That keeps
// the iframe's origin opaque ("null") and prevents it from reaching back
// into the host's web context. Bidirectional communication flows
// exclusively through window.postMessage with our envelope shape:
//
//   { source: "mcp-app",  type, payload }   — from iframe → host
//   { source: "host",     type, payload }   — from host    → iframe
//
// The iframe-side JSON-RPC subset that SEP-1865 defines (so an MCP App
// can call tools or read further resources from inside the iframe) is
// scaffolded here as a `tools/call` message handler that round-trips
// through the host's MCP client. v0 wires the surface; the full
// JSON-RPC method set fills in alongside the apps that need it.

interface Props {
  composition: string;
  source_tool: string;
  entity: string;
  uri: string;
  // Initial height; iframe can request a different height by posting
  // a `{ type: "resize", payload: { height } }` message.
  initialHeight?: number;
  // Optional handler so a parent composition can react to messages from
  // the iframe (e.g. an Approve action inside a drone-focus app).
  onMessage?: (msg: McpAppMessage) => void;
  title?: string;
}

interface FetchState {
  status: "loading" | "ready" | "error";
  html: string | null;
  error: string | null;
}

export function McpAppFrame({
  composition,
  source_tool,
  entity,
  uri,
  initialHeight = 220,
  onMessage,
  title,
}: Props) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "mcp_app",
        source_tool,
        entity,
      }),
    [composition, source_tool, entity],
  );

  const [{ status, html, error }, setState] = useState<FetchState>({
    status: "loading",
    html: null,
    error: null,
  });
  const [height, setHeight] = useState<number>(initialHeight);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Fetch the ui:// resource through the Rust backend (which speaks
  // resources/read against the MCP server). Refetches if the URI changes.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", html: null, error: null });
    ipc
      .readResource(uri)
      .then((res) => {
        if (cancelled) return;
        if (!res.text) {
          setState({
            status: "error",
            html: null,
            error: "resource returned no text content",
          });
          return;
        }
        if (res.mime_type && !res.mime_type.includes("html")) {
          setState({
            status: "error",
            html: null,
            error: `unsupported mime type ${res.mime_type}`,
          });
          return;
        }
        setState({ status: "ready", html: res.text, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          html: null,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  // postMessage broker. Only accept messages whose source is the iframe
  // and whose envelope identifies as `mcp-app`.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const data = e.data as Partial<McpAppMessage> | null;
      if (!data || data.source !== "mcp-app" || typeof data.type !== "string") return;
      const msg = data as McpAppMessage;

      // Built-in handlers first (host-managed concerns).
      if (msg.type === "ready") {
        // App reports it's mounted. Future: emit element_updated with a
        // "ready" flag once the audit log is wired.
        return;
      }
      if (msg.type === "resize") {
        const h = (msg.payload as { height?: number } | undefined)?.height;
        if (typeof h === "number" && h > 40 && h < 1600) setHeight(h);
        return;
      }
      if (msg.type === "ping") {
        // Convenience pong so the hello iframe can demonstrate the path.
        iframeRef.current?.contentWindow?.postMessage(
          { source: "host", type: "pong", payload: { ts: Date.now() } },
          "*",
        );
        return;
      }
      if (msg.type === "tools/call") {
        // SEP-1865 lets an MCP App call back into the host's MCP client.
        // We round-trip through ipc.callTool; result is posted back to
        // the iframe with a correlation id when present.
        const p = msg.payload as
          | { name: string; arguments?: Record<string, unknown>; reply_id?: string }
          | undefined;
        if (p?.name) {
          ipc
            .callTool(p.name, p.arguments)
            .then((res) => {
              iframeRef.current?.contentWindow?.postMessage(
                {
                  source: "host",
                  type: "tools/call-result",
                  payload: { reply_id: p.reply_id ?? null, result: res.structured ?? res.text ?? res.raw },
                },
                "*",
              );
            })
            .catch((err: unknown) => {
              iframeRef.current?.contentWindow?.postMessage(
                {
                  source: "host",
                  type: "tools/call-error",
                  payload: {
                    reply_id: p.reply_id ?? null,
                    error: err instanceof Error ? err.message : String(err),
                  },
                },
                "*",
              );
            });
        }
        return;
      }

      // Unknown type — pass to the parent composition's handler if any.
      onMessage?.(msg);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage]);

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "mcp_app",
        source_tool,
        entity,
        display: { uri, title: title ?? uri, status, height },
      }}
      className="mcp-app-frame"
    >
      <div className="mcp-app-frame__header">
        <span className="mcp-app-frame__title">{title ?? "MCP App"}</span>
        <span className="mcp-app-frame__uri" title={uri}>
          {uri}
        </span>
      </div>
      {status === "loading" && (
        <div className="mcp-app-frame__placeholder">Loading MCP App…</div>
      )}
      {status === "error" && (
        <div className="mcp-app-frame__placeholder mcp-app-frame__placeholder--error">
          MCP App failed to load: {error ?? "unknown error"}
        </div>
      )}
      {status === "ready" && html && (
        <iframe
          ref={iframeRef}
          className="mcp-app-frame__iframe"
          sandbox="allow-scripts"
          srcDoc={html}
          title={title ?? uri}
          style={{ height, width: "100%", border: "0", display: "block" }}
        />
      )}
    </ElementWrapper>
  );
}
