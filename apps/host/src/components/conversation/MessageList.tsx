import { useEffect, useRef } from "react";

export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  ts_ms: number;
}

interface Props {
  messages: Message[];
  busy: boolean;
}

// MessageList: the conversation thread between the user and their agent.
// Auto-scrolls to the latest message on append. Pure presentation; the
// owning panel manages the message array and the in-flight state.

export function MessageList({ messages, busy }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  return (
    <div className="message-list">
      {messages.length === 0 && !busy && (
        <div className="message-list__empty">
          Your agent is ready. Ask it anything.
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`message message--${m.role}`}>
          <div className="message__role">
            {m.role === "user" ? "you" : m.role === "agent" ? "agent" : "system"}
          </div>
          <div className="message__text">{m.text}</div>
        </div>
      ))}
      {busy && (
        <div className="message message--agent message--pending">
          <div className="message__role">agent</div>
          <div className="message__text">…</div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
