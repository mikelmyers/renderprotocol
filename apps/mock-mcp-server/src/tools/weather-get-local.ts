import { z } from "zod";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { getWeatherLocal } from "../simulator/state.js";
import { jsonToolResult } from "./_shared.js";

export const WeatherGetLocalInput = z.object({});

export const weatherGetLocalDefinition = {
  name: TOOL_NAMES.WEATHER_GET_LOCAL,
  title: "Weather · local",
  description:
    "Returns the user's local weather: current conditions, hourly forecast for the next several hours, and the day's high/low.",
  inputSchema: WeatherGetLocalInput,
} as const;

export function handleWeatherGetLocal() {
  return jsonToolResult(getWeatherLocal());
}
