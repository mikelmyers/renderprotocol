// The "what is currently rendered in the render field" store.
//
// In v0 this holds a single composition at a time — the most recent result of
// a user-agent action. The render field reads it and dispatches to a primitive
// based on the data shape. The conversation panel writes it after a tool call
// completes.
//
// Step 2 will introduce a real composer (lib/composer.ts) that picks
// primitives based on data shape and intent; this store will then hold a
// LayoutSpec rather than a single { tool, data } pair. The shape stays
// future-compatible.

import { create } from "zustand";

export interface ActiveComposition {
  /// User intent that triggered this composition (free-text query for v0).
  intent: string;
  /// Tool that produced the data. Identifies which primitive(s) the
  /// composer should consider.
  source_tool: string;
  /// Structured payload returned by the tool. Opaque to the store; the
  /// primitive selected by the composer interprets the shape.
  data: unknown;
  /// Hosting agent the carrier routed this call to. Surfaced as an
  /// attribution chip on the rendered primitive so the routing decision
  /// is visible to the user.
  served_by?: string;
  /// Round-trip latency the carrier observed for this call. Surfaced
  /// alongside served_by; useful when ranking is contested.
  latency_ms?: number;
  /// Wall-clock millis the composition landed. Useful for the audit drawer
  /// and for cache-busting if the same intent fires twice.
  ts_ms: number;
}

interface CompositionState {
  current: ActiveComposition | null;
  setCurrent: (c: ActiveComposition) => void;
  clear: () => void;
}

export const useActiveComposition = create<CompositionState>((set) => ({
  current: null,
  setCurrent: (c) => set({ current: c }),
  clear: () => set({ current: null }),
}));
