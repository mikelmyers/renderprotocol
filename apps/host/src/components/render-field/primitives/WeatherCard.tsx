import type {
  ServiceDescriptor,
  WeatherLocalResult,
} from "@renderprotocol/protocol-types";
import { ServiceCard } from "./ServiceCard";

interface Props {
  service: ServiceDescriptor;
  composition: string;
  data: WeatherLocalResult;
  error?: string | null;
}

export function WeatherCard({ service, composition, data, error }: Props) {
  const summary = `${data.location} · ${data.high_f}/${data.low_f}°F`;
  return (
    <ServiceCard
      service={service}
      composition={composition}
      summary={summary}
      error={error}
    >
      <div className="weather">
        <div className="weather__current">
          <div className="weather__temp">{data.current.temp_f}°</div>
          <div className="weather__details">
            <div className="weather__condition">{data.current.condition}</div>
            <div className="weather__sub">
              feels {data.current.feels_like_f}° · wind {data.current.wind_mph} mph
              · humidity {data.current.humidity_pct}%
            </div>
          </div>
        </div>
        <div className="weather__forecast">
          {data.forecast_hourly.map((f) => {
            const t = new Date(f.hour_iso);
            const hour = t.toLocaleTimeString([], { hour: "numeric" });
            return (
              <div key={f.hour_iso} className="weather__hour">
                <div className="weather__hour-label">{hour}</div>
                <div className="weather__hour-temp">{f.temp_f}°</div>
                <div className="weather__hour-precip">
                  {f.precip_pct > 0 ? `${f.precip_pct}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ServiceCard>
  );
}
