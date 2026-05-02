import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getNewsFollowing } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const NewsGetFollowingInput = z.object({});

export const newsGetFollowingDefinition = {
  name: TOOL_NAMES.NEWS_GET_FOLLOWING,
  title: "News · following",
  description:
    "Returns top items from the sources the user follows, with summaries and topic tags.",
  inputSchema: NewsGetFollowingInput,
} as const;

export function handleNewsGetFollowing() {
  return jsonToolResult(getNewsFollowing());
}
