import { z } from "zod";
import type { TelemetryResult, TelemetrySample } from "@renderprotocol/protocol-types";

export const GetDroneTelemetryInput = z.object({
  drone_id: z.string(),
  range_seconds: z.number().int().positive().optional(),
});

export const getDroneTelemetryDefinition = {
  name: "get_drone_telemetry",
  title: "Get drone telemetry",
  description:
    "Returns recent telemetry samples for a specific drone — vibration, altitude, battery, temperature. Suitable for live-feed and timeseries rendering.",
  inputSchema: GetDroneTelemetryInput,
} as const;

// Deterministic-ish synthesis seeded by drone id so each drone has a stable
// baseline shape. Drone-7 is intentionally noisier to make the anomaly
// scenario visible later.
function syntheticSamples(drone_id: string, range_seconds: number): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  const now = Date.now();
  const isDroneSeven = drone_id === "drone-7";
  const seed = drone_id
    .split("")
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  let r = seed;
  const rand = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 0xffffffff;
  };
  const sampleEveryMs = 1000;
  const count = Math.min(180, Math.floor((range_seconds * 1000) / sampleEveryMs));
  for (let i = count; i >= 0; i--) {
    const ts = new Date(now - i * sampleEveryMs).toISOString();
    const phase = i / Math.max(1, count);
    const vibrationBase = isDroneSeven ? 0.9 + 0.5 * Math.sin(phase * 11) : 0.3;
    samples.push({
      ts_iso: ts,
      vibration_g: round(vibrationBase + (rand() - 0.5) * 0.3, 3),
      altitude_m: round(60 + Math.sin(phase * 6) * 8 + (rand() - 0.5) * 2, 2),
      battery_pct: round(76 - phase * 4 + (rand() - 0.5) * 0.5, 1),
      temp_c: round(34 + Math.sin(phase * 4) * 1.2 + (rand() - 0.5) * 0.4, 2),
    });
  }
  return samples;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function handleGetDroneTelemetry(input: {
  drone_id: string;
  range_seconds?: number;
}) {
  const range_seconds = input.range_seconds ?? 60;
  const result: TelemetryResult = {
    drone_id: input.drone_id,
    range_seconds,
    samples: syntheticSamples(input.drone_id, range_seconds),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
