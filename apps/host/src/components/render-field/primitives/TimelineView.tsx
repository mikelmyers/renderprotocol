import { useMemo } from "react";
import type { TimelineEvent } from "@renderprotocol/protocol-types";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { relativeTime } from "../../../lib/relative-time";

interface Props {
  source_tool: string;
  events: TimelineEvent[];
}

// TimelineView: vertical sequence of events, newest first. Renders timestamps
// using the shared relativeTime helper. `kind` becomes a CSS class so the
// design system can color-code categories without the primitive picking
// colors itself.

export function TimelineView({ source_tool, events }: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition: "ask",
        primitive: "timeline",
        source_tool,
        entity: "container",
      }),
    [source_tool],
  );

  const ordered = useMemo(
    () => [...events].sort((a, b) => b.ts_ms - a.ts_ms),
    [events],
  );

  return (
    <ElementWrapper
      id={containerId}
      metadata={{
        composition: "ask",
        primitive: "timeline",
        source_tool,
        entity: "container",
        display: { count: events.length },
      }}
      className="timeline-view"
    >
      {ordered.length === 0 && (
        <div className="timeline-view__empty">No events.</div>
      )}
      <ol className="timeline-view__list">
        {ordered.map((e) => (
          <li
            key={e.id}
            className={`timeline-event${e.kind ? ` timeline-event--${e.kind}` : ""}`}
          >
            <div className="timeline-event__time" title={new Date(e.ts_ms).toISOString()}>
              {relativeTime(e.ts_ms)}
            </div>
            <div className="timeline-event__body">
              <div className="timeline-event__title">{e.title}</div>
              {e.description && (
                <div className="timeline-event__description">{e.description}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </ElementWrapper>
  );
}
