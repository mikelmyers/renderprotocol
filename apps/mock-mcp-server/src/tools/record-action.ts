import { z } from "zod";

// Generic stub for any agent-initiated action that needs an audit
// trail. Approve/Reject from an ActionCard primitive ends up here.
// In v0 this just logs to stdout and returns ok; later increments wire
// it through to real side effects (send email, place order, etc.) per
// the active agent.md permissions.

export const RecordActionInput = z.object({
  action_id: z.string(),
  intent: z.string(),
  decision: z.enum(["approve", "reject"]),
  payload: z.record(z.unknown()).optional(),
});

export const recordActionDefinition = {
  name: "record_action",
  title: "Record action decision",
  description:
    "Logs a user decision on a proposed action. Returns the decision plus a server-side action_id for audit / replay.",
  inputSchema: RecordActionInput,
} as const;

export function handleRecordAction(input: {
  action_id: string;
  intent: string;
  decision: "approve" | "reject";
  payload?: Record<string, unknown>;
}) {
  const recorded_at = new Date().toISOString();
  console.log(
    `[mock-mcp] action ${input.decision}: ${input.intent} (id=${input.action_id})`,
  );
  const result = {
    ok: true,
    recorded_at,
    action_id: input.action_id,
    decision: input.decision,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
