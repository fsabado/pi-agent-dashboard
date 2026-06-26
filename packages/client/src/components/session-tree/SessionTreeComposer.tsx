import React, { useState, useRef, useCallback } from "react";

interface Props {
  sessionId: string | undefined;
  send: (msg: { type: string; [key: string]: unknown }) => void;
}

export function SessionTreeComposer({ sessionId, send }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || sending) return;
    send({ type: "send_prompt", sessionId, text: trimmed });
    setText("");
    setSending(false);
    textareaRef.current?.focus();
  }, [text, sessionId, send, sending]);

  if (!sessionId) {
    return (
      <div className="px-3 py-2 border-t border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)] text-center flex-shrink-0">
        Session not active
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border-primary)] px-2 py-1.5 flex gap-1.5 items-end flex-shrink-0">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Message this branch…"
        rows={2}
        className="flex-1 resize-none text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-2 py-1 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || sending}
        className="px-2 py-1 text-[10px] rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex-shrink-0 transition-colors"
      >
        Send
      </button>
    </div>
  );
}
