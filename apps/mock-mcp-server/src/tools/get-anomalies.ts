import { z } from "zod";
import type { AnomaliesResult } from "@renderprotocol/protocol-types";

export const GetAnomaliesInput = z.object({
  range_hours: z.number().int().positive().optional(),
});

const FIXTURE: AnomaliesResult["events"] = [
  {
    id: "anom-2026-04-25-09-14",
    ts_iso: "2026-04-25T09:14:00Z",
    drone_id: "drone-7",
    kind: "vibration",
    severity: "warn",
    title: "Hardware vibration above baseline",
    detail: "Sustained 1.4g vibration on rotor #2 for 38s during inspection run.",
  },
  {
    id: "anom-2026-04-25-11-02",
    ts_iso: "2026-04-25T11:02:00Z",
    drone_id: "drone-12",
    kind: "telemetry_gap",
    severity: "critical",
    title: "Telemetry gap — drone offline",
    detail: "12-minute telemetry blackout; no recovery. Battery state at last seen: 0%.",
  },
  {
    id: "anom-2026-04-26-07-48",
    ts_iso: "2026-04-26T07:48:00Z",
    drone_id: "drone-3",
    kind: "battery_anomaly",
    severity: "info",
    title: "Battery discharge faster than baseline",
    detail: "Discharge curve 8% above 30-day baseline; flagged for review.",
  },
  {
    id: "anom-2026-04-26-13-21",
    ts_iso: "2026-04-26T13:21:00Z",
    drone_id: "drone-15",
    kind: "geofence",
    severity: "warn",
    title: "Geofence proximity warning",
    detail: "Drone-15 came within 40m of restricted zone boundary on return path.",
  },
];

export const getAnomaliesDefinition = {
  name: "get_anomalies",
  title: "Get anomaly events",
  description:
    "Returns the recent anomaly events across the fleet — timestamps, severity, drone, and human-readable detail. Suitable for timeline rendering.",
  inputSchema: GetAnomaliesInput,
} as const;

export function handleGetAnomalies(input: { range_hours?: number }) {
  const range_hours = input.range_hours ?? 72;
  const result: AnomaliesResult = {
    generated_at_iso: new Date().toISOString(),
    range_hours,
    events: FIXTURE,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
