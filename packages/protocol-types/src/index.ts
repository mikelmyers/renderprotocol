// Shared types between the React frontend and the Node mock-mcp-server.
// The Rust backend keeps its own mirror types in src-tauri/src/protocols/mcp/types.rs;
// kept in sync by hand for v0 (small surface, not worth a code-generator yet).
//
// Domain: a generic person opening their browser on a Tuesday morning. Six
// "services" are exposed as MCP tools. The render surface composes a default
// "morning brief" by calling them in parallel on open. One mock server pretends
// to be many services — each tool is named with a service prefix.

// ─── Mail ─────────────────────────────────────────────────────────────

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
  // Threads the agent surfaces by default. Order is the agent's recommended
  // reading order, not strictly chronological.
  flagged: MailThread[];
  recent_unread: MailThread[];
}

// ─── Calendar ─────────────────────────────────────────────────────────

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

// ─── News ─────────────────────────────────────────────────────────────

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

// ─── Weather ──────────────────────────────────────────────────────────

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
}

// ─── Messages ─────────────────────────────────────────────────────────

export type ChatChannel = "slack" | "imessage" | "signal" | "whatsapp" | "discord";

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

// ─── Docs ─────────────────────────────────────────────────────────────

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

// ─── Tool registry ────────────────────────────────────────────────────
//
// Tool names live as a const so frontend, sidecar, and Rust are all referring
// to the same string. Cross-language sync is by convention.
//
// Naming convention: `<service>_<verb>` — the prefix conveys which "service"
// the call is reaching, even though one mock server backs them all. MCP tool
// names allow `[a-zA-Z0-9_-]` only, so we use `_` as the separator instead of
// the dot you'd expect from a service-namespaced API.

export const TOOL_NAMES = {
  MAIL_GET_INBOX: "mail_get_inbox",
  CALENDAR_GET_TODAY: "calendar_get_today",
  NEWS_GET_FOLLOWING: "news_get_following",
  WEATHER_GET_LOCAL: "weather_get_local",
  MESSAGES_GET_RECENT: "messages_get_recent",
  DOCS_GET_RECENT: "docs_get_recent",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// Service descriptor — used by the host to label which "service" produced
// each card in the brief, and to drive the parallel tool-call composition.
export interface ServiceDescriptor {
  id: string;
  label: string;
  tool: ToolName;
}

export const SERVICES: readonly ServiceDescriptor[] = [
  { id: "mail", label: "Mail", tool: TOOL_NAMES.MAIL_GET_INBOX },
  { id: "calendar", label: "Calendar", tool: TOOL_NAMES.CALENDAR_GET_TODAY },
  { id: "messages", label: "Messages", tool: TOOL_NAMES.MESSAGES_GET_RECENT },
  { id: "news", label: "News", tool: TOOL_NAMES.NEWS_GET_FOLLOWING },
  { id: "weather", label: "Weather", tool: TOOL_NAMES.WEATHER_GET_LOCAL },
  { id: "docs", label: "Docs", tool: TOOL_NAMES.DOCS_GET_RECENT },
] as const;
