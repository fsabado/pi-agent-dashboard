# Session Tree Right Pane — Implementation Plan

> **For Claude:** Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Add a collapsible right-side session tree pane to the dashboard's session detail view, showing the fork tree and transcript for the current session's JSONL file as a native React component.

**Architecture:** Extract session-tree state-building logic from `pi-session-tree-browser` into a new `packages/server/src/session-tree.ts` module, expose it via new Fastify routes at `/api/session-tree/*`, and build a native React `SessionTreePane` component that mounts alongside `ChatView` in a horizontal flex layout. The pane is collapsible via a toggle button in `SessionHeader` and mirrors the `ResizableSidebar` pattern already in the codebase.

**Tech Stack:** TypeScript, React, Tailwind CSS, Fastify, Node.js `fs`, SSE (EventSource), `@mdi/react` icons, `localStorage` for pane state persistence.

---

## Task 1: Server — session-tree state builder

**Files:**
- Create: `packages/server/src/session-tree.ts`
- Test: `packages/server/src/__tests__/session-tree.test.ts`

**Step 1: Write the failing test**

```ts
// packages/server/src/__tests__/session-tree.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSessionTreeState } from "../session-tree.js";

const TMP = join(tmpdir(), "session-tree-test-" + Date.now());

function makeSession(id: string, parentSession?: string) {
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${id}.jsonl`);
  const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: TMP, ...(parentSession ? { parentSession } : {}) };
  const entry = { type: "message", id: "e1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "hello" } };
  writeFileSync(file, [header, entry].map(e => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("buildSessionTreeState", () => {
  it("returns state for a single session", () => {
    const file = makeSession("root-1");
    const state = buildSessionTreeState(file);
    expect(state).not.toBeNull();
    expect(state!.nodes).toHaveLength(1);
    expect(state!.nodes[0].id).toBe("ROOT");
  });

  it("returns null for missing file", () => {
    const state = buildSessionTreeState(join(TMP, "nonexistent.jsonl"));
    expect(state).toBeNull();
  });

  it("includes child fork session", () => {
    const root = makeSession("root-2");
    makeSession("child-2", root);
    const state = buildSessionTreeState(root);
    expect(state!.nodes).toHaveLength(2);
  });
});

// cleanup
rmSync(TMP, { recursive: true, force: true });
```

**Step 2: Run test to verify it fails**

```bash
cd ~/src/pi-agent-dashboard
npx vitest run packages/server/src/__tests__/session-tree.test.ts
```
Expected: FAIL — `session-tree.js` not found.

**Step 3: Implement `session-tree.ts`**

Port the pure functions from `pi-session-tree-browser/extensions/session-tree-browser.ts`. Keep only what's needed for state building — no HTTP, no SSE, no RPC.

```ts
// packages/server/src/session-tree.ts
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types (subset of tree browser's interface) ──────────────────────────────

export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface EntryView {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  role?: string;
  blocks: MessageBlock[];
}

export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolCall"; name: string; text: string }
  | { kind: "image"; text: string };

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  compactions: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  models: string[];
}

export interface SessionView {
  file: string;
  id: string;
  cwd: string;
  createdAt: string;
  modifiedAt: string;
  stats: SessionStats;
  entries: EntryView[];
}

export interface SessionNode {
  id: string;
  parentId: string | null;
  sessionFile: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  anchorEntryId?: string;
  firstChildEntryId?: string;
}

export interface SessionTreeState {
  currentNodeId: string;
  root: { sessionFile: string; sessionDir: string };
  nodes: SessionNode[];
  sessions: Record<string, SessionView>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function getNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function numberValue(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function parseSessionFile(
  filePath: string,
): { header: SessionHeader; entries: SessionEntry[] } | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const lines = fs.readFileSync(filePath, "utf-8")
      .split("\n")
      .filter(l => l.trim().length > 0);
    if (lines.length === 0) return undefined;
    const first = JSON.parse(lines[0]) as SessionHeader;
    if (first.type !== "session" || typeof first.id !== "string") return undefined;
    const entries: SessionEntry[] = [];
    for (const line of lines.slice(1)) {
      try { entries.push(JSON.parse(line) as SessionEntry); } catch { /* skip */ }
    }
    return { header: first, entries };
  } catch {
    return undefined;
  }
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function messageBlocks(message: unknown): { role?: string; blocks: MessageBlock[] } {
  const obj = getObject(message);
  const role = getString(obj?.role);
  const content = obj?.content;
  if (typeof content === "string") return { role, blocks: [{ kind: "text", text: content }] };
  if (!Array.isArray(content)) return { role, blocks: [] };
  const blocks: MessageBlock[] = [];
  for (const item of content) {
    const b = getObject(item);
    const type = getString(b?.type);
    if (type === "text") blocks.push({ kind: "text", text: getString(b?.text) ?? "" });
    else if (type === "thinking") blocks.push({ kind: "thinking", text: getString(b?.thinking) ?? "" });
    else if (type === "toolCall") blocks.push({ kind: "toolCall", name: getString(b?.name) ?? "tool", text: safeJson(b?.arguments ?? {}) });
    else if (type === "image") blocks.push({ kind: "image", text: `[image: ${getString(b?.mimeType) ?? "unknown"}]` });
  }
  return { role, blocks };
}

function entryView(entry: SessionEntry): EntryView | undefined {
  if (entry.type === "message") {
    const m = messageBlocks(entry.message);
    return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: m.role, blocks: m.blocks };
  }
  if (entry.type === "compaction") {
    return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: "system", blocks: [{ kind: "text", text: `Compaction: ${entry.summary}` }] };
  }
  return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: "system", blocks: [] };
}

function computeStats(entries: SessionEntry[]): SessionStats {
  const stats: SessionStats = {
    userMessages: 0, assistantMessages: 0, toolResults: 0, compactions: 0, toolCalls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: [],
  };
  const models = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "compaction") { stats.compactions++; continue; }
    if (entry.type !== "message") continue;
    const msg = getObject(entry.message);
    const role = getString(msg?.role);
    if (role === "user") stats.userMessages++;
    else if (role === "assistant") {
      stats.assistantMessages++;
      const provider = getString(msg?.provider);
      const model = getString(msg?.model);
      if (provider && model) models.add(`${provider}/${model}`);
      else if (model) models.add(model);
      const content = Array.isArray(msg?.content) ? msg!.content : [];
      for (const b of content) {
        if (getString(getObject(b)?.type) === "toolCall") stats.toolCalls++;
      }
      const usage = getObject(msg?.usage);
      stats.tokens.input += numberValue(usage?.input);
      stats.tokens.output += numberValue(usage?.output);
      stats.tokens.cacheRead += numberValue(usage?.cacheRead);
      stats.tokens.cacheWrite += numberValue(usage?.cacheWrite);
      const cost = getObject((usage as any)?.cost);
      stats.cost.input += numberValue(cost?.input);
      stats.cost.output += numberValue(cost?.output);
      stats.cost.cacheRead += numberValue(cost?.cacheRead);
      stats.cost.cacheWrite += numberValue(cost?.cacheWrite);
    } else if (role === "toolResult") stats.toolResults++;
  }
  stats.models = [...models];
  return stats;
}

