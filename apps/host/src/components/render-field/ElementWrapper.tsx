import { useEffect } from "react";
import { surfaceBus } from "../../lib/surface-bus";
import { useSurfaceBus } from "../../lib/surface-bus";
import type { ElementMetadata } from "../../lib/types";

interface Props {
  id: string;
  metadata: ElementMetadata;
  children: React.ReactNode;
  className?: string;
}

// Stamps a stable element_id onto a primitive (or selectable sub-element),
// registers it on the bus on mount, deregisters on unmount, and forwards
// click → element_selected. Built on day one so every primitive is
// addressable from the conversation panel.
export function ElementWrapper({ id, metadata, children, className }: Props) {
  const selected = useSurfaceBus((s) => s.selected);

  useEffect(() => {
    surfaceBus.registerElement(id, metadata);
    return () => surfaceBus.removeElement(id);
    // metadata is intentionally not in the deps — primitive-level
    // identity is the id, not the bag. Use updateElement for data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isSelected = selected === id;

  return (
    <div
      data-element-id={id}
      className={`element ${isSelected ? "element--selected" : ""} ${className ?? ""}`.trim()}
      onClick={(e) => {
        e.stopPropagation();
        surfaceBus.selectElement(id, "click");
      }}
    >
      {children}
    </div>
  );
}
