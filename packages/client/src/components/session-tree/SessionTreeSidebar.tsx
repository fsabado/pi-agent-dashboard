import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiDeleteOutline } from "@mdi/js";
import type { SessionTreeState, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  state: SessionTreeState;
  selectedNodeId: string;
  activeEntryId: string;
  onSelect: (nodeId: string, entryId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
}

function entryText(entry: EntryView): string {
  return (entry.blocks ?? []).map(b => b.text ?? "").join(" ")
    .replace(/[\n\t]/g, " ").trim();
}

function roleColor(role?: string): string {
  if (role === "user") return "text-teal-400";
  if (role === "assistant") return "text-green-400";
  if (role === "system") return "text-[var(--text-tertiary)]";
  return "text-purple-400";
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

type SidebarRow =
  | { kind: "fork"; nodeId: string; depth: number; title: string }
  | { kind: "entry"; nodeId: string; entryId: string; entry: EntryView; depth: number };

export function SessionTreeSidebar({
  state, selectedNodeId, activeEntryId, onSelect, onDeleteBranch,
}: Props) {
  const [hoveredFork, setHoveredFork] = useState<string | null>(null);

  const rows: SidebarRow[] = [];

  function collect(nodeId: string, depth: number) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const session = state.sessions[node.sessionFile];
    if (!session) return;

    if (nodeId !== "ROOT") {
      rows.push({ kind: "fork", nodeId, depth, title: node.title });
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
      rows.push({ kind: "entry", nodeId, entryId: entry.id, entry, depth });
      for (const child of children) {
        if (child.anchorEntryId === entry.id || child.firstChildEntryId === entry.id) {
          renderedChildren.add(child.id);
          collect(child.id, depth + 1);
        }
      }
    }

    for (const child of children) {
      if (!renderedChildren.has(child.id)) collect(child.id, depth + 1);
    }
  }

  collect("ROOT", 0);

  return (
    <div className="py-1 text-[11px]">
      {rows.map((row) => {
        if (row.kind === "fork") {
          const active = row.nodeId === selectedNodeId && !activeEntryId;
          return (
            <div
              key={`fork-${row.nodeId}`}
              className={`relative flex items-baseline hover:bg-[var(--bg-hover)] ${active ? "bg-[var(--bg-tertiary)]" : ""}`}
              onMouseEnter={() => setHoveredFork(row.nodeId)}
              onMouseLeave={() => setHoveredFork(null)}
            >
              <button
                className="flex-1 text-left px-2 py-0.5 flex items-baseline gap-1"
                onClick={() => onSelect(row.nodeId, "")}
              >
                <span
                  className="text-[var(--text-tertiary)] flex-shrink-0"
                  style={{ paddingLeft: row.depth * 12 }}
                >↳ </span>
                <span className="text-purple-400 truncate">{row.title}</span>
              </button>
              {hoveredFork === row.nodeId && (
                <button
                  onClick={() => onDeleteBranch(row.nodeId)}
                  className="px-1 py-0.5 text-[var(--text-tertiary)] hover:text-red-400 flex-shrink-0"
                  title="Delete this branch"
                >
                  <Icon path={mdiDeleteOutline} size={0.5} />
                </button>
              )}
            </div>
          );
        }

        const active = row.nodeId === selectedNodeId && row.entryId === activeEntryId;
        const role = row.entry.role ?? row.entry.type;
        const text = entryText(row.entry);

        return (
          <button
            key={`${row.nodeId}-${row.entryId}`}
            onClick={() => onSelect(row.nodeId, row.entryId)}
            className={`w-full text-left px-2 py-0.5 flex items-baseline gap-1 leading-4 hover:bg-[var(--bg-hover)] ${active ? "bg-[var(--bg-tertiary)] font-medium" : ""}`}
          >
            <span
              className="text-[var(--text-tertiary)] flex-shrink-0 w-3 text-center"
              style={{ paddingLeft: row.depth * 12 }}
            >
              {active ? "▸" : ""}
            </span>
            <span className={`${roleColor(role)} flex-shrink-0`}>{role}:</span>
            <span className="text-[var(--text-secondary)] truncate">{trunc(text, 44) || "…"}</span>
          </button>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-2 text-[var(--text-tertiary)]">No messages</div>
      )}
    </div>
  );
}
