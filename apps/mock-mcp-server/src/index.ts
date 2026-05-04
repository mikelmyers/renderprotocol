import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { lookupDefinition, handleLookup, LookupInput } from "./tools/lookup.js";
import {
  listItemsDefinition,
  handleListItems,
  ListItemsInput,
} from "./tools/list-items.js";
import {
  getAlertsDefinition,
  handleGetAlerts,
  GetAlertsInput,
} from "./tools/get-alerts.js";
import {
  getRecentEventsDefinition,
  handleGetRecentEvents,
  GetRecentEventsInput,
} from "./tools/get-recent-events.js";
import { widgetDefinition, widgetMeta, handleWidget, WidgetInput } from "./tools/widget.js";
import {
  WIDGET_RESOURCE_URI,
  WIDGET_MIME_TYPE,
  WIDGET_RESOURCE_META,
  widgetHtml,
} from "./ui-resources/widget.js";
import { AGENT_NAME, AGENT_VERSION, isToolEnabled } from "./agent-context.js";

// Mock MCP server. Honest implementation of MCP core over Streamable HTTP.
// One process per hosting agent; the carrier connects to many in parallel.
// MOCK_AGENT_NAME, PORT, and MOCK_TOOLS env vars parameterize this instance
// so the same code runs as alpha, beta, and any other identity we want.

const PORT = Number(process.env.PORT ?? 4717);
// Loopback only. The mock server must never be reachable off-host. If we
// later need cross-host access (e.g. testing on a separate machine), it
// will be a deliberate config flag, not the default.
const HOST = "127.0.0.1";

function buildServer(): McpServer {
  const server = new McpServer(
    { name: `renderprotocol-mock-mcp:${AGENT_NAME}`, version: AGENT_VERSION },
    { capabilities: { tools: {}, resources: {}, logging: {} } },
  );

  if (isToolEnabled(lookupDefinition.name)) {
    server.registerTool(
      lookupDefinition.name,
      {
        title: lookupDefinition.title,
        description: lookupDefinition.description,
        inputSchema: lookupDefinition.inputSchema.shape,
      },
      async (args) => handleLookup(LookupInput.parse(args)),
    );
  }

  if (isToolEnabled(listItemsDefinition.name)) {
    server.registerTool(
      listItemsDefinition.name,
      {
        title: listItemsDefinition.title,
        description: listItemsDefinition.description,
        inputSchema: listItemsDefinition.inputSchema.shape,
      },
      async (args) => handleListItems(ListItemsInput.parse(args)),
    );
  }

  if (isToolEnabled(getAlertsDefinition.name)) {
    server.registerTool(
      getAlertsDefinition.name,
      {
        title: getAlertsDefinition.title,
        description: getAlertsDefinition.description,
        inputSchema: getAlertsDefinition.inputSchema.shape,
      },
      async (args) => handleGetAlerts(GetAlertsInput.parse(args)),
    );
  }

  if (isToolEnabled(getRecentEventsDefinition.name)) {
    server.registerTool(
      getRecentEventsDefinition.name,
      {
        title: getRecentEventsDefinition.title,
        description: getRecentEventsDefinition.description,
        inputSchema: getRecentEventsDefinition.inputSchema.shape,
      },
      async (args) => handleGetRecentEvents(GetRecentEventsInput.parse(args)),
    );
  }

  // SEP-1865: tools associate with a UI resource via _meta.ui.resourceUri.
  // The host fetches the resource separately via resources/read and renders
  // it in a sandboxed iframe; this tool's structured result is what the
  // host then forwards to the iframe via ui/notifications/tool-result.
  if (isToolEnabled(widgetDefinition.name)) {
    server.registerTool(
      widgetDefinition.name,
      {
        title: widgetDefinition.title,
        description: widgetDefinition.description,
        inputSchema: widgetDefinition.inputSchema.shape,
        _meta: widgetMeta,
      },
      async (args) => handleWidget(WidgetInput.parse(args)),
    );

    // The UI resource the widget tool points at. Served via standard
    // resources/read; the _meta.ui block tells the host how to construct
    // the iframe's CSP / permissions. Only registered when the widget tool
    // is enabled — agents that don't ship the tool shouldn't claim its UI.
    server.registerResource(
      "widget-ui",
      WIDGET_RESOURCE_URI,
      {
        mimeType: WIDGET_MIME_TYPE,
        description: "MCP Apps view for the `widget` tool.",
        _meta: WIDGET_RESOURCE_META,
      },
      async () => ({
        contents: [
          {
            uri: WIDGET_RESOURCE_URI,
            mimeType: WIDGET_MIME_TYPE,
            text: widgetHtml(),
            _meta: WIDGET_RESOURCE_META,
          },
        ],
      }),
    );
  }

  return server;
}

const app = express();
// Bound payload size — we don't expect anything close to 1MB on the wire
// for v0, and an explicit cap blocks pathological JSON-RPC bodies from
// exhausting memory.
app.use(express.json({ limit: "256kb" }));

// Stateful sessions are only meaningful once we add server-initiated
// notifications (next increment). For now we keep the session map ready and
// route by mcp-session-id so the wiring is in place.
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildServer();
      await server.connect(transport);
    } else if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "no session and not an initialize request" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mock-mcp] POST /mcp failed", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "internal error" },
        id: null,
      });
    }
  }
});

const handleSessionStream: express.RequestHandler = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("invalid or missing session id");
    return;
  }
  await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionStream);
app.delete("/mcp", handleSessionStream);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, sessions: transports.size });
});

app.listen(PORT, HOST, () => {
  console.log(`[mock-mcp:${AGENT_NAME}] listening on http://${HOST}:${PORT}/mcp`);
});
