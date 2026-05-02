// useBrief — a hook the conversation panel and render field both consume so
// they share the same results across the two-pane shell. Six tool calls are
// fanned out in parallel as soon as the MCP connection reports ready.
//
// React Query dedupes on queryKey, so it doesn't matter that two components
// register the same queries — one network call per tool, and both panels
// observe the same cache.

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  SERVICES,
  TOOL_NAMES,
  type CalendarTodayResult,
  type DocsRecentResult,
  type InboxBriefResult,
  type MessagesRecentResult,
  type NewsFollowingResult,
  type WeatherLocalResult,
} from "@renderprotocol/protocol-types";
import { ipc, type ToolCallResponse } from "./ipc";

export type ConnectionState = "connecting" | "ready" | "error";

// Internal: subscribe to the Rust-side mcp:ready / mcp:error events. Lifted
// out of RenderField so anyone — conversation panel included — can read
// connection state without re-registering listeners.
export function useMcpConnection() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubReady: (() => void) | null = null;
    let unsubError: (() => void) | null = null;

    void ipc.onMcpReady(() => setConnection("ready")).then((u) => {
      unsubReady = u;
    });
    void ipc
      .onMcpError((msg) => {
        setConnection("error");
        setMessage(msg);
      })
      .then((u) => {
        unsubError = u;
      });

    return () => {
      unsubReady?.();
      unsubError?.();
    };
  }, []);

  return { connection, message };
}

function parseToolResponse<T>(res: ToolCallResponse): T {
  if (res.structured) return res.structured as T;
  if (res.text) return JSON.parse(res.text) as T;
  throw new Error("tool returned no payload");
}

// Discriminated map of result types per tool — keyed by the const tool names.
export interface BriefResults {
  mail?: InboxBriefResult;
  calendar?: CalendarTodayResult;
  messages?: MessagesRecentResult;
  news?: NewsFollowingResult;
  weather?: WeatherLocalResult;
  docs?: DocsRecentResult;
}

export interface BriefState {
  connection: ConnectionState;
  connectionMessage: string | null;
  results: BriefResults;
  // Per-service errors so each card can render its own failure state
  // without bringing the whole brief down.
  errors: Partial<Record<keyof BriefResults, string>>;
  isLoading: boolean;
}

const TOOL_TO_KEY: Record<string, keyof BriefResults> = {
  [TOOL_NAMES.MAIL_GET_INBOX]: "mail",
  [TOOL_NAMES.CALENDAR_GET_TODAY]: "calendar",
  [TOOL_NAMES.MESSAGES_GET_RECENT]: "messages",
  [TOOL_NAMES.NEWS_GET_FOLLOWING]: "news",
  [TOOL_NAMES.WEATHER_GET_LOCAL]: "weather",
  [TOOL_NAMES.DOCS_GET_RECENT]: "docs",
};

export function useBrief(): BriefState {
  const { connection, message } = useMcpConnection();

  const queries = useQueries({
    queries: SERVICES.map((svc) => ({
      queryKey: ["service", svc.tool],
      enabled: connection === "ready",
      queryFn: async () => parseToolResponse(await ipc.callTool(svc.tool)),
    })),
  });

  const results: BriefResults = {};
  const errors: BriefState["errors"] = {};
  let stillLoading = false;

  queries.forEach((q, i) => {
    const tool = SERVICES[i]!.tool;
    const key = TOOL_TO_KEY[tool]!;
    if (q.data) {
      // Each tool's result type is checked at the call sites that consume
      // results.<key>; here we trust the runtime shape from the mock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results as any)[key] = q.data;
    } else if (q.error) {
      errors[key] = (q.error as Error).message;
    } else if (q.isLoading) {
      stillLoading = true;
    }
  });

  return {
    connection,
    connectionMessage: message,
    results,
    errors,
    isLoading: connection === "ready" && stillLoading,
  };
}

// ─── Brief composition for the conversation panel ─────────────────────
//
// Picks 2–3 short sentences from the data following the voice rules in
// agent.md (operator log, not friend; specific; subject + verb + object).
// Hard-coded heuristics for v0; real LLM composition arrives later.

export function composeBriefSentences(results: BriefResults): string[] {
  const out: string[] = [];

  // Sentence 1: the most urgent thing in mail, else mail summary.
  if (results.mail) {
    const urgent = results.mail.flagged.find((t) => t.flag === "urgent");
    if (urgent) {
      out.push(
        `Urgent in mail: "${urgent.subject}" from ${urgent.from_name}.`,
      );
    } else if (results.mail.flagged.length > 0) {
      out.push(
        `${results.mail.unread_count} unread, ${results.mail.flagged.length} flagged.`,
      );
    } else {
      out.push(`${results.mail.unread_count} unread.`);
    }
  }

  // Sentence 2: next upcoming event + prep status.
  const next = results.calendar?.events.find((e) => e.status === "upcoming");
  if (next) {
    const time = new Date(next.start_iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const prepNote = next.prep_status === "needs_prep" ? " — needs prep" : "";
    out.push(`Next: ${next.title} at ${time}${prepNote}.`);
  }

  // Sentence 3: weather snapshot.
  if (results.weather) {
    const c = results.weather.current;
    out.push(
      `${results.weather.location}: ${c.temp_f}°F ${c.condition.toLowerCase()}, high ${results.weather.high_f}.`,
    );
  }

  return out;
}
