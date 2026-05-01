import { useSurfaceBus } from "../../lib/surface-bus";
import { resolveReference } from "../../lib/element-registry";

// Placeholder conversation panel. The real ConversationPanel arrives in the
// next increment with MessageList + Composer + ReferenceChip + ContextChip.
// For this first runnable cut the panel demonstrates two things:
//   1. The bus reaches both panes (selecting a marker on the right updates
//      the chip on the left).
//   2. Reference resolution works — including the tombstone fallback path
//      from STRUCTURE.md §5.

export function ConversationPanel() {
  const selected = useSurfaceBus((s) => s.selected);
  const tick = useSurfaceBus((s) => s.tick);

  // Re-derive on every bus tick so updates flow even when the
  // selected id stays the same but its metadata changed.
  void tick;

  const resolved = selected ? resolveReference(selected) : null;
  const display = resolved?.metadata?.display ?? null;

  return (
    <div className="render-field">
      <div className="pane__body">
        <div className="conversation__placeholder">
          Conversation panel — placeholder for v0 first cut.
          <br />
          <br />
          Click any drone on the map to see the bidirectional reference bus
          in action.
        </div>

        {selected && (
          <div className="conversation__system">
            {`selection: ${selected}`}
            {resolved?.status === "live" && display && (
              <>
                {`\nresolved: live`}
                {Object.entries(display).map(
                  ([k, v]) => `\n  ${k}: ${String(v)}`,
                ).join("")}
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
