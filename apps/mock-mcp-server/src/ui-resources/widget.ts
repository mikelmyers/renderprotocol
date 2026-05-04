// MCP Apps (SEP-1865) UI resource for the `widget` tool.
//
// Self-contained HTML, served verbatim via resources/read. Demonstrates
// the four pieces of the protocol that the host has to get right:
//   1. ui/initialize handshake (View → Host)
//   2. ui/notifications/initialized (View → Host)
//   3. Receiving ui/notifications/tool-result (Host → View)
//   4. Proxying tools/call back to the same MCP server (View → Host)
// Plus ui/notifications/size-changed once the document has measured itself.
//
// The HTML uses inline scripts/styles only — fits inside the spec's
// default-deny CSP without needing extra connect/resource domains.

export const WIDGET_RESOURCE_URI = "ui://renderprotocol-mock/widget";
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const WIDGET_RESOURCE_META = {
  ui: {
    // No CSP relaxations — runs in default-deny + inline scripts/styles.
    csp: {},
    permissions: {},
    prefersBorder: true,
  },
} as const;

export function widgetHtml(): string {
  // Backtick-only template; HTML below contains no ${...} interpolation
  // so there is no risk of host-side injection. The iframe's inline
  // script handles all rendering of dynamic content via DOM textContent
  // (never innerHTML), so payloads from tool-result can't escape into
  // the iframe's DOM as markup.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Widget</title>
<style>
  :root {
    color-scheme: light;
    --bg: #ffffff;
    --text: #1a1d24;
    --muted: #6b7384;
    --border: #dde1ea;
    --accent: #3563d1;
    --accent-soft: rgba(53, 99, 209, 0.12);
    --ok: #2f9c5b;
    --warn: #c97a18;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { padding: 18px; }
  h1 { font-size: 16px; margin: 0 0 14px; letter-spacing: -0.01em; }
  .row { display: grid; grid-template-columns: 120px 1fr; gap: 8px 14px; align-items: baseline; margin-bottom: 8px; }
  .key { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .val { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; word-break: break-all; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .pill--pending { background: rgba(107, 115, 132, 0.12); color: var(--muted); }
  .pill--ready { background: rgba(47, 156, 91, 0.14); color: var(--ok); }
  .pill--error { background: rgba(212, 73, 62, 0.14); color: #d4493e; }
  hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
  button { font: inherit; padding: 8px 12px; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 6px; cursor: pointer; }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  pre { margin: 0; padding: 10px 12px; background: var(--accent-soft); border-radius: 6px; font-size: 12px; overflow: auto; max-height: 220px; }
  .footer { margin-top: 14px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <h1>MCP App: Widget</h1>

  <div class="row">
    <span class="key">handshake</span>
    <span class="val"><span id="handshake-state" class="pill pill--pending">pending</span></span>
  </div>
  <div class="row">
    <span class="key">host</span>
    <span class="val" id="host-info">—</span>
  </div>
  <div class="row">
    <span class="key">tool result</span>
    <span class="val" id="tool-result-state"><span class="pill pill--pending">awaiting</span></span>
  </div>

  <hr>

  <p style="margin: 0 0 10px; color: var(--muted); font-size: 13px;">
    Round-trip demo: this iframe can call other tools on the same hosting
    agent through the host's MCP client. Click below to fetch alerts via
    a proxied <code>tools/call</code> and see the count come back.
  </p>
  <button id="fetch-alerts-btn" disabled>Fetch alerts via proxy</button>

  <div id="proxy-output" style="margin-top: 12px;"></div>

  <div class="footer">
    Sent here by the host as: <code id="self-uri">${WIDGET_RESOURCE_URI}</code>
  </div>

<script>
(function () {
  "use strict";

  // ─── postMessage helpers ────────────────────────────────────────────────
  // Outbound: always to window.parent. The host validates source identity
  // on its side; we still don't broadcast to every frame.
  let nextId = 1;
  const pending = new Map();

  function send(method, params) {
    const id = nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve, reject });
      try { window.parent.postMessage(msg, "*"); }
      catch (e) { pending.delete(id); reject(e); }
    });
  }

  function notify(method, params) {
    try { window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*"); }
    catch (e) { console.warn("[widget] notify failed", e); }
  }

  function reply(id, result) {
    try { window.parent.postMessage({ jsonrpc: "2.0", id, result }, "*"); }
    catch (e) { console.warn("[widget] reply failed", e); }
  }

  // ─── inbound handler ────────────────────────────────────────────────────
  // Drop messages whose source isn't window.parent. srcdoc iframes can't
  // easily check origin, so identity-by-source is the right gate here.
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    const msg = e.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (typeof msg.id !== "undefined" && (msg.result !== undefined || msg.error !== undefined)) {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(msg.error);
      else slot.resolve(msg.result);
      return;
    }

    if (typeof msg.method === "string") {
      handleHostMethod(msg);
      return;
    }
  });

  function handleHostMethod(msg) {
    switch (msg.method) {
      case "ui/notifications/tool-result":
        renderToolResult(msg.params);
        break;
      case "ui/notifications/host-context-changed":
        // No-op for v0; spec allows hosts to push context updates.
        break;
      case "ui/resource-teardown":
        // Host is unmounting us. Nothing to clean up here beyond what the
        // browser does when the iframe is removed.
        break;
      default:
        break;
    }
  }

  // ─── render helpers ─────────────────────────────────────────────────────
  function setState(id, label, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    const pill = document.createElement("span");
    pill.className = "pill pill--" + cls;
    pill.textContent = label;
    el.appendChild(pill);
  }

  function renderToolResult(params) {
    const el = document.getElementById("tool-result-state");
    if (!el) return;
    el.innerHTML = "";
    const pre = document.createElement("pre");
    // textContent — never innerHTML — so payload can't escape into DOM.
    pre.textContent = JSON.stringify(params, null, 2);
    el.appendChild(pre);
  }

  function renderProxyOutput(text, isError) {
    const out = document.getElementById("proxy-output");
    out.innerHTML = "";
    const pre = document.createElement("pre");
    pre.textContent = text;
    if (isError) pre.style.background = "rgba(212, 73, 62, 0.10)";
    out.appendChild(pre);
  }

  // ─── handshake ──────────────────────────────────────────────────────────
  send("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "renderprotocol-mock-widget", version: "0.0.0" },
    appCapabilities: {
      experimental: {},
      tools: { listChanged: false },
      availableDisplayModes: ["inline"]
    }
  }).then(function (initResult) {
    setState("handshake-state", "ready", "ready");
    document.getElementById("host-info").textContent =
      (initResult && initResult.hostInfo)
        ? (initResult.hostInfo.name + " " + (initResult.hostInfo.version || ""))
        : "(no hostInfo)";
    notify("ui/notifications/initialized", {});
    document.getElementById("fetch-alerts-btn").disabled = false;
    reportSize();
  }).catch(function (err) {
    setState("handshake-state", "error", "error");
    console.warn("[widget] ui/initialize failed", err);
  });

  // Resize report — coarse, fires on layout changes.
  function reportSize() {
    notify("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    });
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(reportSize).observe(document.body);
  } else {
    window.addEventListener("load", reportSize);
  }

  // ─── proxied tool call demo ─────────────────────────────────────────────
  document.getElementById("fetch-alerts-btn").addEventListener("click", function () {
    renderProxyOutput("calling get_alerts via host proxy…", false);
    send("tools/call", { name: "get_alerts", arguments: {} })
      .then(function (result) {
        const count = result && result.structuredContent && Array.isArray(result.structuredContent.alerts)
          ? result.structuredContent.alerts.length
          : "?";
        renderProxyOutput("get_alerts returned " + count + " alerts (round-trip OK)", false);
      })
      .catch(function (err) {
        renderProxyOutput("proxied tools/call failed: " + JSON.stringify(err), true);
      });
  });
})();
</script>
</body>
</html>`;
}
