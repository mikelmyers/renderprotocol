import { useMemo } from "react";
import type { TableColumn, TableRow, TableCell } from "@renderprotocol/protocol-types";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  source_tool: string;
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
}

// TabularView: structured records primitive. v0 has no sorting / filtering /
// virtualization — those land when a real workload demands them. Cells are
// rendered as plain text via React (auto-escaped); no dangerouslySetInnerHTML.

export function TabularView({ source_tool, title, columns, rows }: Props) {
  const elementId = useMemo(
    () =>
      makeElementId({
        composition: "ask",
        primitive: "tabular",
        source_tool,
        entity: "container",
      }),
    [source_tool],
  );

  return (
    <ElementWrapper
      id={elementId}
      metadata={{
        composition: "ask",
        primitive: "tabular",
        source_tool,
        entity: "container",
        display: { row_count: rows.length, column_count: columns.length },
      }}
      className="tabular-view"
    >
      {title && <div className="tabular-view__title">{title}</div>}
      <table className="tabular-view__table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>{formatCell(row[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="tabular-view__empty">No rows.</div>
      )}
    </ElementWrapper>
  );
}

function formatCell(v: TableCell | undefined): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
