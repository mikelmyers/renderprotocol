import { useEffect, useRef, useState } from "react";
import { setActiveAgent, useActiveAgent, useAgentList } from "../../lib/config";

// Header dropdown that surfaces the active agent contract and lets the
// user switch between any agent.md present under `config/agents/`. The
// substrate the agents are loaded from is the same on every platform —
// edit the markdown, see the surface change without restart.

export function AgentPicker() {
  const { key: activeKey, doc: activeDoc } = useActiveAgent();
  const agents = useAgentList();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = activeDoc?.title ?? activeKey ?? "no agent loaded";

  return (
    <div className="agent-picker" ref={ref}>
      <button
        className="agent-picker__button"
        onClick={() => setOpen((v) => !v)}
        title={activeKey ?? undefined}
      >
        <span className="agent-picker__label">{label}</span>
        <span className="agent-picker__caret">▾</span>
      </button>
      {open && (
        <ul className="agent-picker__menu" role="listbox">
          {agents.length === 0 && (
            <li className="agent-picker__empty">no agent.md files loaded</li>
          )}
          {agents.map((a) => (
            <li
              key={a.key}
              className={
                a.key === activeKey
                  ? "agent-picker__item agent-picker__item--active"
                  : "agent-picker__item"
              }
              onClick={() => {
                void setActiveAgent(a.key);
                setOpen(false);
              }}
              role="option"
              aria-selected={a.key === activeKey}
            >
              <span className="agent-picker__item-title">{a.title}</span>
              <span className="agent-picker__item-key">{a.key}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
