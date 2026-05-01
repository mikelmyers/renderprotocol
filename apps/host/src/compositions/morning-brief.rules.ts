// Morning brief composition rules.
//
// Each rule scans (user.md, agent.md) for a reason to fire. If matched,
// it nominates a tool to call and a primitive to render. Importance
// shapes order; higher = earlier in the layout. Operator user.md
// preferences ("Anomalies before all-clears", "Maps and timelines over
// tables") are encoded by the importance numbers below — keep them
// auditable from this file alone.
//
// Adding a new tool? Add a rule. Removing a domain? Remove the rule.
// The composer engine in lib/composer.ts is intent-agnostic; only this
// file knows about morning briefs.

import {
  TOOL_NAMES,
  type AnomaliesResult,
  type CustomerReportsResult,
  type FleetStatusResult,
  type TelemetryResult,
  type WeatherWindow,
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
import type { TimelineEvent, TimelineSeverity } from "../components/render-field/primitives/TimelineView";
import type { AlertTone } from "../components/render-field/primitives/AlertView";
import type { TabularColumn, TabularRow } from "../components/render-field/primitives/TabularView";
import type { LiveSample } from "../components/render-field/primitives/LiveFeedView";

const COMPOSITION = "morning-brief";

// Single source of truth for the keywords each rule searches for. Keeps
// the rule body short and the matching transparent.
const NEEDLES = {
  fleet: ["drone", "fleet"],
  weather: ["weather", "flight window"],
  customers: ["customer", "report", "inbox", "communication"],
  telemetry: ["telemetry", "hardware", "vibration"],
} as const;

// ── Rules ────────────────────────────────────────────────────────────

const fleetMapRule: Rule = {
  id: "fleet-map",
  primitive: "map",
  tool: { name: TOOL_NAMES.GET_FLEET_STATUS },
  importance: 0.9,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.fleet);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.fleet);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const fleet = data as FleetStatusResult | undefined;
    return { data: fleet ?? { generated_at_iso: "", drones: [] } };
  },
};

const anomaliesRule: Rule = {
  id: "anomalies-timeline",
  primitive: "timeline",
  tool: { name: TOOL_NAMES.GET_ANOMALIES },
  // user.md says "Anomalies before all-clears" — anomalies sit above the
  // fleet map and the weather indicator unless either fires for a more
  // urgent reason. Importance reflects that.
  importance: 0.95,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, ["hardware", "anomal"]);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, ["anomal"]);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const anoms = data as AnomaliesResult | undefined;
    const events: TimelineEvent[] = (anoms?.events ?? []).map((e) => ({
      id: e.id,
      ts_iso: e.ts_iso,
      title: e.title,
      body: e.detail,
      severity: severityToTimeline(e.severity),
      meta: { drone: e.drone_id, kind: e.kind },
    }));
    return { events };
  },
};

const weatherAlertRule: Rule = {
  id: "weather-alert",
  primitive: "alert",
  tool: { name: TOOL_NAMES.GET_WEATHER_WINDOW },
  importance: 0.7,
  matches(ctx) {
    // Either explicit user concern OR an agent-default mentioning weather.
    const sc = findStandingConcern(ctx.user, NEEDLES.weather);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.weather);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const w = data as WeatherWindow | undefined;
    if (!w) return { headline: "Weather window unavailable", tone: "neutral" as AlertTone };
    const tone: AlertTone =
      w.state === "open" ? "ok" : w.state === "marginal" ? "warn" : "critical";
    return {
      tone,
      headline:
        w.state === "open"
          ? "Weather window open"
          : w.state === "marginal"
            ? "Weather window marginal"
            : "Weather window closed",
      detail: w.conditions,
      meta: {
        opens: shortTime(w.window_open_iso),
        closes: shortTime(w.window_close_iso),
        score: `${Math.round(w.score * 100)}%`,
      },
    };
  },
};

const customerReportsRule: Rule = {
  id: "customer-reports-table",
  primitive: "table",
  tool: { name: TOOL_NAMES.GET_CUSTOMER_REPORTS },
  // user.md says "maps and timelines over tables when possible" — table
  // sits below the visual primitives. Surfaces if the agent contract or
  // user concerns mention customers/reports/communication.
  importance: 0.4,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.customers);
    if (sc) return userTrace("Standing concerns", sc);
    const ad = findAgentDefault(ctx.agent, NEEDLES.customers);
    if (ad) return agentTrace("Defaults", ad);
    return null;
  },
  buildProps(data) {
    const r = data as CustomerReportsResult | undefined;
    const columns: TabularColumn[] = [
      { key: "customer", label: "Customer" },
      { key: "subject", label: "Subject" },
      { key: "priority", label: "Priority", type: "priority" },
      { key: "ts_iso", label: "Received", type: "timestamp", align: "right" },
    ];
    const rows: TabularRow[] = (r?.reports ?? []).map((row) => ({
      id: row.id,
      customer: row.unread ? `${row.customer} •` : row.customer,
      subject: row.subject,
      priority: row.priority,
      ts_iso: row.ts_iso,
    }));
    return { columns, rows };
  },
};

const telemetryFeedRule: Rule = {
  id: "drone-7-vibration",
  primitive: "live_feed",
  // The hardware-health concern in user.md tags drone hardware specifically;
  // we surface drone-7's vibration as the live signal because anomaly fixture
  // flags it as the warn-level event. When the anomaly tool returns
  // different drones, this rule should follow — handled here by reading the
  // anomaly result through `args` once that wire is in place.
  tool: { name: TOOL_NAMES.GET_DRONE_TELEMETRY, args: { drone_id: "drone-7", range_seconds: 60 } },
  importance: 0.55,
  matches(ctx) {
    const sc = findStandingConcern(ctx.user, NEEDLES.telemetry);
    if (sc) return userTrace("Standing concerns", sc);
    return null;
  },
  buildProps(data) {
    const t = data as TelemetryResult | undefined;
    const samples: LiveSample[] = (t?.samples ?? []).map((s) => ({
      ts_ms: new Date(s.ts_iso).getTime(),
      value: s.vibration_g,
    }));
    return {
      entity: `${t?.drone_id ?? "unknown"}/vibration`,
      label: `${t?.drone_id ?? "unknown"} vibration`,
      unit: "g",
      samples,
      threshold: { warn: 1.2, critical: 1.6 },
    };
  },
};

export const MORNING_BRIEF_RULES: Rule[] = [
  anomaliesRule,
  fleetMapRule,
  weatherAlertRule,
  telemetryFeedRule,
  customerReportsRule,
];

// ── Watching scan (concerns with no tool match) ──────────────────────

/**
 * Surfaces user.md standing concerns that no rule fired for. The morning
 * brief shouldn't pretend a concern is being watched if there's no
 * corresponding tool — surface them as "watching, no tool connected" so
 * the system feels honest about its blind spots.
 */
export function morningBriefWatching(ctx: ComposeContext, covered: Set<string>): WatchingItem[] {
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

// ── trace + helper utilities ────────────────────────────────────────

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

function severityToTimeline(s: AnomaliesResult["events"][number]["severity"]): TimelineSeverity {
  if (s === "warn") return "warn";
  if (s === "critical") return "critical";
  return "info";
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Re-export the helper so callers can inspect what matched without
// pulling the full composer module.
export { bulletMentions };
