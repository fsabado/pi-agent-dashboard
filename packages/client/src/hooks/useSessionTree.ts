import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionTreeState } from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";

export type { SessionTreeState };
export type {
  SessionTreeNode,
  SessionTreeView,
  EntryView,
  MessageBlock,
  SessionTreeStats,
} from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";

const BACKOFF_DELAYS = [1000, 2000, 4000]; // ms, max 3 attempts

interface UseSessionTreeResult {
  state: SessionTreeState | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refetch: () => void;
}

export function useSessionTree(sessionFile: string | undefined): UseSessionTreeResult {
  const [state, setState] = useState<SessionTreeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchState = useCallback(async (file: string) => {
    try {
      const r = await fetch(`/api/session-tree?sessionFile=${encodeURIComponent(file)}`);
      const payload = await r.json() as { success: boolean; data?: SessionTreeState; error?: string };
      if (payload.success && payload.data) { setState(payload.data); setError(null); }
      else setError(payload.error ?? "Failed to load.");
    } catch (e) { setError(String(e)); }
  }, []);

  const connect = useCallback((file: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/session-tree/events?sessionFile=${encodeURIComponent(file)}`);
    esRef.current = es;

    es.addEventListener("state", (e: MessageEvent<string>) => {
      try {
        setState(JSON.parse(e.data) as SessionTreeState);
        attemptsRef.current = 0;
        setStale(false);
      } catch { /* ignore */ }
    });

    es.onopen = () => { attemptsRef.current = 0; setStale(false); };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const attempt = attemptsRef.current;
      if (attempt >= BACKOFF_DELAYS.length) {
        setStale(true);
        return;
      }
      attemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect(file);
        void fetchState(file);
      }, BACKOFF_DELAYS[attempt]);
    };
  }, [fetchState]);

  const refetch = useCallback(() => {
    if (sessionFile) void fetchState(sessionFile);
  }, [sessionFile, fetchState]);

  useEffect(() => {
    if (!sessionFile) {
      setState(null); setError(null); setStale(false);
      esRef.current?.close(); esRef.current = null;
      return;
    }

    attemptsRef.current = 0;
    setLoading(true);
    setStale(false);

    void fetchState(sessionFile).finally(() => setLoading(false));
    connect(sessionFile);

    return () => {
      esRef.current?.close(); esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [sessionFile, fetchState, connect]);

  return { state, loading, error, stale, refetch };
}
