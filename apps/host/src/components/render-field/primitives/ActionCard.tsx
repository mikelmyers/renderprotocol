import { useMemo, useState } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { ipc } from "../../../lib/ipc";

// Generic Approve/Reject card. Used anywhere the agent has a suggestion
// that wants the user's call before it goes anywhere — "send this
// reply?", "make this purchase?", "switch to this flight?". The
// composer surfaces the card, the user decides, the decision lands as
// a tool call (record_action by default) for audit.
//
// Domain-agnostic by design: no drone/operator vocabulary leaks in.

export interface ActionCardProps {
  composition: string;
  source_tool: string;
  entity: string;
  /** Stable id used for audit + replay. Distinct from `entity` so the
   *  same intent can be raised multiple times. */
  action_id: string;
  /** Short headline shown in bold. */
  headline: string;
  /** One-paragraph context line under the headline. */
  detail?: string;
  /** Optional kv pairs (e.g. { from: "United Airlines", price: "$420" }). */
  meta?: Record<string, string>;
  /** Confidence indicator 0..1 — rendered as a faint percentage. */
  confidence?: number;
  /** Tool to invoke when the user decides. Defaults to record_action. */
  tool?: string;
  /** Free-form payload included in the tool call. */
  payload?: Record<string, unknown>;
  /** Customize button labels per situation. Defaults: Approve / Reject. */
  approve_label?: string;
  reject_label?: string;
}

type Status = "idle" | "submitting" | "approved" | "rejected" | "error";

export function ActionCard({
  composition,
  source_tool,
  entity,
  action_id,
  headline,
  detail,
  meta,
  confidence,
  tool = "record_action",
  payload,
  approve_label = "Approve",
  reject_label = "Reject",
}: ActionCardProps) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "action_card",
        source_tool,
        entity,
      }),
    [composition, source_tool, entity],
  );

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: "approve" | "reject") => {
    setStatus("submitting");
    setError(null);
    try {
      await ipc.callTool(tool, {
        action_id,
        intent: headline,
        decision,
        ...(payload ? { payload } : {}),
      });
      setStatus(decision === "approve" ? "approved" : "rejected");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "action_card",
        source_tool,
        entity,
        display: { headline, action_id, status },
      }}
      className={`action-card action-card--${status}`}
    >
      <div className="action-card__body">
        <div className="action-card__head">
          <span className="action-card__headline">{headline}</span>
          {confidence !== undefined && (
            <span className="action-card__confidence">
              confidence {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
        {detail && <div className="action-card__detail">{detail}</div>}
        {meta && Object.keys(meta).length > 0 && (
          <div className="action-card__meta">
            {Object.entries(meta).map(([k, v]) => (
              <div className="action-card__meta-kv" key={k}>
                <span className="action-card__meta-k">{k}</span>
                <span className="action-card__meta-v">{v}</span>
              </div>
            ))}
          </div>
        )}
        <div className="action-card__actions">
          {status === "idle" || status === "error" ? (
            <>
              <button
                className="action-card__btn action-card__btn--reject"
                onClick={(e) => {
                  e.stopPropagation();
                  void submit("reject");
                }}
              >
                {reject_label}
              </button>
              <button
                className="action-card__btn action-card__btn--approve"
                onClick={(e) => {
                  e.stopPropagation();
                  void submit("approve");
                }}
              >
                {approve_label}
              </button>
            </>
          ) : status === "submitting" ? (
            <span className="action-card__status">Sending…</span>
          ) : status === "approved" ? (
            <span className="action-card__status action-card__status--ok">
              Approved · logged
            </span>
          ) : (
            <span className="action-card__status action-card__status--ok">
              Rejected · logged
            </span>
          )}
        </div>
        {status === "error" && error && (
          <div className="action-card__error">Failed: {error}</div>
        )}
      </div>
    </ElementWrapper>
  );
}
