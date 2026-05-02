import { useMemo } from "react";
import type { ServiceDescriptor } from "@renderprotocol/protocol-types";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

// Common chrome for every brief card. Wraps its body in an ElementWrapper so
// the card itself is addressable (the agent can reference "the mail card"),
// independent of the rows inside which are wrapped separately.
//
// Each per-service card (MailCard, CalendarCard, etc.) provides:
//   - the service descriptor so the header shows which service backed it
//   - a concise summary string for the header right-side
//   - children = the body (rows, grids, whatever fits)

interface Props {
  service: ServiceDescriptor;
  composition: string;
  summary: string;
  children: React.ReactNode;
  // Optional inline error string for when the underlying tool call failed
  // but we still want the chrome present so the layout doesn't collapse.
  // Widened to include undefined explicitly because exactOptionalPropertyTypes
  // is on at the workspace level — callers pass the value through `error={x}`
  // where `x` may be undefined.
  error?: string | null | undefined;
}

export function ServiceCard({
  service,
  composition,
  summary,
  children,
  error,
}: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: `${service.id}-card`,
        source_tool: service.tool,
        entity: "container",
      }),
    [composition, service.id, service.tool],
  );

  return (
    <ElementWrapper
      id={containerId}
      metadata={{
        composition,
        primitive: `${service.id}-card`,
        source_tool: service.tool,
        entity: "container",
        display: { service: service.label, summary },
      }}
      className="card"
    >
      <header className="card__header">
        <span className="card__service">{service.label}</span>
        <span className="card__summary">{summary}</span>
      </header>
      <div className="card__body">
        {error ? (
          <div className="card__error">Tool call failed: {error}</div>
        ) : (
          children
        )}
      </div>
    </ElementWrapper>
  );
}
