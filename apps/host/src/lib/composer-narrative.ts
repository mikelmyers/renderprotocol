// Deterministic narrative generator for the conversation panel.
//
// Single function so the LLM swap is one file: when we connect a real
// model later, this signature stays the same — `(plan, layout, data) →
// NarrativeSpec` — and the UI doesn't change. v0 is templating; v1 is a
// model call against the same input.

import type { CompositionPlan, LayoutSpec, NarrativeSpec } from "./composer";
import type {
  AnomaliesResult,
  CustomerReportsResult,
  FleetStatusResult,
  WeatherWindow,
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

  const fleet = data.get(toolKey(TOOL_NAMES.GET_FLEET_STATUS)) as FleetStatusResult | undefined;
  if (fleet) {
    const active = fleet.drones.filter((d) => d.status === "active").length;
    const total = fleet.drones.length;
    lines.push(`Fleet at ${active} of ${total} drones active.`);
  }

  const anoms = data.get(toolKey(TOOL_NAMES.GET_ANOMALIES)) as AnomaliesResult | undefined;
  if (anoms) {
    const flagged = anoms.events.filter((e) => e.severity !== "info");
    if (flagged.length === 0) {
      lines.push("No flagged anomalies. Standing watches quiet.");
    } else {
      const slot = layout.slots.find((s) => s.primitive === "timeline");
      const slotId = slot?.id ?? null;
      const subset = flagged.slice(0, 2);
      const tokens = subset.map((e) => {
        // Anomaly element_ids inside the timeline are
        // <slotId>/<primitive>/<source_tool>/<entity>. The ElementWrapper
        // inside TimelineView constructs them via makeElementId, with
        // composition=slot.id (which uses `__` so the grammar stays
        // 4-segment).
        const ref = slotId
          ? `${slotId}/timeline/${TOOL_NAMES.GET_ANOMALIES}/${e.id}`
          : null;
        if (ref) refs.push(ref);
        return ref ? `[ref:${ref}]` : e.title;
      });
      if (subset.length === 1) {
        lines.push(`One flagged anomaly: ${tokens[0]}.`);
      } else {
        lines.push(`Two flagged anomalies: ${tokens[0]} and ${tokens[1]}.`);
      }
    }
  }

  const weather = data.get(toolKey(TOOL_NAMES.GET_WEATHER_WINDOW)) as
    | WeatherWindow
    | undefined;
  if (weather) {
    if (weather.state === "open") {
      lines.push(`Weather window opens ${shortTime(weather.window_open_iso)}.`);
    } else if (weather.state === "marginal") {
      lines.push(`Weather marginal — flights at risk.`);
    } else {
      lines.push(`Weather window closed today.`);
    }
  }

  const reports = data.get(toolKey(TOOL_NAMES.GET_CUSTOMER_REPORTS)) as
    | CustomerReportsResult
    | undefined;
  if (reports) {
    const unread = reports.reports.filter((r) => r.unread).length;
    const high = reports.reports.filter((r) => r.priority === "high").length;
    if (unread > 0) {
      lines.push(
        `${unread} unread customer report${unread === 1 ? "" : "s"}${high > 0 ? `; ${high} high priority` : ""}.`,
      );
    }
  }

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
