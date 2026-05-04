// AttributionChip — small "via: <agent>" label that appears above each
// rendered composition so the carrier's routing decision is visible.
// Latency is a tooltip, not a primary label, to keep visual chrome low.

interface Props {
  agent: string;
  latencyMs?: number;
}

export function AttributionChip({ agent, latencyMs }: Props) {
  const title =
    typeof latencyMs === "number"
      ? `${agent} · ${latencyMs}ms round trip`
      : agent;
  return (
    <div className="attribution-chip" title={title}>
      <span className="attribution-chip__label">via</span>
      <span className="attribution-chip__agent">{agent}</span>
      {typeof latencyMs === "number" && (
        <span className="attribution-chip__latency">{latencyMs}ms</span>
      )}
    </div>
  );
}
