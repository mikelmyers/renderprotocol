import {
  SERVICES,
  TOOL_NAMES,
  type ServiceDescriptor,
} from "@renderprotocol/protocol-types";
import { useBrief, type BriefResults, type BriefState } from "../../lib/use-brief";
import { MailCard } from "./primitives/MailCard";
import { CalendarCard } from "./primitives/CalendarCard";
import { MessagesCard } from "./primitives/MessagesCard";
import { NewsCard } from "./primitives/NewsCard";
import { WeatherCard } from "./primitives/WeatherCard";
import { DocsCard } from "./primitives/DocsCard";

// The render field — the right pane. v0 composition is the morning brief:
// six tool calls fanned out in parallel, each rendered as a card primitive
// in the order specified by user.md. Cards register as bus elements so the
// conversation panel can address them; rows inside each card register
// individually so the user can reference specific items.

const COMPOSITION = "morning-brief";

export function RenderField() {
  const brief = useBrief();

  return (
    <div className="render-field">
      <ConnectionStrip
        state={brief.connection}
        message={brief.connectionMessage}
      />
      <div className="pane__body">
        {brief.connection !== "ready" && (
          <div className="render-field__empty">
            {brief.connection === "connecting"
              ? "Waiting for MCP server…"
              : `MCP unavailable: ${brief.connectionMessage ?? "unknown error"}`}
          </div>
        )}
        {brief.connection === "ready" && (
          <BriefStack brief={brief} />
        )}
      </div>
    </div>
  );
}

function BriefStack({ brief }: { brief: BriefState }) {
  return (
    <div className="brief">
      {SERVICES.map((service) => (
        <CardForService
          key={service.id}
          service={service}
          results={brief.results}
          error={brief.errors[keyOf(service)] ?? null}
          isLoading={brief.isLoading}
        />
      ))}
    </div>
  );
}

function keyOf(service: ServiceDescriptor): keyof BriefResults {
  switch (service.tool) {
    case TOOL_NAMES.MAIL_GET_INBOX:
      return "mail";
    case TOOL_NAMES.CALENDAR_GET_TODAY:
      return "calendar";
    case TOOL_NAMES.MESSAGES_GET_RECENT:
      return "messages";
    case TOOL_NAMES.NEWS_GET_FOLLOWING:
      return "news";
    case TOOL_NAMES.WEATHER_GET_LOCAL:
      return "weather";
    case TOOL_NAMES.DOCS_GET_RECENT:
      return "docs";
    default:
      throw new Error(`unknown tool ${service.tool}`);
  }
}

interface CardProps {
  service: ServiceDescriptor;
  results: BriefResults;
  error: string | null;
  isLoading: boolean;
}

function CardForService({ service, results, error, isLoading }: CardProps) {
  // While loading, leave a placeholder card so the layout doesn't reflow once
  // results arrive — calmer to the eye than a sudden cascade of mounts.
  if (isLoading && !error) {
    const k = keyOf(service);
    if (!results[k]) {
      return (
        <div className="card card--placeholder">
          <header className="card__header">
            <span className="card__service">{service.label}</span>
            <span className="card__summary">loading…</span>
          </header>
        </div>
      );
    }
  }

  switch (service.tool) {
    case TOOL_NAMES.MAIL_GET_INBOX:
      return results.mail ? (
        <MailCard
          service={service}
          composition={COMPOSITION}
          data={results.mail}
          error={error}
        />
      ) : null;
    case TOOL_NAMES.CALENDAR_GET_TODAY:
      return results.calendar ? (
        <CalendarCard
          service={service}
          composition={COMPOSITION}
          data={results.calendar}
          error={error}
        />
      ) : null;
    case TOOL_NAMES.MESSAGES_GET_RECENT:
      return results.messages ? (
        <MessagesCard
          service={service}
          composition={COMPOSITION}
          data={results.messages}
          error={error}
        />
      ) : null;
    case TOOL_NAMES.NEWS_GET_FOLLOWING:
      return results.news ? (
        <NewsCard
          service={service}
          composition={COMPOSITION}
          data={results.news}
          error={error}
        />
      ) : null;
    case TOOL_NAMES.WEATHER_GET_LOCAL:
      return results.weather ? (
        <WeatherCard
          service={service}
          composition={COMPOSITION}
          data={results.weather}
          error={error}
        />
      ) : null;
    case TOOL_NAMES.DOCS_GET_RECENT:
      return results.docs ? (
        <DocsCard
          service={service}
          composition={COMPOSITION}
          data={results.docs}
          error={error}
        />
      ) : null;
    default:
      return null;
  }
}

function ConnectionStrip({
  state,
  message,
}: {
  state: BriefState["connection"];
  message: string | null;
}) {
  const dotClass =
    state === "ready"
      ? "connection-dot connection-dot--ready"
      : state === "error"
        ? "connection-dot connection-dot--error"
        : "connection-dot";
  const label =
    state === "ready"
      ? "MCP connected"
      : state === "error"
        ? `MCP error${message ? `: ${message}` : ""}`
        : "MCP connecting…";
  return (
    <div className="connection-strip">
      <span className={dotClass} />
      <span>{label}</span>
    </div>
  );
}
