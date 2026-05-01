import { UI_RESOURCE_URIS } from "@renderprotocol/protocol-types";

// First SEP-1865 ui:// resource. Intentionally minimal — proves the wire end
// to end (host fetches the resource, renders in a sandboxed iframe, exchanges
// postMessage with the parent) without depending on any specific surface
// design. Real domain-specific ui:// resources (e.g. ui://drone-focus/{id})
// land alongside the anomaly scenario.

const HELLO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MCP App — hello</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; height: 100%; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter",
          "Segoe UI", Roboto, sans-serif;
        background: #161922;
        color: #e7e9ee;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .card {
        max-width: 520px;
        text-align: left;
      }
      h1 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 6px 0;
        letter-spacing: 0.01em;
      }
      p {
        font-size: 13px;
        color: #8b93a7;
        margin: 0 0 12px 0;
      }
      .row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        background: #1d2230;
        color: #e7e9ee;
        border: 1px solid #353c4d;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      button:hover { border-color: #7aa2ff; }
      .pong {
        font-family: "SF Mono", "JetBrains Mono", Menlo, monospace;
        font-size: 11px;
        color: #74d39a;
        padding: 6px 8px;
        background: rgba(116, 211, 154, 0.08);
        border-radius: 4px;
        white-space: pre-wrap;
        margin-top: 12px;
        min-height: 1.4em;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>MCP App resource — sandbox check</h1>
      <p>This iframe was loaded from <code>${UI_RESOURCE_URIS.HELLO}</code> and is rendered inside the host's sandboxed <code>McpAppFrame</code>. The button below posts a message to the host; if you see a pong below, bidirectional communication is working.</p>
      <div class="row">
        <button id="ping">Ping host</button>
        <button id="resize">Request resize</button>
      </div>
      <div class="pong" id="pong"></div>
    </div>
    <script>
      const pongEl = document.getElementById("pong");
      const post = (type, payload) => {
        window.parent.postMessage({ source: "mcp-app", type, payload }, "*");
      };
      document.getElementById("ping").addEventListener("click", () => {
        post("ping", { ts: Date.now() });
      });
      document.getElementById("resize").addEventListener("click", () => {
        post("resize", { height: 280 });
      });
      window.addEventListener("message", (e) => {
        if (e.data && e.data.source === "host" && e.data.type === "pong") {
          pongEl.textContent = "pong received: " + JSON.stringify(e.data.payload);
        }
      });
      post("ready", {});
    </script>
  </body>
</html>
`;

export interface UiResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
}

export const HELLO_RESOURCE: UiResource = {
  uri: UI_RESOURCE_URIS.HELLO,
  name: "MCP App: hello",
  description:
    "Minimal MCP App that exercises the iframe sandbox and bidirectional postMessage envelope.",
  mimeType: "text/html",
  text: HELLO_HTML,
};

export const UI_RESOURCES: Record<string, UiResource> = {
  [HELLO_RESOURCE.uri]: HELLO_RESOURCE,
};
