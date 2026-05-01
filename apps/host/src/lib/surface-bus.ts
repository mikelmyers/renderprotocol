// Surface event bus — frontend side.
//
// Mirror of `apps/host/src-tauri/src/bus.rs`. Subscribes to the
// "surface-bus" Tauri event channel, applies events to the local element
// registry, and exposes helpers for components to emit events back.
//
// Design notes:
//   - Every envelope carries a monotonic `seq` from the Rust side.
//     Recompositions fire many remove/register events in close succession;
//     ordering must be preserved. We keep `lastSeq` and warn on out-of-order.
//   - `element_updated` is distinct from remove + register. Updates do not
//     bust references; churn does (and triggers tombstoning).
//   - The store also holds the most recent `selected` and `focused` ids
//     so the conversation panel can show a "context chip" without re-deriving.

import { create } from "zustand";
import { ipc } from "./ipc";
import {
  envelopeToEvent,
  type BusEnvelope,
  type BusEvent,
  type ElementMetadata,
  type SelectionSource,
} from "./types";
import {
  makeElementId,
  registerElement,
  removeElement,
  resolveReference,
  updateElement,
  type ResolveResult,
} from "./element-registry";

interface SurfaceBusState {
  lastSeq: number;
  selected: string | null;
  focused: string | null;
  // Bumped on every event so subscribers can re-derive cheaply if they
  // need to. Components that care about specific elements should query
  // the registry directly rather than re-rendering on every bump.
  tick: number;
}

export const useSurfaceBus = create<SurfaceBusState>(() => ({
  lastSeq: -1,
  selected: null,
  focused: null,
  tick: 0,
}));

let unsubscribe: (() => void) | null = null;

/// Wire the Tauri event channel into the local store. Idempotent.
export async function startSurfaceBus(): Promise<void> {
  if (unsubscribe) return;
  const off = await ipc.onBus(handleEnvelope);
  unsubscribe = off;
}

export function stopSurfaceBus(): void {
  unsubscribe?.();
  unsubscribe = null;
}

function handleEnvelope(env: BusEnvelope): void {
  const state = useSurfaceBus.getState();
  if (env.seq <= state.lastSeq) {
    // Duplicate or out-of-order — Rust is the source of truth for seq, so
    // this shouldn't happen in practice. Log loud if it does.
    console.warn(
      `[surface-bus] non-monotonic seq: got ${env.seq}, last ${state.lastSeq}`,
    );
  }

  const event = envelopeToEvent(env);
  applyEvent(event, env.seq);

  useSurfaceBus.setState((s) => ({
    lastSeq: Math.max(s.lastSeq, env.seq),
    selected:
      event.kind === "element_selected" ? event.element_id : s.selected,
    focused: event.kind === "element_focused" ? event.element_id : s.focused,
    tick: s.tick + 1,
  }));
}

function applyEvent(event: BusEvent, seq: number): void {
  switch (event.kind) {
    case "element_registered":
      registerElement(
        event.element_id,
        event.metadata as unknown as ElementMetadata,
        seq,
      );
      break;
    case "element_updated":
      updateElement(
        event.element_id,
        event.metadata as unknown as ElementMetadata,
        seq,
      );
      break;
    case "element_removed":
      removeElement(event.element_id, seq);
      break;
    // selected / focused / reference / recompose are observed via the
    // store; no registry mutation needed here.
    default:
      break;
  }
}

// ─── Convenience emitters used by components ────────────────────────────

export const surfaceBus = {
  registerElement(id: string, metadata: ElementMetadata): void {
    void ipc.emitBus({
      kind: "element_registered",
      element_id: id,
      metadata: metadata as unknown as Record<string, unknown>,
    });
  },
  updateElement(id: string, metadata: ElementMetadata): void {
    void ipc.emitBus({
      kind: "element_updated",
      element_id: id,
      metadata: metadata as unknown as Record<string, unknown>,
    });
  },
  removeElement(id: string): void {
    void ipc.emitBus({ kind: "element_removed", element_id: id });
  },
  selectElement(id: string, source: SelectionSource = "click"): void {
    void ipc.emitBus({ kind: "element_selected", element_id: id, source });
  },
  focusElement(id: string): void {
    void ipc.emitBus({ kind: "element_focused", element_id: id });
  },
  insertReference(element_id: string, message_id: string): void {
    void ipc.emitBus({ kind: "reference_inserted", element_id, message_id });
  },
  resolveReference(element_id: string): ResolveResult {
    const result = resolveReference(element_id);
    void ipc.emitBus({
      kind: "reference_resolved",
      element_id,
      target_mounted: result.status === "live",
    });
    return result;
  },
  requestRecompose(
    intent: string,
    params: Record<string, unknown> = {},
    anchor: string | null = null,
  ): void {
    void ipc.emitBus({
      kind: "recompose_requested",
      intent,
      anchor,
      params,
    });
  },
};

export { makeElementId };