function latestSessionName(entries: SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "session_info") return getString((e as any).name)?.trim() || undefined;
  }
  return undefined;
}

function loadSessionView(filePath: string): { header: SessionHeader; entries: SessionEntry[]; view: SessionView } | undefined {
  const parsed = parseSessionFile(filePath);
  if (!parsed) return undefined;
  const { header, entries } = parsed;
  const modifiedAt = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtime.toISOString()
    : header.timestamp;
  return {
    header,
    entries,
    view: {
      file: filePath,
      id: header.id,
      cwd: header.cwd,
      createdAt: header.timestamp,
      modifiedAt,
      stats: computeStats(entries),
      entries: entries.map(entryView).filter((e): e is EntryView => e !== undefined),
    },
  };
}

function sessionJsonlFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter(n => n.endsWith(".jsonl"))
      .map(n => path.resolve(path.join(dir, n)));
  } catch { return []; }
}

function findRootSession(filePath: string): string {
  let current = path.resolve(filePath);
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const parsed = parseSessionFile(current);
    const parent = parsed?.header.parentSession ? path.resolve(parsed.header.parentSession) : undefined;
    if (!parent || !fs.existsSync(parent)) return current;
    current = parent;
  }
  return current;
}

function sharedBranchAnchor(
  parent: SessionView,
  child: SessionView,
): { anchorEntryId?: string; firstChildEntryId?: string } {
  const parentIds = new Set(parent.entries.map(e => e.id));
  let anchorEntryId: string | undefined;
  let firstChildEntryId: string | undefined;
  for (const entry of child.entries) {
    if (parentIds.has(entry.id)) anchorEntryId = entry.id;
    else if (!firstChildEntryId) firstChildEntryId = entry.id;
  }
  return { anchorEntryId, firstChildEntryId };
}

