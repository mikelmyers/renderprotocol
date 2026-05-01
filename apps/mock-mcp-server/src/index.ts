import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  getFleetStatusDefinition,
  handleGetFleetStatus,
} from "./tools/get-fleet-status.js";

// Mock MCP server. Honest implementation of MCP core over Streamable HTTP.
// v0 exposes a single tool (get_fleet_status); the surface for additional
// tools, ui:// resources, and notifications grows in subsequent increments.

const PORT = Number(process.env.PORT ?? 4717);

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "renderprotocol-mock-mcp", version: "0.0.0" },
    { capabilities: { tools: {}, resources: {}, logging: {} } },
  );

  server.registerTool(
    getFleetStatusDefinition.name,
    {
      title: getFleetStatusDefinition.title,
      description: getFleetStatusDefinition.description,
      inputSchema: getFleetStatusDefinition.inputSchema.shape,
    },
    async () => handleGetFleetStatus(),
  );

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

app.listen(PORT, () => {
  console.log(`[mock-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
});
