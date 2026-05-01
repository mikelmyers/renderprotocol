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
import {
  recordActionDefinition,
  handleRecordAction,
} from "./tools/record-action.js";
import { UI_RESOURCES } from "./ui-resources/hello.js";

// Mock MCP server. MCP core + ui:// resources + server-initiated
// notifications over the Streamable HTTP transport's GET /mcp SSE channel.

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
// Two emitters run while at least one session is active:
//   - resources/updated for fleet status every 8s. Signals the host to
//     refetch get_fleet_status — drone positions drift slightly with the
//     fixture. Generic mechanism: any tool's underlying data can be
//     declared "updated" by URI.
//   - renderprotocol/data_updated every second carrying a fresh
//     telemetry sample. Custom method, generic shape: { topic, payload }.
//     A live feed primitive subscribed to the matching topic appends each
//     sample to its sparkline without re-issuing the tool call.

const TELEMETRY_DRONE_ID = "drone-7";
let telemetryBaseline = 0.5;

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
  // ResourcesUpdated nudges the host to refetch the corresponding tool
  // (mapping URI → tool happens on the host side, in the notifications
  // bridge).
  broadcast("notifications/resources/updated", {
    uri: "renderprotocol://tool/get_fleet_status",
  });
}, 8000);

setInterval(() => {
  if (sessions.size === 0) return;
  // Random walk + faint sinusoid so the sparkline is alive but not
  // chaotic. The telemetry rule pre-warms the chart with a 60s baseline
  // from the tool call; this keeps it growing in real time.
  const drift = (Math.random() - 0.5) * 0.12;
  const wobble = Math.sin(Date.now() / 700) * 0.05;
  telemetryBaseline = clamp(telemetryBaseline + drift + wobble, 0.05, 2.5);
  broadcast("notifications/renderprotocol/data_updated", {
    topic: `telemetry/${TELEMETRY_DRONE_ID}`,
    payload: {
      ts_ms: Date.now(),
      value: roundTo(telemetryBaseline, 3),
    },
  });
}, 1000);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function roundTo(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

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
      await server.connect(transport);
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
  res.json({ ok: true, sessions: sessions.size });
});

app.listen(PORT, () => {
  console.log(`[mock-mcp] listening on http://127.0.0.1:${PORT}/mcp`);
});
