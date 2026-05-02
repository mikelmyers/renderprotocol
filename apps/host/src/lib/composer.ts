// Composition engine. Pure-function core; React-side wiring lives in
// hooks/useComposition. The composer reads (intent, user.md, agent.md),
// matches rules against capability declarations (the tool catalog), plans
// the parallel data fetches, and — once the data lands — assembles a
// LayoutSpec the render field can interpret.
//
// This is the seam STRUCTURE.md §6 promised: "rules expressed
// declaratively per composition so a learned-selection layer can later
// replace selection without rewriting the engine." For v0 the rules are
// hand-authored. The shape below is what a learned ranker would output.

import type { ParsedDoc } from "./config";

// ── Types the renderer cares about ───────────────────────────────────

export type PrimitiveKind =
  | "timeline"
  | "alert"
  | "narrative"
  | "table"
  | "live_feed"
  | "mcp_app"
  | "action_card";

export interface SlotSpec {
  /** Stable id within the composition; used for layout keying + traces. */
  id: string;
  /** Which composition primitive this slot renders. */
  primitive: PrimitiveKind;
  /** Tool that produced the data for this slot (or "composer" for synthesized). */
  source_tool: string;
  /** Free-form data prop bag handed to the primitive. */
  props: Record<string, unknown>;
  /** Why the rule fired — surfaces under each slot for transparency. */
  trace: SlotTrace;
  /** Sort order within the composition; higher importance first. */
  importance: number;
}

export interface SlotTrace {
  /** Short label, e.g. "Standing concern: Drone hardware health". */
  reason: string;
  /** Where the reason came from — user.md, agent.md, or a default rule. */
  source: TraceSource;
}

export type TraceSource =
  | { kind: "user_md"; section: string; bullet?: string }
  | { kind: "agent_md"; section: string; bullet?: string }
  | { kind: "default" };

export interface LayoutSpec {
  intent: string;
  slots: SlotSpec[];
  /** Standing concerns surfaced but with no available tool match. */
  watching: WatchingItem[];
}

export interface WatchingItem {
  label: string;
  source: TraceSource;
}

export interface NarrativeSpec {
  /** Deterministic summary text. May contain `[ref:elementId]` tokens. */
  body: string;
  /** Element IDs referenced in the body, for the registry to resolve. */
  refs: string[];
}

// ── Rule contract ────────────────────────────────────────────────────

export interface ComposeContext {
  user: ParsedDoc | null;
  agent: ParsedDoc | null;
}

export interface Rule {
  id: string;
  primitive: PrimitiveKind;
  /** The tool the rule wants to call. Null for composer-synthesized slots. */
  tool: { name: string; args?: Record<string, unknown> } | null;
  /**
   * Predicate: does this rule fire for the current (user, agent)? Returns
   * a trace describing why if it matches, or null if it doesn't.
   */
  matches: (ctx: ComposeContext) => SlotTrace | null;
  /** Importance (0..1). Higher = earlier in the layout. */
  importance: number;
  /** Build the slot's primitive props from the tool's data. */
  buildProps: (data: unknown, ctx: ComposeContext) => Record<string, unknown>;
}

// ── Plan + Assemble ──────────────────────────────────────────────────

export interface CompositionPlan {
  intent: string;
  matched: Array<{ rule: Rule; trace: SlotTrace }>;
  /** Distinct tool calls deduped by (name + JSON-stringified args). */
  tool_calls: ToolCall[];
  /** Concerns from user.md with no tool match. */
  watching: WatchingItem[];
}

export interface ToolCall {
  key: string; // dedupe key
  name: string;
  args?: Record<string, unknown>;
}

export function plan(
  intent: string,
  rules: Rule[],
  ctx: ComposeContext,
  watchingScan: (ctx: ComposeContext, matched: Set<string>) => WatchingItem[],
): CompositionPlan {
  const matched: CompositionPlan["matched"] = [];
  const callMap = new Map<string, ToolCall>();
  const concernsCovered = new Set<string>();
  for (const rule of rules) {
    const trace = rule.matches(ctx);
    if (!trace) continue;
    matched.push({ rule, trace });
    if (trace.source.kind === "user_md" && trace.source.bullet) {
      concernsCovered.add(trace.source.bullet.toLowerCase());
    }
    if (rule.tool) {
      const key = toolKey(rule.tool.name, rule.tool.args);
      if (!callMap.has(key)) {
        callMap.set(key, {
          key,
          name: rule.tool.name,
          ...(rule.tool.args ? { args: rule.tool.args } : {}),
        });
      }
    }
  }
  return {
    intent,
    matched,
    tool_calls: Array.from(callMap.values()),
    watching: watchingScan(ctx, concernsCovered),
  };
}

export function assemble(
  plan: CompositionPlan,
  data: Map<string, unknown>,
  ctx: ComposeContext,
): LayoutSpec {
  const slots: SlotSpec[] = plan.matched
    .map(({ rule, trace }, i): SlotSpec | null => {
      const dataForRule = rule.tool ? data.get(toolKey(rule.tool.name, rule.tool.args)) : null;
      const props = rule.buildProps(dataForRule, ctx);
      // A rule may opt out at assembly time (e.g. "no high-priority
      // action right now") by returning props._skip. Cleaner than
      // making the predicate a fat function over post-fetch data.
      if (props && (props as { _skip?: unknown })._skip) return null;
      // Slot id uses `__` so the address grammar's `/` separator stays
      // a 4-segment composite when slot.id is passed as `composition` to
      // primitives. Otherwise ElementWrapper generates 5-segment IDs and
      // the registry's suffix-match for reincarnated entities breaks.
      return {
        id: `${plan.intent}__${rule.id}`,
        primitive: rule.primitive,
        source_tool: rule.tool?.name ?? "composer",
        props,
        trace,
        importance: rule.importance + (1 - i / Math.max(1, plan.matched.length)) * 0.001,
      };
    })
    .filter((s): s is SlotSpec => s !== null)
    .sort((a, b) => b.importance - a.importance);

  return {
    intent: plan.intent,
    slots,
    watching: plan.watching,
  };
}

export function toolKey(name: string, args?: Record<string, unknown>): string {
  const a = args ? JSON.stringify(args, Object.keys(args).sort()) : "";
  return `${name}::${a}`;
}

// ── Helpers used by rules ────────────────────────────────────────────

/** Lower-case mention search across an array of bullets. */
export function bulletMentions(
  bullets: string[],
  needles: string[],
): string | null {
  const lowered = needles.map((n) => n.toLowerCase());
  for (const b of bullets) {
    const lb = b.toLowerCase();
    if (lowered.some((n) => lb.includes(n))) return b;
  }
  return null;
}

/** Find the first user.md standing concern bullet that mentions any needle. */
export function findStandingConcern(
  user: ParsedDoc | null,
  needles: string[],
): string | null {
  if (!user) return null;
  return bulletMentions(user.typed.standing_concerns, needles);
}

/** Find the first agent.md default bullet that mentions any needle. */
export function findAgentDefault(
  agent: ParsedDoc | null,
  needles: string[],
): string | null {
  if (!agent) return null;
  return bulletMentions(agent.typed.defaults, needles);
}
