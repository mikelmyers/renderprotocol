import { useEffect, useMemo, useRef, useState } from "react";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId } from "../../../lib/surface-bus";
import { attachBridge } from "../../../lib/mcp-app-bridge";
import type {
  ResourceCsp,
  ResourcePermissions,
} from "../../../lib/composer";

interface Props {
  source_tool: string;
  uri: string;
  html: string;
  csp: ResourceCsp;
  permissions: ResourcePermissions;
  prefersBorder?: boolean;
  /// Raw MCP tool result to forward to the iframe via
  /// ui/notifications/tool-result once it signals initialized.
  toolResult: unknown;
}

// SEP-1865 mandates exactly these sandbox attributes for view content.
// allow-same-origin is paired with allow-scripts so the iframe can run
// JavaScript and use same-origin browser APIs (postMessage between window
// and srcdoc iframe works either way; some other APIs need same-origin).
const REQUIRED_SANDBOX = "allow-scripts allow-same-origin";

// Default-deny CSP per SEP-1865 spec. Domain allowlists are appended
// from the resource's _meta.ui.csp when present.
const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "media-src": ["'self'", "data:"],
  "connect-src": ["'none'"],
  "frame-src": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
};

// Permission Policy mapping per SEP-1865.
const PERMISSION_FEATURE_MAP: Record<keyof ResourcePermissions, string> = {
  camera: "camera",
  microphone: "microphone",
  geolocation: "geolocation",
  clipboardWrite: "clipboard-write",
};

export function McpAppFrame({
  source_tool,
  uri,
  html,
  csp,
  permissions,
  prefersBorder,
  toolResult,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const elementId = useMemo(
    () =>
      makeElementId({
        composition: "ask",
        primitive: "mcp_app",
        source_tool,
        entity: uri,
      }),
    [source_tool, uri],
  );

  const cspString = useMemo(() => buildCsp(csp), [csp]);
  const allowAttr = useMemo(() => buildAllowAttr(permissions), [permissions]);
  const srcdoc = useMemo(() => injectCsp(html, cspString), [html, cspString]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const bridge = attachBridge({
      iframe,
      toolResult,
      onSizeChanged: (_w, h) => {
        // Width follows the container; only auto-grow height. Cap
        // generously so a runaway widget can't push the rest of the
        // surface off-screen.
        if (h > 0 && h <= 4000) setHeight(h);
      },
    });

    return () => {
      bridge.detach();
    };
  }, [srcdoc, toolResult]);

  return (
    <ElementWrapper
      id={elementId}
      metadata={{
        composition: "ask",
        primitive: "mcp_app",
        source_tool,
        entity: uri,
        display: { uri, html_bytes: html.length },
      }}
      className={`mcp-app-frame${prefersBorder ? " mcp-app-frame--bordered" : ""}`}
    >
      <iframe
        ref={iframeRef}
        title={`MCP App: ${uri}`}
        srcDoc={srcdoc}
        sandbox={REQUIRED_SANDBOX}
        allow={allowAttr}
        // referrerpolicy stays "no-referrer" — the iframe is local data
        // URI-equivalent (srcdoc); there's no meaningful referrer to leak.
        referrerPolicy="no-referrer"
        style={{
          width: "100%",
          height: height ? `${height}px` : "320px",
          border: "none",
          background: "transparent",
        }}
      />
    </ElementWrapper>
  );
}

// Build the CSP header string from the spec's default-deny directives,
// extended with per-resource domain allowlists from _meta.ui.csp.
function buildCsp(meta: ResourceCsp): string {
  const directives: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(DEFAULT_CSP_DIRECTIVES)) {
    directives[k] = [...v];
  }
  if (meta.connectDomains?.length) {
    directives["connect-src"] = filterNone(directives["connect-src"]).concat(meta.connectDomains);
  }
  if (meta.resourceDomains?.length) {
    for (const k of ["img-src", "script-src", "style-src", "font-src", "media-src"]) {
      const base = directives[k] ?? [];
      directives[k] = base.concat(meta.resourceDomains);
    }
  }
  if (meta.frameDomains?.length) {
    directives["frame-src"] = filterNone(directives["frame-src"]).concat(meta.frameDomains);
  }
  if (meta.baseUriDomains?.length) {
    directives["base-uri"] = filterNone(directives["base-uri"]).concat(meta.baseUriDomains);
  }
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

// Drop "'none'" entries when a real domain list is added on top — having
// both is invalid CSP syntax.
function filterNone(parts: string[]): string[] {
  return parts.filter((p) => p !== "'none'");
}

// Build the iframe `allow` attribute string from the spec's permission
// keys. Empty string when no permissions requested.
function buildAllowAttr(permissions: ResourcePermissions): string {
  const features: string[] = [];
  for (const [key, feature] of Object.entries(PERMISSION_FEATURE_MAP)) {
    if (permissions[key as keyof ResourcePermissions]) {
      features.push(feature);
    }
  }
  return features.join("; ");
}

// Inject a <meta http-equiv="Content-Security-Policy"> at the top of <head>
// (or prepend a head if missing). srcdoc iframes inherit the parent's CSP
// otherwise; we want the resource-specific one. Doing this host-side keeps
// the CSP enforcement consistent regardless of what the resource's HTML
// chose to declare itself.
function injectCsp(html: string, cspString: string): string {
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(cspString)}">`;
  // Find the first <head…> tag (case-insensitive). If present, inject
  // immediately after it. Otherwise, prepend a <head> with the meta tag.
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    const idx = headOpen.index! + headOpen[0].length;
    return html.slice(0, idx) + metaTag + html.slice(idx);
  }
  // No <head> — prepend one. We don't try to be clever about doctype/html
  // tags; browsers tolerate <meta> outside <head> in srcdoc context.
  return `<head>${metaTag}</head>` + html;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
