import { useMemo } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";

// Generic alert / indicator primitive. One prominent statement with optional
// detail and metadata. Domain shape (weather window, anomaly alert, system
// notice) is mapped onto this shape by composition rules.

export type AlertTone = "ok" | "warn" | "critical" | "info" | "neutral";

export interface AlertAction {
  id: string;
  label: string;
  intent: "primary" | "secondary";
}

interface Props {
  composition: string;
  source_tool: string;
  // Stable identifier within the composition (e.g. "weather-window",
  // "drone-7-anomaly"). Joined with the rest of the address grammar
  // to form the full element_id.
  entity: string;
  tone: AlertTone;
  headline: string;
  detail?: string;
  meta?: Record<string, string>;
  actions?: AlertAction[];
  onAction?: (action_id: string) => void;
}

export function AlertView({
  composition,
  source_tool,
  entity,
  tone,
  headline,
  detail,
  meta,
  actions,
  onAction,
}: Props) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "alert",
        source_tool,
        entity,
      }),
    [composition, source_tool, entity],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "alert",
        source_tool,
        entity,
        display: { tone, headline },
      }}
      className={`alert-view alert-view--${tone}`}
    >
      <div className="alert-view__bar" />
      <div className="alert-view__body">
        <div className="alert-view__headline">{headline}</div>
        {detail && <div className="alert-view__detail">{detail}</div>}
        {meta && Object.keys(meta).length > 0 && (
          <div className="alert-view__meta">
            {Object.entries(meta).map(([k, v]) => (
              <div className="alert-view__meta-kv" key={k}>
                <span className="alert-view__meta-k">{k}</span>
                <span className="alert-view__meta-v">{v}</span>
              </div>
            ))}
          </div>
        )}
        {actions && actions.length > 0 && (
          <div className="alert-view__actions">
            {actions.map((a) => (
              <button
                key={a.id}
                className={`alert-view__action alert-view__action--${a.intent}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction?.(a.id);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </ElementWrapper>
  );
}
