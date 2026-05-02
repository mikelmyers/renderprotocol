import { useMemo } from "react";
import type {
  DocItem,
  DocsRecentResult,
  ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: DocsRecentResult;
  error?: string | null;
}

export function DocsCard({ service, composition, data, error }: Props) {
  const summary = `${data.docs.length} recently edited`;
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <ul className="rows">
        {data.docs.map((d) => (
          <DocRow
            key={d.doc_id}
            doc={d}
            composition={composition}
            sourceTool={service.tool}
          />
        ))}
      </ul>
    </ServiceCard>
  );
}

interface RowProps {
  doc: DocItem;
  composition: string;
  sourceTool: string;
}

function DocRow({ doc, composition, sourceTool }: RowProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "doc-item",
        source_tool: sourceTool,
        entity: doc.doc_id,
      }),
    [composition, sourceTool, doc.doc_id],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "doc-item",
        source_tool: sourceTool,
        entity: doc.doc_id,
        display: { source: doc.source, title: doc.title },
      }}
      className="row"
    >
      <div className="row__main">
        <div className="row__title">
          <span className={`source source--${doc.source}`}>{labelFor(doc.source)}</span>
          <span className="row__subject">{doc.title}</span>
          <span className="row__time">{relTime(doc.edited_iso)}</span>
        </div>
        <div className="row__preview">{doc.preview}</div>
      </div>
    </ElementWrapper>
  );
}

function labelFor(source: DocItem["source"]): string {
  switch (source) {
    case "google_docs":
      return "Docs";
    case "notion":
      return "Notion";
    case "github":
      return "GitHub";
    case "local":
      return "Local";
  }
}

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
