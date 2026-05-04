import { z } from "zod";
import type { GetAlertsResult } from "@renderprotocol/protocol-types";

export const GetAlertsInput = z.object({
  query: z.string().max(2000).optional(),
});

export const getAlertsDefinition = {
  name: "get_alerts",
  title: "Get alerts",
  description:
    "A hosting agent returns items needing the operator's attention, severity-coded.",
  inputSchema: GetAlertsInput,
} as const;

export function handleGetAlerts(_args: { query?: string }) {
  const now = Date.now();
  const result: GetAlertsResult = {
    alerts: [
      {
        id: "a-1",
        severity: "critical",
        title: "Capability declaration mismatch",
        body:
          "A hosting agent's published schema disagrees with its last 12 receipts. Routing paused pending review.",
        ts_ms: now - 4 * 60 * 1000,
      },
      {
        id: "a-2",
        severity: "warning",
        title: "Latency above target",
        body: "Median routing latency rose to 480ms over the last hour (target: 250ms).",
        ts_ms: now - 28 * 60 * 1000,
      },
      {
        id: "a-3",
        severity: "info",
        title: "New hosting agent in exploration",
        body: "A new hosting agent is in the bounded-exposure window. No action required.",
        ts_ms: now - 90 * 60 * 1000,
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
