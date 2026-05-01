import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  getFleetStatusDefinition,
  handleGetFleetStatus,
} from "./tools/get-fleet-status.js";
import {
  getAnomaliesDefinition,
  handleGetAnomalies,
} from "./tools/get-anomalies.js";
import {
  getWeatherWindowDefinition,
  handleGetWeatherWindow,
} from "./tools/get-weather-window.js";
import {
  getCustomerReportsDefinition,
  handleGetCustomerReports,
} from "./tools/get-customer-reports.js";
import {
  getDroneTelemetryDefinition,
  handleGetDroneTelemetry,
} from "./tools/get-drone-telemetry.js";
import { UI_RESOURCES } from "./ui-resources/hello.js";

// Mock MCP server. Honest implementation of MCP core + the ui:// resource
// scheme over Streamable HTTP. Tools and resources expand alongside the
// composition vocabulary they serve.

const PORT = Number(process.env.PORT ?? 4717);

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "renderprotocol-mock-mcp", version: "0.0.0" },
    { capabilities: { tools: {}, resources: {}, logging: {} } },
  );

  // ── tools ─────────────────────────────────────────────────────────
  server.registerTool(
    getFleetStatusDefinition.name,
    {
      title: getFleetStatusDefinition.title,
      description: getFleetStatusDefinition.description,
      inputSchema: getFleetStatusDefinition.inputSchema.shape,
    },
    async () => handleGetFleetStatus(),
  );

  server.registerTool(
    getAnomaliesDefinition.name,
    {
      title: getAnomaliesDefinition.title,
      description: getAnomaliesDefinition.description,
      inputSchema: getAnomaliesDefinition.inputSchema.shape,
    },
    async (input) => handleGetAnomalies(input as { range_hours?: number }),
  );

  server.registerTool(
    getWeatherWindowDefinition.name,
    {
      title: getWeatherWindowDefinition.title,
      description: getWeatherWindowDefinition.description,
      inputSchema: getWeatherWindowDefinition.inputSchema.shape,
    },
    async () => handleGetWeatherWindow(),
  );

  server.registerTool(
    getCustomerReportsDefinition.name,
    {
      title: getCustomerReportsDefinition.title,
      description: getCustomerReportsDefinition.description,
      inputSchema: getCustomerReportsDefinition.inputSchema.shape,
    },
    async () => handleGetCustomerReports(),
  );

  server.registerTool(
    getDroneTelemetryDefinition.name,
    {
      title: getDroneTelemetryDefinition.title,
      description: getDroneTelemetryDefinition.description,
      inputSchema: getDroneTelemetryDefinition.inputSchema.shape,
    },
    async (input) =>
      handleGetDroneTelemetry(
        input as { drone_id: string; range_seconds?: number },
      ),
  );

  // ── ui:// resources (SEP-1865) ───────────────────────────────────
  // Each ui:// resource is registered as an MCP resource so that the
  // host's resources/list and resources/read calls work uniformly across
  // all resource kinds.
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

const app = express();
app.use(express.json());

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
