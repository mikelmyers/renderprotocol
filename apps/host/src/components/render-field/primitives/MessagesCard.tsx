import { useMemo } from "react";
import type {
  ChatMessage,
  MessagesRecentResult,
  ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: MessagesRecentResult;
  error?: string | null;
}

export function MessagesCard({ service, composition, data, error }: Props) {
  const summary =
    data.unread_count > 0
      ? `${data.unread_count} unread`
      : `${data.messages.length} recent`;
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <ul className="rows">
        {data.messages.map((m) => (
          <MessageRow
            key={m.message_id}
            message={m}
            composition={composition}
            sourceTool={service.tool}
          />
        ))}
      </ul>
    </ServiceCard>
  );
}

interface RowProps {
  message: ChatMessage;
  composition: string;
  sourceTool: string;
}

function MessageRow({ message, composition, sourceTool }: RowProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "chat-message",
        source_tool: sourceTool,
        entity: message.message_id,
      }),
    [composition, sourceTool, message.message_id],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "chat-message",
        source_tool: sourceTool,
        entity: message.message_id,
        display: {
          channel: message.channel,
          conversation: message.conversation,
          unread: message.unread,
        },
      }}
      className={`row ${message.unread ? "row--unread" : ""}`}
    >
      <div className="row__main">
        <div className="row__title">
          <span className={`channel channel--${message.channel}`}>
            {message.channel}
          </span>
          <span className="row__subject">{message.conversation}</span>
          <span className="row__time">{relTime(message.received_iso)}</span>
        </div>
        <div className="row__preview">{message.preview}</div>
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