function nodeIdForIndex(i: number): string {
  return i === 0 ? "ROOT" : `S${String(i).padStart(4, "0")}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full session tree state for a given session file.
 * Returns null if the session file cannot be read.
 */
export function buildSessionTreeState(sessionFile: string): SessionTreeState | null {
  const requestedFile = path.resolve(sessionFile);
  const rootFile = findRootSession(requestedFile);
  const sessionDir = path.dirname(rootFile);

  const loadedByFile = new Map<string, ReturnType<typeof loadSessionView> & {}>();
  const root = loadSessionView(rootFile);
  if (!root) return null;
  loadedByFile.set(root.view.file, root);

  let added = true;
  while (added) {
    added = false;
    for (const file of sessionJsonlFiles(sessionDir)) {
      if (loadedByFile.has(file)) continue;
      const loaded = loadSessionView(file);
      const parent = loaded?.header.parentSession ? path.resolve(loaded.header.parentSession) : undefined;
      if (loaded && parent && loadedByFile.has(parent)) {
        loadedByFile.set(file, loaded);
        added = true;
      }
    }
  }

  const ordered = [...loadedByFile.values()].sort((a, b) => {
    if (a.view.file === rootFile) return -1;
    if (b.view.file === rootFile) return 1;
    return Date.parse(a.header.timestamp) - Date.parse(b.header.timestamp) || a.view.file.localeCompare(b.view.file);
  });

  const nodeIdByFile = new Map<string, string>();
  ordered.forEach((loaded, i) => nodeIdByFile.set(loaded.view.file, nodeIdForIndex(i)));

  const nodes: SessionNode[] = [];
  const sessions: Record<string, SessionView> = {};

  for (const loaded of ordered) {
    const nodeId = nodeIdByFile.get(loaded.view.file)!;
    const parentFile = loaded.header.parentSession ? path.resolve(loaded.header.parentSession) : undefined;
    const naturalParentId = parentFile ? (nodeIdByFile.get(parentFile) ?? null) : null;
    const parentView = parentFile ? loadedByFile.get(parentFile)?.view : undefined;
    const anchor = parentView ? sharedBranchAnchor(parentView, loaded.view) : {};

    nodes.push({
      id: nodeId,
      parentId: naturalParentId,
      sessionFile: loaded.view.file,
      title: latestSessionName(loaded.entries) || loaded.header.id,
      createdAt: loaded.header.timestamp,
      updatedAt: loaded.view.modifiedAt,
      anchorEntryId: anchor.anchorEntryId,
      firstChildEntryId: anchor.firstChildEntryId,
    });
    sessions[loaded.view.file] = loaded.view;
  }

  return {
    currentNodeId: nodeIdByFile.get(requestedFile) ?? "ROOT",
    root: { sessionFile: rootFile, sessionDir },
    nodes,
    sessions,
  };
}
```

**Step 4: Run tests**

```bash
cd ~/src/pi-agent-dashboard
npx vitest run packages/server/src/__tests__/session-tree.test.ts
```
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/server/src/session-tree.ts packages/server/src/__tests__/session-tree.test.ts
git commit -m "feat(server): add session-tree state builder"
```

---

## Task 2: Server — session-tree routes

**Files:**
- Create: `packages/server/src/routes/session-tree-routes.ts`
- Modify: `packages/server/src/server.ts` (3 lines)

**Step 1: Create the routes file**

```ts
// packages/server/src/routes/session-tree-routes.ts
import type { FastifyInstance } from "fastify";
import { watch } from "node:fs";
import type { NetworkGuard } from "./route-deps.js";
import { buildSessionTreeState } from "../session-tree.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function registerSessionTreeRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
) {
  const { networkGuard } = deps;

  // GET /api/session-tree?sessionFile=<absolute-path>
  fastify.get<{ Querystring: { sessionFile?: string } }>(
    "/api/session-tree",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile } = request.query;
      if (!sessionFile) {
        reply.code(400);
        return { success: false, error: "sessionFile required" } satisfies ApiResponse;
      }
      const state = buildSessionTreeState(sessionFile);
      if (!state) {
        reply.code(404);
        return { success: false, error: "Session file not found or unreadable." } satisfies ApiResponse;
      }
      return { success: true, data: state } satisfies ApiResponse;
    },
  );

  // GET /api/session-tree/events?sessionFile=<absolute-path>
  // SSE stream — sends updated state whenever the session directory changes.
  fastify.get<{ Querystring: { sessionFile?: string } }>(
    "/api/session-tree/events",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile } = request.query;
      if (!sessionFile) {
        reply.code(400).send("sessionFile required");
        return;
      }

      const state = buildSessionTreeState(sessionFile);
      if (!state) {
        reply.code(404).send("Session not found.");
        return;
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders?.();

      let lastPayload = "";

      const sendState = () => {
        try {
          const current = buildSessionTreeState(sessionFile);
          if (!current) return;
          const payload = JSON.stringify(current);
          if (payload === lastPayload) return;
          lastPayload = payload;
          reply.raw.write(`event: state\ndata: ${payload}\n\n`);
        } catch { /* ignore */ }
      };

      sendState();

      // Watch the session directory for JSONL changes
      let watcher: ReturnType<typeof watch> | undefined;
      let pending: NodeJS.Timeout | undefined;

      try {
        watcher = watch(state.root.sessionDir, { persistent: false }, () => {
          if (pending) return;
          pending = setTimeout(() => {
            pending = undefined;
            sendState();
          }, 120);
        });
      } catch { /* directory may not be watchable */ }

      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
      }, 25_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        watcher?.close();
      });
    },
  );
}
```

**Step 2: Register routes in server.ts**

Find the block where other routes are registered (around line 57–90) and add:

```ts
// Add import at top with other route imports:
import { registerSessionTreeRoutes } from "./routes/session-tree-routes.js";

