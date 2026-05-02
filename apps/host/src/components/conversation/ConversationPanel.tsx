import { useSurfaceBus } from "../../lib/surface-bus";
import { resolveReference } from "../../lib/element-registry";
import { composeBriefSentences, useBrief } from "../../lib/use-brief";

// Conversation panel — left pane. v0 shows two things:
//   1. The agent's morning-brief opening message (2–3 sentences computed
//      from the same data the render field is composing).
//   2. A live selection chip — clicking any row in the render field surfaces
//      the registered metadata here, exercising the bidirectional bus.
//
// The composer + threaded message list arrives in a later increment.

export function ConversationPanel() {
  const brief = useBrief();
  const sentences = composeBriefSentences(brief.results);

  const selected = useSurfaceBus((s) => s.selected);
  const tick = useSurfaceBus((s) => s.tick);
  // Re-derive on every bus tick so selection metadata refreshes even when
  // the same id stays selected through an underlying data update.
  void tick;

  const resolved = selected ? resolveReference(selected) : null;
  const display = resolved?.metadata?.display ?? null;

  return (
    <div className="render-field">
      <div className="pane__body">
        {brief.connection === "connecting" && (
          <div className="conversation__placeholder">
            Waiting for the agent to compose your morning brief…
          </div>
        )}

        {brief.connection === "ready" && sentences.length > 0 && (
          <div className="agent-message">
            <div className="agent-message__author">primordia-ops</div>
            {sentences.map((s, i) => (
              <p key={i} className="agent-message__line">
                {s}
              </p>
            ))}
          </div>
        )}

        {brief.connection === "error" && (
          <div className="conversation__placeholder">
            MCP unavailable — no brief to compose.
          </div>
        )}

        {brief.connection === "ready" && sentences.length === 0 && !brief.isLoading && (
          <div className="conversation__placeholder">
            Brief is empty — the agent had nothing to surface.
          </div>
        )}

        <div className="conversation__hint">
          Click any row on the right to see the bidirectional reference bus.
        </div>

        {selected && (
          <div className="conversation__system">
            {`selection: ${selected}`}
            {resolved?.status === "live" && display && (
              <>
                {`\nresolved: live`}
                {Object.entries(display)
                  .map(([k, v]) => `\n  ${k}: ${String(v)}`)
                  .join("")}
              </>
            )}
            {resolved?.status === "tombstoned" && (
              <>{`\nresolved: tombstoned (no longer mounted — reference fallback would offer to bring it back)`}</>
            )}
            {resolved?.status === "unknown" && (
              <>{`\nresolved: unknown (no metadata)`}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
