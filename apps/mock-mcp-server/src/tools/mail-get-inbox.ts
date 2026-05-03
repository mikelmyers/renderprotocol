import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getInboxBrief } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const MailGetInboxInput = z.object({});

export const mailGetInboxDefinition = {
  name: TOOL_NAMES.MAIL_GET_INBOX,
  title: "Mail · inbox brief",
  description:
    "Returns a brief of the user's inbox: total unread count, flagged threads the agent should surface, and a short list of the most recent unread.",
  inputSchema: MailGetInboxInput,
} as const;

export function handleMailGetInbox() {
  return jsonToolResult(getInboxBrief());
}
