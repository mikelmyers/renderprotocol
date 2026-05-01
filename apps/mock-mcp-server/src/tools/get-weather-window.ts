import { z } from "zod";
import type { WeatherWindow } from "@renderprotocol/protocol-types";

export const GetWeatherWindowInput = z.object({});

export const getWeatherWindowDefinition = {
  name: "get_weather_window",
  title: "Get weather flight window",
  description:
    "Returns today's flight window indicator for inspection ops — open/marginal/closed state, conditions, score, and notes. Suitable for an alert / indicator primitive.",
  inputSchema: GetWeatherWindowInput,
} as const;

export function handleGetWeatherWindow() {
  const today = new Date();
  const open = new Date(today);
  open.setUTCHours(14, 30, 0, 0); // 10:30 EDT-ish
  const close = new Date(today);
  close.setUTCHours(20, 0, 0, 0);

  const result: WeatherWindow = {
    state: "open",
    window_open_iso: open.toISOString(),
    window_close_iso: close.toISOString(),
    conditions: "Light cloud, gusts to 12mph, visibility >10mi",
    score: 0.84,
    notes: [
      "Crosswind below operational threshold for all active drones.",
      "Cloud ceiling at 4,200ft — clear of inspection altitudes.",
    ],
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
