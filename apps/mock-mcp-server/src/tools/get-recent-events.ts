import { z } from "zod";
import type { GetRecentEventsResult } from "@renderprotocol/protocol-types";

export const GetRecentEventsInput = z.object({
  query: z.string().max(2000).optional(),
});

export const getRecentEventsDefinition = {
  name: "get_recent_events",
  title: "Get recent events",
  description:
    "A hosting agent returns a sequence of recent events with timestamps for timeline rendering.",
  inputSchema: GetRecentEventsInput,
} as const;

export function handleGetRecentEvents(_args: { query?: string }) {
  const now = Date.now();
  const result: GetRecentEventsResult = {
    events: [
      {
        id: "e-1",
        ts_ms: now - 3 * 60 * 1000,
        title: "Routing decision: alpha-svc selected",
        description: "Carrier ranked alpha-svc above beta-svc on capability match + authority.",
        kind: "routing",
      },
      {
        id: "e-2",
        ts_ms: now - 17 * 60 * 1000,
        title: "Receipt: gamma-svc, success",
        description: "Latency 192ms, structuredContent valid, user agent did not override.",
        kind: "receipt",
      },
      {
        id: "e-3",
        ts_ms: now - 42 * 60 * 1000,
        title: "Hosting agent registered: epsilon-svc",
        description: "Bond posted; entered bounded-exposure window.",
        kind: "registration",
      },
      {
        id: "e-4",
        ts_ms: now - 2 * 60 * 60 * 1000,
        title: "Carrier weight rebalanced",
        description: "Online learner adjusted authority weight upward by 0.04 in `lookup` category.",
        kind: "tuning",
      },
    ],
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
    structuredContent: result,
  };
}
