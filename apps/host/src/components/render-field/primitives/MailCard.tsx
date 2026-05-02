import { useMemo } from "react";
import type {
  InboxBriefResult,
  MailThread,
  ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: InboxBriefResult;
  error?: string | null;
}

export function MailCard({ service, composition, data, error }: Props) {
  const summary = `${data.unread_count} unread · ${data.flagged.length} flagged`;
  const items = [...data.flagged, ...data.recent_unread];
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <ul className="rows">
        {items.map((t) => (
          <MailRow
            key={t.thread_id}
            thread={t}
            composition={composition}
            sourceTool={service.tool}
          />
        ))}
      </ul>
    </ServiceCard>
  );
}

interface RowProps {
  thread: MailThread;
  composition: string;
  sourceTool: string;
}

function MailRow({ thread, composition, sourceTool }: RowProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "mail-thread",
        source_tool: sourceTool,
        entity: thread.thread_id,
      }),
    [composition, sourceTool, thread.thread_id],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "mail-thread",
        source_tool: sourceTool,
        entity: thread.thread_id,
        display: {
          subject: thread.subject,
          from: thread.from_name,
          flag: thread.flag,
          unread: thread.unread,
        },
      }}
      className="row"
    >
      <div className="row__main">
        <div className="row__title">
          {thread.flag && (
            <span className={`flag flag--${thread.flag}`}>{thread.flag}</span>
          )}
          <span className="row__subject">{thread.subject}</span>
        </div>
        <div className="row__meta">
          <span>{thread.from_name}</span>
          <span className="row__dot">·</span>
          <time>{relTime(thread.received_iso)}</time>
        </div>
        <div className="row__preview">{thread.preview}</div>
      </div>
    </ElementWrapper>
  );
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
