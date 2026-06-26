import React, { useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiSourceBranch, mdiDeleteSweepOutline } from "@mdi/js";
import type { SessionTreeView, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionTreeView | null | undefined;
  activeEntryId: string;
  showThinking: boolean;
  showTools: boolean;
  onFork: (entryId: string) => void;
  onTruncate: (entryId: string) => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function EntryRow({
  entry, showThinking, showTools, active, onFork, onTruncate,
}: {
  entry: EntryView;
  showThinking: boolean;
  showTools: boolean;
  active: boolean;
  onFork: () => void;
  onTruncate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const role = entry.role ?? entry.type;
  const ts = fmtTime(entry.timestamp);

  const blocks = (entry.blocks ?? []).filter(b => {
    if (b.kind === "thinking") return showThinking;
    if (b.kind === "toolCall") return showTools;
    return true;
  });

  if (blocks.length === 0) return null;

  const isUser = role === "user";
  const isAssistant = role === "assistant";

  return (
    <div
      id={`tree-entry-${entry.id}`}
      className={`relative group mx-2 my-1.5 ${active ? "ring-1 ring-blue-400 rounded-lg" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Action buttons on hover */}
      {hovered && (
        <div className="absolute top-0.5 right-0.5 flex gap-0.5 z-10">
          {isAssistant && (
            <button
              onClick={onFork}
              title="Fork after this message"
              className="p-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-green-400 hover:border-green-400"
            >
              <Icon path={mdiSourceBranch} size={0.45} />
            </button>
          )}
          <button
            onClick={onTruncate}
            title="Delete after this message"
            className="p-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400"
          >
            <Icon path={mdiDeleteSweepOutline} size={0.45} />
          </button>
        </div>
      )}

      {isUser && (
        <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 text-[11px] text-[var(--text-primary)]">
          {ts && <div className="text-[9px] text-[var(--text-tertiary)] mb-0.5">{ts}</div>}
          {blocks.map((b, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">{b.text}</div>
          ))}
        </div>
      )}

      {isAssistant && (
        <div className="px-2 py-1 text-[11px] text-[var(--text-primary)]">
          {ts && <div className="text-[9px] text-[var(--text-tertiary)] mb-0.5 pl-1">{ts}</div>}
          {blocks.map((b, i) => {
            if (b.kind === "thinking") return (
              <div key={i} className="pl-2 py-0.5 text-[var(--text-tertiary)] italic text-[10px] whitespace-pre-wrap border-l-2 border-[var(--border-secondary)] my-0.5">
                {b.text}
              </div>
            );
            if (b.kind === "toolCall") return (
              <div key={i} className="px-2 py-1 my-0.5 rounded bg-[var(--bg-tertiary)] text-[10px]">
                <span className="text-yellow-400 font-medium">{b.name}</span>
                <pre className="mt-0.5 text-[var(--text-tertiary)] whitespace-pre-wrap break-all text-[9px] max-h-16 overflow-hidden">
                  {b.text}
                </pre>
              </div>
            );
            return (
              <div key={i} className="pl-1 whitespace-pre-wrap break-words">{b.text}</div>
            );
          })}
        </div>
      )}

      {!isUser && !isAssistant && (
        <div className="px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] border-l-2 border-[var(--border-secondary)]">
          <span className="text-purple-400 mr-1">[{role}]</span>
          {blocks.map((b, i) => <span key={i}>{b.text}</span>)}
        </div>
      )}
    </div>
  );
}

export function SessionTreeMessages({
  session, activeEntryId, showThinking, showTools, onFork, onTruncate,
}: Props) {
  useEffect(() => {
    if (!activeEntryId) return;
    document.getElementById(`tree-entry-${activeEntryId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeEntryId]);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-xs p-4">
        Select a branch
      </div>
    );
  }

  const visible = session.entries.filter(e => {
    if (e.role === "toolResult") return false;
    if (
      e.role === "assistant" &&
      !(e.blocks ?? []).some(b => b.kind !== "toolCall" && String(b.text ?? "").trim())
    ) return false;
    return (e.blocks ?? []).length > 0;
  });

  return (
    <div className="py-1">
      {visible.length === 0 && (
        <div className="text-center text-[var(--text-tertiary)] text-xs pt-8">No messages</div>
      )}
      {visible.map(entry => (
        <EntryRow
          key={entry.id}
          entry={entry}
          showThinking={showThinking}
          showTools={showTools}
          active={entry.id === activeEntryId}
          onFork={() => onFork(entry.id)}
          onTruncate={() => onTruncate(entry.id)}
        />
      ))}
    </div>
  );
}
