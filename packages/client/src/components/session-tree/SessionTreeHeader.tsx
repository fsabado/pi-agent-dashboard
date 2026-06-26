import React from "react";
import { Icon } from "@mdi/react";
import { mdiEye, mdiEyeOff, mdiWrench, mdiRefresh, mdiAlertCircleOutline } from "@mdi/js";
import type { SessionTreeView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionTreeView | null | undefined;
  stale: boolean;
  showThinking: boolean;
  showTools: boolean;
  onToggleThinking: () => void;
  onToggleTools: () => void;
  onRefresh: () => void;
}

function fmt(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function SessionTreeHeader({
  session, stale, showThinking, showTools, onToggleThinking, onToggleTools, onRefresh,
}: Props) {
  const stats = session?.stats;
  const cost = stats
    ? stats.cost.input + stats.cost.output + stats.cost.cacheRead + stats.cost.cacheWrite
    : 0;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)] flex-shrink-0 flex-wrap">
      {stale && (
        <span title="Live updates disconnected" className="text-yellow-400 flex items-center gap-0.5">
          <Icon path={mdiAlertCircleOutline} size={0.45} /> stale
        </span>
      )}
      {stats && (
        <>
          <span title="User / Assistant messages">{stats.userMessages}u · {stats.assistantMessages}a</span>
          <span title="Tool calls">{stats.toolCalls}t</span>
          <span title="Tokens">↑{fmt(stats.tokens.input)} ↓{fmt(stats.tokens.output)}</span>
          {cost > 0 && <span title="Cost">${cost.toFixed(2)}</span>}
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={onRefresh}
        title="Refresh"
        className="p-0.5 rounded hover:text-[var(--text-primary)] transition-colors"
      >
        <Icon path={mdiRefresh} size={0.5} />
      </button>
      <button
        onClick={onToggleThinking}
        title={showThinking ? "Hide thinking" : "Show thinking"}
        className={`p-0.5 rounded transition-colors ${showThinking ? "text-[var(--text-secondary)]" : "opacity-40"}`}
      >
        <Icon path={showThinking ? mdiEye : mdiEyeOff} size={0.5} />
      </button>
      <button
        onClick={onToggleTools}
        title={showTools ? "Hide tools" : "Show tools"}
        className={`p-0.5 rounded transition-colors ${showTools ? "text-[var(--text-secondary)]" : "opacity-40"}`}
      >
        <Icon path={mdiWrench} size={0.5} />
      </button>
    </div>
  );
}
