// Shared types between the React frontend and the Node mock-mcp-server.
// The Rust backend keeps its own mirror types in src-tauri/src/protocols/mcp/types.rs;
// kept in sync by hand for v0 (small surface, not worth a code-generator yet).

export type DroneStatus = "active" | "idle" | "grounded" | "charging" | "offline";

export interface DroneSnapshot {
  drone_id: string;
  callsign: string;
  lat: number;
  lon: number;
  status: DroneStatus;
  battery_pct: number;
  last_seen_iso: string;
}

export interface FleetStatusResult {
  generated_at_iso: string;
  drones: DroneSnapshot[];
}

// Tool registry — tool names live as a const so frontend, sidecar, and Rust
// are all referring to the same string. Cross-language sync is by convention.
export const TOOL_NAMES = {
  GET_FLEET_STATUS: "get_fleet_status",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
