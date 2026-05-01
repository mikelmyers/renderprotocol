// Thin wrappers over Tauri invoke + listen so the rest of the app doesn't
// import @tauri-apps/api directly. Concentrates the IPC surface in one
// place — easier to mock for tests, easier to swap if the backend protocol
// shifts.

import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type { BusEnvelope, BusEvent } from "./types";

export interface ToolCallResponse {
  raw: unknown;
  structured: unknown | null;
  text: string | null;
}

export interface ResourceReadResponse {
  raw: unknown;
  mime_type: string | null;
  text: string | null;
}

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

  async readResource(uri: string): Promise<ResourceReadResponse> {
    return invoke("mcp_read_resource", { uri });
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
};
