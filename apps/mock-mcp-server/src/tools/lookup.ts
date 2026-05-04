import { z } from "zod";
import type { LookupResult } from "@renderprotocol/protocol-types";
import { AGENT_NAME } from "../agent-context.js";

export const LookupInput = z.object({
  query: z.string().min(1).max(2000),
});

export const lookupDefinition = {
  name: "lookup",
  title: "Lookup",
  description:
    "A hosting agent answers a free-text query with a markdown response. Stand-in for the eventual carrier-routed multi-source result.",
  inputSchema: LookupInput,
} as const;

export function handleLookup(args: { query: string }) {
  const result: LookupResult = {
    markdown: buildResponse(args.query),
  };

  return {
    content: [
      {
        type: "text" as const,
        // Structured payload returned as JSON in a text block. The host parses
        // this back out via `structuredContent` (preferred) or by parsing the
        // text. v0 supplies both; later we lean on structured-content blocks.
        text: JSON.stringify(result),
      },
    ],
    structuredContent: result,
  };
}

// v0 mock response. Returns a deterministic markdown stub that echoes the
// query and demonstrates the rendering surface (headings, lists, code,
// links). A real hosting agent would produce a substantive answer here.
function buildResponse(query: string): string {
  const trimmed = query.trim();
  return [
    `# Lookup: \`${escapeMd(trimmed)}\``,
    ``,
    `_Mock hosting agent. Returns a stub response so the render path is exercised end-to-end._`,
    ``,
    `## What you'd see from a real hosting agent`,
    ``,
    `- A direct answer to your query, composed for the moment`,
    `- Source attribution via the audit/X-ray drawer`,
    `- Optional rich UI shipped via MCP Apps (\`ui://\`) when the agent prefers to author its own surface`,
    ``,
    `## Echo`,
    ``,
    `> ${escapeMd(trimmed)}`,
    ``,
    `---`,
    ``,
    `Wired through: composer → user agent → carrier → hosting agent → render field.`,
    ``,
    `_Returned by hosting agent: ${escapeMd(AGENT_NAME)}_`,
  ].join("\n");
}

// Defensive escape — query text is user-controlled, and even though
// react-markdown sanitizes HTML, escaping markdown control characters
// in echoed content keeps the rendered output faithful and prevents
// injected formatting from masquerading as the agent's authorship.
function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}\[\]()#+\-.!>|])/g, "\\$1");
}
