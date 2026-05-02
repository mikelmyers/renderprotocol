import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  mailGetInboxDefinition,
  handleMailGetInbox,
} from "./tools/mail-get-inbox.js";
import {
  calendarGetTodayDefinition,
  handleCalendarGetToday,
} from "./tools/calendar-get-today.js";
import {
  messagesGetRecentDefinition,
  handleMessagesGetRecent,
} from "./tools/messages-get-recent.js";
import {
  newsGetFollowingDefinition,
  handleNewsGetFollowing,
} from "./tools/news-get-following.js";
import {
  weatherGetLocalDefinition,
  handleWeatherGetLocal,
} from "./tools/weather-get-local.js";
import {
  docsGetRecentDefinition,
  handleDocsGetRecent,
} from "./tools/docs-get-recent.js";

// Mock MCP server. Honest implementation of MCP core over Streamable HTTP.
// One process exposes six tools, each pretending to be a different "service"
// the agent can reach: mail, calendar, messages, news, weather, docs. The
// per-tool naming convention (`<service>_<verb>`) lets the host label which
// service produced each piece of the brief — even though it's all one server
// for v0.

const PORT = Number(process.env.PORT ?? 4717);

interface ToolEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: { name: string; title: string; description: string; inputSchema: any };
  handler: () => ReturnType<typeof handleMailGetInbox>;
}

const TOOLS: ToolEntry[] = [
  { definition: mailGetInboxDefinition, handler: handleMailGetInbox },
  { definition: calendarGetTodayDefinition, handler: handleCalendarGetToday },
  { definition: messagesGetRecentDefinition, handler: handleMessagesGetRecent },
  { definition: newsGetFollowingDefinition, handler: handleNewsGetFollowing },
  { definition: weatherGetLocalDefinition, handler: handleWeatherGetLocal },
  { definition: docsGetRecentDefinition, handler: handleDocsGetRecent },
];

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "renderprotocol-mock-mcp", version: "0.0.0" },
    { capabilities: { tools: {}, resources: {}, logging: {} } },
  );

  for (const { definition, handler } of TOOLS) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema.shape,
      },
      async () => handler(),
    );
  }

  return server;
}

const app = express();
app.use(express.json());

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
      // SDK's Transport.onclose is required, but StreamableHTTPServerTransport
      // declares it optional; with exactOptionalPropertyTypes the structural
      // check fails. Safe to widen — onclose is set above.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
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
  res.json({
    ok: true,
    sessions: transports.size,
    tools: TOOLS.map((t) => t.definition.name),
  });
});

app.listen(PORT, () => {
  console.log(
    `[mock-mcp] listening on http://127.0.0.1:${PORT}/mcp — ${TOOLS.length} tools registered`,
  );
});
