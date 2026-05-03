import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getDocsRecent } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const DocsGetRecentInput = z.object({});

export const docsGetRecentDefinition = {
  name: TOOL_NAMES.DOCS_GET_RECENT,
  title: "Docs · recent",
  description:
    "Returns the user's recently edited documents across Notion, Google Docs, GitHub, and local files.",
  inputSchema: DocsGetRecentInput,
} as const;

export function handleDocsGetRecent() {
  return jsonToolResult(getDocsRecent());
}
