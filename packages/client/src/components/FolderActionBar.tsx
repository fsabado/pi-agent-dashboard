/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: Terminals(N) | Editor | Zed | Clean up broken | Pi Resources
 * See change: sidebar-compact-combo-pill.
 */
import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiConsoleLine,
  mdiCodeBraces,
  mdiToyBrickOutline,
  mdiOpenInNew,
  mdiAlertCircleOutline,
  mdiBroom,
} from "@mdi/js";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { WorktreeInitButton } from "./WorktreeInitButton.js";
import { ComboPill } from "./ComboPill.js";
import type { DetectedEditor } from "../lib/editor-api.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  cwd: string;
  terminalCount: number;
  editorStatus?: { id: string; status: EditorInstanceStatus } | null;
  editorAvailable?: boolean; // Whether code-server binary is detected
  nativeEditors: DetectedEditor[];
  /**
   * Number of ended sessions in this folder whose `cwdMissing === true`.
   * Drives the visibility + label of the `Clean up broken (N)` button.
   * 0 / undefined hides the button. See change: add-worktree-lifecycle-actions.
   */
  brokenSessionCount?: number;
  /** Called when the user confirms cleaning up. Fires hide for each broken session. */
  onCleanUpBroken?: () => void;
  onOpenTerminals: () => void;
  onOpenEditor: () => void;
  onOpenNativeEditor: (editorId: string) => void;
  onOpenPiResources: () => void;
}

// Keycap map for native editors
const editorKeycaps: Record<string, string> = {
  zed: "Z",
};

export function FolderActionBar({
  cwd,
  terminalCount,
  editorStatus,
  editorAvailable = true,
  nativeEditors,
  brokenSessionCount,
  onCleanUpBroken,
  onOpenTerminals,
  onOpenEditor,
  onOpenNativeEditor,
  onOpenPiResources,
}: Props) {
  // Filter out vscode/code from native editors (served via EditorView)
  const filteredNativeEditors = nativeEditors.filter((e) => e.id !== "vscode" && e.id !== "code");
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Initialize (shown iff this checkout declares a hook + gate says needsInit) */}
      <WorktreeInitButton cwd={cwd} />

      {/* [T] Terminals(N) */}
      <ComboPill
        keycap="T"
        icon={mdiConsoleLine}
        label={terminalCount}
        variant="terminal"
        title={i18nT("auto.open_terminals_view", undefined, "Open terminals view")}
        onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
      />

      {/* [E] Editor — status dot shows running/starting/missing state */}
      <ComboPill
        keycap="E"
        icon={mdiCodeBraces}
        label={
          editorAvailable === false ? (
            <Icon path={mdiAlertCircleOutline} size={0.38} className="text-yellow-400" />
          ) : editorStatus?.status === "ready" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
          ) : editorStatus?.status === "starting" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          ) : undefined
        }
        variant="editor"
        title={
          editorAvailable === false
            ? "code-server not found — click to see install guide"
            : editorStatus?.status === "ready"
            ? "Editor running — click to open"
            : editorStatus?.status === "starting"
            ? "Editor starting..."
            : i18nT("auto.open_vs_code_editor", undefined, "Open VS Code editor")
        }
        onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
      />

      {/* Native editors (e.g., Zed) — filtered to exclude vscode */}
      {filteredNativeEditors.map((editor) => (
        <ComboPill
          key={editor.id}
          keycap={editorKeycaps[editor.id] ?? editor.name[0].toUpperCase()}
          icon={mdiOpenInNew}
          label={editor.name}
          variant="neutral"
          title={`Open in ${editor.name}`}
          onClick={(e) => { e.stopPropagation(); onOpenNativeEditor(editor.id); }}
        />
      ))}

      {/* [!] Clean up broken sessions */}
      {showCleanUp && (
        <ComboPill
          keycap="!"
          icon={mdiBroom}
          label={brokenSessionCount}
          variant="danger"
          title={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists`}
          onClick={(e) => { e.stopPropagation(); setConfirmCleanUpOpen(true); }}
          testId="folder-cleanup-broken-btn"
        />
      )}
      {confirmCleanUpOpen && (
        <Confirm
          open
          testId="cleanup-broken-confirm"
          title={i18nT("auto.hide_broken_sessions", undefined, "Hide broken sessions?")}
          message={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists?`}
          confirmLabel="Hide"
          onConfirm={() => { setConfirmCleanUpOpen(false); onCleanUpBroken?.(); }}
          onClose={() => setConfirmCleanUpOpen(false)}
        />
      )}

      {/* [π] Pi Resources — right-aligned */}
      <ComboPill
        keycap="π"
        icon={mdiToyBrickOutline}
        variant="pi"
        title={i18nT("auto.pi_resources", undefined, "Pi Resources")}
        onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
        className="ml-auto"
      />
    </div>
  );
}
