import { useState, useCallback } from "react";

const WIDTH_KEY  = "dashboard:session-tree-pane-width";
const OPEN_KEY   = "dashboard:session-tree-pane-open";
export const DEFAULT_WIDTH = 420;
export const MIN_WIDTH = 260;
export const MAX_WIDTH = 640;

function clamp(v: number) { return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v)); }

function readNumber(key: string, fallback: number): number {
  try { const r = localStorage.getItem(key); return r !== null && Number.isFinite(+r) ? +r : fallback; }
  catch { return fallback; }
}
function readBoolean(key: string, fallback: boolean): boolean {
  try { const r = localStorage.getItem(key); return r !== null ? r === "true" : fallback; }
  catch { return fallback; }
}

export interface SessionTreePaneState {
  open: boolean;
  width: number;
  toggle: () => void;
  setWidth: (w: number) => void;
}

export function useSessionTreePane(): SessionTreePaneState {
  const [open, setOpen] = useState(() => readBoolean(OPEN_KEY, false));
  const [width, setWidthRaw] = useState(() => clamp(readNumber(WIDTH_KEY, DEFAULT_WIDTH)));

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(OPEN_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const setWidth = useCallback((w: number) => {
    const c = clamp(w);
    setWidthRaw(c);
    try { localStorage.setItem(WIDTH_KEY, String(c)); } catch { /* noop */ }
  }, []);

  return { open, width, toggle, setWidth };
}
