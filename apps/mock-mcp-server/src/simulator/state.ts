import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  CalendarEvent,
  CalendarTodayResult,
  ChatChannel,
  ChatMessage,
  DocItem,
  DocSource,
  DocsRecentResult,
  EventStatus,
  InboxBriefResult,
  MailFlag,
  MailThread,
  MessagesRecentResult,
  NewsFollowingResult,
  NewsItem,
  PrepStatus,
  WeatherForecastEntry,
  WeatherLocalResult,
} from "@renderprotocol/protocol-types";

// In-memory simulator state for the mock MCP server.
//
// The seed file holds fixed content (subjects, titles, etc.) plus offsets
// relative to "now"; the simulator turns those into ISO timestamps each
// time a tool is called so the demo always feels live regardless of when
// the dev environment was last running.
//
// Six services share one process here. Splitting them into separate mock
// servers later doesn't change this shape — only the wiring layer.

const __dirname = dirname(fileURLToPath(import.meta.url));
// fixtures/ rather than data/: the repo's .gitignore swallows data/ for
// runtime files (audit DB, etc.), and the seed is source-controlled
// fixture data, not runtime state.
const seedPath = resolve(__dirname, "../fixtures/seed.json");

interface SeedMailThread {
  thread_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  received_offset_s: number;
  unread: boolean;
  flag: MailFlag;
}

interface SeedMail {
  extra_unread_count: number;
  flagged: SeedMailThread[];
  recent_unread: SeedMailThread[];
}

interface SeedCalendarEvent {
  event_id: string;
  title: string;
  start_offset_s: number;
  duration_s: number;
  location: string | null;
  attendees: string[];
  prep_status: PrepStatus;
}

interface SeedCalendar {
  events: SeedCalendarEvent[];
}

interface SeedMessage {
  message_id: string;
  channel: ChatChannel;
  conversation: string;
  preview: string;
  received_offset_s: number;
  unread: boolean;
}

interface SeedMessages {
  messages: SeedMessage[];
}

interface SeedNewsItem {
  item_id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_offset_s: number;
  topics: string[];
}

interface SeedNews {
  items: SeedNewsItem[];
}

interface SeedForecastEntry {
  hour_offset_s: number;
  temp_f: number;
  condition: string;
  precip_pct: number;
}

interface SeedWeather {
  location: string;
  headline: string;
  alert_level: WeatherLocalResult["alert_level"];
  current: WeatherLocalResult["current"];
  forecast_hourly: SeedForecastEntry[];
  high_f: number;
  low_f: number;
}

interface SeedDoc {
  doc_id: string;
  source: DocSource;
  title: string;
  preview: string;
  edited_offset_s: number;
  shared_with: string[];
}

interface SeedDocs {
  docs: SeedDoc[];
}

interface Seed {
  user: { name: string; location: string };
  mail: SeedMail;
  calendar: SeedCalendar;
  messages: SeedMessages;
  news: SeedNews;
  weather: SeedWeather;
  docs: SeedDocs;
}

const seed: Seed = JSON.parse(readFileSync(seedPath, "utf8"));

// ── Helpers ─────────────────────────────────────────────────────────

function isoFromOffset(offsetSeconds: number): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function hydrateMail(t: SeedMailThread): MailThread {
  return {
    thread_id: t.thread_id,
    subject: t.subject,
    from_name: t.from_name,
    from_email: t.from_email,
    preview: t.preview,
    received_iso: isoFromOffset(t.received_offset_s),
    unread: t.unread,
    flag: t.flag,
  };
}

function eventStatusFromOffset(startOffsetS: number, durationS: number): EventStatus {
  if (startOffsetS > 0) return "upcoming";
  if (startOffsetS + durationS > 0) return "in_progress";
  return "past";
}

function hydrateEvent(e: SeedCalendarEvent): CalendarEvent {
  const startMs = Date.now() + e.start_offset_s * 1000;
  return {
    event_id: e.event_id,
    title: e.title,
    start_iso: new Date(startMs).toISOString(),
    end_iso: new Date(startMs + e.duration_s * 1000).toISOString(),
    location: e.location,
    attendees: e.attendees,
    prep_status: e.prep_status,
    status: eventStatusFromOffset(e.start_offset_s, e.duration_s),
  };
}

function hydrateMessage(m: SeedMessage): ChatMessage {
  return {
    message_id: m.message_id,
    channel: m.channel,
    conversation: m.conversation,
    preview: m.preview,
    received_iso: isoFromOffset(m.received_offset_s),
    unread: m.unread,
  };
}

function hydrateNews(n: SeedNewsItem): NewsItem {
  return {
    item_id: n.item_id,
    source: n.source,
    title: n.title,
    summary: n.summary,
    url: n.url,
    published_iso: isoFromOffset(n.published_offset_s),
    topics: n.topics,
  };
}

function hydrateForecast(f: SeedForecastEntry): WeatherForecastEntry {
  return {
    hour_iso: isoFromOffset(f.hour_offset_s),
    temp_f: f.temp_f,
    condition: f.condition,
    precip_pct: f.precip_pct,
  };
}

function hydrateDoc(d: SeedDoc): DocItem {
  return {
    doc_id: d.doc_id,
    source: d.source,
    title: d.title,
    preview: d.preview,
    edited_iso: isoFromOffset(d.edited_offset_s),
    shared_with: d.shared_with,
  };
}

// ── Public snapshot getters ─────────────────────────────────────────

export function getInboxBrief(): InboxBriefResult {
  const flagged = seed.mail.flagged.map(hydrateMail);
  const recent_unread = seed.mail.recent_unread.map(hydrateMail);
  const flaggedUnread = flagged.filter((t) => t.unread).length;
  const recentUnread = recent_unread.filter((t) => t.unread).length;
  return {
    generated_at_iso: new Date().toISOString(),
    unread_count: flaggedUnread + recentUnread + seed.mail.extra_unread_count,
    flagged,
    recent_unread,
  };
}

export function getCalendarToday(): CalendarTodayResult {
  return {
    generated_at_iso: new Date().toISOString(),
    events: seed.calendar.events.map(hydrateEvent),
  };
}

export function getMessagesRecent(): MessagesRecentResult {
  const messages = seed.messages.messages.map(hydrateMessage);
  return {
    generated_at_iso: new Date().toISOString(),
    unread_count: messages.filter((m) => m.unread).length,
    messages,
  };
}

export function getNewsFollowing(): NewsFollowingResult {
  return {
    generated_at_iso: new Date().toISOString(),
    items: seed.news.items.map(hydrateNews),
  };
}

export function getWeatherLocal(): WeatherLocalResult {
  return {
    generated_at_iso: new Date().toISOString(),
    location: seed.weather.location,
    headline: seed.weather.headline,
    alert_level: seed.weather.alert_level,
    current: seed.weather.current,
    forecast_hourly: seed.weather.forecast_hourly.map(hydrateForecast),
    high_f: seed.weather.high_f,
    low_f: seed.weather.low_f,
  };
}

export function getDocsRecent(): DocsRecentResult {
  return {
    generated_at_iso: new Date().toISOString(),
    docs: seed.docs.docs.map(hydrateDoc),
  };
}
