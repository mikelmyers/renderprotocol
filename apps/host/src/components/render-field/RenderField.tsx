import { useEffect, useState } from "react";
import { TOOL_NAMES } from "@renderprotocol/protocol-types";
import { ipc } from "../../lib/ipc";
import { useComposition } from "../../lib/use-composition";
import type { LayoutSpec, SlotSpec, TraceSource, WatchingItem } from "../../lib/composer";
import { TimelineView, type TimelineEvent } from "./primitives/TimelineView";
import { AlertView, type AlertAction, type AlertTone } from "./primitives/AlertView";
import { TabularView, type TabularColumn, type TabularRow } from "./primitives/TabularView";
import { LiveFeedView, type LiveSample } from "./primitives/LiveFeedView";
import { ActionCard, type ActionCardProps } from "./primitives/ActionCard";
import { McpAppFrame } from "./primitives/McpAppFrame";

// Composition-driven render field. Used to be a hand-wired showcase;
// now it interprets a LayoutSpec produced by the composer. The slot →
// primitive mapping lives in renderSlot below — that single function
// is the only place primitive identity is bound.

const ACTIVE_INTENT = "morning_brief";

type ConnectionState = "connecting" | "ready" | "error";

export function RenderField() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubReady: (() => void) | null = null;
    let unsubError: (() => void) | null = null;
    void ipc.onMcpReady(() => setConnection("ready")).then((u) => {
      unsubReady = u;
    });
    void ipc
      .onMcpError((msg) => {
        setConnection("error");
        setConnectionMessage(msg);
      })
      .then((u) => {
        unsubError = u;
      });
    return () => {
      unsubReady?.();
      unsubError?.();
    };
  }, []);

  const { layout, status, error } = useComposition(ACTIVE_INTENT, connection === "ready");

  return (
    <div className="render-field">
      <ConnectionStrip state={connection} message={connectionMessage} />
      <div className="pane__body render-field__stack">
        {status === "config-pending" && (
          <div className="render-field__empty">
            Waiting for an active <code>agent.md</code> contract…
          </div>
        )}

        {status === "fetching" && (
          <div className="render-field__empty">Composing morning brief…</div>
        )}

        {status === "error" && (
          <div className="render-field__empty render-field__empty--error">
            Composition failed: {error ?? "unknown error"}
          </div>
        )}

        {status === "ready" && layout && <LayoutRenderer layout={layout} />}
      </div>
    </div>
  );
}

function LayoutRenderer({ layout }: { layout: LayoutSpec }) {
  return (
    <>
      {layout.slots.map((slot) => (
        <SlotFrame key={slot.id} slot={slot}>
          {renderSlot(slot)}
        </SlotFrame>
      ))}
      {layout.watching.length > 0 && <Watching items={layout.watching} />}
    </>
  );
}

function SlotFrame({ slot, children }: { slot: SlotSpec; children: React.ReactNode }) {
  return (
    <section className="composition-slot">
      <header className="composition-slot__head">
        <h2 className="composition-slot__title">{titleFor(slot)}</h2>
        <TraceTag trace={slot.trace.reason} source={slot.trace.source} />
      </header>
      {children}
    </section>
  );
}

function TraceTag({ trace, source }: { trace: string; source: TraceSource }) {
  const label =
    source.kind === "user_md"
      ? "user.md"
      : source.kind === "agent_md"
        ? "agent.md"
        : "default";
  return (
    <span className={`composition-trace composition-trace--${source.kind}`} title={trace}>
      <span className="composition-trace__source">{label}</span>
      <span className="composition-trace__reason">{trace}</span>
    </span>
  );
}

