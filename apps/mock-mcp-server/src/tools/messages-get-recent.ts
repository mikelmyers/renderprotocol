import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getMessagesRecent } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const MessagesGetRecentInput = z.object({});

export const messagesGetRecentDefinition = {
  name: TOOL_NAMES.MESSAGES_GET_RECENT,
  title: "Messages · recent",
  description:
    "Returns recent direct messages and channel activity across the user's chat apps (iMessage, Slack, Signal, WhatsApp, Discord).",
  inputSchema: MessagesGetRecentInput,
} as const;

export function handleMessagesGetRecent() {
  return jsonToolResult(getMessagesRecent());
}
