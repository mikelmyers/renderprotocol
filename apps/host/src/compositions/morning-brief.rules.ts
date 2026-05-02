// Morning brief composition rules.
//
// Each rule scans (user.md, agent.md) for a reason to fire. If matched,
// it nominates a tool to call and a primitive to render. Importance
// shapes order; higher = earlier in the layout. Operator user.md
// preferences ("flagged email above the rest", "timelines and lists
// over dense tables") are encoded by the importance numbers below —
// keep them auditable from this file alone.
//
// Adding a new tool? Add a rule. Removing a domain? Remove the rule.
// The composer engine in lib/composer.ts is intent-agnostic; only this
// file knows about morning briefs.

import {
  TOOL_NAMES,
  UI_RESOURCE_URIS,
  type CalendarTodayResult,
  type DocsRecentResult,
  type InboxBriefResult,
  type MailThread,
  type MessagesRecentResult,
  type NewsFollowingResult,
  type WeatherLocalResult,
} from "@renderprotocol/protocol-types";
import {
  bulletMentions,
  findAgentDefault,
  findStandingConcern,
  type ComposeContext,
  type Rule,
  type SlotTrace,
  type WatchingItem,
} from "../lib/composer";
import type {
  TimelineEvent,
  TimelineSeverity,
} from "../components/render-field/primitives/TimelineView";
import type { AlertTone } from "../components/render-field/primitives/AlertView";
import type {
  TabularColumn,
  TabularRow,
} from "../components/render-field/primitives/TabularView";

// Single source of truth for the keywords each rule searches for. Keeps
// rule bodies short and the matching transparent. Explicit shape avoids
// `noUncheckedIndexedAccess` widening to `string[] | undefined` at use.
interface Needles {
  mail: string[];
  calendar: string[];
  messages: string[];
  news: string[];
  weather: string[];
  docs: string[];
}
const NEEDLES: Needles = {
  mail: ["mail", "inbox", "email"],
  calendar: ["calendar", "schedule", "event", "meeting"],
  messages: ["message", "dm", "chat"],
  news: ["news", "feed", "reading"],
  weather: ["weather", "forecast"],
  docs: ["doc", "document", "file"],
};

// ── Rules ────────────────────────────────────────────────────────────

// Action card: the most urgent flagged thread becomes a "Reply now?" card.
// Domain-agnostic shape — same machinery would work for "approve this
// purchase?" or "decline this meeting?" in another scenario.
const urgentMailActionRule: Rule = {
  id: "urgent-mail-action",
  primitive: "action_card",
  // Re-uses the inbox tool — the card's data comes from there. The
  // composer dedupes the call with the mail-table rule below.
  tool: { name: TOOL_NAMES.MAIL_GET_INBOX },
  importance: 0.97, // Top of the brief — actions need attention.
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.mail);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.mail);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const inbox = data as InboxBriefResult | undefined;
    const target =
      inbox?.flagged.find((t) => t.flag === "urgent" && t.unread) ??
      inbox?.flagged.find((t) => t.unread);
    if (!target) {
      return { _skip: true };
    }
    return {
      action_id: `mail-reply/${target.thread_id}`,
      headline: `Reply to ${target.from_name}?`,
      detail: target.subject,
      meta: {
        flag: target.flag ?? "unread",
        received: target.received_iso,
      },
      confidence: 0.7,
      payload: {
        thread_id: target.thread_id,
        from_email: target.from_email,
      },
      approve_label: "Draft reply",
      reject_label: "Not now",
    };
  },
};

const calendarTimelineRule: Rule = {
  id: "calendar-timeline",
  primitive: "timeline",
  tool: { name: TOOL_NAMES.CALENDAR_GET_TODAY },
  importance: 0.85,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.calendar);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.calendar);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const cal = data as CalendarTodayResult | undefined;
    const events: TimelineEvent[] = (cal?.events ?? []).map((e) => ({
      id: e.event_id,
      ts_iso: e.start_iso,
      title: e.title,
      ...(e.location ? { body: e.location } : {}),
      severity: eventSeverity(e.status, e.prep_status),
      meta: {
        ...(e.attendees.length > 0
          ? { with: e.attendees.filter((a) => a !== "you").join(", ") }
          : {}),
        ...(e.prep_status === "needs_prep" ? { prep: "needs prep" } : {}),
        status: e.status,
      },
    }));
    return { events };
  },
};

