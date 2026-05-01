import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FleetStatusResult } from "@renderprotocol/protocol-types";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { ipc } from "../../lib/ipc";
import { MapView } from "./primitives/MapView";

// First runnable composition: a single MapView populated by one tool call.
// Subsequent increments expand this into the rule-driven composer + the
// full primitive vocabulary; for now the wiring is the point.

type ConnectionState = "connecting" | "ready" | "error";

export function RenderField() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubReady: (() => void) | null = null;
    let unsubError: (() => void) | null = null;

    void ipc.onMcpReady(() => setConnection("ready")).then((u) => {
      unsubReady = u;
    });
    void ipc
      .onMcpError((msg) => {
        setConnection("error");
        setConnectionMessage(msg);
      })
      .then((u) => {
        unsubError = u;
      });

    return () => {
      unsubReady?.();
      unsubError?.();
    };
  }, []);

  const fleet = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_FLEET_STATUS],
    enabled: connection === "ready",
    queryFn: async (): Promise<FleetStatusResult> => {
      const res = await ipc.callTool(TOOL_NAMES.GET_FLEET_STATUS);
      // Prefer structured content; fall back to parsing the text block.
      if (res.structured) return res.structured as FleetStatusResult;
      if (res.text) return JSON.parse(res.text) as FleetStatusResult;
      throw new Error("get_fleet_status returned no payload");
    },
  });

  return (
    <div className="render-field">
      <ConnectionStrip state={connection} message={connectionMessage} />
      <div className="pane__body">
        {fleet.isLoading && (
          <div className="render-field__empty">Loading fleet…</div>
        )}
        {fleet.isError && (
          <div className="render-field__empty">
            Tool call failed: {String((fleet.error as Error).message)}
          </div>
        )}
        {fleet.data && (
          <MapView
            composition="morning-brief"
            source_tool={TOOL_NAMES.GET_FLEET_STATUS}
            data={fleet.data}
          />
        )}
        {connection !== "ready" && !fleet.data && !fleet.isError && (
          <div className="render-field__empty">
            {connection === "connecting"
              ? "Waiting for MCP server…"
              : `MCP unavailable: ${connectionMessage ?? "unknown error"}`}
          </div>
        )}
      </div>
    </div>
  );
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
      ? "MCP connected"
      : state === "error"
        ? `MCP error${message ? `: ${message}` : ""}`
        : "MCP connecting…";
  return (
    <div className="connection-strip">
      <span className={dotClass} />
      <span>{label}</span>
    </div>
  );
}
