// Frontend-side wrapper for the configuration substrate.
//
// Mirrors the Rust `ConfigStore` shape and exposes a small Zustand store
// + initialization helper. The header reads `activeAgent` from this
// store; the morning brief composer (step 5) will pull `typed.defaults`
// out of `agents[active]` to drive what gets composed.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export interface ParsedSection {
  heading: string;
  body: string;
}

export interface TypedView {
  defaults: string[];
  standing_concerns: string[];
  permissions: string[];
  carriers: string[];
  audit: string[];
}

export interface ParsedDoc {
  title: string | null;
  sections: ParsedSection[];
  sections_by_key: Record<string, string>;
  typed: TypedView;
  raw: string;
}

export interface ConfigSnapshot {
  user: ParsedDoc | null;
  agents: Record<string, ParsedDoc>;
  active_agent: string | null;
}

interface ConfigState {
  snapshot: ConfigSnapshot | null;
  ready: boolean;
  dir: string | null;
}

export const useConfig = create<ConfigState>(() => ({
  snapshot: null,
  ready: false,
  dir: null,
}));

let unsubscribers: UnlistenFn[] = [];

export async function startConfig(): Promise<void> {
  if (unsubscribers.length > 0) return;

  const offReady = await listen<{ dir: string }>("config:ready", (e) => {
    useConfig.setState({ ready: true, dir: e.payload.dir });
    void refresh();
  });
  const offChanged = await listen("config:changed", () => {
    void refresh();
  });
  unsubscribers.push(offReady, offChanged);

  // First load — the Rust side may have populated already by the time we
  // subscribe to events. Pull the snapshot once so we don't sit empty.
  await refresh();
}

export function stopConfig(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [];
}

async function refresh(): Promise<void> {
  try {
    const snap = await invoke<ConfigSnapshot>("config_snapshot");
    useConfig.setState({ snapshot: snap });
  } catch (e) {
    console.warn("[config] snapshot fetch failed", e);
  }
}

export async function setActiveAgent(key: string): Promise<void> {
  try {
    const snap = await invoke<ConfigSnapshot>("config_set_active_agent", { key });
    useConfig.setState({ snapshot: snap });
  } catch (e) {
    console.warn("[config] set_active_agent failed", e);
  }
}

// Convenience selectors components can use. The composite selectors return
// new objects/arrays each call; useShallow keeps re-renders bounded to
// real changes in the underlying snapshot.
export function useActiveAgent(): { key: string | null; doc: ParsedDoc | null } {
  return useConfig(
    useShallow((s) => {
      const key = s.snapshot?.active_agent ?? null;
      const doc = key ? (s.snapshot?.agents[key] ?? null) : null;
      return { key, doc };
    }),
  );
}

export function useAgentList(): { key: string; title: string }[] {
  return useConfig(
    useShallow((s) => {
      const agents = s.snapshot?.agents ?? {};
      return Object.entries(agents).map(([key, doc]) => ({
        key,
        title: doc.title ?? key,
      }));
    }),
  );
}