// Add registration near registerSessionRoutes call:
registerSessionTreeRoutes(fastify, { networkGuard });
```

**Step 3: Verify server starts**

```bash
cd ~/src/pi-agent-dashboard
npx tsx packages/server/src/cli.ts --help 2>&1 | head -5
```
Expected: no import errors.

**Step 4: Commit**

```bash
git add packages/server/src/routes/session-tree-routes.ts packages/server/src/server.ts
git commit -m "feat(server): add session-tree SSE + state routes"
```

---

## Task 3: Client — `useSessionTreePane` hook

**Files:**
- Create: `packages/client/src/hooks/useSessionTreePane.ts`

**Step 1: Write the hook** (mirrors `useSidebarState` exactly, different keys)

```ts
// packages/client/src/hooks/useSessionTreePane.ts
import { useState, useCallback } from "react";

const WIDTH_KEY = "dashboard:session-tree-pane-width";
const OPEN_KEY = "dashboard:session-tree-pane-open";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 260;
const MAX_WIDTH = 640;

function clamp(v: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch { return fallback; }
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
    const clamped = clamp(w);
    setWidthRaw(clamped);
    try { localStorage.setItem(WIDTH_KEY, String(clamped)); } catch { /* noop */ }
  }, []);

  return { open, width, toggle, setWidth };
}

export { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH };
```

**Step 2: Commit**

```bash
git add packages/client/src/hooks/useSessionTreePane.ts
git commit -m "feat(client): add useSessionTreePane hook"
```

---

## Task 4: Client — `useSessionTree` data hook

**Files:**
- Create: `packages/client/src/hooks/useSessionTree.ts`

**Step 1: Write the hook**

```ts
// packages/client/src/hooks/useSessionTree.ts
import { useState, useEffect, useRef } from "react";
import type { SessionTreeState } from "@blackbelt-technology/pi-dashboard-server/session-tree.js";

// Re-export types the components need
export type { SessionTreeState };
export type { SessionNode, SessionView, EntryView, MessageBlock, SessionStats } from
  "@blackbelt-technology/pi-dashboard-server/session-tree.js";

interface UseSessionTreeResult {
  state: SessionTreeState | null;
  loading: boolean;
  error: string | null;
}

