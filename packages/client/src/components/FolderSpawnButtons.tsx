/**
 * Elevated spawn-button stack for folder groups in the sidebar.
 *
 * Renders inline ComboPill buttons (rounded pill + keycap + icon + label):
 *   - [S] + Session (green) — always rendered.
 *   - [W] ⑂ Worktree (orange) — rendered only when `showWorktree` holds.
 *
 * See change: elevate-folder-spawn-buttons.
 * See change: sidebar-compact-combo-pill.
 */
import { mdiPlus, mdiSourceBranchPlus } from "@mdi/js";
import { ComboPill } from "./ComboPill.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  /** Disables `+ New Session` while a session is being spawned in this folder. */
  spawningDisabled?: boolean;
  /**
   * Whether to render `+ New Worktree`. Caller computes
   * `isGitRepo && gitWorktreeEnabled && !!onSpawnWorktree`.
   */
  showWorktree: boolean;
  onSpawnSession: () => void;
  onSpawnWorktree?: () => void;
}

export function FolderSpawnButtons({
  spawningDisabled,
  showWorktree,
  onSpawnSession,
  onSpawnWorktree,
}: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ComboPill
        keycap="S"
        icon={mdiPlus}
        label={i18nT("auto.new_session_2", undefined, "Session")}
        variant={spawningDisabled ? "neutral" : "session"}
        title={i18nT("auto.new_pi_session", undefined, "New pi session")}
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        testId="folder-spawn-session-btn"
      />
      {showWorktree && (
        <ComboPill
          keycap="W"
          icon={mdiSourceBranchPlus}
          label={i18nT("auto.new_worktree_2", undefined, "Worktree")}
          variant="worktree"
          title={i18nT("auto.new_pi_session_in_a_git", undefined, "New pi session in a git worktree")}
          onClick={(e) => { e.stopPropagation(); onSpawnWorktree!(); }}
          testId="folder-spawn-worktree-btn"
        />
      )}
    </div>
  );
}
