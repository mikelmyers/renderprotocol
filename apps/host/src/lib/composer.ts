// Composer — pure function that maps an ActiveComposition to a typed
// PrimitiveSelection the render field can switch-render. Single dispatch
// site for the whole surface; primitives never inspect raw tool payloads.
//
// v0 dispatches on `source_tool`. Step 4+ may add intent or agent.md
// hints to influence which primitive is chosen for an ambiguous shape
// (e.g. a list could be Tabular or Timeline depending on the intent).
// Keep `compose(composition)` as the single entry point.

import {
  TOOL_NAMES,
  type AlertItem,
  type AlertSeverity,
  type GetAlertsResult,
  type GetRecentEventsResult,
  type ListItemsResult,
  type LookupResult,
  type TableColumn,
  type TableRow,
  type TimelineEvent,
} from "@renderprotocol/protocol-types";
import type { ActiveComposition } from "./active-composition";

// SEP-1865 _meta.ui shapes carried into the host as part of the resource
// envelope. Empty objects are valid (= permission requested with no extra
// config), matching the spec's pattern.
export interface ResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface ResourcePermissions {
  camera?: Record<string, unknown>;
  microphone?: Record<string, unknown>;
  geolocation?: Record<string, unknown>;
  clipboardWrite?: Record<string, unknown>;
}

// Tagged envelope ConversationPanel constructs when a tool has an
// associated `ui://` resource. Lives on ActiveComposition.data when
// present; the composer dispatches on its presence before falling back
// to source_tool routing.
export interface UiResourceEnvelope {
  kind: "ui_resource";
  uri: string;
  html: string;
  csp: ResourceCsp;
  permissions: ResourcePermissions;
  prefersBorder?: boolean;
  /// Raw MCP tool-call result (the full response object). Forwarded to
  /// the iframe verbatim via ui/notifications/tool-result so the iframe
  /// sees what a standard MCP client would have seen.
  toolResult: unknown;
}

export type PrimitiveSelection =
  | {
      primitive: "narrative";
      source_tool: string;
      markdown: string;
    }
  | {
      primitive: "tabular";
      source_tool: string;
      title?: string;
      columns: TableColumn[];
      rows: TableRow[];
    }
  | {
      primitive: "alerts";
      source_tool: string;
      alerts: AlertItem[];
    }
  | {
      primitive: "timeline";
      source_tool: string;
      events: TimelineEvent[];
    }
  | {
      primitive: "mcp_app";
      source_tool: string;
      uri: string;
      html: string;
      csp: ResourceCsp;
      permissions: ResourcePermissions;
      prefersBorder?: boolean;
      toolResult: unknown;
    }
  | {
      primitive: "fallback";
      source_tool: string;
      reason: string;
    };

export function compose(composition: ActiveComposition): PrimitiveSelection {
  const { source_tool, data } = composition;

  // UI resource takes precedence over per-tool dispatch. A hosting agent
  // that ships its own UI is asking us to use it; we don't second-guess
  // by also rendering a structured-data primitive.
  if (isUiResourceEnvelope(data)) {
    return {
      primitive: "mcp_app",
      source_tool,
      uri: data.uri,
      html: data.html,
      csp: data.csp,
      permissions: data.permissions,
      prefersBorder: data.prefersBorder,
      toolResult: data.toolResult,
    };
  }

  switch (source_tool) {
    case TOOL_NAMES.LOOKUP:
      return narrativeFrom(data, source_tool);
    case TOOL_NAMES.LIST_ITEMS:
      return tabularFrom(data, source_tool);
    case TOOL_NAMES.GET_ALERTS:
      return alertsFrom(data, source_tool);
    case TOOL_NAMES.GET_RECENT_EVENTS:
      return timelineFrom(data, source_tool);
    default:
      return {
        primitive: "fallback",
        source_tool,
        reason: `no primitive registered for tool: ${source_tool}`,
      };
  }
}

function isUiResourceEnvelope(v: unknown): v is UiResourceEnvelope {
  return (
    isObject(v) &&
    v.kind === "ui_resource" &&
    typeof v.uri === "string" &&
    typeof v.html === "string"
  );
}

// ─── shape guards ───────────────────────────────────────────────────────
//
// Each guard validates only what the primitive actually consumes. Extra
// fields are tolerated — agents may evolve their schemas additively. A
// failed guard returns a `fallback` selection with a human-readable
// reason rather than throwing, so the render field can show an honest
// "couldn't compose this" message.

function narrativeFrom(data: unknown, source_tool: string): PrimitiveSelection {
  if (isLookupResult(data)) {
    return { primitive: "narrative", source_tool, markdown: data.markdown };
  }
  return {
    primitive: "fallback",
    source_tool,
    reason: "lookup payload missing string `markdown`",
  };
}

function tabularFrom(data: unknown, source_tool: string): PrimitiveSelection {
  if (isListItemsResult(data)) {
    return {
      primitive: "tabular",
      source_tool,
      title: data.title,
      columns: data.columns,
      rows: data.rows,
    };
  }
  return {
    primitive: "fallback",
    source_tool,
    reason: "list_items payload missing valid `columns` / `rows`",
  };
}

function alertsFrom(data: unknown, source_tool: string): PrimitiveSelection {
  if (isGetAlertsResult(data)) {
    return { primitive: "alerts", source_tool, alerts: data.alerts };
  }
  return {
    primitive: "fallback",
    source_tool,
    reason: "get_alerts payload missing valid `alerts` array",
  };
}

function timelineFrom(data: unknown, source_tool: string): PrimitiveSelection {
  if (isGetRecentEventsResult(data)) {
    return { primitive: "timeline", source_tool, events: data.events };
  }
  return {
    primitive: "fallback",
    source_tool,
    reason: "get_recent_events payload missing valid `events` array",
  };
}

// ─── primitive type guards ──────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isLookupResult(v: unknown): v is LookupResult {
  return isObject(v) && typeof v.markdown === "string";
}

function isListItemsResult(v: unknown): v is ListItemsResult {
  if (!isObject(v)) return false;
  const cols = v.columns;
  const rows = v.rows;
  if (!Array.isArray(cols) || !Array.isArray(rows)) return false;
  if (
    !cols.every(
      (c) =>
        isObject(c) && typeof c.key === "string" && typeof c.label === "string",
    )
  ) {
    return false;
  }
  if (!rows.every((r) => isObject(r))) return false;
  return true;
}

const ALERT_SEVERITIES: ReadonlySet<AlertSeverity> = new Set([
  "info",
  "warning",
  "critical",
]);

function isGetAlertsResult(v: unknown): v is GetAlertsResult {
  if (!isObject(v)) return false;
  const alerts = v.alerts;
  if (!Array.isArray(alerts)) return false;
  return alerts.every(
    (a) =>
      isObject(a) &&
      typeof a.id === "string" &&
      typeof a.title === "string" &&
      typeof a.ts_ms === "number" &&
      typeof a.severity === "string" &&
      ALERT_SEVERITIES.has(a.severity as AlertSeverity) &&
      (a.body === undefined || typeof a.body === "string"),
  );
}

function isGetRecentEventsResult(v: unknown): v is GetRecentEventsResult {
  if (!isObject(v)) return false;
  const events = v.events;
  if (!Array.isArray(events)) return false;
  return events.every(
    (e) =>
      isObject(e) &&
      typeof e.id === "string" &&
      typeof e.title === "string" &&
      typeof e.ts_ms === "number" &&
      (e.description === undefined || typeof e.description === "string") &&
      (e.kind === undefined || typeof e.kind === "string"),
  );
}
