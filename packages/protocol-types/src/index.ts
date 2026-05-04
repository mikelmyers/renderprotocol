// Shared types between the React frontend and the Node mock-mcp-server.
// The Rust backend keeps mirror types in src-tauri/src/protocols/mcp/types.rs;
// kept in sync by hand for v0 (small surface, not worth a code-generator yet).

// Tool name registry — names live as a const so frontend, sidecar, and Rust
// all reference the same string. Cross-language sync is by convention.
export const TOOL_NAMES = {
  LOOKUP: "lookup",
  LIST_ITEMS: "list_items",
  GET_ALERTS: "get_alerts",
  GET_RECENT_EVENTS: "get_recent_events",
  WIDGET: "widget",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// ─── lookup ──────────────────────────────────────────────────────────────
// A hosting agent answers a free-text query with a markdown blob. Closest
// shape to "user expresses intent, carrier returns rankable results."
// In v0 the mock server is the only hosting agent and the carrier is a
// passthrough; later, multiple hosting agents implement this same tool
// surface and the carrier ranks between them.

export interface LookupArgs {
  query: string;
}

export interface LookupResult {
  markdown: string;
}

// ─── list_items ──────────────────────────────────────────────────────────
// Tabular response. The agent returns a column schema plus rows. Cell
// values are scalar — primitives don't render nested structures inline.

export interface ListItemsArgs {
  query?: string;
}

export interface TableColumn {
  key: string;
  label: string;
}

export type TableCell = string | number | boolean | null;
export type TableRow = Record<string, TableCell>;

export interface ListItemsResult {
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
}

// ─── get_alerts ──────────────────────────────────────────────────────────
// A list of items needing attention. Severity drives color coding in the
// AlertView primitive.

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  /// Optional markdown body for context (rendered safely by the host).
  body?: string;
  ts_ms: number;
}

export interface GetAlertsArgs {
  query?: string;
}

export interface GetAlertsResult {
  alerts: AlertItem[];
}

// ─── get_recent_events ───────────────────────────────────────────────────
// Sequence of events with timestamps. TimelineView renders them vertically.

export interface TimelineEvent {
  id: string;
  ts_ms: number;
  title: string;
  description?: string;
  /// Free-form category; used for color/icon coding by the primitive.
  kind?: string;
}

export interface GetRecentEventsArgs {
  query?: string;
}

export interface GetRecentEventsResult {
  events: TimelineEvent[];
}
