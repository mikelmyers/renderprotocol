import { useMemo } from "react";
import type {
  CalendarEvent,
  CalendarTodayResult,
  ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: CalendarTodayResult;
  error?: string | null;
}

export function CalendarCard({ service, composition, data, error }: Props) {
  const needsPrep = data.events.filter((e) => e.prep_status === "needs_prep")
    .length;
  const summary =
    needsPrep > 0
      ? `${data.events.length} events · ${needsPrep} need${needsPrep > 1 ? "" : "s"} prep`
      : `${data.events.length} events`;
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <ul className="rows">
        {data.events.map((e) => (
          <EventRow
            key={e.event_id}
            event={e}
            composition={composition}
            sourceTool={service.tool}
          />
        ))}
      </ul>
    </ServiceCard>
  );
}

interface RowProps {
  event: CalendarEvent;
  composition: string;
  sourceTool: string;
}

function EventRow({ event, composition, sourceTool }: RowProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "calendar-event",
        source_tool: sourceTool,
        entity: event.event_id,
      }),
    [composition, sourceTool, event.event_id],
  );

  const start = new Date(event.start_iso);
  const end = new Date(event.end_iso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "calendar-event",
        source_tool: sourceTool,
        entity: event.event_id,
        display: {
          title: event.title,
          start: event.start_iso,
          status: event.status,
          prep: event.prep_status,
        },
      }}
      className="row"
    >
      <div className="row__main">
        <div className="row__title">
          <span className={`status-pill status-pill--${event.status}`}>
            {event.status === "in_progress" ? "now" : fmt(start)}
          </span>
          <span className="row__subject">{event.title}</span>
          {event.prep_status === "needs_prep" && (
            <span className="flag flag--important">prep</span>
          )}
        </div>
        <div className="row__meta">
          <span>
            {fmt(start)}–{fmt(end)}
          </span>
          {event.location && (
            <>
              <span className="row__dot">·</span>
              <span>{event.location}</span>
            </>
          )}
          {event.attendees.length > 1 && (
            <>
              <span className="row__dot">·</span>
              <span>{event.attendees.filter((a) => a !== "you").join(", ")}</span>
            </>
          )}
        </div>
      </div>
    </ElementWrapper>
  );
}
