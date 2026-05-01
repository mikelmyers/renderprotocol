import { useSurfaceBus } from "../../lib/surface-bus";
import { resolveReference } from "../../lib/element-registry";
import { useActiveAgent, useConfig } from "../../lib/config";
import { useCompositionState } from "../../lib/use-composition";
import { NarrativeView } from "../render-field/primitives/NarrativeView";

// Conversation panel — the agent's voice on the left.
//
// For step 5 the panel is composer-driven: the morning-brief composer
// produces a NarrativeSpec (deterministic v0; same shape an LLM call
// will produce later) and we render it through NarrativeView. Embedded
// `[ref:elementId]` tokens resolve against the live element registry,
// so clicking "Drone 7 vibration" jumps the right pane to that timeline
// event.
//
// Selection echo and the active agent's contract still surface below
// the narrative — the panel is one place to see what the agent decided
// AND why.

export function ConversationPanel() {
  const selected = useSurfaceBus((s) => s.selected);
  const tick = useSurfaceBus((s) => s.tick);
  void tick;

  const ready = useConfig((s) => s.ready);
  const dir = useConfig((s) => s.dir);
  const { key: activeKey, doc: activeDoc } = useActiveAgent();
  const narrative = useCompositionState((s) => s.narrative);
  const status = useCompositionState((s) => s.status);
  const watching = useCompositionState((s) => s.watching);

  const resolved = selected ? resolveReference(selected) : null;
  const display = resolved?.metadata?.display ?? null;

  return (
    <div className="render-field">
      <div className="pane__body">
        {!ready && (
          <div className="conversation__placeholder">Loading configuration…</div>
        )}

        {ready && !activeDoc && (
          <div className="conversation__placeholder">
            No <code>agent.md</code> loaded.
            <br />
            <br />
            Drop a markdown file into <code>{dir ?? "config/agents/"}</code> —
            the surface watches that directory and reloads automatically.
          </div>
        )}

        {/* Composer's narrative — what the agent has to say this morning. */}
        {narrative && narrative.body.trim() && (
          <section className="conv-section">
            <NarrativeView
              composition="conversation"
              source_tool="composer"
              entity="morning-brief-summary"
              body={narrative.body}
            />
          </section>
        )}

        {status === "fetching" && !narrative && (
          <div className="conversation__placeholder">Composing morning brief…</div>
        )}

        {/* What the agent is watching but can't see (concerns without tools). */}
        {watching.length > 0 && (
          <section className="conv-section">
            <div className="conv-section__head">Standing concerns</div>
            <ul className="conv-watching">
              {watching.map((w, i) => (
                <li key={i}>
                  <span>{w.label}</span>
                  <span className="conv-watching__hint">no tool connected</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Selection echo — proves the bus reaches both panes. */}
        {selected && (
          <section className="conv-section">
            <div className="conv-section__head">Selection</div>
            <div className="conversation__system">
              {selected}
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
          </section>
        )}

        {/* Active agent contract surfaced for transparency — moved below the
            narrative so the headline reads first. */}
        {activeDoc && (
          <section className="conv-section conv-section--muted">
            <div className="conv-section__head">
              Active agent — {activeDoc.title ?? activeKey ?? "unnamed"}
            </div>
            {activeDoc.typed.defaults.length > 0 && (
              <>
                <div className="conv-section__sub">Defaults</div>
                <ul className="conv-agent__bullets">
                  {activeDoc.typed.defaults.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
