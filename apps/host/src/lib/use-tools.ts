// useTools — caches the result of `tools/list` so the conversation panel
// can know, before calling a tool, whether that tool is associated with
// a `ui://` resource (SEP-1865). Re-fetches when MCP reconnects.
//
// v0: single in-process consumer (ConversationPanel). When more
// consumers appear we'll move the cache into a Zustand store and let
// this hook subscribe.

import { useCallback, useEffect, useState } from "react";
import { ipc } from "./ipc";

export interface ToolDefinitionMetaUi {
  resourceUri?: string;
  visibility?: string[];
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: {
    ui?: ToolDefinitionMetaUi;
    [key: string]: unknown;
  };
}

export interface UseToolsResult {
  tools: ToolDefinition[] | null;
  uiResourceUriFor: (toolName: string) => string | undefined;
}

export function useTools(): UseToolsResult {
  const [tools, setTools] = useState<ToolDefinition[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubReady: (() => void) | null = null;

    const refresh = async () => {
      try {
        const res = await ipc.listTools();
        if (cancelled) return;
        const t = (res as { tools?: unknown }).tools;
        if (Array.isArray(t)) {
          setTools(t as ToolDefinition[]);
        }
      } catch (e) {
        console.warn("[useTools] tools/list failed", e);
      }
    };

    // Fetch as soon as MCP is ready; query status to handle the case
    // where the ready event fired before this hook subscribed.
    void ipc.mcpStatus().then((s) => {
      if (s.state === "ready") void refresh();
    });

    void ipc
      .onMcpReady(() => void refresh())
      .then((u) => {
        if (cancelled) u();
        else unsubReady = u;
      });

    return () => {
      cancelled = true;
      unsubReady?.();
    };
  }, []);

  const uiResourceUriFor = useCallback(
    (name: string): string | undefined => {
      const tool = tools?.find((t) => t.name === name);
      return tool?._meta?.ui?.resourceUri;
    },
    [tools],
  );

  return { tools, uiResourceUriFor };
}
