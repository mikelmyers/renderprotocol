import { z } from "zod";
import { getFleetSnapshot } from "../simulator/fleet-state.js";

export const GetFleetStatusInput = z.object({});

export const getFleetStatusDefinition = {
  name: "get_fleet_status",
  title: "Get fleet status",
  description:
    "Returns the current snapshot of the Primordia drone fleet — position, status, battery, and last-seen timestamp for every drone.",
  inputSchema: GetFleetStatusInput,
} as const;

export function handleGetFleetStatus() {
  const snapshot = getFleetSnapshot();
  return {
    content: [
      {
        type: "text" as const,
        // Structured payload returned as JSON in a text block. The host parses
        // this back out. Once we wire MCP Apps + structured outputs we'll move
        // to typed structured-content blocks; for v0 the JSON-text shape is
        // honest enough and works with every current SDK version.
        text: JSON.stringify(snapshot),
      },
    ],
    structuredContent: snapshot,
  };
}
