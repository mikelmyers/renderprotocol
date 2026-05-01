import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId, surfaceBus } from "../../../lib/surface-bus";

// Generic table primitive. Each row is individually addressable on the
// surface bus so a reference chip can target a single record.

export type TabularCellType =
  | "text"
  | "muted-text"
  | "timestamp"
  | "badge"
  | "priority";

export interface TabularColumn {
  key: string;
  label: string;
  type?: TabularCellType;
  // Optional renderer for arbitrary cell content. Composition rules can
  // pass formatted strings/JSX directly via the `rows` payload.
  align?: "left" | "right";
}

export type TabularRow = Record<string, unknown> & { id: string };

interface Props {
  composition: string;
  source_tool: string;
  columns: TabularColumn[];
  rows: TabularRow[];
  empty?: string;
}

export function TabularView({
  composition,
  source_tool,
  columns,
  rows,
  empty = "No rows.",
}: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "table",
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
        primitive: "table",
        source_tool,
        entity: "container",
        display: { row_count: rows.length, columns: columns.map((c) => c.key) },
      }}
      className="tabular-view"
    >
      {rows.length === 0 ? (
        <div className="tabular-view__empty">{empty}</div>
      ) : (
        <table className="tabular-view__table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`tabular-view__th tabular-view__th--${c.align ?? "left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TabularRow
                key={row.id}
                composition={composition}
                source_tool={source_tool}
                columns={columns}
                row={row}
              />
            ))}
          </tbody>
        </table>
      )}
    </ElementWrapper>
  );
}

function TabularRow({
  composition,
  source_tool,
  columns,
  row,
}: {
  composition: string;
  source_tool: string;
  columns: TabularColumn[];
  row: TabularRow;
}) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "table",
        source_tool,
        entity: row.id,
      }),
    [composition, source_tool, row.id],
  );

  const sig = useMemo(
    () => columns.map((c) => `${c.key}:${String(row[c.key] ?? "")}`).join("|"),
    [columns, row],
  );
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    surfaceBus.registerElement(id, {
      composition,
      primitive: "table",
      source_tool,
      entity: row.id,
      display: extractDisplay(columns, row),
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
      primitive: "table",
      source_tool,
      entity: row.id,
      display: extractDisplay(columns, row),
    });
  }, [id, composition, source_tool, sig, columns, row]);

  return (
    <tr
      className="tabular-view__tr"
      onClick={(e) => {
        e.stopPropagation();
        surfaceBus.selectElement(id, "click");
      }}
    >
      {columns.map((c) => (
        <td
          key={c.key}
          className={`tabular-view__td tabular-view__td--${c.type ?? "text"} tabular-view__td--${c.align ?? "left"}`}
        >
          {renderCell(c, row[c.key])}
        </td>
      ))}
    </tr>
  );
}

function extractDisplay(
  columns: TabularColumn[],
  row: TabularRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    out[c.key] = row[c.key];
  }
  return out;
}

function renderCell(col: TabularColumn, value: unknown): ReactNode {
  if (value == null || value === "") return <span className="tabular-view__td-empty">—</span>;
  switch (col.type) {
    case "timestamp":
      return formatTimestamp(String(value));
    case "badge": {
      const v = String(value);
      return <span className={`status-badge status-badge--${badgeClass(v)}`}>{v}</span>;
    }
    case "priority": {
      const v = String(value);
      return <span className={`priority priority--${v}`}>{v}</span>;
    }
    case "muted-text":
      return <span className="tabular-view__muted">{String(value)}</span>;
    default:
      return String(value);
  }
}

function badgeClass(v: string): string {
  switch (v) {
    case "active":
    case "open":
    case "ok":
      return "active";
    case "idle":
    case "neutral":
      return "idle";
    case "charging":
    case "warn":
    case "marginal":
      return "charging";
    case "grounded":
    case "critical":
    case "closed":
      return "grounded";
    default:
      return "offline";
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}
