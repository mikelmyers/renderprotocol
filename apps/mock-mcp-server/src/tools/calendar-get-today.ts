import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getCalendarToday } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const CalendarGetTodayInput = z.object({});

export const calendarGetTodayDefinition = {
  name: TOOL_NAMES.CALENDAR_GET_TODAY,
  title: "Calendar · today",
  description:
    "Returns the user's calendar events for today, including title, time, attendees, location, and whether each event needs preparation.",
  inputSchema: CalendarGetTodayInput,
} as const;

export function handleCalendarGetToday() {
  return jsonToolResult(getCalendarToday());
}
