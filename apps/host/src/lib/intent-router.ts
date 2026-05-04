// Intent router — host-side, mechanical for v0.
//
// The conversation panel hands the user's text here; the router decides
// which tool the user agent should call on the (single) hosting agent.
// Pure function: same text in → same routing out, no I/O.
//
// In step 4 the *carrier* becomes the routing layer — picking which
// hosting agent to call, not just which tool. This file is the v0
// stand-in until that exists. Keep the surface shape (`route(text)`
// returning {tool, args, agentMessage}) stable so the call site in
// ConversationPanel doesn't move when routing migrates to the carrier.

import { TOOL_NAMES, type ToolName } from "@renderprotocol/protocol-types";

export interface IntentRoute {
  tool: ToolName;
  args: Record<string, unknown>;
  /// What the agent says back in the conversation panel after dispatching.
  /// Kept short and tool-aware so the surface feels authored, not generic.
  agentMessage: string;
}

// Keyword rules. Matching is case-insensitive and word-bounded so
// "alphabetical" doesn't trigger the alert route. First match wins.
const RULES: Array<{
  pattern: RegExp;
  build: (text: string) => IntentRoute;
}> = [
  {
    pattern: /\b(widget|iframe|mcp ?app|app)\b/i,
    build: (text) => ({
      tool: TOOL_NAMES.WIDGET,
      args: { query: text },
      agentMessage: "Mounted a hosting agent's UI in a sandboxed iframe.",
    }),
  },
  {
    pattern: /\b(alerts?|warnings?|incidents?)\b/i,
    build: (text) => ({
      tool: TOOL_NAMES.GET_ALERTS,
      args: { query: text },
      agentMessage: "Pulled the current alerts — see the right pane.",
    }),
  },
  {
    pattern: /\b(timeline|events?|activity|recent|history)\b/i,
    build: (text) => ({
      tool: TOOL_NAMES.GET_RECENT_EVENTS,
      args: { query: text },
      agentMessage: "Fetched recent events — timeline on the right.",
    }),
  },
  {
    pattern: /\b(list|items?|table|rows?|inventory|catalog)\b/i,
    build: (text) => ({
      tool: TOOL_NAMES.LIST_ITEMS,
      args: { query: text },
      agentMessage: "Returned a tabular view — see the right pane.",
    }),
  },
];

const DEFAULT: (text: string) => IntentRoute = (text) => ({
  tool: TOOL_NAMES.LOOKUP,
  args: { query: text },
  agentMessage: "Routed to a hosting agent — see the result on the right.",
});

export function routeIntent(text: string): IntentRoute {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.build(text);
  }
  return DEFAULT(text);
}