const weatherAlertRule: Rule = {
  id: "weather-alert",
  primitive: "alert",
  tool: { name: TOOL_NAMES.WEATHER_GET_LOCAL },
  importance: 0.75,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.weather);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.weather);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const w = data as WeatherLocalResult | undefined;
    if (!w) {
      return {
        headline: "Weather unavailable",
        tone: "neutral" as AlertTone,
      };
    }
    const tone: AlertTone =
      w.alert_level === "critical"
        ? "critical"
        : w.alert_level === "warn"
          ? "warn"
          : "ok";
    return {
      tone,
      headline: w.headline,
      detail: `${w.location} — ${w.current.temp_f}°F ${w.current.condition.toLowerCase()}`,
      meta: {
        high: `${w.high_f}°`,
        low: `${w.low_f}°`,
        wind: `${w.current.wind_mph} mph`,
        humidity: `${w.current.humidity_pct}%`,
      },
    };
  },
};

const mailTableRule: Rule = {
  id: "mail-table",
  primitive: "table",
  tool: { name: TOOL_NAMES.MAIL_GET_INBOX },
  importance: 0.65,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.mail);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.mail);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const inbox = data as InboxBriefResult | undefined;
    const columns: TabularColumn[] = [
      { key: "from", label: "From" },
      { key: "subject", label: "Subject" },
      { key: "flag", label: "Flag", type: "priority" },
      { key: "received_iso", label: "Received", type: "timestamp", align: "right" },
    ];
    const rows: TabularRow[] = mergeMailRows(inbox);
    return { columns, rows };
  },
};

const messagesTableRule: Rule = {
  id: "messages-table",
  primitive: "table",
  tool: { name: TOOL_NAMES.MESSAGES_GET_RECENT },
  importance: 0.55,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.messages);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.messages);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const r = data as MessagesRecentResult | undefined;
    const columns: TabularColumn[] = [
      { key: "channel", label: "App", type: "muted-text" },
      { key: "conversation", label: "Conversation" },
      { key: "preview", label: "Preview", type: "muted-text" },
      { key: "received_iso", label: "Received", type: "timestamp", align: "right" },
    ];
    const rows: TabularRow[] = (r?.messages ?? []).map((m) => ({
      id: m.message_id,
      channel: m.channel,
      conversation: m.unread ? `${m.conversation} •` : m.conversation,
      preview: m.preview,
      received_iso: m.received_iso,
    }));
    return { columns, rows };
  },
};

const newsTimelineRule: Rule = {
  id: "news-timeline",
  primitive: "timeline",
  tool: { name: TOOL_NAMES.NEWS_GET_FOLLOWING },
  importance: 0.45,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.news);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.news);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const n = data as NewsFollowingResult | undefined;
    const events: TimelineEvent[] = (n?.items ?? []).map((item) => ({
      id: item.item_id,
      ts_iso: item.published_iso,
      title: item.title,
      body: item.summary,
      severity: "info",
      meta: {
        source: item.source,
        ...(item.topics.length > 0 ? { topics: item.topics.join(", ") } : {}),
      },
    }));
    return { events };
  },
};

const docsTableRule: Rule = {
  id: "docs-table",
  primitive: "table",
  tool: { name: TOOL_NAMES.DOCS_GET_RECENT },
  importance: 0.35,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.docs);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.docs);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const d = data as DocsRecentResult | undefined;
    const columns: TabularColumn[] = [
      { key: "source", label: "Source", type: "muted-text" },
      { key: "title", label: "Title" },
      { key: "shared_with", label: "Shared", type: "muted-text" },
      { key: "edited_iso", label: "Edited", type: "timestamp", align: "right" },
    ];
    const rows: TabularRow[] = (d?.docs ?? []).map((doc) => ({
      id: doc.doc_id,
      source: docSourceLabel(doc.source),
      title: doc.title,
      shared_with: doc.shared_with.length > 0 ? doc.shared_with.join(", ") : "—",
      edited_iso: doc.edited_iso,
    }));
    return { columns, rows };
  },
};

