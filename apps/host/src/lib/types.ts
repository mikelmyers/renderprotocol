// Frontend-side mirror of the bus event types defined in
// `apps/host/src-tauri/src/bus.rs`. Hand-synchronized for v0; the surface is
// small enough that codegen would be premature.

export type SelectionSource =
  | "click"
  | "keyboard"
  | "conversation_reference"
  | "programmatic";

export type BusEvent =
  | {
      kind: "element_registered";
      element_id: string;
      metadata: Record<string, unknown>;
    }
  | {
      kind: "element_updated";
      element_id: string;
      metadata: Record<string, unknown>;
    }
  | { kind: "element_removed"; element_id: string }
  | {
      kind: "element_selected";
      element_id: string;
      source: SelectionSource;
    }
  | { kind: "element_focused"; element_id: string }
  | {
      kind: "reference_inserted";
      element_id: string;
      message_id: string;
    }
  | {
      kind: "reference_resolved";
      element_id: string;
      target_mounted: boolean;
    }
  | {
      kind: "recompose_requested";
      intent: string;
      anchor: string | null;
      params: Record<string, unknown>;
    };

export interface BusEnvelope {
  seq: number;
  ts_ms: number;
  // Flattened event fields (kind + payload) live alongside seq/ts_ms.
  // Use a discriminated narrowing on `kind`.
  kind: BusEvent["kind"];
  [extra: string]: unknown;
}

// Helper to recover a typed BusEvent from the flattened envelope.
export function envelopeToEvent(env: BusEnvelope): BusEvent {
  const { seq: _seq, ts_ms: _ts_ms, ...rest } = env;
  return rest as unknown as BusEvent;
}

export interface ElementMetadata {
  composition: string;
  primitive: string;
  source_tool: string;
  entity: string;
  // Free-form bag for primitive-specific data (e.g. for Drone 7: callsign,
  // last position). Stored so that reference fallbacks can render a useful
  // description when the element isn't currently mounted.
  display: Record<string, unknown>;
}
