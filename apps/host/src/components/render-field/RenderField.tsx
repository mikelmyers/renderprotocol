import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AnomaliesResult,
  CustomerReportsResult,
  FleetStatusResult,
  TelemetryResult,
  WeatherWindow,
} from "@renderprotocol/protocol-types";
import { TOOL_NAMES, UI_RESOURCE_URIS } from "@renderprotocol/protocol-types";
import { ipc } from "../../lib/ipc";
import { MapView } from "./primitives/MapView";
import { TimelineView, type TimelineEvent } from "./primitives/TimelineView";
import { AlertView, type AlertTone } from "./primitives/AlertView";
import { NarrativeView } from "./primitives/NarrativeView";
import { TabularView, type TabularColumn, type TabularRow } from "./primitives/TabularView";
import { LiveFeedView, type LiveSample } from "./primitives/LiveFeedView";
import { McpAppFrame } from "./primitives/McpAppFrame";
import { makeElementId } from "../../lib/surface-bus";

// Step 2 showcase: every primitive rendered in a vertical stack so the
// composition vocabulary is visible end-to-end. The rule-based composer
// (step 5 of STRUCTURE.md §9) replaces this with a LayoutSpec assembled
// from agent.md + tool data; for now the showcase keeps each primitive
// runnable while we confirm the contracts.
//
// Domain-to-primitive mapping happens here (and only here) — the
// primitives themselves stay generic. When the composer arrives, this
// adapter logic moves into composition rule files like
// `compositions/morning-brief.rules.ts`.

const COMPOSITION = "showcase";

type ConnectionState = "connecting" | "ready" | "error";

