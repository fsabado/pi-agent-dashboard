/**
 * Per-session persistence for the flow socket's collapse state. The whole-panel
 * (`FlowSummary`) and live-dashboard (`FlowDashboard`) collapses are stored in
 * localStorage keyed by session id, so collapsing a session's flow panel sticks
 * across remounts/reloads instead of re-opening every time. Mirrors the
 * try/catch-swallow pattern of `useSidebarState.ts`; a localStorage failure
 * (quota / disabled / private mode) degrades to in-memory state and never throws.
 *
 * Default is expanded (false) for any session never collapsed.
 *
 * See change: fix-flow-ui-graph-zoom-summary.
 */
import { useCallback, useEffect, useState } from "react";

export type FlowCollapseKind = "summary" | "dashboard";

/** localStorage key for a (kind, session) pair. */
export function flowCollapseKey(kind: FlowCollapseKind, sessionId: string): string {
  return `dashboard:flow-${kind}-collapsed:${sessionId}`;
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* noop — degrade to in-memory */
  }
}

/**
 * Generic localStorage-backed boolean toggle. Returns `[value, toggle]`.
 * `key === null` → purely in-memory (no persistence). Re-syncs on key change
 * (so a component reused under a new key reads the right value) without
 * clobbering a same-key toggle. localStorage failures degrade to in-memory.
 */
export function usePersistedToggle(
  key: string | null,
  fallback: boolean,
): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => (key ? readBoolean(key, fallback) : fallback));

  useEffect(() => {
    setValue(key ? readBoolean(key, fallback) : fallback);
  }, [key, fallback]);

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      if (key) writeBoolean(key, next);
      return next;
    });
  }, [key]);

  return [value, toggle];
}

/** localStorage key for the global error-route visibility toggle (not session-scoped). */
export const FLOW_SHOW_ERROR_ROUTES_KEY = "dashboard:flow-show-error-routes";

/**
 * Persisted collapse state for one flow panel. Returns `[collapsed, toggle]`.
 * When `sessionId` is undefined the state is purely in-memory (no key to scope by).
 */
export function useFlowCollapsePersisted(
  sessionId: string | undefined,
  kind: FlowCollapseKind,
): [boolean, () => void] {
  return usePersistedToggle(sessionId ? flowCollapseKey(kind, sessionId) : null, false);
}