// ── MCP App slot ───────────────────────────────────────────────────
// Demonstrates that the composer can include a SEP-1865 ui:// resource
// alongside structured-data primitives. The resource itself is the
// minimal hello sandbox — kept on through the scenario pivot so the
// iframe path stays exercised.
const mcpAppSlotRule: Rule = {
  id: "mcp-app-hello",
  primitive: "mcp_app",
  tool: null,
  importance: 0.05,
  matches(ctx) {
    if (ctx.agent) {
      return {
        reason: "MCP App slot — hello sandbox",
        source: { kind: "default" },
      };
    }
    return null;
  },
  buildProps() {
    return {
      uri: UI_RESOURCE_URIS.HELLO,
      title: "MCP App — sandbox check",
      initialHeight: 220,
    };
  },
};

export const MORNING_BRIEF_RULES: Rule[] = [
  urgentMailActionRule,
  calendarTimelineRule,
  weatherAlertRule,
  mailTableRule,
  messagesTableRule,
  newsTimelineRule,
  docsTableRule,
  mcpAppSlotRule,
];

// ── Watching scan (concerns with no tool match) ──────────────────────

/**
 * Surfaces user.md standing concerns that no rule fired for. The morning
 * brief shouldn't pretend a concern is being watched if there's no
 * corresponding tool — surface them as "watching, no tool connected" so
 * the system feels honest about its blind spots.
 */
export function morningBriefWatching(
  ctx: ComposeContext,
  covered: Set<string>,
): WatchingItem[] {
  const out: WatchingItem[] = [];
  if (!ctx.user) return out;
  for (const concern of ctx.user.typed.standing_concerns) {
    if (covered.has(concern.toLowerCase())) continue;
    out.push({
      label: concern,
      source: { kind: "user_md", section: "Standing concerns", bullet: concern },
    });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────

function userTrace(section: string, bullet: string): SlotTrace {
  return {
    reason: `Standing concern: ${bullet}`,
    source: { kind: "user_md", section, bullet },
  };
}

function agentTrace(section: string, bullet: string): SlotTrace {
  return {
    reason: `Agent default: ${bullet}`,
    source: { kind: "agent_md", section, bullet },
  };
}

function eventSeverity(
  status: CalendarTodayResult["events"][number]["status"],
  prep: CalendarTodayResult["events"][number]["prep_status"],
): TimelineSeverity {
  if (status === "in_progress") return "ok";
  if (prep === "needs_prep") return "warn";
  return "info";
}

function mergeMailRows(inbox: InboxBriefResult | undefined): TabularRow[] {
  if (!inbox) return [];
  const seen = new Set<string>();
  const ordered: MailThread[] = [];
  for (const t of [...inbox.flagged, ...inbox.recent_unread]) {
    if (seen.has(t.thread_id)) continue;
    seen.add(t.thread_id);
    ordered.push(t);
  }
  return ordered.map((t) => ({
    id: t.thread_id,
    from: t.unread ? `${t.from_name} •` : t.from_name,
    subject: t.subject,
    // Map mail flags onto the table's priority column. "urgent" → high,
    // "important" → normal, "starred" → low; null → empty cell.
    flag: t.flag === "urgent" ? "high" : t.flag === "important" ? "normal" : t.flag === "starred" ? "low" : "",
    received_iso: t.received_iso,
  }));
}

function docSourceLabel(s: DocsRecentResult["docs"][number]["source"]): string {
  switch (s) {
    case "google_docs":
      return "Docs";
    case "notion":
      return "Notion";
    case "github":
      return "GitHub";
    case "local":
      return "Local";
  }
}

// Re-export the helper so callers can inspect what matched without
// pulling the full composer module.
export { bulletMentions };