export function RenderField() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubReady: (() => void) | null = null;
    let unsubError: (() => void) | null = null;

    void ipc.onMcpReady(() => setConnection("ready")).then((u) => {
      unsubReady = u;
    });
    void ipc
      .onMcpError((msg) => {
        setConnection("error");
        setConnectionMessage(msg);
      })
      .then((u) => {
        unsubError = u;
      });

    return () => {
      unsubReady?.();
      unsubError?.();
    };
  }, []);

  const enabled = connection === "ready";

  const fleet = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_FLEET_STATUS],
    enabled,
    queryFn: () => callStructured<FleetStatusResult>(TOOL_NAMES.GET_FLEET_STATUS),
  });

  const anomalies = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_ANOMALIES],
    enabled,
    queryFn: () => callStructured<AnomaliesResult>(TOOL_NAMES.GET_ANOMALIES),
  });

  const weather = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_WEATHER_WINDOW],
    enabled,
    queryFn: () => callStructured<WeatherWindow>(TOOL_NAMES.GET_WEATHER_WINDOW),
  });

  const reports = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_CUSTOMER_REPORTS],
    enabled,
    queryFn: () => callStructured<CustomerReportsResult>(TOOL_NAMES.GET_CUSTOMER_REPORTS),
  });

  const telemetry = useQuery({
    queryKey: ["tool", TOOL_NAMES.GET_DRONE_TELEMETRY, "drone-7", 60],
    enabled,
    queryFn: () =>
      callStructured<TelemetryResult>(TOOL_NAMES.GET_DRONE_TELEMETRY, {
        drone_id: "drone-7",
        range_seconds: 60,
      }),
  });

  return (
    <div className="render-field">
      <ConnectionStrip state={connection} message={connectionMessage} />
      <div className="pane__body render-field__stack">
        <Section title="Fleet — map" sub={`tool ${TOOL_NAMES.GET_FLEET_STATUS}`}>
          {renderFleet(fleet)}
        </Section>

        <Section title="Anomalies — timeline" sub={`tool ${TOOL_NAMES.GET_ANOMALIES}`}>
          {renderAnomalies(anomalies)}
        </Section>

        <Section title="Weather window — alert" sub={`tool ${TOOL_NAMES.GET_WEATHER_WINDOW}`}>
          {renderWeather(weather)}
        </Section>

        <Section title="Agent narrative — markdown + refs" sub="composer-authored">
          {renderNarrative(fleet.data, anomalies.data)}
        </Section>

        <Section title="Customer reports — table" sub={`tool ${TOOL_NAMES.GET_CUSTOMER_REPORTS}`}>
          {renderReports(reports)}
        </Section>

        <Section title="Live feed — drone-7 vibration" sub={`tool ${TOOL_NAMES.GET_DRONE_TELEMETRY}`}>
          {renderLiveFeed(telemetry)}
        </Section>

        <Section title="MCP App — sandboxed iframe (SEP-1865)" sub={UI_RESOURCE_URIS.HELLO}>
          {enabled ? (
            <McpAppFrame
              composition={COMPOSITION}
              source_tool="resources/read"
              entity="hello"
              uri={UI_RESOURCE_URIS.HELLO}
              title="Hello — sandbox check"
              initialHeight={240}
            />
          ) : (
            <Empty>Waiting for MCP server…</Empty>
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── Adapters: tool result → primitive props ─────────────────────────

function renderFleet(q: { data?: FleetStatusResult; isLoading: boolean; error: unknown }) {
  if (q.isLoading) return <Empty>Loading fleet…</Empty>;
  if (q.error) return <Empty error>{`Fleet call failed: ${(q.error as Error).message}`}</Empty>;
  if (!q.data) return <Empty>Waiting for MCP server…</Empty>;
  return (
    <MapView
      composition={COMPOSITION}
      source_tool={TOOL_NAMES.GET_FLEET_STATUS}
      data={q.data}
    />
  );
}

function renderAnomalies(q: { data?: AnomaliesResult; isLoading: boolean; error: unknown }) {
  if (q.isLoading) return <Empty>Loading anomalies…</Empty>;
  if (q.error) return <Empty error>{`Anomalies call failed: ${(q.error as Error).message}`}</Empty>;
  if (!q.data) return <Empty>Waiting…</Empty>;
  const events: TimelineEvent[] = q.data.events.map((e) => ({
    id: e.id,
    ts_iso: e.ts_iso,
    title: e.title,
    body: e.detail,
    severity: e.severity === "warn" ? "warn" : e.severity === "critical" ? "critical" : "info",
    meta: { drone: e.drone_id, kind: e.kind },
  }));
  return (
    <TimelineView
      composition={COMPOSITION}
      source_tool={TOOL_NAMES.GET_ANOMALIES}
      events={events}
    />
  );
}

function renderWeather(q: { data?: WeatherWindow; isLoading: boolean; error: unknown }) {
  if (q.isLoading) return <Empty>Loading weather…</Empty>;
  if (q.error) return <Empty error>{`Weather call failed: ${(q.error as Error).message}`}</Empty>;
  if (!q.data) return <Empty>Waiting…</Empty>;
  const tone: AlertTone =
    q.data.state === "open" ? "ok" : q.data.state === "marginal" ? "warn" : "critical";
  return (
    <AlertView
      composition={COMPOSITION}
      source_tool={TOOL_NAMES.GET_WEATHER_WINDOW}
      entity="weather-window"
      tone={tone}
      headline={
        q.data.state === "open"
          ? "Weather window open"
          : q.data.state === "marginal"
            ? "Weather window marginal"
            : "Weather window closed"
      }
      detail={q.data.conditions}
      meta={{
        opens: shortTime(q.data.window_open_iso),
        closes: shortTime(q.data.window_close_iso),
        score: `${Math.round(q.data.score * 100)}%`,
      }}
      actions={[
        { id: "view-radar", label: "View radar", intent: "secondary" },
        { id: "queue-flights", label: "Queue inspections", intent: "primary" },
      ]}
      onAction={(a) => console.log("[showcase] alert action:", a)}
    />
  );
}

function renderReports(q: {
  data?: CustomerReportsResult;
  isLoading: boolean;
  error: unknown;
}) {
  if (q.isLoading) return <Empty>Loading reports…</Empty>;
  if (q.error) return <Empty error>{`Reports call failed: ${(q.error as Error).message}`}</Empty>;
  if (!q.data) return <Empty>Waiting…</Empty>;
  const columns: TabularColumn[] = [
    { key: "customer", label: "Customer" },
    { key: "subject", label: "Subject" },
    { key: "priority", label: "Priority", type: "priority" },
    { key: "ts_iso", label: "Received", type: "timestamp", align: "right" },
  ];
  const rows: TabularRow[] = q.data.reports.map((r) => ({
    id: r.id,
    customer: r.unread ? `${r.customer} •` : r.customer,
    subject: r.subject,
    priority: r.priority,
    ts_iso: r.ts_iso,
  }));
  return (
    <TabularView
      composition={COMPOSITION}
      source_tool={TOOL_NAMES.GET_CUSTOMER_REPORTS}
      columns={columns}
      rows={rows}
    />
  );
}

function renderLiveFeed(q: { data?: TelemetryResult; isLoading: boolean; error: unknown }) {
  if (q.isLoading) return <Empty>Loading telemetry…</Empty>;
  if (q.error) return <Empty error>{`Telemetry call failed: ${(q.error as Error).message}`}</Empty>;
  if (!q.data) return <Empty>Waiting…</Empty>;
  return <LiveFeedAdapter data={q.data} />;
}

// LiveFeed needs the simulated stream subscription, so adapt in a small
// component rather than a pure function.
function LiveFeedAdapter({ data }: { data: TelemetryResult }) {
  const initial = useMemo<LiveSample[]>(
    () =>
      data.samples.map((s) => ({
        ts_ms: new Date(s.ts_iso).getTime(),
        value: s.vibration_g,
      })),
    [data.samples],
  );

  const subscribe = useCallback(
    (onSample: (s: LiveSample) => void) => {
      // Client-side simulator. Server-initiated streaming via MCP
      // notifications replaces this in step 3.
      const seedRef = { current: data.samples.at(-1)?.vibration_g ?? 0.5 };
      const handle = setInterval(() => {
        // Light random walk around the last value, with a faint sinusoid
        // so the sparkline doesn't look static.
        const drift = (Math.random() - 0.5) * 0.12;
        const wobble = Math.sin(Date.now() / 700) * 0.05;
        seedRef.current = clamp(seedRef.current + drift + wobble, 0.05, 2.5);
        onSample({ ts_ms: Date.now(), value: roundTo(seedRef.current, 3) });
      }, 1000);
      return () => clearInterval(handle);
    },
    [data.samples],
  );

  return (
    <LiveFeedView
      composition={COMPOSITION}
      source_tool={TOOL_NAMES.GET_DRONE_TELEMETRY}
      entity={`${data.drone_id}/vibration`}
      label={`${data.drone_id} vibration`}
      unit="g"
      samples={initial}
      subscribe={subscribe}
      threshold={{ warn: 1.2, critical: 1.6 }}
    />
  );
}

function renderNarrative(
  fleet: FleetStatusResult | undefined,
  anomalies: AnomaliesResult | undefined,
) {
  if (!fleet || !anomalies) {
    return <Empty>Narrative renders once fleet + anomalies load.</Empty>;
  }
  const active = fleet.drones.filter((d) => d.status === "active").length;
  const total = fleet.drones.length;
  const flaggedAnoms = anomalies.events.filter((e) => e.severity !== "info").slice(0, 2);
  const refs = flaggedAnoms.map((e) =>
    makeElementId({
      composition: COMPOSITION,
      primitive: "timeline",
      source_tool: TOOL_NAMES.GET_ANOMALIES,
      entity: e.id,
    }),
  );
  // Deterministic templating per STRUCTURE.md §7 ("Conversation summary v0").
  // The same shape will produce a real LLM call once the composer arrives;
  // for now this is the testable, free, reproducible path.
  const lines: string[] = [
    `Fleet at ${active} of ${total} drones active.`,
  ];
  if (flaggedAnoms.length === 0) {
    lines.push("No active anomalies. Standing watches quiet.");
  } else {
    const refToken = (i: number) => (refs[i] ? `[ref:${refs[i]}]` : "");
    if (flaggedAnoms.length === 1) {
      lines.push(`One flagged anomaly: ${refToken(0)}.`);
    } else {
      lines.push(
        `Two flagged anomalies: ${refToken(0)} and ${refToken(1)}.`,
      );
    }
  }
  return (
    <NarrativeView
      composition={COMPOSITION}
      source_tool="composer"
      entity="morning-summary"
      body={lines.join("\n\n")}
    />
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function callStructured<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await ipc.callTool(name, args);
  if (res.structured) return res.structured as T;
  if (res.text) return JSON.parse(res.text) as T;
  throw new Error(`tool ${name} returned no payload`);
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function roundTo(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function ConnectionStrip({
  state,
  message,
}: {
  state: ConnectionState;
  message: string | null;
}) {
  const dotClass =
    state === "ready"
      ? "connection-dot connection-dot--ready"
      : state === "error"
        ? "connection-dot connection-dot--error"
        : "connection-dot";
  const label =
    state === "ready"
      ? "MCP connected"
      : state === "error"
        ? `MCP error${message ? `: ${message}` : ""}`
        : "MCP connecting…";
  return (
    <div className="connection-strip">
      <span className={dotClass} />
      <span>{label}</span>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="showcase-section">
      <header className="showcase-section__head">
        <h2 className="showcase-section__title">{title}</h2>
        <span className="showcase-section__sub">{sub}</span>
      </header>
      {children}
    </section>
  );
}

function Empty({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={error ? "render-field__empty render-field__empty--error" : "render-field__empty"}>
      {children}
    </div>
  );
}
