import { useSurfaceBus } from "../../lib/surface-bus";
import { resolveReference } from "../../lib/element-registry";
import { useActiveAgent, useConfig } from "../../lib/config";

// Placeholder conversation panel. The real ConversationPanel arrives in a
// later increment with MessageList + Composer + ReferenceChip + ContextChip.
//
// For step 4 it surfaces three things so the configuration substrate is
// observable end-to-end:
//   1. the active agent's title and purpose
//   2. the active agent's "Defaults" bullets (what the morning brief
//      composer will read in step 5)
//   3. the current render-field selection — proves the bus reaches both
//      panes and the reference registry resolves.

export function ConversationPanel() {
  const selected = useSurfaceBus((s) => s.selected);
  const tick = useSurfaceBus((s) => s.tick);
  void tick;
  const ready = useConfig((s) => s.ready);
  const dir = useConfig((s) => s.dir);
  const { key: activeKey, doc: activeDoc } = useActiveAgent();

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

        {activeDoc && (
          <section className="conv-section">
            <div className="conv-section__head">Active agent</div>
            <div className="conv-section__body">
              <div className="conv-agent__title">
                {activeDoc.title ?? activeKey ?? "Unnamed"}
              </div>
              {activeDoc.sections_by_key["purpose"] && (
                <p className="conv-agent__purpose">
                  {activeDoc.sections_by_key["purpose"]}
                </p>
              )}
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
              {activeDoc.typed.permissions.length > 0 && (
                <>
                  <div className="conv-section__sub">Permissions</div>
                  <ul className="conv-agent__bullets conv-agent__bullets--mono">
                    {activeDoc.typed.permissions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        )}

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
      </div>
    </div>
  );
}
