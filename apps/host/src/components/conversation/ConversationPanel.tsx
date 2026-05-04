import { useCallback, useState } from "react";
import { ipc, type ResourceContentItem } from "../../lib/ipc";
import { useActiveComposition } from "../../lib/active-composition";
import { surfaceBus } from "../../lib/surface-bus";
import { routeIntent } from "../../lib/intent-router";
import { useTools, type ToolDefinition } from "../../lib/use-tools";
import type {
  ResourceCsp,
  ResourcePermissions,
  UiResourceEnvelope,
} from "../../lib/composer";
import { Composer } from "./Composer";
import { MessageList, type Message } from "./MessageList";

// ConversationPanel: the persistent home of the user's agent. Owns the
// conversation thread, dispatches user intent through the (host-side)
// intent router → carrier (passthrough v0) → MCP, and pushes either the
// raw structured payload or a UI-resource envelope (SEP-1865) into
// active-composition for the composer to interpret.
//
// Type-narrowing per source-tool is the composer's job — this panel
// handles routing + transport + the UI-resource fetch when a called tool
// is associated with a `ui://` resource.

const HTML_MIME_PREFIX = "text/html";

export function ConversationPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const setComposition = useActiveComposition((s) => s.setCurrent);
  const { tools, uiResourceUriFor } = useTools();

  const handleSubmit = useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: makeId(),
        role: "user",
        text,
        ts_ms: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);

      surfaceBus.requestRecompose(text, {});

      const route = routeIntent(text);

      try {
        const res = await ipc.callTool(route.tool, route.args);

        // If tools/list hasn't populated the cache yet (window just
        // opened), fetch inline so the first submission still resolves
        // UI-resource associations correctly.
        let resourceUri = uiResourceUriFor(route.tool);
        if (!resourceUri && tools === null) {
          resourceUri = await fetchUiResourceUriInline(route.tool);
        }

        const data = resourceUri
          ? await buildUiResourceEnvelope(resourceUri, res.raw)
          : (res.structured ?? parseJsonText(res.text));

        if (data === undefined) {
          throw new Error("hosting agent returned no parseable payload");
        }

        setComposition({
          intent: text,
          source_tool: route.tool,
          data,
          served_by: res.served_by,
          latency_ms: res.latency_ms,
          ts_ms: Date.now(),
        });

        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "agent",
            text: route.agentMessage,
            ts_ms: Date.now(),
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "system",
            text: `Tool call failed: ${msg}`,
            ts_ms: Date.now(),
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [setComposition, tools, uiResourceUriFor],
  );

  return (
    <div className="conversation">
      <div className="conversation__thread">
        <MessageList messages={messages} busy={busy} />
      </div>
      <div className="conversation__composer">
        <Composer onSubmit={handleSubmit} busy={busy} />
      </div>
    </div>
  );
}

// Look up `_meta.ui.resourceUri` for a tool by issuing a fresh tools/list.
// Used only when the useTools cache hasn't populated yet (first submission
// race). The hook fills its own cache asynchronously in parallel.
async function fetchUiResourceUriInline(toolName: string): Promise<string | undefined> {
  try {
    const res = await ipc.listTools();
    const list = (res as { tools?: ToolDefinition[] }).tools ?? [];
    return list.find((t) => t.name === toolName)?._meta?.ui?.resourceUri;
  } catch {
    return undefined;
  }
}

// Fetch the `ui://` resource via resources/read and assemble the envelope
// the composer expects. Pulls _meta.ui.csp / permissions / prefersBorder
// out of the response to drive iframe sandbox + CSP construction.
async function buildUiResourceEnvelope(
  uri: string,
  toolResult: unknown,
): Promise<UiResourceEnvelope> {
  const routed = await ipc.mcpReadResource(uri);
  const htmlItem = routed.response.contents.find(isHtmlContentItem);
  if (!htmlItem || typeof htmlItem.text !== "string") {
    throw new Error(
      `UI resource ${uri} (served by ${routed.served_by}) returned no HTML content`,
    );
  }
  const ui = extractUiMeta(htmlItem._meta);
  return {
    kind: "ui_resource",
    uri,
    html: htmlItem.text,
    csp: ui.csp,
    permissions: ui.permissions,
    prefersBorder: ui.prefersBorder,
    toolResult,
  };
}

function isHtmlContentItem(c: ResourceContentItem): boolean {
  return (
    typeof c.text === "string" &&
    typeof c.mimeType === "string" &&
    c.mimeType.startsWith(HTML_MIME_PREFIX)
  );
}

interface UiMeta {
  csp: ResourceCsp;
  permissions: ResourcePermissions;
  prefersBorder?: boolean;
}

// Defensive: any missing/malformed _meta.ui defaults to the spec's
// locked-down posture (no CSP relaxations, no permissions).
function extractUiMeta(raw: Record<string, unknown> | undefined): UiMeta {
  const ui = raw?.["ui"];
  if (typeof ui !== "object" || ui === null) {
    return { csp: {}, permissions: {} };
  }
  const u = ui as {
    csp?: ResourceCsp;
    permissions?: ResourcePermissions;
    prefersBorder?: boolean;
  };
  return {
    csp: u.csp ?? {},
    permissions: u.permissions ?? {},
    prefersBorder: typeof u.prefersBorder === "boolean" ? u.prefersBorder : undefined,
  };
}

function parseJsonText(text: string | null): unknown | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function makeId(): string {
  return crypto.randomUUID();
}
