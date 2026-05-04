import { useMemo } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { SafeMarkdown } from "../../../lib/safe-markdown";

interface Props {
  composition: string;
  source_tool: string;
  /// Markdown source. Rendered with the shared SafeMarkdown wrapper —
  /// no raw HTML, URI-allowlisted links, external links opened safely.
  markdown: string;
}

// NarrativeView: the v0 generalist primitive. Renders prose authored by a
// hosting agent (or by the user agent summarizing across hosting agents).
// Any tool whose result shape we don't have a specialist primitive for
// falls back to here via the composer's `fallback` selection.

export function NarrativeView({ composition, source_tool, markdown }: Props) {
  const elementId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "narrative",
        source_tool,
        entity: "body",
      }),
    [composition, source_tool],
  );

  return (
    <ElementWrapper
      id={elementId}
      metadata={{
        composition,
        primitive: "narrative",
        source_tool,
        entity: "body",
        display: { length: markdown.length },
      }}
      className="narrative-view"
    >
      <div className="narrative-view__body">
        <SafeMarkdown>{markdown}</SafeMarkdown>
      </div>
    </ElementWrapper>
  );
}
