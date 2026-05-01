// React hook that wires the pure composer into the surface.
//
// Flow: read config → plan against rules → fan out tool calls in
// parallel via useQueries → when all settle, assemble the LayoutSpec
// and the deterministic narrative → publish to a Zustand slice the
// conversation panel reads.

import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { recordAudit } from "./audit";
import { useConfig, type ParsedDoc } from "./config";
import { ipc } from "./ipc";
import {
  assemble,
  plan,
  toolKey,
  type CompositionPlan,
  type LayoutSpec,
  type NarrativeSpec,
  type Rule,
  type WatchingItem,
} from "./composer";
import { summarize } from "./composer-narrative";
import { MORNING_BRIEF_RULES, morningBriefWatching } from "../compositions/morning-brief.rules";

// ── Public state surface ─────────────────────────────────────────────

export interface CompositionState {
  layout: LayoutSpec | null;
  narrative: NarrativeSpec | null;
  watching: WatchingItem[];
  status: "idle" | "config-pending" | "fetching" | "ready" | "error";
  error: string | null;
}

export const useCompositionState = create<CompositionState>(() => ({
  layout: null,
  narrative: null,
  watching: [],
  status: "idle",
  error: null,
}));

// ── Rule book per intent ─────────────────────────────────────────────

const RULES_BY_INTENT: Record<string, { rules: Rule[]; watching: typeof morningBriefWatching }> = {
  morning_brief: { rules: MORNING_BRIEF_RULES, watching: morningBriefWatching },
};

// ── Hook ────────────────────────────────────────────────────────────

export interface UseCompositionResult {
  layout: LayoutSpec | null;
  status: CompositionState["status"];
  error: string | null;
}

export function useComposition(intent: string, mcpReady: boolean): UseCompositionResult {
  const userDoc = useConfig((s) => s.snapshot?.user ?? null);
  const activeKey = useConfig((s) => s.snapshot?.active_agent ?? null);
  const agentDoc = useConfig((s) =>
    activeKey ? (s.snapshot?.agents[activeKey] ?? null) : null,
  );

  const ruleBook = RULES_BY_INTENT[intent];

  // Plan: pure function over (intent, rules, ctx). Re-runs whenever the
  // documents change — config hot reload triggers a fresh plan.
  const compositionPlan = useMemo<CompositionPlan | null>(() => {
    if (!ruleBook) return null;
    if (!agentDoc && !userDoc) return null;
    return plan(intent, ruleBook.rules, { user: userDoc, agent: agentDoc }, ruleBook.watching);
    // ruleBook is intentionally not in the deps — it's keyed by intent
    // and stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, userDoc, agentDoc]);

  // Fan out the planned tool calls. useQueries handles parallel fetch +
  // shared cache. Each query dedupes by its key in the cache.
  const queries = useQueries({
    queries: (compositionPlan?.tool_calls ?? []).map((call) => ({
      queryKey: ["tool", call.name, call.args ?? null],
      enabled: mcpReady,
      queryFn: async () => {
        const res = await ipc.callTool(call.name, call.args);
        if (res.structured) return res.structured;
        if (res.text) return JSON.parse(res.text) as unknown;
        throw new Error(`tool ${call.name} returned no payload`);
      },
    })),
  });

  // Assemble + publish whenever any input changes. Side effects only —
  // the UI reads from useCompositionState below.
  useEffect(() => {
    const setState = useCompositionState.setState;

    if (!ruleBook) {
      setState({
        layout: null,
        narrative: null,
        watching: [],
        status: "error",
        error: `unknown intent: ${intent}`,
      });
      return;
    }

    if (!compositionPlan) {
      setState({
        layout: null,
        narrative: null,
        watching: [],
        status: "config-pending",
        error: null,
      });
      return;
    }

    if (!mcpReady) {
      setState({
        layout: null,
        narrative: null,
        watching: compositionPlan.watching,
        status: "fetching",
        error: null,
      });
      return;
    }

    if (queries.some((q) => q.isPending)) {
      setState({
        layout: null,
        narrative: null,
        watching: compositionPlan.watching,
        status: "fetching",
        error: null,
      });
      return;
    }

    const errored = queries.find((q) => q.isError);
    if (errored) {
      setState({
        layout: null,
        narrative: null,
        watching: compositionPlan.watching,
        status: "error",
        error: (errored.error as Error).message,
      });
      return;
    }

    const data = new Map<string, unknown>();
    compositionPlan.tool_calls.forEach((call, i) => {
      data.set(toolKey(call.name, call.args), queries[i]?.data);
    });

    const layout = assemble(compositionPlan, data, { user: userDoc, agent: agentDoc });
    const narrative = summarize(compositionPlan, layout, data, agentTitle(agentDoc, activeKey));

    setState({
      layout,
      narrative,
      watching: layout.watching,
      status: "ready",
      error: null,
    });

    // Record the composition for the X-ray drawer. Audit is best-effort;
    // failures are logged in the wrapper.
    void recordAudit("composition.assembled", {
      intent,
      slot_count: layout.slots.length,
      slots: layout.slots.map((s) => ({
        id: s.id,
        primitive: s.primitive,
        source_tool: s.source_tool,
        trace: s.trace,
        importance: Number(s.importance.toFixed(3)),
      })),
      watching: layout.watching.map((w) => w.label),
      narrative_bytes: narrative.body.length,
      narrative_refs: narrative.refs.length,
    });
    // Composition plan + the queries' data are the meaningful triggers.
    // queries themselves are a fresh array each render so depend on a
    // stable signature instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    intent,
    compositionPlan,
    mcpReady,
    queriesSignature(queries),
    userDoc,
    agentDoc,
    activeKey,
    ruleBook,
  ]);

  const state = useCompositionState();
  return { layout: state.layout, status: state.status, error: state.error };
}

function queriesSignature(queries: { status: string; dataUpdatedAt: number }[]): string {
  return queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join("|");
}

function agentTitle(agent: ParsedDoc | null, key: string | null): string | null {
  return agent?.title ?? key ?? null;
}
