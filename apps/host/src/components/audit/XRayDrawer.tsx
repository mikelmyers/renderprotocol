import { useEffect, useMemo, useState } from "react";
import { queryAudit, type AuditEvent } from "../../lib/audit";

// X-ray drawer. Slides in from the right. Surfaces the audit log so the
// surface's behavior is interrogable: every tool call, resource read,
// notification, bus event, action decision, and composition assembly
// lands here with timestamps and payloads.
//
// v0 is a flat reverse-chronological list with kind filtering and
// per-row payload expansion. Frame view (parent_id chains rendered as
// indented children) arrives when the audit log starts threading
// composition→tool-call parent ids in a future increment.

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRESET_FILTERS: Array<{ key: string; label: string; prefix?: string }> = [
  { key: "all", label: "All" },
  { key: "mcp", label: "MCP", prefix: "mcp." },
  { key: "bus", label: "Bus", prefix: "bus." },
  { key: "config", label: "Config", prefix: "config." },
  { key: "action", label: "Actions", prefix: "action." },
  { key: "composition", label: "Composition", prefix: "composition." },
];

const REFRESH_MS = 1500;
const PAGE_SIZE = 200;

export function XRayDrawer({ open, onClose }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const prefix = useMemo(
    () => PRESET_FILTERS.find((f) => f.key === filter)?.prefix,
    [filter],
  );

  // Keep the drawer fresh while open. Tail-mode (since_id) would be
  // cheaper but it complicates the filter switch story; for v0 the
  // periodic re-query is fine.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const next = await queryAudit({
          limit: PAGE_SIZE,
          ...(prefix ? { kind_prefix: prefix } : {}),
        });
        if (cancelled) return;
        setEvents(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) {
        handle = setTimeout(tick, REFRESH_MS);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
    };
  }, [open, prefix]);

  const toggleRow = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;

  return (
    <aside
      className="xray-drawer"
      role="dialog"
      aria-label="Audit log — X-ray drawer"
    >
      <header className="xray-drawer__head">
        <h2 className="xray-drawer__title">X-ray</h2>
        <button
          className="xray-drawer__close"
          onClick={onClose}
          aria-label="Close X-ray"
        >
          ×
        </button>
      </header>

      <nav className="xray-drawer__filters">
        {PRESET_FILTERS.map((f) => (
          <button
            key={f.key}
            className={
              filter === f.key
                ? "xray-drawer__filter xray-drawer__filter--active"
                : "xray-drawer__filter"
            }
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {error && <div className="xray-drawer__error">audit query failed: {error}</div>}

      <ol className="xray-drawer__list">
        {events.length === 0 && (
          <li className="xray-drawer__empty">No events yet.</li>
        )}
        {events.map((e) => (
          <li
            key={e.id}
            className={
              expanded.has(e.id)
                ? "xray-row xray-row--expanded"
                : "xray-row"
            }
            onClick={() => toggleRow(e.id)}
          >
            <div className="xray-row__head">
              <span className="xray-row__id">#{e.id}</span>
              <span className="xray-row__time">{formatTime(e.ts_ms)}</span>
              <span className="xray-row__kind">{e.kind}</span>
              {e.parent_id !== null && (
                <span className="xray-row__parent">
                  ↳ {e.parent_id}
                </span>
              )}
            </div>
            {expanded.has(e.id) && (
              <pre className="xray-row__payload">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const millis = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${millis}`;
}
