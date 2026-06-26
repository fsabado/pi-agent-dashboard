import React from "react";
import { Icon } from "@mdi/react";
import { mdiSourceBranch, mdiDeleteSweepOutline, mdiDeleteOutline, mdiArrowRight } from "@mdi/js";
import type { SessionTreeNode, SessionTreeView } from "../../hooks/useSessionTree.js";

interface Props {
  selectedNode: SessionTreeNode | null;
  selectedSession: SessionTreeView | null | undefined;
  activeEntryId: string;
  resolvedSessionId: string;
  onFork: (entryId: string) => void;
  onTruncate: (entryId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
  /** Navigate to this branch as the main session in the left pane */
  onNavigate?: (sessionId: string) => void;
}

export function SessionTreeActionBar({
  selectedNode,
  selectedSession,
  activeEntryId,
  resolvedSessionId,
  onFork,
  onTruncate,
  onDeleteBranch,
  onNavigate,
}: Props) {
  const isRoot = !selectedNode || selectedNode.id === "ROOT";
  const hasActiveEntry = Boolean(activeEntryId);
  const activeEntry = selectedSession?.entries.find(e => e.id === activeEntryId);
  const isAssistantEntry = activeEntry?.role === "assistant";

  return (
    <div className="border-t border-[var(--border-primary)] px-2 py-1.5 flex items-center gap-1.5 flex-shrink-0 flex-wrap min-h-[36px]">
      {/* Contextual label */}
      <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-wide flex-shrink-0">
        {hasActiveEntry ? "message" : isRoot ? "main" : "branch"}
      </span>

      <div className="flex-1" />

      {/* Fork after selected message */}
      {hasActiveEntry && isAssistantEntry && (
        <button
          onClick={() => onFork(activeEntryId)}
          title="Fork after this message"
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors"
        >
          <Icon path={mdiSourceBranch} size={0.45} />
          Fork here
        </button>
      )}

      {/* Truncate after selected message */}
      {hasActiveEntry && (
        <button
          onClick={() => onTruncate(activeEntryId)}
          title="Delete all messages after this one"
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
        >
          <Icon path={mdiDeleteSweepOutline} size={0.45} />
          Truncate after
        </button>
      )}

      {/* Delete branch (non-root only, no active entry selected) */}
      {!isRoot && !hasActiveEntry && (
        <button
          onClick={() => onDeleteBranch(selectedNode!.id)}
          title="Delete this branch and all its descendants"
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Icon path={mdiDeleteOutline} size={0.45} />
          Delete branch
        </button>
      )}

      {/* Switch to branch as main view — non-root, no message selected */}
      {!isRoot && !hasActiveEntry && onNavigate && (
        <button
          onClick={() => onNavigate(resolvedSessionId)}
          title="Switch main view to this branch"
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors"
        >
          <Icon path={mdiArrowRight} size={0.45} />
          Switch to
        </button>
      )}

      {/* Empty state */}
      {!hasActiveEntry && isRoot && !onNavigate && (
        <span className="text-[9px] text-[var(--text-tertiary)]">Select a message to fork or truncate</span>
      )}
    </div>
  );
}
