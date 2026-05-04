// Thin wrappers over Tauri invoke + listen so the rest of the app doesn't
// import @tauri-apps/api directly. Concentrates the IPC surface in one
// place — easier to mock for tests, easier to swap if the backend protocol
// shifts.

import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type { BusEnvelope, BusEvent } from "./types";

// Mirror of carrier::RoutedToolCallResult — McpClient::ToolCallResult
// fields (raw/structured/text) flattened together with the carrier's
// per-call attribution.
export interface ToolCallResponse {
  raw: unknown;
  structured: unknown | null;
  text: string | null;
  served_by: string;
  latency_ms: number;
}

// Mirror of crate::commands::mcp::McpConnectionState (serde tag = "state").
export type McpStatus =
  | { state: "connecting" }
  | { state: "ready" }
  | { state: "error"; message: string };

// Subset of MCP `resources/read` response shape the host actually consumes.
// Extra fields are tolerated (servers may evolve schemas additively).
export interface ResourceContentItem {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface ResourceReadInner {
  contents: ResourceContentItem[];
  _meta?: Record<string, unknown>;
}

// Mirror of carrier::RoutedResourceResult — the inner MCP response wrapped
// with carrier attribution.
export interface ResourceReadResponse {
  response: ResourceReadInner;
  served_by: string;
  latency_ms: number;
}

// Mirror of carrier::CarrierStatus.
export interface AgentStatusEntry {
  id: string;
  endpoint: string;
  state: McpStatus;
}

export interface CatalogEntry {
  tool: string;
  providers: string[];
}

export interface CarrierStatus {
  agents: AgentStatusEntry[];
  catalog: CatalogEntry[];
  receipt_count: number;
}

// Mirror of crate::config_parser::Section.
export interface ConfigSection {
  heading: string;
  body: string;
}

// Mirror of crate::config_parser::ParsedDocument.
export interface ConfigDocument {
  title: string | null;
  body: string;
  sections: ConfigSection[];
}

export type ConfigFile = "agent.md" | "user.md";

export const ipc = {
  async listTools(): Promise<unknown> {
    return invoke("mcp_list_tools");
  },

  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolCallResponse> {
    return invoke("mcp_call_tool", { name, arguments: args ?? null });
  },

  async emitBus(event: BusEvent): Promise<void> {
    return invoke("bus_emit", { event });
  },

  async onBus(
    handler: (env: BusEnvelope) => void,
  ): Promise<UnlistenFn> {
    return listen("surface-bus", (e: Event<BusEnvelope>) => handler(e.payload));
  },

  async onMcpReady(handler: () => void): Promise<UnlistenFn> {
    return listen("mcp:ready", () => handler());
  },

  async onMcpError(
    handler: (msg: string) => void,
  ): Promise<UnlistenFn> {
    return listen("mcp:error", (e: Event<{ error: string }>) =>
      handler(e.payload.error),
    );
  },

  async onAgentReady(
    handler: (agentId: string) => void,
  ): Promise<UnlistenFn> {
    return listen("agent:ready", (e: Event<{ agent: string }>) =>
      handler(e.payload.agent),
    );
  },

  async onAgentError(
    handler: (agentId: string, message: string) => void,
  ): Promise<UnlistenFn> {
    return listen(
      "agent:error",
      (e: Event<{ agent: string; error: string }>) =>
        handler(e.payload.agent, e.payload.error),
    );
  },

  async mcpStatus(): Promise<McpStatus> {
    return invoke("mcp_status");
  },

  async carrierStatus(): Promise<CarrierStatus> {
    return invoke("carrier_status");
  },

  async mcpReadResource(uri: string): Promise<ResourceReadResponse> {
    return invoke("mcp_read_resource", { uri });
  },

  async currentAgentMd(): Promise<ConfigDocument | null> {
    return invoke("current_agent_md");
  },

  async currentUserMd(): Promise<ConfigDocument | null> {
    return invoke("current_user_md");
  },

  async onConfigUpdated(
    handler: (file: ConfigFile) => void,
  ): Promise<UnlistenFn> {
    return listen("config:updated", (e: Event<{ file: string }>) => {
      const f = e.payload.file;
      if (f === "agent.md" || f === "user.md") handler(f);
    });
  },
};