function Watching({ items }: { items: WatchingItem[] }) {
  return (
    <section className="composition-slot composition-slot--watching">
      <header className="composition-slot__head">
        <h2 className="composition-slot__title">Watching</h2>
        <span className="composition-trace composition-trace--default">
          <span className="composition-trace__reason">
            Concerns from user.md without a tool match yet
          </span>
        </span>
      </header>
      <ul className="watching__list">
        {items.map((item, i) => (
          <li className="watching__item" key={i}>
            <span className="watching__dot" />
            <span className="watching__label">{item.label}</span>
            <span className="watching__hint">no tool connected</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Slot dispatcher ──────────────────────────────────────────────────

interface TimelineProps { events: TimelineEvent[] }
interface AlertProps {
  tone: AlertTone;
  headline: string;
  detail?: string;
  meta?: Record<string, string>;
  actions?: AlertAction[];
}
interface TableProps { columns: TabularColumn[]; rows: TabularRow[] }
interface LiveFeedProps {
  entity: string;
  label: string;
  unit?: string;
  samples: LiveSample[];
  subscribeTopic?: string;
  threshold?: { warn?: number; critical?: number };
}

type ActionCardSlotProps = Omit<
  ActionCardProps,
  "composition" | "source_tool" | "entity"
> & { entity?: string };

interface McpAppSlotProps {
  uri: string;
  title?: string;
  initialHeight?: number;
}

function renderSlot(slot: SlotSpec): React.ReactNode {
  // Each `as unknown as XxxProps` cast bypasses TS's two-way overlap check
  // — slot.props is the engine's `Record<string, unknown>` bag, populated
  // by the rule's buildProps. The dispatcher trusts the rule/primitive
  // contract authored alongside it.
  switch (slot.primitive) {
    case "timeline": {
      const p = slot.props as unknown as TimelineProps;
      return (
        <TimelineView composition={slot.id} source_tool={slot.source_tool} events={p.events} />
      );
    }
    case "alert": {
      const p = slot.props as unknown as AlertProps;
      return (
        <AlertView
          composition={slot.id}
          source_tool={slot.source_tool}
          entity="indicator"
          tone={p.tone}
          headline={p.headline}
          {...(p.detail !== undefined ? { detail: p.detail } : {})}
          {...(p.meta !== undefined ? { meta: p.meta } : {})}
          {...(p.actions !== undefined ? { actions: p.actions } : {})}
        />
      );
    }
    case "table": {
      const p = slot.props as unknown as TableProps;
      return (
        <TabularView
          composition={slot.id}
          source_tool={slot.source_tool}
          columns={p.columns}
          rows={p.rows}
        />
      );
    }
    case "live_feed": {
      const p = slot.props as unknown as LiveFeedProps;
      return (
        <LiveFeedView
          composition={slot.id}
          source_tool={slot.source_tool}
          entity={p.entity}
          label={p.label}
          {...(p.unit !== undefined ? { unit: p.unit } : {})}
          samples={p.samples}
          {...(p.subscribeTopic !== undefined ? { subscribeTopic: p.subscribeTopic } : {})}
          {...(p.threshold !== undefined ? { threshold: p.threshold } : {})}
        />
      );
    }
    case "action_card": {
      const p = slot.props as unknown as ActionCardSlotProps;
      return (
        <ActionCard
          composition={slot.id}
          source_tool={slot.source_tool}
          entity={p.entity ?? "action"}
          action_id={p.action_id}
          headline={p.headline}
          {...(p.detail !== undefined ? { detail: p.detail } : {})}
          {...(p.meta !== undefined ? { meta: p.meta } : {})}
          {...(p.confidence !== undefined ? { confidence: p.confidence } : {})}
          {...(p.tool !== undefined ? { tool: p.tool } : {})}
          {...(p.payload !== undefined ? { payload: p.payload } : {})}
          {...(p.approve_label !== undefined ? { approve_label: p.approve_label } : {})}
          {...(p.reject_label !== undefined ? { reject_label: p.reject_label } : {})}
        />
      );
    }
    case "mcp_app": {
      const p = slot.props as unknown as McpAppSlotProps;
      return (
        <McpAppFrame
          composition={slot.id}
          source_tool={slot.source_tool}
          entity="frame"
          uri={p.uri}
          {...(p.title !== undefined ? { title: p.title } : {})}
          {...(p.initialHeight !== undefined ? { initialHeight: p.initialHeight } : {})}
        />
      );
    }
    case "narrative":
      // Narrative renders in the conversation panel.
      return null;
  }
  void (slot.primitive satisfies never);
  return null;
}

function titleFor(slot: SlotSpec): string {
  // Service label by source_tool — the most natural framing for the
  // brief, since each "service" backs one or more slots.
  switch (slot.source_tool) {
    case TOOL_NAMES.MAIL_GET_INBOX:
      return slot.primitive === "action_card" ? "Suggested reply" : "Mail";
    case TOOL_NAMES.CALENDAR_GET_TODAY:
      return "Calendar";
    case TOOL_NAMES.MESSAGES_GET_RECENT:
      return "Messages";
    case TOOL_NAMES.NEWS_GET_FOLLOWING:
      return "News";
    case TOOL_NAMES.WEATHER_GET_LOCAL:
      return "Weather";
    case TOOL_NAMES.DOCS_GET_RECENT:
      return "Docs";
  }
  switch (slot.primitive) {
    case "mcp_app":
      return "MCP app";
    case "narrative":
      return "Narrative";
    case "action_card":
      return "Suggested action";
    default:
      return slot.primitive;
  }
}

function ConnectionStrip({ state, message }: { state: ConnectionState; message: string | null }) {
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
