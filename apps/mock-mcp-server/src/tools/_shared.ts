// Tool result helper. The MCP SDK accepts both a textual content block and
// a structured-content payload; we send both so older clients fall back to
// JSON-in-text and newer ones consume the structured form directly.
//
// Each tool's handler stays a thin wrapper around its simulator getter — the
// only thing that varies is the snapshot type.

export function jsonToolResult<T>(snapshot: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(snapshot),
      },
    ],
    structuredContent: snapshot as unknown as Record<string, unknown>,
  };
}
