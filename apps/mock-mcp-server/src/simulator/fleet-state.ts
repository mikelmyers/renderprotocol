import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { DroneSnapshot, FleetStatusResult } from "@renderprotocol/protocol-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, "../data/seed.json");

interface SeedDrone extends Omit<DroneSnapshot, "last_seen_iso"> {
  last_seen_offset_s: number;
}

interface Seed {
  fleet: SeedDrone[];
}

const seed: Seed = JSON.parse(readFileSync(seedPath, "utf8"));

// In-memory mutable state. The simulator owns the canonical fleet view; tools
// read from it, scenarios mutate it. Kept in-process for v0; later versions
// can persist or stream from external sources.
const fleet: SeedDrone[] = seed.fleet.map((d) => ({ ...d }));

export function getFleetSnapshot(): FleetStatusResult {
  const now = Date.now();
  return {
    generated_at_iso: new Date(now).toISOString(),
    drones: fleet.map((d) => ({
      drone_id: d.drone_id,
      callsign: d.callsign,
      lat: d.lat,
      lon: d.lon,
      status: d.status,
      battery_pct: d.battery_pct,
      last_seen_iso: new Date(now - d.last_seen_offset_s * 1000).toISOString(),
    })),
  };
}
