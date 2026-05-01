import { useEffect, useMemo, useRef } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId, surfaceBus } from "../../../lib/surface-bus";

// Generic timeline. Renders an ordered sequence of events. Domain mapping
// (e.g. anomaly events → timeline events) lives in composition rules.

export type TimelineSeverity = "info" | "warn" | "critical" | "ok";

export interface TimelineEvent {
  id: string;
  ts_iso: string;
  title: string;
  body?: string;
  severity?: TimelineSeverity;
  // Free-form bag for the rule layer to surface domain context
  // (e.g. drone_id, kind). Shown as a faint metadata line.
  meta?: Record<string, string>;
}

interface Props {
  composition: string;
  source_tool: string;
  events: TimelineEvent[];
  empty?: string;
}

const SEVERITY_LABEL: Record<TimelineSeverity, string> = {
  info: "info",
  ok: "ok",
  warn: "warn",
  critical: "critical",
};

export function TimelineView({
  composition,
  source_tool,
  events,
  empty = "No events.",
}: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "timeline",
        source_tool,
        entity: "container",
      }),
    [composition, source_tool],
  );

  return (
    <ElementWrapper
      id={containerId}
      metadata={{
        composition,
        primitive: "timeline",
        source_tool,
        entity: "container",
        display: { event_count: events.length },
      }}
      className="timeline-view"
    >
      {events.length === 0 ? (
        <div className="timeline-view__empty">{empty}</div>
      ) : (
        <ol className="timeline-view__list">
          {events.map((e) => (
            <TimelineRow
              key={e.id}
              composition={composition}
              source_tool={source_tool}
              event={e}
            />
          ))}
        </ol>
      )}
    </ElementWrapper>
  );
}

function TimelineRow({
  composition,
  source_tool,
  event,
}: {
  composition: string;
  source_tool: string;
  event: TimelineEvent;
}) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "timeline",
        source_tool,
        entity: event.id,
      }),
    [composition, source_tool, event.id],
  );

  const lastSig = useRef<string | null>(null);
  const sig = `${event.title}|${event.ts_iso}|${event.severity ?? ""}|${event.body ?? ""}`;

  useEffect(() => {
    surfaceBus.registerElement(id, {
      composition,
      primitive: "timeline",
      source_tool,
      entity: event.id,
      display: {
        title: event.title,
        ts_iso: event.ts_iso,
        severity: event.severity ?? "info",
      },
    });
    lastSig.current = sig;
    return () => surfaceBus.removeElement(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (lastSig.current === null || lastSig.current === sig) return;
    lastSig.current = sig;
    surfaceBus.updateElement(id, {
      composition,
      primitive: "timeline",
      source_tool,
      entity: event.id,
      display: {
        title: event.title,
        ts_iso: event.ts_iso,
        severity: event.severity ?? "info",
      },
    });
  }, [id, composition, source_tool, sig, event.id, event.title, event.ts_iso, event.severity]);

  const severity = event.severity ?? "info";

  return (
    <li
      className={`timeline-view__row timeline-view__row--${severity}`}
      onClick={(e) => {
        e.stopPropagation();
        surfaceBus.selectElement(id, "click");
      }}
    >
      <div className="timeline-view__gutter">
        <span className={`timeline-view__dot timeline-view__dot--${severity}`} />
      </div>
      <div className="timeline-view__content">
        <div className="timeline-view__head">
          <time className="timeline-view__time" dateTime={event.ts_iso}>
            {formatTs(event.ts_iso)}
          </time>
          <span
            className={`status-badge status-badge--${severity === "ok" ? "active" : severity === "warn" ? "charging" : severity === "critical" ? "grounded" : "idle"}`}
          >
            {SEVERITY_LABEL[severity]}
          </span>
        </div>
        <div className="timeline-view__title">{event.title}</div>
        {event.body && <div className="timeline-view__body">{event.body}</div>}
        {event.meta && Object.keys(event.meta).length > 0 && (
          <div className="timeline-view__meta">
            {Object.entries(event.meta).map(([k, v]) => (
              <span key={k} className="timeline-view__meta-kv">
                <span className="timeline-view__meta-k">{k}</span>
                <span className="timeline-view__meta-v">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Locale-default short date + time. Operators want absolute timestamps;
  // first-time users still read these without context (no "2h ago").
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}
