import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngBoundsLiteral } from "leaflet";
import type {
  DroneSnapshot,
  FleetStatusResult,
} from "@renderprotocol/protocol-types";
import { ElementWrapper } from "../ElementWrapper";
import { makeElementId, surfaceBus } from "../../../lib/surface-bus";

interface Props {
  composition: string;
  source_tool: string;
  data: FleetStatusResult;
}

// MapView: the first composition primitive. Renders fleet positions on an
// OpenStreetMap tile layer with one CircleMarker per drone. Each marker is
// wrapped in ElementWrapper so it's individually addressable from the
// conversation panel — selecting a drone in the map fires
// element_selected; references like
// `morning-brief/map/get_fleet_status/drone-7` resolve to it.

const STATUS_COLORS: Record<DroneSnapshot["status"], string> = {
  active: "#74d39a",
  idle: "#8b93a7",
  charging: "#f0b66a",
  grounded: "#f47373",
  offline: "#5a6173",
};

export function MapView({ composition, source_tool, data }: Props) {
  const containerId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "map",
        source_tool,
        entity: "container",
      }),
    [composition, source_tool],
  );

  const bounds = useMemo<LatLngBoundsLiteral>(() => {
    if (data.drones.length === 0) {
      return [[37.95, -78.35], [37.99, -78.29]];
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const d of data.drones) {
      if (d.lat < minLat) minLat = d.lat;
      if (d.lat > maxLat) maxLat = d.lat;
      if (d.lon < minLon) minLon = d.lon;
      if (d.lon > maxLon) maxLon = d.lon;
    }
    // Pad slightly so markers don't sit on the frame edge.
    const padLat = Math.max(0.005, (maxLat - minLat) * 0.15);
    const padLon = Math.max(0.005, (maxLon - minLon) * 0.15);
    return [
      [minLat - padLat, minLon - padLon],
      [maxLat + padLat, maxLon + padLon],
    ];
  }, [data.drones]);

  return (
    <ElementWrapper
      id={containerId}
      metadata={{
        composition,
        primitive: "map",
        source_tool,
        entity: "container",
        display: { drone_count: data.drones.length },
      }}
      className="map-view"
    >
      <MapContainer
        bounds={bounds}
        scrollWheelZoom={false}
        className="map-view__leaflet"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {data.drones.map((d) => (
          <DroneMarker
            key={d.drone_id}
            drone={d}
            composition={composition}
            source_tool={source_tool}
          />
        ))}
      </MapContainer>
    </ElementWrapper>
  );
}

interface MarkerProps {
  drone: DroneSnapshot;
  composition: string;
  source_tool: string;
}

function sigOf(d: Pick<DroneSnapshot, "callsign" | "status" | "battery_pct" | "lat" | "lon">) {
  return `${d.callsign}|${d.status}|${d.battery_pct}|${d.lat}|${d.lon}`;
}

function DroneMarker({ drone, composition, source_tool }: MarkerProps) {
  const elementId = useMemo(
    () =>
      makeElementId({
        composition,
        primitive: "map",
        source_tool,
        entity: drone.drone_id,
      }),
    [composition, source_tool, drone.drone_id],
  );

  // Use a ref to distinguish first-mount (register) from subsequent data
  // changes (update). This keeps the bus + audit log honest about whether
  // an event represents identity-creation vs data refresh.
  const lastSig = useRef<string | null>(null);

  // Register on mount, remove on unmount. Reference chips resolve to
  // "live" immediately — no prior click needed.
  useEffect(() => {
    const metadata = {
      composition,
      primitive: "map" as const,
      source_tool,
      entity: drone.drone_id,
      display: {
        callsign: drone.callsign,
        status: drone.status,
        battery_pct: drone.battery_pct,
        lat: drone.lat,
        lon: drone.lon,
      },
    };
    surfaceBus.registerElement(elementId, metadata);
    lastSig.current = sigOf(drone);
    return () => surfaceBus.removeElement(elementId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  // Subsequent data changes: emit element_updated, not register/remove churn.
  useEffect(() => {
    const sig = sigOf(drone);
    if (lastSig.current === null || lastSig.current === sig) return;
    lastSig.current = sig;
    surfaceBus.updateElement(elementId, {
      composition,
      primitive: "map",
      source_tool,
      entity: drone.drone_id,
      display: {
        callsign: drone.callsign,
        status: drone.status,
        battery_pct: drone.battery_pct,
        lat: drone.lat,
        lon: drone.lon,
      },
    });
  }, [
    elementId,
    composition,
    source_tool,
    drone.callsign,
    drone.status,
    drone.battery_pct,
    drone.lat,
    drone.lon,
    drone.drone_id,
  ]);

  return (
    <CircleMarker
      center={[drone.lat, drone.lon]}
      radius={9}
      pathOptions={{
        color: STATUS_COLORS[drone.status],
        fillColor: STATUS_COLORS[drone.status],
        fillOpacity: 0.55,
        weight: 2,
      }}
      eventHandlers={{
        click: (e) => {
          // Stop Leaflet's internal click propagation so the surrounding
          // ElementWrapper doesn't also fire its container-level selection.
          e.originalEvent?.stopPropagation();
          surfaceBus.selectElement(elementId, "click");
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -8]}>
        <div>
          <strong>{drone.callsign}</strong>{" "}
          <span className={`status-badge status-badge--${drone.status}`}>
            {drone.status}
          </span>
          <br />
          {drone.drone_id} &middot; {drone.battery_pct}%
        </div>
      </Tooltip>
    </CircleMarker>
  );
}
