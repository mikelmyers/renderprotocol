// useConfig — small React hook that exposes the parsed agent.md / user.md
// to the UI and re-fetches when the Rust watcher emits a `config:updated`
// event. The Rust side is the source of truth; the hook is a thin cache
// for the current snapshot.

import { useEffect, useState } from "react";
import { ipc, type ConfigDocument } from "./ipc";

export interface ConfigSnapshot {
  agent: ConfigDocument | null;
  user: ConfigDocument | null;
}

export function useConfig(): ConfigSnapshot {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>({
    agent: null,
    user: null,
  });

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const refreshAgent = async () => {
      try {
        const a = await ipc.currentAgentMd();
        if (!cancelled) setSnapshot((s) => ({ ...s, agent: a }));
      } catch (e) {
        // Surface as warning; the panel still functions with null config.
        console.warn("[useConfig] failed to load agent.md", e);
      }
    };

    const refreshUser = async () => {
      try {
        const u = await ipc.currentUserMd();
        if (!cancelled) setSnapshot((s) => ({ ...s, user: u }));
      } catch (e) {
        console.warn("[useConfig] failed to load user.md", e);
      }
    };

    void refreshAgent();
    void refreshUser();

    void ipc
      .onConfigUpdated((file) => {
        if (file === "agent.md") void refreshAgent();
        else if (file === "user.md") void refreshUser();
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unsub = u;
        }
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return snapshot;
}
