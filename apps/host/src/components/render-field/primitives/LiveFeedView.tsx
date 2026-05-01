import { useEffect, useMemo, useRef, useState } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId, surfaceBus } from "../../../lib/surface-bus";

// Generic live-feed primitive. Renders a simple sparkline + the latest
// value for a stream of timestamped numeric samples. Updates push new
// samples in via the `samples` prop or via an optional `subscribe` hook
// the composition rule provides.
//
// Server-initiated streaming via MCP notifications arrives in step 3 of
// STRUCTURE.md §9 build order. For now the showcase uses a client-side
// setInterval simulator so the rendering, the bus events, and the
// element_updated semantics get exercised end-to-end.

export interface LiveSample {
  ts_ms: number;
  value: number;
}

interface Props {
  composition: string;
  source_tool: string;
  entity: string;
  label: string;
  unit?: string;
  // History to seed the chart. The component appends streamed samples
  // to this baseline.
  samples: LiveSample[];
  // Subscribe to a stream and call onSample for each new sample. Returns
  // an unsubscribe function. If omitted, the chart renders the static
  // `samples` only.
  subscribe?: (onSample: (s: LiveSample) => void) => () => void;
  // Threshold lines drawn faintly behind the sparkline.
  threshold?: { warn?: number; critical?: number };
  height?: number;
}

const DEFAULT_HEIGHT = 96;
const MAX_POINTS = 240;

export function LiveFeedView({
  composition,
  source_tool,
  entity,
  label,
  unit,
  samples: initial,
  subscribe,
  threshold,
  height = DEFAULT_HEIGHT,
}: Props) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "live_feed",
        source_tool,
        entity,
      }),
    [composition, source_tool, entity],
  );

  const [samples, setSamples] = useState<LiveSample[]>(initial);

  // Keep samples in sync if the parent passes a fresh baseline.
  useEffect(() => {
    setSamples(initial);
  }, [initial]);

  useEffect(() => {
    if (!subscribe) return;
    const off = subscribe((s) => {
      setSamples((prev) => {
        const next = prev.length >= MAX_POINTS ? prev.slice(-MAX_POINTS + 1) : prev.slice();
        next.push(s);
        return next;
      });
    });
    return off;
  }, [subscribe]);

  // Register on mount; emit element_updated when the latest value changes.
  const lastValRef = useRef<number | null>(null);
  useEffect(() => {
    surfaceBus.registerElement(id, {
      composition,
      primitive: "live_feed",
      source_tool,
      entity,
      display: { label, unit: unit ?? "", point_count: samples.length },
    });
    lastValRef.current = samples.at(-1)?.value ?? null;
    return () => surfaceBus.removeElement(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const latest = samples.at(-1)?.value ?? null;
  useEffect(() => {
    if (latest === null) return;
    if (lastValRef.current === null || lastValRef.current === latest) return;
    lastValRef.current = latest;
    surfaceBus.updateElement(id, {
      composition,
      primitive: "live_feed",
      source_tool,
      entity,
      display: { label, unit: unit ?? "", latest },
    });
  }, [id, composition, source_tool, entity, label, unit, latest]);

  const path = useMemo(() => buildSparklinePath(samples, height), [samples, height]);

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "live_feed",
        source_tool,
        entity,
        display: { label, unit: unit ?? "", latest: latest ?? 0 },
      }}
      className="live-feed-view"
    >
      <div className="live-feed-view__head">
        <div className="live-feed-view__label">{label}</div>
        <div className="live-feed-view__value">
          {latest === null ? "—" : formatValue(latest)}
          {unit && <span className="live-feed-view__unit"> {unit}</span>}
        </div>
      </div>
      <div className="live-feed-view__chart" style={{ height }}>
        <svg
          viewBox={`0 0 ${path.width} ${height}`}
          preserveAspectRatio="none"
          width="100%"
          height={height}
        >
          {threshold?.warn !== undefined && path.normalize && (
            <line
              x1={0}
              x2={path.width}
              y1={path.normalize(threshold.warn)}
              y2={path.normalize(threshold.warn)}
              stroke="rgba(240,182,106,0.35)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {threshold?.critical !== undefined && path.normalize && (
            <line
              x1={0}
              x2={path.width}
              y1={path.normalize(threshold.critical)}
              y2={path.normalize(threshold.critical)}
              stroke="rgba(244,115,115,0.45)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {path.d && (
            <>
              <path d={path.area} fill="rgba(122,162,255,0.12)" stroke="none" />
              <path d={path.d} fill="none" stroke="#7aa2ff" strokeWidth={1.5} />
            </>
          )}
        </svg>
      </div>
    </ElementWrapper>
  );
}

interface SparklinePath {
  d: string;
  area: string;
  width: number;
  normalize: ((v: number) => number) | null;
}

function buildSparklinePath(samples: LiveSample[], height: number): SparklinePath {
  if (samples.length < 2) {
    return { d: "", area: "", width: 100, normalize: null };
  }
  const width = Math.max(samples.length, 60);
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  const span = Math.max(0.0001, max - min);
  const padTop = 6;
  const padBottom = 6;
  const usable = height - padTop - padBottom;
  const normalize = (v: number) => padTop + (1 - (v - min) / span) * usable;

  const stride = width / (samples.length - 1);
  let d = "";
  for (let i = 0; i < samples.length; i++) {
    const x = i * stride;
    const y = normalize(samples[i]!.value);
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : ` L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  const area = `${d} L${width},${height - padBottom} L0,${height - padBottom} Z`;
  return { d, area, width, normalize };
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
