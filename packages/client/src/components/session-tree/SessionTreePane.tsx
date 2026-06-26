import React, { useRef, useCallback, useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
import type { SessionTreePaneState } from "../../hooks/useSessionTreePane.js";
import { useSessionTree, type SessionTreeState } from "../../hooks/useSessionTree.js";
import { SessionTreeSidebar } from "./SessionTreeSidebar.js";
import { SessionTreeMessages } from "./SessionTreeMessages.js";
import { SessionTreeHeader } from "./SessionTreeHeader.js";
import { SessionTreeActionBar } from "./SessionTreeActionBar.js";

const COLLAPSED_WIDTH = 28;

export interface SessionTreePaneProps {
  sessionFile: string;
  pane: SessionTreePaneState;
  rootSessionId: string;
  resolveSessionId: (sessionFile: string) => string | undefined;
  onStateChange?: (state: SessionTreeState | null) => void;
  onSwitchToSession?: (sessionFile: string) => void;
}

export function SessionTreePane({
  sessionFile, pane, rootSessionId, resolveSessionId, onStateChange, onSwitchToSession,
}: SessionTreePaneProps) {
  const { open, width, toggle, setWidth } = pane;
  const { state, loading, error, stale, refetch } = useSessionTree(sessionFile);
  const dragging = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const [selectedNodeId, setSelectedNodeId] = useState("ROOT");
  const [activeEntryId, setActiveEntryId] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const [showTools, setShowTools] = useState(true);

  // Bubble tree state up so header branch switcher can read it
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!open) return;
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [open]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !paneRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(260, Math.min(640, newWidth));
      paneRef.current.style.width = `${clamped}px`;
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth(window.innerWidth - e.clientX);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  // Reset selection when session file changes
  useEffect(() => {
    setSelectedNodeId(state?.currentNodeId ?? "ROOT");
    setActiveEntryId("");
  }, [sessionFile, state?.currentNodeId]);

  const handleFork = async (entryId: string) => {
    const selectedNode = state?.nodes.find(n => n.id === selectedNodeId);
    if (!selectedNode) return;
    try {
      const r = await fetch("/api/session-tree/fork-and-spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionFile: selectedNode.sessionFile,
          entryId,
          parentSessionId: rootSessionId,
        }),
      });
      const payload = await r.json() as { success: boolean; error?: string };
      if (!payload.success) throw new Error(payload.error);
      refetch();
    } catch (e) {
      alert(`Fork failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleNavigateNode = useCallback((nodeId: string) => {
    const node = state?.nodes.find(n => n.id === nodeId);
    if (!node) return;
    onSwitchToSession?.(node.sessionFile);
  }, [state, onSwitchToSession]);

  const handleTruncate = async (entryId: string) => {
    if (!confirm("Delete all conversation after this message? This rewrites the session file.")) return;
    const selectedNode = state?.nodes.find(n => n.id === selectedNodeId);
    if (!selectedNode) return;
    try {
      const r = await fetch("/api/session-tree/truncate-after", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionFile: selectedNode.sessionFile, entryId }),
      });
      const payload = await r.json() as { success: boolean; error?: string };
      if (!payload.success) throw new Error(payload.error);
      refetch();
    } catch (e) {
      alert(`Truncate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteBranch = async (nodeId: string) => {
    if (!confirm("Delete this fork branch and all its descendants?")) return;
    try {
      const r = await fetch("/api/session-tree/delete-branch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootSessionFile: state?.root.sessionFile, nodeId }),
      });
      const payload = await r.json() as { success: boolean; error?: string };
      if (!payload.success) throw new Error(payload.error);
      setSelectedNodeId("ROOT");
      setActiveEntryId("");
      refetch();
    } catch (e) {
      alert(`Delete branch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Collapsed strip ──────────────────────────────────────────────────────────
  if (!open) {
    return (
      <div
        className="relative border-l border-[var(--border-primary)] bg-[var(--bg-primary)] flex-shrink-0 flex items-center justify-center"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <button
          onClick={toggle}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-5 h-8 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] shadow-md transition-colors cursor-pointer"
          title="Expand session tree"
          data-testid="session-tree-expand"
        >
          <Icon path={mdiChevronLeft} size={0.55} />
        </button>
        <span
          className="text-[9px] text-[var(--text-tertiary)] tracking-widest uppercase select-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Tree
        </span>
      </div>
    );
  }

  // ── Expanded pane ────────────────────────────────────────────────────────────
  const selectedNode = state?.nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedSession = selectedNode ? (state?.sessions[selectedNode.sessionFile] ?? null) : null;
  const resolvedSessionId = selectedNode
    ? (resolveSessionId(selectedNode.sessionFile) ?? rootSessionId)
    : rootSessionId;

  return (
    <div
      ref={paneRef}
      className="flex flex-shrink-0 relative border-l border-[var(--border-primary)] bg-[var(--bg-primary)]"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 flex-shrink-0"
        data-testid="session-tree-drag-handle"
      />
      {/* Collapse button */}
      <button
        onClick={toggle}
        onMouseDown={e => e.stopPropagation()}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-5 h-8 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] shadow-md transition-colors cursor-pointer"
        title="Collapse session tree"
        data-testid="session-tree-collapse"
      >
        <Icon path={mdiChevronRight} size={0.55} />
      </button>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {loading && !state && !error && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-xs">
            Loading…
          </div>
        )}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs p-4 text-center">
            <span className="text-red-400">{error}</span>
            <button
              onClick={refetch}
              className="px-3 py-1 text-[10px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)] transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {state && (
          <>
            <SessionTreeHeader
              session={selectedSession}
              stale={stale}
              showThinking={showThinking}
              showTools={showTools}
              onToggleThinking={() => setShowThinking(v => !v)}
              onToggleTools={() => setShowTools(v => !v)}
              onRefresh={refetch}
            />
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Sidebar tree ~40% */}
              <div className="w-2/5 flex-shrink-0 border-r border-[var(--border-primary)] overflow-y-auto">
                <SessionTreeSidebar
                  state={state}
                  selectedNodeId={selectedNodeId}
                  activeEntryId={activeEntryId}
                  onSelect={(nodeId, entryId) => {
                    setSelectedNodeId(nodeId);
                    setActiveEntryId(entryId);
                  }}
                  onDeleteBranch={handleDeleteBranch}
                  onNavigateNode={onSwitchToSession ? handleNavigateNode : undefined}
                />
              </div>
              {/* Transcript + composer */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <SessionTreeMessages
                    session={selectedSession}
                    activeEntryId={activeEntryId}
                    showThinking={showThinking}
                    showTools={showTools}
                    onFork={handleFork}
                    onTruncate={handleTruncate}
                  />
                </div>
                <SessionTreeActionBar
                  selectedNode={selectedNode}
                  selectedSession={selectedSession}
                  activeEntryId={activeEntryId}
                  resolvedSessionId={resolvedSessionId}
                  onFork={handleFork}
                  onTruncate={handleTruncate}
                  onDeleteBranch={handleDeleteBranch}
                  onNavigate={onSwitchToSession && selectedNode ? () => onSwitchToSession(selectedNode.sessionFile) : undefined}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
