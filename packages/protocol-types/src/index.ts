// Shared types between the React frontend and the Node mock-mcp-server.
// The Rust backend keeps mirror types in src-tauri/src; kept in sync by
// hand for v0 (small surface, not worth a code-generator yet).

// ── Drone fleet ──────────────────────────────────────────────────────

export type DroneStatus =
  | "active"
  | "idle"
  | "grounded"
  | "charging"
  | "offline";

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

// ── Anomaly events (timeline) ───────────────────────────────────────

export type AnomalySeverity = "info" | "warn" | "critical";

export interface AnomalyEvent {
  id: string;
  ts_iso: string;
  drone_id: string;
  kind: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
}

export interface AnomaliesResult {
  generated_at_iso: string;
  range_hours: number;
  events: AnomalyEvent[];
}

// ── Weather window (alert / indicator) ──────────────────────────────

export type WeatherWindowState = "open" | "marginal" | "closed";

export interface WeatherWindow {
  state: WeatherWindowState;
  window_open_iso: string;
  window_close_iso: string;
  conditions: string;
  score: number; // 0..1
  notes: string[];
}

// ── Customer reports (table / inbox) ────────────────────────────────

export interface CustomerReport {
  id: string;
  customer: string;
  subject: string;
  preview: string;
  ts_iso: string;
  unread: boolean;
  priority: "low" | "normal" | "high";
}

export interface CustomerReportsResult {
  generated_at_iso: string;
  reports: CustomerReport[];
}

// ── Telemetry (live feed) ───────────────────────────────────────────

export interface TelemetrySample {
  ts_iso: string;
  vibration_g: number;
  altitude_m: number;
  battery_pct: number;
  temp_c: number;
}

export interface TelemetryResult {
  drone_id: string;
  range_seconds: number;
  samples: TelemetrySample[];
}

// ── Tool registry ───────────────────────────────────────────────────

export const TOOL_NAMES = {
  GET_FLEET_STATUS: "get_fleet_status",
  GET_ANOMALIES: "get_anomalies",
  GET_WEATHER_WINDOW: "get_weather_window",
  GET_CUSTOMER_REPORTS: "get_customer_reports",
  GET_DRONE_TELEMETRY: "get_drone_telemetry",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ── MCP Apps (SEP-1865) UI resources ────────────────────────────────

export const UI_RESOURCE_URIS = {
  HELLO: "ui://renderprotocol/hello",
} as const;

// Envelope for postMessage between an MCP App iframe and the host.
// The wire shape here is the one we control on our side; the actual
// SEP-1865 envelope is a superset and may carry more fields. We keep
// this minimal and ignore anything we don't recognize.
export interface McpAppMessage {
  source: "mcp-app";
  // Free-form for v0. Future: align with the JSON-RPC subset SEP-1865
  // defines for iframe-to-host RPC.
  type: string;
  payload?: unknown;
}
