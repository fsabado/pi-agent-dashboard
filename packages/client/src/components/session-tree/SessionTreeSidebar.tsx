import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiDeleteOutline, mdiSourceBranch, mdiArrowRight } from "@mdi/js";
import type { SessionTreeState, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  state: SessionTreeState;
  selectedNodeId: string;
  activeEntryId: string;
  onSelect: (nodeId: string, entryId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
  onNavigateNode?: (nodeId: string) => void;
}

function entryText(entry: EntryView): string {
  return (entry.blocks ?? []).map(b => b.text ?? "").join(" ")
    .replace(/[\n\t]/g, " ").trim();
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

type Row =
  | { kind: "fork-label"; nodeId: string; depth: number; title: string; isRoot: boolean }
  | { kind: "entry"; nodeId: string; entryId: string; entry: EntryView; depth: number; isLast: boolean; hasBranchAfter: boolean };

export function SessionTreeSidebar({ state, selectedNodeId, activeEntryId, onSelect, onDeleteBranch, onNavigateNode }: Props) {
  const [hoveredFork, setHoveredFork] = useState<string | null>(null);

  const rows: Row[] = [];

  function collect(nodeId: string, depth: number) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const session = state.sessions[node.sessionFile];
    if (!session) return;

    if (nodeId !== "ROOT") {
      rows.push({ kind: "fork-label", nodeId, depth, title: node.title, isRoot: false });
    }

    const startIndex = (() => {
      if (nodeId === "ROOT") return 0;
      if (node.firstChildEntryId) {
        const i = session.entries.findIndex(e => e.id === node.firstChildEntryId);
        return i >= 0 ? i : 0;
      }
      if (node.anchorEntryId) {
        const i = session.entries.findIndex(e => e.id === node.anchorEntryId);
        return i >= 0 ? i + 1 : 0;
      }
      return 0;
    })();

    const entries = session.entries.slice(startIndex).filter(e => {
      if (e.role === "toolResult") return false;
      return (e.blocks ?? []).length > 0;
    });

    const children = state.nodes
      .filter(n => n.parentId === nodeId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    const renderedChildren = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Find children that branch off this entry
      const branchingChildren = children.filter(
        c => c.anchorEntryId === entry.id || c.firstChildEntryId === entry.id
      );
      const hasBranchAfter = branchingChildren.length > 0;
      const isLast = i === entries.length - 1 && !hasBranchAfter;

      rows.push({ kind: "entry", nodeId, entryId: entry.id, entry, depth, isLast, hasBranchAfter });

      for (const child of branchingChildren) {
        renderedChildren.add(child.id);
        collect(child.id, depth + 1);
      }
    }

    for (const child of children) {
      if (!renderedChildren.has(child.id)) collect(child.id, depth + 1);
    }
  }

  collect("ROOT", 0);

  return (
    <div className="py-1 text-[11px]">
      {rows.map((row, rowIdx) => {
        const RAIL_PX = 14; // px per depth level for the rail

        if (row.kind === "fork-label") {
          const active = row.nodeId === selectedNodeId && !activeEntryId;
          return (
            <div
              key={`fork-${row.nodeId}`}
              className={`relative flex items-center hover:bg-[var(--bg-hover)] group ${active ? "bg-[var(--bg-tertiary)]" : ""}`}
              style={{ paddingLeft: row.depth * RAIL_PX }}
              onMouseEnter={() => setHoveredFork(row.nodeId)}
              onMouseLeave={() => setHoveredFork(null)}
            >
              {/* Vertical connector from parent rail */}
              <div
                className="absolute top-0 bottom-0 border-l-2 border-dashed border-purple-500/40"
                style={{ left: row.depth * RAIL_PX - RAIL_PX / 2 }}
              />
              {/* Horizontal connector to label */}
              <div
                className="absolute top-1/2 border-t-2 border-dashed border-purple-500/40"
                style={{ left: row.depth * RAIL_PX - RAIL_PX / 2, width: RAIL_PX / 2 }}
              />
              {/* Fork icon dot */}
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 z-10 relative">
                <Icon path={mdiSourceBranch} size={0.45} className="text-purple-400" />
              </div>
              <button
                className="flex-1 text-left px-1 py-0.5 truncate text-purple-400 font-medium"
                onClick={() => onSelect(row.nodeId, "")}
              >
                {trunc(row.title, 32)}
              </button>
              {hoveredFork === row.nodeId && (
                <>
                  {onNavigateNode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onNavigateNode(row.nodeId); }}
                      className="px-1 py-0.5 text-[var(--text-tertiary)] hover:text-blue-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Switch main view to this branch"
                    >
                      <Icon path={mdiArrowRight} size={0.5} />
                    </button>
                  )}
                  <button
                    onClick={() => onDeleteBranch(row.nodeId)}
                    className="px-1 py-0.5 text-[var(--text-tertiary)] hover:text-red-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete this branch"
                  >
                    <Icon path={mdiDeleteOutline} size={0.5} />
                  </button>
                </>
              )}
            </div>
          );
        }

        // Entry row
        const active = row.nodeId === selectedNodeId && row.entryId === activeEntryId;
        const role = row.entry.role ?? row.entry.type;
        const isUser = role === "user";
        const isAssistant = role === "assistant";
        const text = entryText(row.entry);

        // Dot color by role
        const dotColor = isUser
          ? "bg-teal-400"
          : isAssistant
          ? "bg-green-400"
          : "bg-purple-400";

        // Look ahead: does the next row continue the same node's rail?
        const nextRow = rows[rowIdx + 1];
        const railContinues = nextRow !== undefined;

        return (
          <button
            key={`${row.nodeId}-${row.entryId}`}
            onClick={() => onSelect(row.nodeId, row.entryId)}
            className={`relative w-full text-left flex items-start gap-1.5 py-0.5 pr-2 leading-4 hover:bg-[var(--bg-hover)] transition-colors ${active ? "bg-[var(--bg-tertiary)]" : ""}`}
            style={{ paddingLeft: row.depth * RAIL_PX + 2 }}
          >
            {/* Vertical rail line */}
            {railContinues && (
              <div
                className="absolute top-3 bottom-0 w-px bg-[var(--border-secondary)]"
                style={{ left: row.depth * RAIL_PX + 6 }}
              />
            )}
            {/* Branch-off horizontal tick when this entry has children */}
            {row.hasBranchAfter && (
              <div
                className="absolute top-3 w-2 h-px bg-purple-500/40"
                style={{ left: row.depth * RAIL_PX + 7 }}
              />
            )}

            {/* Timeline dot */}
            <div className="flex-shrink-0 mt-1.5 relative z-10">
              <div className={`w-1.5 h-1.5 rounded-full ${active ? "ring-2 ring-offset-1 ring-[var(--bg-primary)]" : ""} ${dotColor}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <span className={`text-[9px] uppercase tracking-wide mr-1 ${isUser ? "text-teal-400" : isAssistant ? "text-green-400" : "text-purple-400"}`}>
                {isUser ? "you" : isAssistant ? "ai" : role}
              </span>
              <span className={`text-[var(--text-secondary)] ${active ? "font-medium" : ""}`}>
                {trunc(text, 38) || "…"}
              </span>
            </div>
          </button>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-2 text-[var(--text-tertiary)]">No messages</div>
      )}
    </div>
  );
}
