import { useMemo } from "react";
import type { AlertItem } from "@renderprotocol/protocol-types";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { SafeMarkdown } from "../../../lib/safe-markdown";
import { relativeTime } from "../../../lib/relative-time";

interface Props {
  source_tool: string;
  alerts: AlertItem[];
}

// AlertView: stack of severity-coded cards for items needing attention.
// Optional markdown body rendered with the same safe defaults as
// NarrativeView — no raw HTML, URI-allowlisted links.

export function AlertView({ source_tool, alerts }: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition: "ask",
        primitive: "alerts",
        source_tool,
        entity: "container",
      }),
    [source_tool],
  );

  return (
    <ElementWrapper
      id={containerId}
      metadata={{
        composition: "ask",
        primitive: "alerts",
        source_tool,
        entity: "container",
        display: { count: alerts.length },
      }}
      className="alert-view"
    >
      {alerts.length === 0 && (
        <div className="alert-view__empty">No alerts.</div>
      )}
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`alert-card alert-card--${a.severity}`}
        >
          <div className="alert-card__header">
            <span className={`alert-card__severity alert-card__severity--${a.severity}`}>
              {a.severity}
            </span>
            <span className="alert-card__title">{a.title}</span>
            <span className="alert-card__time">{relativeTime(a.ts_ms)}</span>
          </div>
          {a.body && (
            <div className="alert-card__body">
              <SafeMarkdown>{a.body}</SafeMarkdown>
            </div>
          )}
        </div>
      ))}
    </ElementWrapper>
  );
}
