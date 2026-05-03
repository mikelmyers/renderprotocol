// Shared types between the React frontend and the Node mock-mcp-server.
// The Rust backend keeps mirror types in src-tauri/src; kept in sync by
// hand for v0 (small surface, not worth a code-generator yet).
//
// Domain: a generic person opening their browser on a Tuesday morning.
// One mock MCP server pretends to be six services — mail, calendar,
// messages, news, weather, docs — each exposed as its own tool. The
// per-tool naming convention (`<service>_<verb>`) lets the host trace
// which service produced each piece of the morning brief.

// ── Mail ────────────────────────────────────────────────────────────

export type MailFlag = "starred" | "important" | "urgent" | null;

export interface MailThread {
  thread_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  received_iso: string;
  unread: boolean;
  flag: MailFlag;
}

export interface InboxBriefResult {
  generated_at_iso: string;
  unread_count: number;
  /** Threads the agent surfaces by default — flagged in the seed; ordered
   *  by the agent's recommended reading order, not strictly chronological. */
  flagged: MailThread[];
  /** Most recent unread, regardless of flag. */
  recent_unread: MailThread[];
}

// ── Calendar ────────────────────────────────────────────────────────

export type EventStatus = "upcoming" | "in_progress" | "past";
export type PrepStatus = "ready" | "needs_prep" | "none";

export interface CalendarEvent {
  event_id: string;
  title: string;
  start_iso: string;
  end_iso: string;
  location: string | null;
  attendees: string[];
  prep_status: PrepStatus;
  status: EventStatus;
}

export interface CalendarTodayResult {
  generated_at_iso: string;
  events: CalendarEvent[];
}

// ── Messages ────────────────────────────────────────────────────────

export type ChatChannel =
  | "slack"
  | "imessage"
  | "signal"
  | "whatsapp"
  | "discord";

export interface ChatMessage {
  message_id: string;
  channel: ChatChannel;
  conversation: string;
  preview: string;
  received_iso: string;
  unread: boolean;
}

export interface MessagesRecentResult {
  generated_at_iso: string;
  unread_count: number;
  messages: ChatMessage[];
}

// ── News ────────────────────────────────────────────────────────────

export interface NewsItem {
  item_id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_iso: string;
  topics: string[];
}

export interface NewsFollowingResult {
  generated_at_iso: string;
  items: NewsItem[];
}

// ── Weather ─────────────────────────────────────────────────────────

export interface WeatherForecastEntry {
  hour_iso: string;
  temp_f: number;
  condition: string;
  precip_pct: number;
}

export interface WeatherCurrent {
  temp_f: number;
  feels_like_f: number;
  condition: string;
  humidity_pct: number;
  wind_mph: number;
}

export interface WeatherLocalResult {
  generated_at_iso: string;
  location: string;
  current: WeatherCurrent;
  forecast_hourly: WeatherForecastEntry[];
  high_f: number;
  low_f: number;
  /** Plain-English summary that captures the actionable change for today
   *  ("rain after lunch"). The composer uses this to craft an alert tone. */
  headline: string;
  /** "ok" — clear or pleasant; "warn" — rain or significant change; "critical"
   *  — severe weather. Drives the AlertView tone in the brief. */
  alert_level: "ok" | "warn" | "critical";
}

// ── Docs ────────────────────────────────────────────────────────────

export type DocSource = "google_docs" | "notion" | "local" | "github";

export interface DocItem {
  doc_id: string;
  source: DocSource;
  title: string;
  preview: string;
  edited_iso: string;
  shared_with: string[];
}

export interface DocsRecentResult {
  generated_at_iso: string;
  docs: DocItem[];
}

// ── Tool registry ───────────────────────────────────────────────────

export const TOOL_NAMES = {
  MAIL_GET_INBOX: "mail_get_inbox",
  CALENDAR_GET_TODAY: "calendar_get_today",
  MESSAGES_GET_RECENT: "messages_get_recent",
  NEWS_GET_FOLLOWING: "news_get_following",
  WEATHER_GET_LOCAL: "weather_get_local",
  DOCS_GET_RECENT: "docs_get_recent",
  // Domain-agnostic action recorder; survived the scenario pivot.
  RECORD_ACTION: "record_action",
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
