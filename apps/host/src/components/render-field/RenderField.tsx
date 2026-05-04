import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { useActiveComposition } from "../../lib/active-composition";
import { compose, type PrimitiveSelection } from "../../lib/composer";
import { NarrativeView } from "./primitives/NarrativeView";
import { TabularView } from "./primitives/TabularView";
import { AlertView } from "./primitives/AlertView";
import { TimelineView } from "./primitives/TimelineView";
import { McpAppFrame } from "./primitives/McpAppFrame";
import { AttributionChip } from "./AttributionChip";

// RenderField: the right pane. Reads the active composition (set by the
// user agent in the conversation panel after a tool call), runs it through
// the composer, and switch-renders the selected primitive.
//
// Primitive choice is the composer's job. This component owns layout +
// connection lifecycle only. Adding a new primitive: extend
// PrimitiveSelection in composer.ts, build the component, add a case to
// the switch below. No other touch points.

type ConnectionState = "connecting" | "ready" | "error";

export function RenderField() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const current = useActiveComposition((s) => s.current);

  useEffect(() => {
    let cancelled = false;
    let unsubReady: (() => void) | null = null;
    let unsubError: (() => void) | null = null;

    // Resolve the startup race: if MCP initialized before this component
    // mounted, the `mcp:ready` event is already in the past. Query the
    // current state from Rust as the source of truth, then continue
    // listening for future transitions.
    void ipc
      .mcpStatus()
      .then((s) => {
        if (cancelled) return;
        if (s.state === "ready") {
          setConnection("ready");
        } else if (s.state === "error") {
          setConnection("error");
          setConnectionMessage(s.message);
        }
      })
      .catch((e) => {
        if (!cancelled) console.warn("[RenderField] mcp_status failed", e);
      });

    void ipc.onMcpReady(() => setConnection("ready")).then((u) => {
      if (cancelled) u();
      else unsubReady = u;
    });
    void ipc
      .onMcpError((msg) => {
        setConnection("error");
        setConnectionMessage(msg);
      })
      .then((u) => {
        if (cancelled) u();
        else unsubError = u;
      });

    return () => {
      cancelled = true;
      unsubReady?.();
      unsubError?.();
    };
  }, []);

  const selection = current ? compose(current) : null;

  return (
    <div className="render-field">
      <ConnectionStrip state={connection} message={connectionMessage} />
      <div className="pane__body">
        {!selection && connection === "ready" && (
          <div className="render-field__empty">
            Ask your agent something to compose a view.
          </div>
        )}
        {!selection && connection !== "ready" && (
          <div className="render-field__empty">
            {connection === "connecting"
              ? "Waiting for hosting agent…"
              : `Hosting agent unavailable: ${connectionMessage ?? "unknown error"}`}
          </div>
        )}
        {selection && current && (
          <div className="composition">
            {current.served_by && (
              <AttributionChip
                agent={current.served_by}
                latencyMs={current.latency_ms}
              />
            )}
            <SelectedPrimitive selection={selection} />
          </div>
        )}
      </div>
    </div>
  );
}

// Single switch site mirroring the PrimitiveSelection tagged union. Each
// case is exhaustive on the discriminator; TypeScript flags a missed
// primitive at compile time.
function SelectedPrimitive({ selection }: { selection: PrimitiveSelection }) {
  switch (selection.primitive) {
    case "narrative":
      return (
        <NarrativeView
          composition="ask"
          source_tool={selection.source_tool}
          markdown={selection.markdown}
        />
      );
    case "tabular":
      return (
        <TabularView
          source_tool={selection.source_tool}
          title={selection.title}
          columns={selection.columns}
          rows={selection.rows}
        />
      );
    case "alerts":
      return (
        <AlertView
          source_tool={selection.source_tool}
          alerts={selection.alerts}
        />
      );
    case "timeline":
      return (
        <TimelineView
          source_tool={selection.source_tool}
          events={selection.events}
        />
      );
    case "mcp_app":
      return (
        <McpAppFrame
          source_tool={selection.source_tool}
          uri={selection.uri}
          html={selection.html}
          csp={selection.csp}
          permissions={selection.permissions}
          prefersBorder={selection.prefersBorder}
          toolResult={selection.toolResult}
        />
      );
    case "fallback":
      return (
        <NarrativeView
          composition="ask"
          source_tool={selection.source_tool}
          markdown={`_Couldn't compose a view: ${selection.reason}_`}
        />
      );
  }
}

function ConnectionStrip({
  state,
  message,
}: {
  state: ConnectionState;
  message: string | null;
}) {
  const dotClass =
    state === "ready"
      ? "connection-dot connection-dot--ready"
      : state === "error"
        ? "connection-dot connection-dot--error"
        : "connection-dot";
  const label =
    state === "ready"
      ? "Hosting agent connected"
      : state === "error"
        ? `Hosting agent error${message ? `: ${message}` : ""}`
        : "Connecting to hosting agent…";
  return (
    <div className="connection-strip">
      <span className={dotClass} />
      <span>{label}</span>
    </div>
  );
}
