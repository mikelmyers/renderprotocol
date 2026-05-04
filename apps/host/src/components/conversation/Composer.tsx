import { useState, type FormEvent, type KeyboardEvent } from "react";

interface Props {
  onSubmit: (text: string) => void;
  busy: boolean;
}

// Composer: where the user talks to their agent. Single-line for v0.
// Enter submits; Shift+Enter is reserved for multi-line in step 2.
//
// Submission is disabled while a request is in flight to keep the
// conversation thread strictly ordered (no interleaved replies in v0).

export function Composer({ onSubmit, busy }: Props) {
  const [text, setText] = useState("");

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setText("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(text);
    }
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <input
        type="text"
        className="composer__input"
        placeholder={busy ? "Your agent is working…" : "Ask your agent…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        disabled={busy}
        autoFocus
        // Length cap mirrors the server-side LookupInput zod cap so the user
        // gets immediate feedback rather than a JSON-RPC error after submit.
        maxLength={2000}
        autoComplete="off"
        spellCheck={true}
      />
      <button
        type="submit"
        className="composer__submit"
        disabled={busy || text.trim().length === 0}
      >
        Send
      </button>
    </form>
  );
}