export function useSessionTree(sessionFile: string | undefined): UseSessionTreeResult {
  const [state, setState] = useState<SessionTreeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionFile) {
      setState(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Initial load
    fetch(`/api/session-tree?sessionFile=${encodeURIComponent(sessionFile)}`)
      .then(r => r.json())
      .then(payload => {
        if (payload.success) setState(payload.data);
        else setError(payload.error ?? "Failed to load session tree.");
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));

    // SSE for live updates
    const es = new EventSource(
      `/api/session-tree/events?sessionFile=${encodeURIComponent(sessionFile)}`
    );
    esRef.current = es;

    es.addEventListener("state", (e: MessageEvent) => {
      try { setState(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.onerror = () => {
      // Connection lost — stop trying; state stays at last known good
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionFile]);

  return { state, loading, error };
}
```

**Step 2: Export types from shared package**

Check if `@blackbelt-technology/pi-dashboard-server` exports from `session-tree.ts`. If not, add to `packages/server/src/index.ts` or use a direct relative path in the hook.

> **Note:** If the server package doesn't export `session-tree.ts` types, copy the type definitions directly into the hook file rather than importing from the server package. Keep types DRY by putting them in `packages/client/src/components/session-tree/types.ts`.

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useSessionTree.ts
git commit -m "feat(client): add useSessionTree SSE hook"
```

---

## Task 5: Client — `SessionTreePane` component

**Files:**
- Create: `packages/client/src/components/session-tree/SessionTreePane.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeSidebar.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeMessages.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeHeader.tsx`

**Step 1: Write `SessionTreePane.tsx`** — outer shell, mirrors `ResizableSidebar` but right-side

```tsx
// packages/client/src/components/session-tree/SessionTreePane.tsx
import React, { useRef, useCallback, useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronLeft, mdiChevronRight, mdiSourceBranch } from "@mdi/js";
import type { SessionTreePaneState } from "../../hooks/useSessionTreePane.js";
import { useSessionTree } from "../../hooks/useSessionTree.js";
import { SessionTreeSidebar } from "./SessionTreeSidebar.js";
import { SessionTreeMessages } from "./SessionTreeMessages.js";
import { SessionTreeHeader } from "./SessionTreeHeader.js";

const COLLAPSED_WIDTH = 28;

interface Props {
  sessionFile: string;
  pane: SessionTreePaneState;
}

export function SessionTreePane({ sessionFile, pane }: Props) {
  const { open, width, toggle, setWidth } = pane;
  const { state, loading, error } = useSessionTree(open ? sessionFile : undefined);
  const dragging = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("ROOT");
  const [activeEntryId, setActiveEntryId] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const [showTools, setShowTools] = useState(true);

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
      paneRef.current.style.width = `${Math.max(260, Math.min(640, newWidth))}px`;
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

  // Reset selection when session changes
  useEffect(() => {
    if (state) {
      setSelectedNodeId(state.currentNodeId ?? "ROOT");
      setActiveEntryId("");
    }
  }, [sessionFile]);

  // Collapsed strip
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
        >
          <Icon path={mdiChevronLeft} size={0.55} />
        </button>
        {/* Rotated label */}
        <span
          className="text-[9px] text-[var(--text-tertiary)] tracking-widest uppercase select-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Tree
        </span>
      </div>
    );
  }

  const selectedNode = state?.nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedSession = selectedNode ? state?.sessions[selectedNode.sessionFile] : null;

  return (
    <div
      ref={paneRef}
      className="flex flex-shrink-0 relative border-l border-[var(--border-primary)] bg-[var(--bg-primary)]"
      style={{ width }}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 flex-shrink-0"
      />

      {/* Collapse button — floats on left edge */}
      <button
        onClick={toggle}
        onMouseDown={e => e.stopPropagation()}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-5 h-8 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] shadow-md transition-colors cursor-pointer"
        title="Collapse session tree"
      >
        <Icon path={mdiChevronRight} size={0.55} />
      </button>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {loading && !state && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-xs">
            Loading tree…
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center text-red-400 text-xs p-4 text-center">
            {error}
          </div>
        )}
        {state && (
          <>
            <SessionTreeHeader
              session={selectedSession}
              showThinking={showThinking}
              showTools={showTools}
              onToggleThinking={() => setShowThinking(v => !v)}
              onToggleTools={() => setShowTools(v => !v)}
            />
            <div className="flex-1 flex min-h-0">
              {/* Sidebar tree — ~35% width */}
              <div className="w-2/5 flex-shrink-0 border-r border-[var(--border-primary)] overflow-y-auto">
                <SessionTreeSidebar
                  state={state}
                  selectedNodeId={selectedNodeId}
                  activeEntryId={activeEntryId}
                  onSelect={(nodeId, entryId) => {
                    setSelectedNodeId(nodeId);
                    setActiveEntryId(entryId);
                  }}
                />
              </div>
              {/* Transcript — remaining width */}
              <div className="flex-1 overflow-y-auto">
                <SessionTreeMessages
                  session={selectedSession}
                  activeEntryId={activeEntryId}
                  showThinking={showThinking}
                  showTools={showTools}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Write `SessionTreeSidebar.tsx`** — tree nav, role-colored rows

```tsx
// packages/client/src/components/session-tree/SessionTreeSidebar.tsx
import React from "react";
import type { SessionTreeState, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  state: SessionTreeState;
  selectedNodeId: string;
  activeEntryId: string;
  onSelect: (nodeId: string, entryId: string) => void;
}

function entryText(entry: EntryView): string {
  return (entry.blocks ?? [])
    .map(b => b.text ?? "")
    .join(" ")
    .replace(/[\n\t]/g, " ")
    .trim();
}

function entryRoleColor(role: string | undefined): string {
  if (role === "user") return "text-teal-400";
  if (role === "assistant") return "text-green-400";
  if (role === "system") return "text-[var(--text-tertiary)]";
  return "text-purple-400";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

export function SessionTreeSidebar({ state, selectedNodeId, activeEntryId, onSelect }: Props) {
  const rows: Array<{ nodeId: string; entryId: string; entry: EntryView; depth: number; isForkLabel?: boolean; forkTitle?: string }> = [];

  function collectRows(nodeId: string, depth: number) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const session = state.sessions[node.sessionFile];
    if (!session) return;

    if (nodeId !== "ROOT") {
      rows.push({ nodeId, entryId: "", entry: { id: "", parentId: null, timestamp: "", type: "forkLabel", blocks: [] }, depth, isForkLabel: true, forkTitle: node.title });
    }

    const startIndex = nodeId === "ROOT" ? 0 : (() => {
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

    const children = state.nodes.filter(n => n.parentId === nodeId);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      rows.push({ nodeId, entryId: entry.id, entry, depth });
      // Insert child forks anchored to this entry
      for (const child of children) {
        if (child.anchorEntryId === entry.id || child.firstChildEntryId === entry.id) {
          collectRows(child.id, depth + 1);
        }
      }
    }

    // Children not anchored to any entry
    for (const child of children) {
      if (!child.anchorEntryId && !child.firstChildEntryId) {
        collectRows(child.id, depth + 1);
      }
    }
  }

  collectRows("ROOT", 0);

  return (
    <div className="py-1">
      {rows.map((row, i) => {
        if (row.isForkLabel) {
          const active = row.nodeId === selectedNodeId && !activeEntryId;
          return (
            <button
              key={`fork-${row.nodeId}`}
              onClick={() => onSelect(row.nodeId, "")}
              className={`w-full text-left px-2 py-0.5 flex items-baseline gap-1 text-[11px] hover:bg-[var(--bg-hover)] ${active ? "bg-[var(--bg-tertiary)]" : ""}`}
            >
              <span className="text-[var(--text-tertiary)] whitespace-pre flex-shrink-0" style={{ paddingLeft: row.depth * 12 }}>{"↳ "}</span>
              <span className="text-purple-400 truncate">{row.forkTitle || "fork"}</span>
            </button>
          );
        }

        const active = row.nodeId === selectedNodeId && row.entryId === activeEntryId;
        const role = row.entry.role ?? row.entry.type;
        const text = entryText(row.entry);
        const label = (role ? role + ": " : "") + (truncate(text, 46) || "…");

        return (
          <button
            key={`${row.nodeId}-${row.entryId}`}
            onClick={() => onSelect(row.nodeId, row.entryId)}
            className={`w-full text-left px-2 py-0.5 flex items-baseline gap-1 text-[11px] leading-4 hover:bg-[var(--bg-hover)] ${active ? "bg-[var(--bg-tertiary)] font-medium" : ""}`}
          >
            <span className="text-[var(--text-tertiary)] whitespace-pre flex-shrink-0" style={{ paddingLeft: row.depth * 12 }}>{active ? "* " : "  "}</span>
            <span className={`${entryRoleColor(role)} flex-shrink-0`}>{role}:</span>
            <span className="text-[var(--text-secondary)] truncate">{truncate(text, 46)}</span>
          </button>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">No messages</div>
      )}
    </div>
  );
}
```

**Step 3: Write `SessionTreeMessages.tsx`** — transcript viewer

```tsx
// packages/client/src/components/session-tree/SessionTreeMessages.tsx
import React, { useEffect, useRef } from "react";
import type { SessionView, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionView | null | undefined;
  activeEntryId: string;
  showThinking: boolean;
  showTools: boolean;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EntryBlock({ entry, showThinking, showTools, active }: { entry: EntryView; showThinking: boolean; showTools: boolean; active: boolean }) {
  const role = entry.role ?? entry.type;
  const ts = fmtTime(entry.timestamp);

  const blocks = (entry.blocks ?? []).filter(b => {
    if (b.kind === "thinking") return showThinking;
    if (b.kind === "toolCall") return showTools;
    return true;
  });

  if (blocks.length === 0) return null;

  if (role === "user") {
    return (
      <div
        id={`tree-entry-${entry.id}`}
        className={`mx-3 my-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 text-[12px] text-[var(--text-primary)] ${active ? "ring-1 ring-teal-400" : ""}`}
      >
        {ts && <div className="text-[10px] text-[var(--text-tertiary)] mb-1">{ts}</div>}
        {blocks.map((b, i) => <div key={i} className="whitespace-pre-wrap break-words">{b.text}</div>)}
      </div>
    );
  }

  if (role === "assistant") {
    return (
      <div
        id={`tree-entry-${entry.id}`}
        className={`mx-3 my-2 text-[12px] text-[var(--text-primary)] ${active ? "ring-1 ring-green-400 rounded-lg px-2 py-1" : ""}`}
      >
        {ts && <div className="text-[10px] text-[var(--text-tertiary)] mb-1 px-1">{ts}</div>}
        {blocks.map((b, i) => {
          if (b.kind === "thinking") return (
            <div key={i} className="px-2 py-1 text-[var(--text-tertiary)] italic text-[11px] whitespace-pre-wrap">{b.text}</div>
          );
          if (b.kind === "toolCall") return (
            <div key={i} className="px-2 py-1 my-1 rounded bg-[var(--bg-tertiary)] text-[11px]">
              <span className="text-yellow-400 font-medium">{b.name}</span>
              <pre className="mt-1 text-[var(--text-tertiary)] whitespace-pre-wrap break-all text-[10px]">{b.text}</pre>
            </div>
          );
          return <div key={i} className="px-1 whitespace-pre-wrap break-words">{b.text}</div>;
        })}
      </div>
    );
  }

  return (
    <div
      id={`tree-entry-${entry.id}`}
      className="mx-3 my-1 px-2 py-1 text-[11px] text-[var(--text-tertiary)] border-l-2 border-[var(--border-secondary)]"
    >
      <span className="text-purple-400 mr-1">[{role}]</span>
      {blocks.map((b, i) => <span key={i}>{b.text}</span>)}
    </div>
  );
}

export function SessionTreeMessages({ session, activeEntryId, showThinking, showTools }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeEntryId) return;
    const el = document.getElementById(`tree-entry-${activeEntryId}`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeEntryId]);

  if (!session) {
    return <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-xs p-4">Select a session</div>;
  }

  const visible = session.entries.filter(e => {
    if (e.role === "toolResult") return false;
    if (e.role === "assistant" && !(e.blocks ?? []).some(b => b.kind !== "toolCall" && String(b.text ?? "").trim())) return false;
    return (e.blocks ?? []).length > 0;
  });

  return (
    <div ref={scrollRef} className="p-2 space-y-1">
      {visible.length === 0 && (
        <div className="text-center text-[var(--text-tertiary)] text-xs pt-8">No messages</div>
      )}
      {visible.map(entry => (
        <EntryBlock
          key={entry.id}
          entry={entry}
          showThinking={showThinking}
          showTools={showTools}
          active={entry.id === activeEntryId}
        />
      ))}
    </div>
  );
}
```

**Step 4: Write `SessionTreeHeader.tsx`** — compact stats + toggles

```tsx
// packages/client/src/components/session-tree/SessionTreeHeader.tsx
import React from "react";
import { Icon } from "@mdi/react";
import { mdiEye, mdiEyeOff, mdiWrench } from "@mdi/js";
import type { SessionView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionView | null | undefined;
  showThinking: boolean;
  showTools: boolean;
  onToggleThinking: () => void;
  onToggleTools: () => void;
}

function fmt(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function SessionTreeHeader({ session, showThinking, showTools, onToggleThinking, onToggleTools }: Props) {
  const stats = session?.stats;
  const cost = stats ? stats.cost.input + stats.cost.output + stats.cost.cacheRead + stats.cost.cacheWrite : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)] flex-shrink-0 flex-wrap">
      {stats && (
        <>
          <span title="User messages">{stats.userMessages}u</span>
          <span title="Assistant messages">{stats.assistantMessages}a</span>
          <span title="Tool calls">{stats.toolCalls}t</span>
          <span title="Tokens in">↑{fmt(stats.tokens.input)}</span>
          <span title="Tokens out">↓{fmt(stats.tokens.output)}</span>
          {cost > 0 && <span title="Cost">${cost.toFixed(2)}</span>}
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={onToggleThinking}
        title={showThinking ? "Hide thinking" : "Show thinking"}
        className={`p-0.5 rounded transition-colors ${showThinking ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)] opacity-50"}`}
      >
        <Icon path={mdiEye} size={0.55} />
      </button>
      <button
        onClick={onToggleTools}
        title={showTools ? "Hide tools" : "Show tools"}
        className={`p-0.5 rounded transition-colors ${showTools ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)] opacity-50"}`}
      >
        <Icon path={mdiWrench} size={0.55} />
      </button>
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add packages/client/src/components/session-tree/
git commit -m "feat(client): add SessionTreePane, Sidebar, Messages, Header components"
```

---

## Task 6: Wire into App.tsx + SessionHeader toggle

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/SessionHeader.tsx`

**Step 1: Add toggle button to `SessionHeader`**

Find the desktop toolbar buttons (near `onOpenDiffView`, line ~464) and add:

```tsx
// Add to SessionHeader props interface:
onToggleSessionTree?: () => void;
sessionTreeOpen?: boolean;

// Add to desktop toolbar (near hasFileChanges button):
{onToggleSessionTree && (
  <button
    onClick={onToggleSessionTree}
    title={sessionTreeOpen ? "Hide session tree" : "Show session tree"}
    className={`p-1.5 rounded transition-colors ${sessionTreeOpen ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
  >
    <Icon path={mdiSourceBranch} size={0.65} />
  </button>
)}
```

Add `mdiSourceBranch` to the existing `@mdi/react` import at the top of `SessionHeader.tsx`.

**Step 2: Wire up `App.tsx`**

```tsx
// Add near other hook imports (top of App component):
import { useSessionTreePane } from "./hooks/useSessionTreePane.js";
import { SessionTreePane } from "./components/session-tree/SessionTreePane.js";

// Add near useSidebarState():
const sessionTreePane = useSessionTreePane();

// In sessionDetail, wrap the existing flex-col div + ChatView block:
// BEFORE:
<div className="flex-1 flex flex-col min-w-0 h-full">
  {connectionBanner}
  <SessionHeader ... />
  ...ChatView...
  <SessionBanner ... />
  <StatusBar ... />
</div>

// AFTER:
<div className="flex-1 flex flex-col min-w-0 h-full">
  {connectionBanner}
  <SessionHeader
    ...existing props...
    onToggleSessionTree={sessionTreePane.toggle}
    sessionTreeOpen={sessionTreePane.open}
  />
  <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      ...existing ChatView block (ContentHeaderStickySlot, ErrorBoundary, ChatView, SessionBanner, StatusBar)...
    </div>
    {selectedSession?.sessionFile && (
      <SessionTreePane
        sessionFile={selectedSession.sessionFile}
        pane={sessionTreePane}
      />
    )}
  </div>
</div>
```

**Step 3: Build and verify**

```bash
cd ~/src/pi-agent-dashboard
npm run build 2>&1 | tail -20
```
Expected: clean build, no TypeScript errors.

**Step 4: Smoke test in browser**

- Open `http://localhost:8001/session/<any-session-id>`
- Verify a `⎇` button appears in the session header toolbar
- Click it — right pane slides in with tree sidebar + transcript
- Click `⟩` to collapse — 28px strip with rotated "Tree" label remains
- Drag the left edge of the pane to resize
- Reload — pane open/width state is preserved from localStorage

**Step 5: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/components/SessionHeader.tsx
git commit -m "feat(client): wire SessionTreePane into session detail layout"
```

---

## Task 7: Polish + edge cases

**Files:**
- Modify: `packages/client/src/components/session-tree/SessionTreePane.tsx`
- Modify: `packages/client/src/components/session-tree/SessionTreeMessages.tsx`

**Step 1: Handle missing sessionFile gracefully**

If `selectedSession?.sessionFile` is undefined (session not yet persisted), hide the toggle button rather than rendering a broken pane:

```tsx
// In App.tsx SessionHeader call:
onToggleSessionTree={selectedSession?.sessionFile ? sessionTreePane.toggle : undefined}
```

**Step 2: Mobile — hide pane on small screens**

Wrap `SessionTreePane` in a hidden-on-mobile guard:

```tsx
{selectedSession?.sessionFile && (
  <div className="hidden md:flex">
    <SessionTreePane sessionFile={selectedSession.sessionFile} pane={sessionTreePane} />
  </div>
)}
```

**Step 3: Commit**

```bash
git add packages/client/src/components/session-tree/ packages/client/src/App.tsx
git commit -m "fix(client): hide session tree pane on mobile, guard missing sessionFile"
```

---

## Summary

| Task | What ships |
|------|-----------|
| 1 | `session-tree.ts` — pure state builder, tested |
| 2 | `/api/session-tree` + `/api/session-tree/events` routes |
| 3 | `useSessionTreePane` hook — localStorage-backed open/width |
| 4 | `useSessionTree` hook — fetch + SSE live updates |
| 5 | `SessionTreePane`, `SessionTreeSidebar`, `SessionTreeMessages`, `SessionTreeHeader` |
| 6 | Wired into `App.tsx` + toggle button in `SessionHeader` |
| 7 | Mobile guard, missing sessionFile edge case |
