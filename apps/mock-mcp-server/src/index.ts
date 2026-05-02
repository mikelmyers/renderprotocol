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
import {
  recordActionDefinition,
  handleRecordAction,
} from "./tools/record-action.js";
import { UI_RESOURCES } from "./ui-resources/hello.js";

// Mock MCP server. MCP core + ui:// resources + server-initiated
// notifications over the Streamable HTTP transport's GET /mcp SSE channel.
//
// One process exposes six "service" tools (mail / calendar / messages /
// news / weather / docs) plus the domain-agnostic record_action and the
// hello sandbox ui:// resource. The per-tool name prefix
// (`<service>_<verb>`) lets the host trace which service produced each
// piece of the morning brief.

const PORT = Number(process.env.PORT ?? 4717);

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, Session>();

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "renderprotocol-mock-mcp", version: "0.0.0" },
    { capabilities: { tools: {}, resources: {}, logging: {} } },
  );

  // ── tools ─────────────────────────────────────────────────────────
  server.registerTool(
    mailGetInboxDefinition.name,
    {
      title: mailGetInboxDefinition.title,
      description: mailGetInboxDefinition.description,
      inputSchema: mailGetInboxDefinition.inputSchema.shape,
    },
    async () => handleMailGetInbox(),
  );

  server.registerTool(
    calendarGetTodayDefinition.name,
    {
      title: calendarGetTodayDefinition.title,
      description: calendarGetTodayDefinition.description,
      inputSchema: calendarGetTodayDefinition.inputSchema.shape,
    },
    async () => handleCalendarGetToday(),
  );

  server.registerTool(
    messagesGetRecentDefinition.name,
    {
      title: messagesGetRecentDefinition.title,
      description: messagesGetRecentDefinition.description,
      inputSchema: messagesGetRecentDefinition.inputSchema.shape,
    },
    async () => handleMessagesGetRecent(),
  );

  server.registerTool(
    newsGetFollowingDefinition.name,
    {
      title: newsGetFollowingDefinition.title,
      description: newsGetFollowingDefinition.description,
      inputSchema: newsGetFollowingDefinition.inputSchema.shape,
    },
    async () => handleNewsGetFollowing(),
  );

  server.registerTool(
    weatherGetLocalDefinition.name,
    {
      title: weatherGetLocalDefinition.title,
      description: weatherGetLocalDefinition.description,
      inputSchema: weatherGetLocalDefinition.inputSchema.shape,
    },
    async () => handleWeatherGetLocal(),
  );

  server.registerTool(
    docsGetRecentDefinition.name,
    {
      title: docsGetRecentDefinition.title,
      description: docsGetRecentDefinition.description,
      inputSchema: docsGetRecentDefinition.inputSchema.shape,
    },
    async () => handleDocsGetRecent(),
  );

  server.registerTool(
    recordActionDefinition.name,
    {
      title: recordActionDefinition.title,
      description: recordActionDefinition.description,
      inputSchema: recordActionDefinition.inputSchema.shape,
    },
    async (input) =>
      handleRecordAction(
        input as {
          action_id: string;
          intent: string;
          decision: "approve" | "reject";
          payload?: Record<string, unknown>;
        },
      ),
  );

  // ── ui:// resources (SEP-1865) ───────────────────────────────────
  for (const r of Object.values(UI_RESOURCES)) {
    server.registerResource(
      r.name,
      r.uri,
      {
        title: r.name,
        description: r.description,
        mimeType: r.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: r.uri,
            mimeType: r.mimeType,
            text: r.text,
          },
        ],
      }),
    );
  }

  return server;
}

// ── server-initiated notifications ────────────────────────────────────
// Keeps the resources/updated mechanism exercised after the scenario
// pivot. The host's notifications bridge maps URIs to tool refetches,
// so flagging mail_get_inbox as "updated" prompts the host to refetch
// and the mail card recomposes — the same generic mechanism the drone
// scenario used for fleet status.

function broadcast(method: string, params: unknown): void {
  for (const { server } of sessions.values()) {
    server.server
      .notification({
        method,
        params: params as Record<string, unknown> | undefined,
      })
      .catch((err) => {
        console.warn(`[mock-mcp] notification ${method} failed:`, err);
      });
  }
}

setInterval(() => {
  if (sessions.size === 0) return;
  broadcast("notifications/resources/updated", {
    uri: "renderprotocol://tool/mail_get_inbox",
  });
}, 30000);

// ── transport plumbing ───────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session && isInitializeRequest(req.body)) {
      let registered: Session | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (registered) sessions.set(id, registered);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = buildServer();
      registered = { transport, server };
      // Widen — SDK's Transport.onclose is required, but
      // StreamableHTTPServerTransport declares it optional. Safe: onclose
      // is set above.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      session = registered;
    } else if (!session) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "no session and not an initialize request" },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res, req.body);
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
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    res.status(400).send("invalid or missing session id");
    return;
  }
  await session.transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionStream);
app.delete("/mcp", handleSessionStream);

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    sessions: sessions.size,
    tools: [
      mailGetInboxDefinition.name,
      calendarGetTodayDefinition.name,
      messagesGetRecentDefinition.name,
      newsGetFollowingDefinition.name,
      weatherGetLocalDefinition.name,
      docsGetRecentDefinition.name,
      recordActionDefinition.name,
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[mock-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
});
