// Process-wide agent identity for this mock-server instance. Driven by
// env vars so the same code can run as multiple parallel hosting agents
// (alpha, beta, …) on different ports — that's what the carrier routes
// between.

export const AGENT_NAME = (process.env.MOCK_AGENT_NAME ?? "alpha").trim();
export const AGENT_VERSION = "0.0.0";

// Comma-separated allowlist of tool names this instance should expose.
// Unset (or "*") means all tools. Lets us simulate specialist hosting
// agents (beta runs a subset, alpha runs everything).
const RAW = process.env.MOCK_TOOLS?.trim();
const ALLOWLIST: ReadonlySet<string> | null =
  !RAW || RAW === "*"
    ? null
    : new Set(RAW.split(",").map((s) => s.trim()).filter(Boolean));

export function isToolEnabled(name: string): boolean {
  return ALLOWLIST === null || ALLOWLIST.has(name);
}
