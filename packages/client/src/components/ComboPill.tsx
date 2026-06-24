/**
 * ComboPill — rounded pill with a colored keycap tile + icon + optional label.
 *
 * Shape:  [keycap][icon][label?]  — all inside a rounded-full pill.
 * The keycap tile is flush-left, colored at ~20% opacity, separated from the
 * icon area by a hairline right-border.
 *
 * Used by FolderSpawnButtons, FolderActionBar, SessionHeader, DashboardSpawnButtons.
 * See change: sidebar-compact-combo-pill.
 */
import React from "react";
import { Icon } from "@mdi/react";

export type PillVariant =
  | "session"
  | "worktree"
  | "fork"
  | "terminal"
  | "editor"
  | "pi"
  | "resume"
  | "danger"
  | "neutral"
  | "folder"
  | "workspace";

const VARIANTS: Record<PillVariant, { pill: string; key: string }> = {
  session:   { pill: "text-green-400  border-green-500/40  bg-green-500/5   hover:border-green-500/60",   key: "bg-green-500/20  border-r border-r-green-500/30" },
  worktree:  { pill: "text-orange-400 border-orange-500/40 bg-orange-500/5  hover:border-orange-500/60",  key: "bg-orange-500/20 border-r border-r-orange-500/30" },
  fork:      { pill: "text-blue-400   border-blue-500/40   bg-blue-500/5    hover:border-blue-500/60",    key: "bg-blue-500/20   border-r border-r-blue-500/30" },
  terminal:  { pill: "text-cyan-400   border-cyan-500/30   bg-cyan-500/5    hover:border-cyan-500/50",    key: "bg-cyan-500/15   border-r border-r-cyan-500/25" },
  editor:    { pill: "text-blue-400   border-blue-500/25   bg-blue-500/5    hover:border-blue-500/40",    key: "bg-blue-500/15   border-r border-r-blue-500/25" },
  pi:        { pill: "text-purple-400 border-purple-500/25 bg-purple-500/5  hover:border-purple-500/40",  key: "bg-purple-500/15 border-r border-r-purple-500/20" },
  resume:    { pill: "text-green-400  border-green-500/35  bg-green-500/5   hover:border-green-500/55",   key: "bg-green-500/20  border-r border-r-green-500/25" },
  danger:    { pill: "text-red-400    border-red-500/40    bg-red-500/5     hover:border-red-500/60",     key: "bg-red-500/20    border-r border-r-red-500/30" },
  neutral:   { pill: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)]", key: "bg-[var(--bg-tertiary)] border-r border-r-[var(--border-secondary)]" },
  folder:    { pill: "text-blue-500   border-blue-500/40   bg-blue-500/5    hover:border-blue-500/60",    key: "bg-blue-500/20   border-r border-r-blue-500/30" },
  workspace: { pill: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)]", key: "bg-[var(--bg-tertiary)] border-r border-r-[var(--border-secondary)]" },
};

export interface ComboPillProps {
  /** Single character / glyph shown in the keycap tile (e.g. "S", "W", "F", "π"). */
  keycap: string;
  /** MDI icon path. */
  icon: string;
  /** Optional content rendered to the right of the icon (text, count badge, status dot). */
  label?: React.ReactNode;
  variant?: PillVariant;
  title: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
  iconSize?: number;
}

export function ComboPill({
  keycap,
  icon,
  label,
  variant = "neutral",
  title,
  onClick,
  disabled,
  testId,
  className = "",
  iconSize = 0.45,
}: ComboPillProps) {
  const v = VARIANTS[variant];
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(e); }}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`inline-flex items-center rounded-full border overflow-hidden font-mono text-[10px] whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${v.pill} ${className}`}
    >
      {/* keycap tile */}
      <span className={`self-stretch flex items-center justify-center w-5 text-[9px] font-semibold flex-shrink-0 ${v.key}`}>
        {keycap}
      </span>
      {/* icon */}
      <span className="flex items-center px-[3px] flex-shrink-0">
        <Icon path={icon} size={iconSize} />
      </span>
      {/* label / count / status */}
      {label != null && (
        <span className="pr-[7px] inline-flex items-center gap-[3px]">{label}</span>
      )}
    </button>
  );
}
