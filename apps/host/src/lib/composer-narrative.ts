// Deterministic narrative generator for the conversation panel.
//
// Single function so the LLM swap is one file: when we connect a real
// model later, this signature stays the same — `(plan, layout, data) →
// NarrativeSpec` — and the UI doesn't change. v0 is templating; v1 is a
// model call against the same input.

import type { CompositionPlan, LayoutSpec, NarrativeSpec } from "./composer";
import type {
  CalendarTodayResult,
  InboxBriefResult,
  MessagesRecentResult,
  WeatherLocalResult,
} from "@renderprotocol/protocol-types";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { toolKey } from "./composer";

export function summarize(
  plan: CompositionPlan,
  layout: LayoutSpec,
  data: Map<string, unknown>,
  active_agent_title: string | null,
): NarrativeSpec {
  const lines: string[] = [];
  const refs: string[] = [];

  // Greeting line that acknowledges the role. Short — never the headline.
  if (active_agent_title) {
    lines.push(`Morning brief — ${active_agent_title}.`);
  }

  // ── Mail: surface the most urgent flagged thread by name + ref. ──
  const inbox = data.get(toolKey(TOOL_NAMES.MAIL_GET_INBOX)) as
    | InboxBriefResult
    | undefined;
  if (inbox) {
    const urgent = inbox.flagged.find(
      (t) => t.flag === "urgent" && t.unread,
    );
    if (urgent) {
      // Prefer the table's element id since the table is more durable
      // than the action card (which can _skip on no-action mornings).
      const slotId = layout.slots.find(
        (s) =>
          s.primitive === "table" &&
          s.source_tool === TOOL_NAMES.MAIL_GET_INBOX,
      )?.id;
      const ref = slotId
        ? `${slotId}/table/${TOOL_NAMES.MAIL_GET_INBOX}/${urgent.thread_id}`
        : null;
      if (ref) refs.push(ref);
      const subject = ref ? `[ref:${ref}]` : `"${urgent.subject}"`;
      lines.push(`Urgent in mail: ${subject} from ${urgent.from_name}.`);
    } else if (inbox.flagged.length > 0) {
      lines.push(
        `${inbox.unread_count} unread, ${inbox.flagged.length} flagged.`,
      );
    } else {
      lines.push(`${inbox.unread_count} unread.`);
    }
  }

  // ── Calendar: next upcoming event + prep status. ─────────────────
  const cal = data.get(toolKey(TOOL_NAMES.CALENDAR_GET_TODAY)) as
    | CalendarTodayResult
    | undefined;
  const next = cal?.events.find((e) => e.status === "upcoming");
  if (next) {
    const slotId = layout.slots.find(
      (s) =>
        s.primitive === "timeline" &&
        s.source_tool === TOOL_NAMES.CALENDAR_GET_TODAY,
    )?.id;
    const ref = slotId
      ? `${slotId}/timeline/${TOOL_NAMES.CALENDAR_GET_TODAY}/${next.event_id}`
      : null;
    if (ref) refs.push(ref);
    const title = ref ? `[ref:${ref}]` : next.title;
    const prepNote = next.prep_status === "needs_prep" ? " — needs prep" : "";
    lines.push(`Next: ${title} at ${shortTime(next.start_iso)}${prepNote}.`);
  }

  // ── Weather: location + current + headline. ──────────────────────
  const weather = data.get(toolKey(TOOL_NAMES.WEATHER_GET_LOCAL)) as
    | WeatherLocalResult
    | undefined;
  if (weather) {
    lines.push(
      `${weather.location}: ${weather.current.temp_f}°F ${weather.current.condition.toLowerCase()}; ${weather.headline.toLowerCase()}.`,
    );
  }

  // ── Messages: only mention if there are unread DMs. ──────────────
  const messages = data.get(toolKey(TOOL_NAMES.MESSAGES_GET_RECENT)) as
    | MessagesRecentResult
    | undefined;
  if (messages && messages.unread_count > 0) {
    const conversations = messages.messages
      .filter((m) => m.unread)
      .slice(0, 2)
      .map((m) => m.conversation)
      .join(", ");
    lines.push(
      `${messages.unread_count} unread message${messages.unread_count === 1 ? "" : "s"} (${conversations}).`,
    );
  }

  // ── Watching: concerns we surface but can't address yet. ─────────
  if (layout.watching.length > 0) {
    const labels = layout.watching.map((w) => w.label.toLowerCase()).join("; ");
    lines.push(`Watching (no tool connected yet): ${labels}.`);
  }

  return { body: lines.join("\n\n"), refs };
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
