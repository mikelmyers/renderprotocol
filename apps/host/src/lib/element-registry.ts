// Element registry. Holds metadata for every currently-mounted primitive
// (and selectable sub-element) keyed by composite element_id.
//
// Crucially: when an element unmounts, we keep its last-known metadata in a
// separate `tombstones` map so reference chips pointing at it can resolve
// to "this referred to X, which isn't currently visible — bring it back?"
// rather than silently failing. This is a first-class case per STRUCTURE.md
// §5; building it on day one so it doesn't get retrofitted.

import type { ElementMetadata } from "./types";

interface RegistryRecord {
  id: string;
  metadata: ElementMetadata;
  registered_seq: number;
  last_updated_seq: number;
}

interface Tombstone {
  id: string;
  metadata: ElementMetadata;
  removed_seq: number;
  removed_at_ms: number;
}

const live = new Map<string, RegistryRecord>();
const tombstones = new Map<string, Tombstone>();

// Cap tombstones — they're for fallback messaging, not unbounded memory.
const TOMBSTONE_LIMIT = 500;

export function registerElement(
  id: string,
  metadata: ElementMetadata,
  seq: number,
): void {
  live.set(id, { id, metadata, registered_seq: seq, last_updated_seq: seq });
  tombstones.delete(id);
}

export function updateElement(
  id: string,
  metadata: ElementMetadata,
  seq: number,
): void {
  const existing = live.get(id);
  if (existing) {
    existing.metadata = metadata;
    existing.last_updated_seq = seq;
  } else {
    // Update for an unknown id — treat as registration so later references
    // still resolve. Logged as a soft inconsistency.
    console.warn(`[element-registry] update for unknown id ${id}; registering`);
    registerElement(id, metadata, seq);
  }
}

export function removeElement(id: string, seq: number): void {
  const existing = live.get(id);
  if (!existing) return;
  live.delete(id);
  tombstones.set(id, {
    id,
    metadata: existing.metadata,
    removed_seq: seq,
    removed_at_ms: Date.now(),
  });
  if (tombstones.size > TOMBSTONE_LIMIT) {
    const oldest = tombstones.keys().next().value;
    if (oldest) tombstones.delete(oldest);
  }
}

export interface ResolveResult {
  status: "live" | "tombstoned" | "unknown";
  metadata: ElementMetadata | null;
  // Suffix-match candidates (live) when the exact id has churned but the
  // same source_tool/entity has reappeared under a new composition.
  reincarnated_id?: string;
}

export function resolveReference(id: string): ResolveResult {
  const liveHit = live.get(id);
  if (liveHit) return { status: "live", metadata: liveHit.metadata };

  // Suffix match: same source_tool/entity under a different composition.
  // Element IDs are `composition/primitive/source_tool/entity`; the last
  // two segments identify the entity across recompositions.
  const parts = id.split("/");
  if (parts.length === 4) {
    const suffix = `${parts[2]}/${parts[3]}`;
    for (const [liveId, rec] of live) {
      if (liveId.endsWith(suffix)) {
        return {
          status: "live",
          metadata: rec.metadata,
          reincarnated_id: liveId,
        };
      }
    }
  }

  const tombHit = tombstones.get(id);
  if (tombHit) return { status: "tombstoned", metadata: tombHit.metadata };

  return { status: "unknown", metadata: null };
}

// Construct a stable composite id from its parts. Single source of truth so
// IDs always have the same shape.
export function makeElementId(parts: {
  composition: string;
  primitive: string;
  source_tool: string;
  entity: string;
}): string {
  return `${parts.composition}/${parts.primitive}/${parts.source_tool}/${parts.entity}`;
}
