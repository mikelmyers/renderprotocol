import { z } from "zod";
import type { ListItemsResult } from "@renderprotocol/protocol-types";
import { AGENT_NAME } from "../agent-context.js";

export const ListItemsInput = z.object({
  query: z.string().max(2000).optional(),
});

export const listItemsDefinition = {
  name: "list_items",
  title: "List items",
  description:
    "A hosting agent returns a tabular result — columns plus rows — for a query that wants structured records.",
  inputSchema: ListItemsInput,
} as const;

export function handleListItems(_args: { query?: string }) {
  const result: ListItemsResult = {
    title: `Sample items (${AGENT_NAME})`,
    columns: [
      { key: "name", label: "Name" },
      { key: "kind", label: "Kind" },
      { key: "status", label: "Status" },
      { key: "updated", label: "Updated" },
    ],
    rows: [
      { name: "Alpha", kind: "service", status: "ready", updated: "2 min ago" },
      { name: "Beta", kind: "service", status: "ready", updated: "11 min ago" },
      { name: "Gamma", kind: "scheduler", status: "degraded", updated: "1 hr ago" },
      { name: "Delta", kind: "queue", status: "ready", updated: "3 hr ago" },
      { name: "Epsilon", kind: "ledger", status: "offline", updated: "6 hr ago" },
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
