// Frontend wrapper for the audit log.
//
// Two surfaces: read (for the X-ray drawer) and write (for events that
// originate in the React side — composition assembled, action decided).
// Rust-side writes (tool calls, bus events, notifications, config
// changes) land in the same store automatically; this module is the
// frontend's voice into it.

import { invoke } from "@tauri-apps/api/core";

export interface AuditEvent {
  id: number;
  ts_ms: number;
  parent_id: number | null;
  kind: string;
  payload: unknown;
}

export interface QueryArgs {
  limit?: number;
  since_id?: number;
  kind_prefix?: string;
}

export async function queryAudit(args: QueryArgs = {}): Promise<AuditEvent[]> {
  // Tauri 2 matches JS arg names against Rust parameter names directly;
  // we use the snake_case form here to match the command signature.
  return invoke("audit_query", {
    limit: args.limit ?? null,
    since_id: args.since_id ?? null,
    kind_prefix: args.kind_prefix ?? null,
  });
}

export async function recordAudit(
  kind: string,
  payload?: unknown,
  parent_id?: number | null,
): Promise<number | null> {
  try {
    return await invoke<number>("audit_record", {
      kind,
      payload: payload ?? null,
      parent_id: parent_id ?? null,
    });
  } catch (e) {
    console.warn(`[audit] record(${kind}) failed`, e);
    return null;
  }
}
