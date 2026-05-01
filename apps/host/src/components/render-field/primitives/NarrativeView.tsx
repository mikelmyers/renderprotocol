import { useMemo, type ReactNode } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId, surfaceBus } from "../../../lib/surface-bus";
import { resolveReference } from "../../../lib/element-registry";

// Generic narrative primitive — agent-authored text with embedded
// references. References are rendered as inline chips that resolve through
// the element registry. Clicking a chip emits reference_resolved on the
// bus; the registry's tombstone path means a chip pointing at an element
// that no longer mounts still surfaces context (per STRUCTURE.md §5).
//
// Markdown support is intentionally tiny for v0: paragraph splitting on
// blank lines plus inline `[ref:...]` token expansion. Heavier markdown
// (lists, links, code) arrives when a primitive actually needs it.

interface Props {
  composition: string;
  source_tool: string;
  entity: string;
  body: string;
}

export function NarrativeView({
  composition,
  source_tool,
  entity,
  body,
}: Props) {
  const id = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "narrative",
        source_tool,
        entity,
      }),
    [composition, source_tool, entity],
  );

  const paragraphs = useMemo(
    () => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    [body],
  );

  return (
    <ElementWrapper
      id={id}
      metadata={{
        composition,
        primitive: "narrative",
        source_tool,
        entity,
        display: { length: body.length },
      }}
      className="narrative-view"
    >
      {paragraphs.map((p, i) => (
        <p key={i} className="narrative-view__p">
          {renderParagraph(p)}
        </p>
      ))}
    </ElementWrapper>
  );
}

function renderParagraph(p: string): ReactNode {
  // Split on `[ref:...]` tokens, preserving order.
  const parts: ReactNode[] = [];
  const re = /\[ref:([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(p)) !== null) {
    if (match.index > lastIndex) {
      parts.push(p.slice(lastIndex, match.index));
    }
    parts.push(
      <ReferenceChipInline key={`r-${key++}`} target={match[1]!.trim()} />,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < p.length) parts.push(p.slice(lastIndex));
  return parts.length > 0 ? parts : p;
}

function ReferenceChipInline({ target }: { target: string }) {
  // The full ReferenceChip component (with hover preview, jump-to-element
  // animation, and the "bring it back?" tombstone CTA) lands when the
  // conversation panel real version arrives. For v0 this is a minimal
  // chip that resolves on click and emits the right bus events.
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = surfaceBus.resolveReference(target);
    if (result.status === "live") {
      // Live element — also fire selection so the render field highlights it.
      surfaceBus.selectElement(
        result.reincarnated_id ?? target,
        "conversation_reference",
      );
    }
  };
  // Snapshot the registry once on render to derive a label and a state.
  const snapshot = resolveReference(target);
  const label =
    (snapshot.metadata?.display?.["title"] as string | undefined) ??
    (snapshot.metadata?.display?.["callsign"] as string | undefined) ??
    (snapshot.metadata?.entity as string | undefined) ??
    target.split("/").pop() ??
    target;
  const className =
    snapshot.status === "live"
      ? "ref-chip ref-chip--live"
      : snapshot.status === "tombstoned"
        ? "ref-chip ref-chip--tombstoned"
        : "ref-chip ref-chip--unknown";
  return (
    <span
      className={className}
      onClick={onClick}
      data-target={target}
      role="button"
      tabIndex={0}
    >
      {label}
    </span>
  );
}
