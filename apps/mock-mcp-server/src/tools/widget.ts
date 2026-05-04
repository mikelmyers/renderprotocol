import { z } from "zod";
import { WIDGET_RESOURCE_URI } from "../ui-resources/widget.js";
import { AGENT_NAME } from "../agent-context.js";

export const WidgetInput = z.object({
  query: z.string().max(2000).optional(),
});

export const widgetDefinition = {
  name: "widget",
  title: "Widget",
  description:
    "A hosting agent that ships its own UI via MCP Apps. The host fetches the associated ui:// resource and renders it in a sandboxed iframe; this tool's structured result is forwarded to the iframe via ui/notifications/tool-result.",
  inputSchema: WidgetInput,
} as const;

// SEP-1865: tools associate with a UI resource via _meta.ui.resourceUri.
// Spec also defines `visibility: ["model", "app"]` (the default); set it
// explicitly for clarity.
export const widgetMeta = {
  ui: {
    resourceUri: WIDGET_RESOURCE_URI,
    visibility: ["model", "app"] as const,
  },
} as const;

export function handleWidget(args: { query?: string }) {
  // The structured result is what the host forwards to the iframe via
  // ui/notifications/tool-result. The iframe renders it; the host doesn't
  // dispatch to a structured-data primitive when a UI resource is present.
  const result = {
    greeting: `Hello from hosting agent ${AGENT_NAME}`,
    received_query: args.query ?? null,
    server_ts_ms: Date.now(),
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
