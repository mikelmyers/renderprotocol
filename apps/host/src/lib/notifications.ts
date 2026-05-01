// Frontend notifications bridge.
//
// The Rust backend re-emits every JSON-RPC notification it receives over
// the MCP SSE channel as a Tauri event named `mcp:notification`. This
// module is the one place those events get parsed and routed:
//
//   - `notifications/resources/updated` → invalidate the React Query
//     keyed by the tool name encoded in the URI. (URI grammar:
//     `renderprotocol://tool/<tool_name>` for v0.)
//   - `notifications/renderprotocol/data_updated` → fan out to topic
//     subscribers (e.g. LiveFeedView).
//   - Anything else → logged at debug.
//
// Topic-based subscription keeps primitive code simple: a live feed
// just calls `subscribeTopic("telemetry/drone-7")` and gets a stream
// of samples without knowing the protocol.

import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { queryClient } from "./query-client";

interface RawNotification {
  method: string;
  params?: unknown;
}

type TopicHandler = (payload: unknown) => void;

const topicSubscribers = new Map<string, Set<TopicHandler>>();
let started = false;
let unlisten: UnlistenFn | null = null;

export async function startNotifications(): Promise<void> {
  if (started) return;
  started = true;
  unlisten = await listen("mcp:notification", (e: Event<RawNotification>) => {
    handle(e.payload);
  });
}

export function stopNotifications(): void {
  unlisten?.();
  unlisten = null;
  started = false;
}

export function subscribeTopic(topic: string, handler: TopicHandler): () => void {
  let set = topicSubscribers.get(topic);
  if (!set) {
    set = new Set();
    topicSubscribers.set(topic, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
    if (set && set.size === 0) topicSubscribers.delete(topic);
  };
}

function handle(n: RawNotification): void {
  if (n.method === "notifications/resources/updated") {
    const params = n.params as { uri?: string } | undefined;
    if (!params?.uri) return;
    const tool = toolNameFromUri(params.uri);
    if (tool) {
      // Invalidate every query keyed by ["tool", <name>, ...] for this
      // tool — args may differ but they all share the same source.
      void queryClient.invalidateQueries({ queryKey: ["tool", tool] });
    }
    return;
  }

  if (n.method === "notifications/renderprotocol/data_updated") {
    const params = n.params as { topic?: string; payload?: unknown } | undefined;
    if (!params?.topic) return;
    const set = topicSubscribers.get(params.topic);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(params.payload);
      } catch (e) {
        console.warn(`[notifications] subscriber for ${params.topic} threw`, e);
      }
    }
    return;
  }

  // Unknown method — log at debug. Forward-compatibility: future protocols
  // arriving as MCP extensions don't break the host.
  console.debug("[notifications] unhandled method", n.method);
}

function toolNameFromUri(uri: string): string | null {
  // We declare URIs as `renderprotocol://tool/<tool_name>` server-side;
  // accept that grammar and ignore others for v0.
  const prefix = "renderprotocol://tool/";
  if (uri.startsWith(prefix)) {
    return uri.slice(prefix.length);
  }
  return null;
}
