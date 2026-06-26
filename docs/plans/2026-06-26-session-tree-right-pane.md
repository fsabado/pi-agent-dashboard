# Session Tree Right Pane — Implementation Plan

> **For Claude:** Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Add a collapsible right-side session tree pane to the dashboard's session detail view — fork tree navigation, transcript viewer, fork/truncate/delete branch, and composer — as a native React component backed by new Fastify routes.

**Architecture:** Shared types in `packages/shared`, pure state-building logic in `packages/server/src/session-tree.ts`, REST+SSE routes at `/api/session-tree/*`, native React components in `packages/client/src/components/session-tree/`. Composer reuses the existing WebSocket `send_prompt` path. Fork reuses the existing `handleResumeSession` path.

**Tech Stack:** TypeScript, React, Tailwind CSS, Fastify, Node.js `fs` + `fs.watch`, SSE (EventSource), `@mdi/react` icons, `localStorage`.

---

## Task 1: Shared types

**Files:**
- Create: `packages/shared/src/session-tree-types.ts`

**Step 1: Write the types file**

```ts
// packages/shared/src/session-tree-types.ts

export interface SessionTreeHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionTreeEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolCall"; name: string; text: string }
  | { kind: "image"; text: string };

export interface EntryView {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  role?: string;
  blocks: MessageBlock[];
}

export interface SessionTreeStats {
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  compactions: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  models: string[];
}

export interface SessionTreeView {
  file: string;
  id: string;
  cwd: string;
  createdAt: string;
  modifiedAt: string;
  stats: SessionTreeStats;
  entries: EntryView[];
}

export interface SessionTreeNode {
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
  nodes: SessionTreeNode[];
  sessions: Record<string, SessionTreeView>;
}

export interface ForkResult {
  sessionFile: string;
}

export interface TruncateResult {
  sessionFile: string;
  deletedEntryCount: number;
  deletedSessionFiles: string[];
}

export interface DeleteBranchResult {
  sessionFile: string;
  deletedSessionFiles: string[];
}
```

**Step 2: Verify it compiles**

```bash
cd ~/src/pi-agent-dashboard
npx tsc -p packages/shared/tsconfig.json --noEmit 2>&1 | head -20
```
Expected: no errors.

**Step 3: Commit**

```bash
cd ~/src/pi-agent-dashboard
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/shared/src/session-tree-types.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(shared): add session-tree-types"
```

---

## Task 2: Server — session-tree state builder

**Files:**
- Create: `packages/server/src/session-tree.ts`
- Create: `packages/server/src/__tests__/session-tree.test.ts`

**Step 1: Write the failing test**

```ts
// packages/server/src/__tests__/session-tree.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSessionTreeState, parseSessionFile } from "../session-tree.js";

const TMP = join(tmpdir(), `session-tree-test-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

function makeSession(id: string, parentSession?: string): string {
  const file = join(TMP, `${id}.jsonl`);
  const header = {
    type: "session", version: 3, id, cwd: TMP,
    timestamp: new Date().toISOString(),
    ...(parentSession ? { parentSession } : {}),
  };
  const entry = {
    type: "message", id: "e1", parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "hello" },
  };
  writeFileSync(file, [header, entry].map(e => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("parseSessionFile", () => {
  it("parses a valid session file", () => {
    const file = makeSession("parse-1");
    const result = parseSessionFile(file);
    expect(result).not.toBeNull();
    expect(result!.header.id).toBe("parse-1");
    expect(result!.entries).toHaveLength(1);
  });

  it("returns undefined for missing file", () => {
    expect(parseSessionFile(join(TMP, "nope.jsonl"))).toBeUndefined();
  });
});

describe("buildSessionTreeState", () => {
  it("returns state for a single session", () => {
    const file = makeSession("root-1");
    const state = buildSessionTreeState(file);
    expect(state).not.toBeNull();
    expect(state!.nodes).toHaveLength(1);
    expect(state!.nodes[0].id).toBe("ROOT");
    expect(state!.nodes[0].sessionFile).toBe(file);
  });

  it("returns null for missing file", () => {
    expect(buildSessionTreeState(join(TMP, "ghost.jsonl"))).toBeNull();
  });

  it("includes child fork session", () => {
    const root = makeSession("root-2");
    makeSession("child-2", root);
    const state = buildSessionTreeState(root);
    expect(state!.nodes).toHaveLength(2);
    const ids = state!.nodes.map(n => n.id);
    expect(ids).toContain("ROOT");
    expect(ids).toContain("S0001");
  });
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));
```

**Step 2: Run to verify it fails**

```bash
cd ~/src/pi-agent-dashboard
npx vitest run packages/server/src/__tests__/session-tree.test.ts 2>&1 | tail -10
```
Expected: FAIL — `session-tree.js` not found.

**Step 3: Implement `session-tree.ts`**

```ts
// packages/server/src/session-tree.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SessionTreeHeader, SessionTreeEntry, SessionTreeView, SessionTreeNode,
  SessionTreeState, EntryView, MessageBlock, SessionTreeStats,
  ForkResult, TruncateResult, DeleteBranchResult,
} from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";
import { randomUUID } from "node:crypto";

export type {
  SessionTreeState, SessionTreeNode, SessionTreeView, EntryView,
  MessageBlock, SessionTreeStats, ForkResult, TruncateResult, DeleteBranchResult,
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function getString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function getObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>) : undefined;
}

function numberValue(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
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

function toEntryView(entry: SessionTreeEntry): EntryView | undefined {
  if (entry.type === "message") {
    const m = messageBlocks(entry.message);
    return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: m.role, blocks: m.blocks };
  }
  if (entry.type === "compaction") {
    return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: "system", blocks: [{ kind: "text", text: `Compaction: ${entry.summary ?? ""}` }] };
  }
  return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: "system", blocks: [] };
}

function computeStats(entries: SessionTreeEntry[]): SessionTreeStats {
  const stats: SessionTreeStats = {
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
    if (role === "user") { stats.userMessages++; }
    else if (role === "assistant") {
      stats.assistantMessages++;
      const provider = getString(msg?.provider);
      const model = getString(msg?.model);
      if (provider && model) models.add(`${provider}/${model}`);
      else if (model) models.add(model);
      const content = Array.isArray(msg?.content) ? msg!.content as unknown[] : [];
      for (const b of content) {
        if (getString(getObject(b)?.type) === "toolCall") stats.toolCalls++;
      }
      const usage = getObject(msg?.usage);
      stats.tokens.input += numberValue(usage?.input);
      stats.tokens.output += numberValue(usage?.output);
      stats.tokens.cacheRead += numberValue(usage?.cacheRead);
      stats.tokens.cacheWrite += numberValue(usage?.cacheWrite);
      const cost = getObject(getObject(msg?.usage)?.cost as unknown);
      stats.cost.input += numberValue(cost?.input);
      stats.cost.output += numberValue(cost?.output);
      stats.cost.cacheRead += numberValue(cost?.cacheRead);
      stats.cost.cacheWrite += numberValue(cost?.cacheWrite);
    } else if (role === "toolResult") { stats.toolResults++; }
  }
  stats.models = [...models];
  return stats;
}

function latestSessionName(entries: SessionTreeEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "session_info") return getString(e.name as unknown)?.trim() || undefined;
  }
  return undefined;
}

function sessionJsonlFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter(n => n.endsWith(".jsonl"))
      .map(n => path.resolve(path.join(dir, n)));
  } catch { return []; }
}

function sharedBranchAnchor(
  parent: SessionTreeView, child: SessionTreeView,
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

export function parseSessionFile(
  filePath: string,
): { header: SessionTreeHeader; entries: SessionTreeEntry[] } | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const lines = fs.readFileSync(filePath, "utf-8")
      .split("\n").filter(l => l.trim().length > 0);
    if (lines.length === 0) return undefined;
    const first = JSON.parse(lines[0]) as SessionTreeHeader;
    if (first.type !== "session" || typeof first.id !== "string") return undefined;
    const entries: SessionTreeEntry[] = [];
    for (const line of lines.slice(1)) {
      try { entries.push(JSON.parse(line) as SessionTreeEntry); } catch { /* skip malformed */ }
    }
    return { header: first, entries };
  } catch { return undefined; }
}

function loadView(filePath: string): { header: SessionTreeHeader; entries: SessionTreeEntry[]; view: SessionTreeView } | undefined {
  const parsed = parseSessionFile(filePath);
  if (!parsed) return undefined;
  const { header, entries } = parsed;
  const modifiedAt = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtime.toISOString() : header.timestamp;
  return {
    header, entries,
    view: {
      file: filePath, id: header.id, cwd: header.cwd,
      createdAt: header.timestamp, modifiedAt,
      stats: computeStats(entries),
      entries: entries.map(toEntryView).filter((e): e is EntryView => e !== undefined),
    },
  };
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

export function buildSessionTreeState(sessionFile: string): SessionTreeState | null {
  const requestedFile = path.resolve(sessionFile);
  const rootFile = findRootSession(requestedFile);
  const sessionDir = path.dirname(rootFile);

  type LoadedEntry = NonNullable<ReturnType<typeof loadView>>;
  const loadedByFile = new Map<string, LoadedEntry>();
  const root = loadView(rootFile);
  if (!root) return null;
  loadedByFile.set(root.view.file, root);

  let added = true;
  while (added) {
    added = false;
    for (const file of sessionJsonlFiles(sessionDir)) {
      if (loadedByFile.has(file)) continue;
      const loaded = loadView(file);
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
    return Date.parse(a.header.timestamp) - Date.parse(b.header.timestamp)
      || a.view.file.localeCompare(b.view.file);
  });

  const nodeIdByFile = new Map<string, string>();
  ordered.forEach((loaded, i) => nodeIdByFile.set(loaded.view.file, nodeIdForIndex(i)));

  const nodes: SessionTreeNode[] = [];
  const sessions: Record<string, SessionTreeView> = {};

  for (const loaded of ordered) {
    const nodeId = nodeIdByFile.get(loaded.view.file)!;
    const parentFile = loaded.header.parentSession ? path.resolve(loaded.header.parentSession) : undefined;
    const naturalParentId = parentFile ? (nodeIdByFile.get(parentFile) ?? null) : null;
    const parentView = parentFile ? loadedByFile.get(parentFile)?.view : undefined;
    const anchor = parentView ? sharedBranchAnchor(parentView, loaded.view) : {};
    nodes.push({
      id: nodeId, parentId: naturalParentId,
      sessionFile: loaded.view.file,
      title: latestSessionName(loaded.entries) || loaded.header.id,
      createdAt: loaded.header.timestamp, updatedAt: loaded.view.modifiedAt,
      anchorEntryId: anchor.anchorEntryId, firstChildEntryId: anchor.firstChildEntryId,
    });
    sessions[loaded.view.file] = loaded.view;
  }

  return {
    currentNodeId: nodeIdByFile.get(requestedFile) ?? "ROOT",
    root: { sessionFile: rootFile, sessionDir },
    nodes, sessions,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function forkSessionAfterEntry(
  sessionFile: string, entryId: string, name?: string,
): ForkResult {
  const normalizedFile = path.resolve(sessionFile);
  const parsed = parseSessionFile(normalizedFile);
  if (!parsed) throw new Error("Session file not found.");

  const { header, entries } = parsed;
  const byId = new Map(entries.filter(e => e.id).map(e => [e.id, e]));
  if (!byId.has(entryId)) throw new Error("Entry not found.");

  // Walk from entryId to root, building the branch
  const branch: SessionTreeEntry[] = [];
  let current = byId.get(entryId);
  while (current) {
    branch.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const newId = randomUUID();
  const timestamp = new Date().toISOString();
  const newFile = path.resolve(path.join(path.dirname(normalizedFile), `${timestamp.replace(/[:.]/g, "-")}_${newId}.jsonl`));
  const newHeader: SessionTreeHeader = {
    type: "session", version: header.version ?? 3, id: newId,
    timestamp, cwd: header.cwd, parentSession: normalizedFile,
  };

  const allIds = new Set(branch.map(e => e.id));
  const rewritten = branch.map((e, i) => ({ ...e, parentId: i === 0 ? null : branch[i - 1].id }));

  if (name?.trim()) {
    const infoId = randomUUID().slice(0, 8);
    rewritten.push({ type: "session_info", id: infoId, parentId: rewritten.at(-1)?.id ?? null, timestamp: new Date().toISOString(), name: name.trim() } as SessionTreeEntry);
  }

  const content = [newHeader, ...rewritten].map(e => JSON.stringify(e)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(newFile), { recursive: true });
  fs.writeFileSync(newFile, content, "utf-8");
  return { sessionFile: newFile };
}

export function truncateSessionAfterEntry(
  sessionFile: string, entryId: string,
): TruncateResult {
  const normalizedFile = path.resolve(sessionFile);
  const parsed = parseSessionFile(normalizedFile);
  if (!parsed) throw new Error("Session file not found.");

  const cutoffIndex = parsed.entries.findIndex(e => e.id === entryId);
  if (cutoffIndex < 0) throw new Error("Entry not found.");

  const state = buildSessionTreeState(normalizedFile);
  if (!state) throw new Error("Could not build state.");

  const selectedNode = state.nodes.find(n => n.sessionFile === normalizedFile);
  const selectedSession = state.sessions[normalizedFile];
  if (!selectedNode || !selectedSession) throw new Error("Session not in tree.");

  const cutoffViewIndex = selectedSession.entries.findIndex(e => e.id === entryId);
  const cutoffEntry = selectedSession.entries[cutoffViewIndex];

  // Collect child nodes that start at or after the cutoff
  const deleteNodeIds = new Set<string>();
  for (const child of state.nodes) {
    if (child.parentId !== selectedNode.id) continue;
    const anchorIds = [child.anchorEntryId, child.firstChildEntryId].filter(Boolean) as string[];
    let startsAfter = false;
    for (const anchorId of anchorIds) {
      const anchorIndex = selectedSession.entries.findIndex(e => e.id === anchorId);
      if (anchorIndex >= cutoffViewIndex) { startsAfter = true; break; }
    }
    if (!anchorIds.length) {
      const childCreated = Date.parse(child.createdAt);
      const cutoffTs = Date.parse(cutoffEntry.timestamp);
      startsAfter = Number.isFinite(childCreated) && Number.isFinite(cutoffTs) && childCreated >= cutoffTs;
    }
    if (startsAfter) deleteNodeIds.add(child.id);
  }
  // Propagate to all descendants
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of state.nodes) {
      if (deleteNodeIds.has(node.id) || !node.parentId || !deleteNodeIds.has(node.parentId)) continue;
      deleteNodeIds.add(node.id);
      changed = true;
    }
  }

  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  const deletedSessionFiles = [...deleteNodeIds]
    .map(id => nodesById.get(id)?.sessionFile)
    .filter((f): f is string => typeof f === "string");

  const keptEntries = parsed.entries.slice(0, cutoffIndex + 1);
  const deletedEntryCount = parsed.entries.length - keptEntries.length;

  if (deletedEntryCount > 0 || deletedSessionFiles.length > 0) {
    const content = [parsed.header, ...keptEntries].map(e => JSON.stringify(e)).join("\n") + "\n";
    const tmp = `${normalizedFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, normalizedFile);
    for (const f of deletedSessionFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  return { sessionFile: normalizedFile, deletedEntryCount, deletedSessionFiles };
}

export function deleteBranch(rootSessionFile: string, nodeId: string): DeleteBranchResult {
  if (nodeId === "ROOT") throw new Error("Root branch cannot be deleted.");
  const state = buildSessionTreeState(path.resolve(rootSessionFile));
  if (!state) throw new Error("Session file not found.");

  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  if (!nodesById.has(nodeId)) throw new Error("Branch not found.");

  const deleteNodeIds = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of state.nodes) {
      if (deleteNodeIds.has(node.id) || !node.parentId || !deleteNodeIds.has(node.parentId)) continue;
      deleteNodeIds.add(node.id);
      changed = true;
    }
  }

  const deletedSessionFiles = [...deleteNodeIds]
    .map(id => nodesById.get(id)?.sessionFile)
    .filter((f): f is string => typeof f === "string");

  for (const f of deletedSessionFiles) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  return { sessionFile: path.resolve(rootSessionFile), deletedSessionFiles };
}
```

**Step 4: Run tests**

```bash
cd ~/src/pi-agent-dashboard
npx vitest run packages/server/src/__tests__/session-tree.test.ts 2>&1 | tail -20
```
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
cd ~/src/pi-agent-dashboard
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/server/src/session-tree.ts packages/server/src/__tests__/session-tree.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(server): add session-tree state builder + mutations"
```

---

## Task 3: Server — session-tree routes

**Files:**
- Create: `packages/server/src/routes/session-tree-routes.ts`
- Modify: `packages/server/src/server.ts` (~4 lines)

**Step 1: Create routes file**

```ts
// packages/server/src/routes/session-tree-routes.ts
import { watch } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  buildSessionTreeState, forkSessionAfterEntry,
  truncateSessionAfterEntry, deleteBranch,
} from "../session-tree.js";

export function registerSessionTreeRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
) {
  const { networkGuard } = deps;

  // GET /api/session-tree?sessionFile=<path>
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
        return { success: false, error: "Session not found." } satisfies ApiResponse;
      }
      return { success: true, data: state } satisfies ApiResponse;
    },
  );

  // GET /api/session-tree/events?sessionFile=<path>  — SSE with reconnect support
  fastify.get<{ Querystring: { sessionFile?: string } }>(
    "/api/session-tree/events",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile } = request.query;
      if (!sessionFile) { reply.code(400).send("sessionFile required"); return; }

      const state = buildSessionTreeState(sessionFile);
      if (!state) { reply.code(404).send("Session not found."); return; }

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

      sendState(); // send initial state immediately

      let watcher: ReturnType<typeof watch> | undefined;
      let pending: NodeJS.Timeout | undefined;
      try {
        watcher = watch(state.root.sessionDir, { persistent: false }, () => {
          if (pending) return;
          pending = setTimeout(() => { pending = undefined; sendState(); }, 120);
        });
        watcher.on("error", () => { /* directory may disappear */ });
      } catch { /* not watchable */ }

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

  // POST /api/session-tree/fork
  fastify.post<{ Body: { sessionFile?: string; entryId?: string; name?: string } }>(
    "/api/session-tree/fork",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile, entryId, name } = request.body ?? {};
      if (!sessionFile || !entryId) {
        reply.code(400);
        return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
      }
      try {
        const result = forkSessionAfterEntry(sessionFile, entryId, name);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );

  // POST /api/session-tree/truncate-after
  fastify.post<{ Body: { sessionFile?: string; entryId?: string } }>(
    "/api/session-tree/truncate-after",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile, entryId } = request.body ?? {};
      if (!sessionFile || !entryId) {
        reply.code(400);
        return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
      }
      try {
        const result = truncateSessionAfterEntry(sessionFile, entryId);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );

  // POST /api/session-tree/delete-branch
  fastify.post<{ Body: { rootSessionFile?: string; nodeId?: string } }>(
    "/api/session-tree/delete-branch",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { rootSessionFile, nodeId } = request.body ?? {};
      if (!rootSessionFile || !nodeId) {
        reply.code(400);
        return { success: false, error: "rootSessionFile and nodeId required" } satisfies ApiResponse;
      }
      try {
        const result = deleteBranch(rootSessionFile, nodeId);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );
}
```

**Step 2: Register in `server.ts`**

Add import near the other route imports (line ~57–90):
```ts
import { registerSessionTreeRoutes } from "./routes/session-tree-routes.js";
```

Add registration near `registerSessionRoutes`:
```ts
registerSessionTreeRoutes(fastify, { networkGuard });
```

**Step 3: Verify server starts cleanly**

```bash
cd ~/src/pi-agent-dashboard
npx tsx packages/server/src/cli.ts --help 2>&1 | head -5
```
Expected: help text, no import errors.

**Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/server/src/routes/session-tree-routes.ts packages/server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(server): add session-tree REST + SSE routes"
```

---

## Task 4: Client — hooks

**Files:**
- Create: `packages/client/src/hooks/useSessionTreePane.ts`
- Create: `packages/client/src/hooks/useSessionTree.ts`

**Step 1: `useSessionTreePane.ts`** (mirrors `useSidebarState` pattern)

```ts
// packages/client/src/hooks/useSessionTreePane.ts
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
  open: boolean; width: number;
  toggle: () => void; setWidth: (w: number) => void;
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
```

**Step 2: `useSessionTree.ts`** (with exponential backoff reconnect)

```ts
// packages/client/src/hooks/useSessionTree.ts
import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionTreeState } from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";

export type { SessionTreeState };
export type {
  SessionTreeNode, SessionTreeView, EntryView, MessageBlock, SessionTreeStats,
} from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";

const BACKOFF_DELAYS = [1000, 2000, 4000]; // ms, max 3 attempts

interface UseSessionTreeResult {
  state: SessionTreeState | null;
  loading: boolean;
  error: string | null;
  stale: boolean; // true after reconnect exhausted
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
      const payload = await r.json();
      if (payload.success) { setState(payload.data); setError(null); }
      else setError(payload.error ?? "Failed to load.");
    } catch (e) { setError(String(e)); }
  }, []);

  const connect = useCallback((file: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/session-tree/events?sessionFile=${encodeURIComponent(file)}`);
    esRef.current = es;

    es.addEventListener("state", (e: MessageEvent) => {
      try {
        setState(JSON.parse(e.data));
        attemptsRef.current = 0; // reset backoff on successful message
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
        return; // give up
      }
      attemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect(file);
        fetchState(file); // also re-fetch snapshot on reconnect
      }, BACKOFF_DELAYS[attempt]);
    };
  }, [fetchState]);

  const refetch = useCallback(() => {
    if (sessionFile) fetchState(sessionFile);
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

    fetchState(sessionFile).finally(() => setLoading(false));
    connect(sessionFile);

    return () => {
      esRef.current?.close(); esRef.current = null;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    };
  }, [sessionFile, fetchState, connect]);

  return { state, loading, error, stale, refetch };
}
```

**Step 3: Verify TS**

```bash
cd ~/src/pi-agent-dashboard
npx tsc -p packages/client/tsconfig.json --noEmit 2>&1 | head -20
```
Expected: no errors on new files (existing errors, if any, are pre-existing).

**Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/client/src/hooks/useSessionTreePane.ts packages/client/src/hooks/useSessionTree.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(client): add useSessionTreePane + useSessionTree hooks"
```

---

## Task 5: Client — SessionTreePane shell

**Files:**
- Create: `packages/client/src/components/session-tree/SessionTreePane.tsx`

This is the outer shell — drag resize, collapse strip, layout. Inner components are stubs until Task 6.

```tsx
// packages/client/src/components/session-tree/SessionTreePane.tsx
import React, { useRef, useCallback, useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
import type { SessionTreePaneState } from "../../hooks/useSessionTreePane.js";
import { useSessionTree } from "../../hooks/useSessionTree.js";
import { SessionTreeSidebar } from "./SessionTreeSidebar.js";
import { SessionTreeMessages } from "./SessionTreeMessages.js";
import { SessionTreeHeader } from "./SessionTreeHeader.js";
import { SessionTreeComposer } from "./SessionTreeComposer.js";

const COLLAPSED_WIDTH = 28;

export interface SessionTreePaneProps {
  sessionFile: string;
  pane: SessionTreePaneState;
  /** sessionId of the root session in the dashboard (for send_prompt) */
  rootSessionId: string;
  /** Resolved sessionId for a given sessionFile — from dashboard session list */
  resolveSessionId: (sessionFile: string) => string | undefined;
  onFork: (sessionId: string, entryId: string) => void;
  send: (msg: { type: string; [key: string]: unknown }) => void;
}

export function SessionTreePane({
  sessionFile, pane, rootSessionId, resolveSessionId, onFork, send,
}: SessionTreePaneProps) {
  const { open, width, toggle, setWidth } = pane;
  const { state, loading, error, stale, refetch } = useSessionTree(open ? sessionFile : undefined);
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

  // ── Collapsed strip ─────────────────────────────────────────────────────────
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

  // ── Expanded pane ───────────────────────────────────────────────────────────
  const selectedNode = state?.nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedSession = selectedNode ? (state?.sessions[selectedNode.sessionFile] ?? null) : null;
  const resolvedSessionId = selectedNode
    ? resolveSessionId(selectedNode.sessionFile) ?? rootSessionId
    : rootSessionId;

  const handleFork = async (entryId: string, name?: string) => {
    try {
      const r = await fetch("/api/session-tree/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionFile: selectedNode?.sessionFile, entryId, name }),
      });
      const payload = await r.json();
      if (!payload.success) throw new Error(payload.error);
      refetch();
    } catch (e) {
      alert(`Fork failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleTruncate = async (entryId: string) => {
    if (!confirm("Delete all conversation after this message? This rewrites the session file.")) return;
    try {
      const r = await fetch("/api/session-tree/truncate-after", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionFile: selectedNode?.sessionFile, entryId }),
      });
      const payload = await r.json();
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
      const payload = await r.json();
      if (!payload.success) throw new Error(payload.error);
      setSelectedNodeId("ROOT");
      setActiveEntryId("");
      refetch();
    } catch (e) {
      alert(`Delete branch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
        {loading && !state && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-xs">
            Loading…
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
              stale={stale}
              showThinking={showThinking}
              showTools={showTools}
              onToggleThinking={() => setShowThinking(v => !v)}
              onToggleTools={() => setShowTools(v => !v)}
              onRefresh={refetch}
            />
            <div className="flex-1 flex min-h-0 overflow-hidden">
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
                />
              </div>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  <SessionTreeMessages
                    session={selectedSession}
                    activeEntryId={activeEntryId}
                    showThinking={showThinking}
                    showTools={showTools}
                    onFork={(entryId) => handleFork(entryId)}
                    onTruncate={handleTruncate}
                  />
                </div>
                <SessionTreeComposer
                  sessionId={resolvedSessionId}
                  send={send}
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

**Step 2: Commit (with stub imports — inner components created in Task 6)**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/client/src/components/session-tree/SessionTreePane.tsx
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(client): add SessionTreePane shell"
```

---

## Task 6: Client — inner components

**Files:**
- Create: `packages/client/src/components/session-tree/SessionTreeSidebar.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeMessages.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeHeader.tsx`
- Create: `packages/client/src/components/session-tree/SessionTreeComposer.tsx`

**Step 1: `SessionTreeSidebar.tsx`**

```tsx
// packages/client/src/components/session-tree/SessionTreeSidebar.tsx
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

export function SessionTreeSidebar({ state, selectedNodeId, activeEntryId, onSelect, onDeleteBranch }: Props) {
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

    const children = state.nodes.filter(n => n.parentId === nodeId)
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
              className={`relative flex items-baseline group hover:bg-[var(--bg-hover)] ${active ? "bg-[var(--bg-tertiary)]" : ""}`}
              onMouseEnter={() => setHoveredFork(row.nodeId)}
              onMouseLeave={() => setHoveredFork(null)}
            >
              <button
                className="flex-1 text-left px-2 py-0.5 flex items-baseline gap-1"
                onClick={() => onSelect(row.nodeId, "")}
              >
                <span className="text-[var(--text-tertiary)] flex-shrink-0" style={{ paddingLeft: row.depth * 12 }}>↳ </span>
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
            <span className="text-[var(--text-tertiary)] flex-shrink-0 w-3 text-center" style={{ paddingLeft: row.depth * 12 }}>
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
```

**Step 2: `SessionTreeMessages.tsx`**

```tsx
// packages/client/src/components/session-tree/SessionTreeMessages.tsx
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiSourceBranch, mdiDeleteSweepOutline } from "@mdi/js";
import type { SessionTreeView, EntryView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionTreeView | null | undefined;
  activeEntryId: string;
  showThinking: boolean;
  showTools: boolean;
  onFork: (entryId: string) => void;
  onTruncate: (entryId: string) => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EntryRow({ entry, showThinking, showTools, active, onFork, onTruncate }: {
  entry: EntryView; showThinking: boolean; showTools: boolean; active: boolean;
  onFork: () => void; onTruncate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const role = entry.role ?? entry.type;
  const ts = fmtTime(entry.timestamp);
  const blocks = (entry.blocks ?? []).filter(b => {
    if (b.kind === "thinking") return showThinking;
    if (b.kind === "toolCall") return showTools;
    return true;
  });
  if (blocks.length === 0) return null;

  const isAssistant = role === "assistant";
  const isUser = role === "user";

  return (
    <div
      id={`tree-entry-${entry.id}`}
      className={`relative group mx-2 my-1.5 ${active ? "ring-1 ring-blue-400 rounded-lg" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Action buttons — appear on hover */}
      {hovered && (
        <div className="absolute top-0.5 right-0.5 flex gap-0.5 z-10">
          {isAssistant && (
            <button onClick={onFork} title="Fork after this message"
              className="p-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-green-400 hover:border-green-400">
              <Icon path={mdiSourceBranch} size={0.45} />
            </button>
          )}
          <button onClick={onTruncate} title="Delete after this message"
            className="p-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400">
            <Icon path={mdiDeleteSweepOutline} size={0.45} />
          </button>
        </div>
      )}

      {isUser && (
        <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 text-[11px] text-[var(--text-primary)]">
          {ts && <div className="text-[9px] text-[var(--text-tertiary)] mb-0.5">{ts}</div>}
          {blocks.map((b, i) => <div key={i} className="whitespace-pre-wrap break-words">{b.text}</div>)}
        </div>
      )}
      {isAssistant && (
        <div className="px-2 py-1 text-[11px] text-[var(--text-primary)]">
          {ts && <div className="text-[9px] text-[var(--text-tertiary)] mb-0.5 pl-1">{ts}</div>}
          {blocks.map((b, i) => {
            if (b.kind === "thinking") return (
              <div key={i} className="pl-2 py-0.5 text-[var(--text-tertiary)] italic text-[10px] whitespace-pre-wrap border-l-2 border-[var(--border-secondary)] my-0.5">{b.text}</div>
            );
            if (b.kind === "toolCall") return (
              <div key={i} className="px-2 py-1 my-0.5 rounded bg-[var(--bg-tertiary)] text-[10px]">
                <span className="text-yellow-400 font-medium">{b.name}</span>
                <pre className="mt-0.5 text-[var(--text-tertiary)] whitespace-pre-wrap break-all text-[9px] max-h-16 overflow-hidden">{b.text}</pre>
              </div>
            );
            return <div key={i} className="pl-1 whitespace-pre-wrap break-words">{b.text}</div>;
          })}
        </div>
      )}
      {!isUser && !isAssistant && (
        <div className="px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] border-l-2 border-[var(--border-secondary)]">
          <span className="text-purple-400 mr-1">[{role}]</span>
          {blocks.map((b, i) => <span key={i}>{b.text}</span>)}
        </div>
      )}
    </div>
  );
}

export function SessionTreeMessages({ session, activeEntryId, showThinking, showTools, onFork, onTruncate }: Props) {
  useEffect(() => {
    if (!activeEntryId) return;
    document.getElementById(`tree-entry-${activeEntryId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeEntryId]);

  if (!session) {
    return <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-xs p-4">Select a branch</div>;
  }

  const visible = session.entries.filter(e => {
    if (e.role === "toolResult") return false;
    if (e.role === "assistant" && !(e.blocks ?? []).some(b => b.kind !== "toolCall" && String(b.text ?? "").trim())) return false;
    return (e.blocks ?? []).length > 0;
  });

  return (
    <div className="py-1">
      {visible.length === 0 && (
        <div className="text-center text-[var(--text-tertiary)] text-xs pt-8">No messages</div>
      )}
      {visible.map(entry => (
        <EntryRow
          key={entry.id}
          entry={entry}
          showThinking={showThinking}
          showTools={showTools}
          active={entry.id === activeEntryId}
          onFork={() => onFork(entry.id)}
          onTruncate={() => onTruncate(entry.id)}
        />
      ))}
    </div>
  );
}
```

**Step 3: `SessionTreeHeader.tsx`**

```tsx
// packages/client/src/components/session-tree/SessionTreeHeader.tsx
import React from "react";
import { Icon } from "@mdi/react";
import { mdiEye, mdiEyeOff, mdiWrench, mdiRefresh, mdiAlertCircleOutline } from "@mdi/js";
import type { SessionTreeView } from "../../hooks/useSessionTree.js";

interface Props {
  session: SessionTreeView | null | undefined;
  stale: boolean;
  showThinking: boolean;
  showTools: boolean;
  onToggleThinking: () => void;
  onToggleTools: () => void;
  onRefresh: () => void;
}

function fmt(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function SessionTreeHeader({ session, stale, showThinking, showTools, onToggleThinking, onToggleTools, onRefresh }: Props) {
  const stats = session?.stats;
  const cost = stats ? stats.cost.input + stats.cost.output + stats.cost.cacheRead + stats.cost.cacheWrite : 0;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)] flex-shrink-0 flex-wrap">
      {stale && (
        <span title="Live updates disconnected" className="text-yellow-400 flex items-center gap-0.5">
          <Icon path={mdiAlertCircleOutline} size={0.45} /> stale
        </span>
      )}
      {stats && (
        <>
          <span title="User / Assistant messages">{stats.userMessages}u · {stats.assistantMessages}a</span>
          <span title="Tool calls">{stats.toolCalls}t</span>
          <span title="Tokens">↑{fmt(stats.tokens.input)} ↓{fmt(stats.tokens.output)}</span>
          {cost > 0 && <span title="Cost">${cost.toFixed(2)}</span>}
        </>
      )}
      <span className="flex-1" />
      <button onClick={onRefresh} title="Refresh" className="p-0.5 rounded hover:text-[var(--text-primary)] transition-colors">
        <Icon path={mdiRefresh} size={0.5} />
      </button>
      <button onClick={onToggleThinking} title={showThinking ? "Hide thinking" : "Show thinking"}
        className={`p-0.5 rounded transition-colors ${showThinking ? "text-[var(--text-secondary)]" : "opacity-40"}`}>
        <Icon path={showThinking ? mdiEye : mdiEyeOff} size={0.5} />
      </button>
      <button onClick={onToggleTools} title={showTools ? "Hide tools" : "Show tools"}
        className={`p-0.5 rounded transition-colors ${showTools ? "text-[var(--text-secondary)]" : "opacity-40"}`}>
        <Icon path={mdiWrench} size={0.5} />
      </button>
    </div>
  );
}
```

**Step 4: `SessionTreeComposer.tsx`**

```tsx
// packages/client/src/components/session-tree/SessionTreeComposer.tsx
import React, { useState, useRef, useCallback } from "react";

interface Props {
  sessionId: string | undefined;
  send: (msg: { type: string; [key: string]: unknown }) => void;
}

export function SessionTreeComposer({ sessionId, send }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || sending) return;
    send({ type: "send_prompt", sessionId, text: trimmed });
    setText("");
    setSending(false);
    textareaRef.current?.focus();
  }, [text, sessionId, send, sending]);

  if (!sessionId) {
    return (
      <div className="px-3 py-2 border-t border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)] text-center">
        Session not active
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border-primary)] px-2 py-1.5 flex gap-1.5 items-end flex-shrink-0">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); } }}
        placeholder="Message this branch…"
        rows={2}
        className="flex-1 resize-none text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-2 py-1 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || sending}
        className="px-2 py-1 text-[10px] rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex-shrink-0 transition-colors"
      >
        Send
      </button>
    </div>
  );
}
```

**Step 5: Build check**

```bash
cd ~/src/pi-agent-dashboard
npx tsc -p packages/client/tsconfig.json --noEmit 2>&1 | grep "session-tree" | head -20
```
Expected: no errors on session-tree files.

**Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/client/src/components/session-tree/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(client): add SessionTreeSidebar, Messages, Header, Composer"
```

---

## Task 7: Wire into App.tsx + SessionHeader

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/SessionHeader.tsx`

**Step 1: Add `mdiSourceBranch` import + toggle props to `SessionHeader.tsx`**

Add to the `@mdi/js` import line:
```ts
import { ..., mdiSourceBranch } from "@mdi/js";
```

Add to the props interface:
```ts
onToggleSessionTree?: () => void;
sessionTreeOpen?: boolean;
```

Add to the desktop toolbar (near the `hasFileChanges && onOpenDiffView` block):
```tsx
{onToggleSessionTree && (
  <button
    onClick={onToggleSessionTree}
    title={sessionTreeOpen ? "Hide session tree" : "Show session tree"}
    data-testid="session-tree-toggle"
    className={`p-1.5 rounded transition-colors ${
      sessionTreeOpen
        ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
        : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
    }`}
  >
    <Icon path={mdiSourceBranch} size={0.65} />
  </button>
)}
```

**Step 2: Wire `App.tsx`**

Add imports near other hook/component imports:
```ts
import { useSessionTreePane } from "./hooks/useSessionTreePane.js";
import { SessionTreePane } from "./components/session-tree/SessionTreePane.js";
```

Add hook near `useSidebarState()`:
```ts
const sessionTreePane = useSessionTreePane();
```

Add `resolveSessionId` helper inside the component (near `selectedSession` derivations):
```ts
const resolveSessionId = useCallback((file: string): string | undefined => {
  for (const [id, session] of sessions) {
    if (session.sessionFile === file) return id;
  }
  return undefined;
}, [sessions]);
```

In `SessionHeader` call, add:
```tsx
onToggleSessionTree={selectedSession?.sessionFile ? sessionTreePane.toggle : undefined}
sessionTreeOpen={sessionTreePane.open}
```

Wrap the inner content of `sessionDetail` (inside the outer `flex-1 flex flex-col`):
```tsx
{/* BEFORE: the flex-1 content div containing ChatView + SessionBanner + StatusBar */}
{/* AFTER: */}
<div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
  <div className="flex-1 flex flex-col min-w-0 min-h-0">
    {/* existing: ContentHeaderStickySlot, ErrorBoundary+ChatView, SessionBanner, StatusBar */}
  </div>
  {selectedSession?.sessionFile && (
    <div className="hidden md:flex">
      <SessionTreePane
        sessionFile={selectedSession.sessionFile}
        pane={sessionTreePane}
        rootSessionId={selectedId!}
        resolveSessionId={resolveSessionId}
        onFork={(sessionId, entryId) => handleResumeSession(sessionId, "fork", entryId)}
        send={send}
      />
    </div>
  )}
</div>
```

**Step 3: Full build**

```bash
cd ~/src/pi-agent-dashboard
npm run build 2>&1 | tail -30
```
Expected: clean build, no TS errors.

**Step 4: Smoke test**

- Open `http://localhost:8001/session/<id>`
- Verify `⎇` button in header toolbar
- Click → right pane opens with tree sidebar + transcript
- Click `⟩` → collapses to 28px "Tree" strip
- Reload → pane state persists
- Resize by dragging left edge
- Click an entry in sidebar → transcript scrolls to it + highlights
- Hover over assistant message in transcript → fork + truncate buttons appear
- Fork: confirmation → new branch appears in sidebar
- Delete branch: confirmation → branch removed

**Step 5: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git add packages/client/src/App.tsx packages/client/src/components/SessionHeader.tsx
PRE_COMMIT_ALLOW_NO_CONFIG=1 git commit -m "feat(client): wire SessionTreePane into session detail layout"
```

---

## Summary

| Task | Deliverable |
|------|-------------|
| 1 | `session-tree-types.ts` in shared package |
| 2 | `session-tree.ts` in server — state builder + fork/truncate/delete, with tests |
| 3 | `/api/session-tree/*` Fastify routes — state, SSE, mutations |
| 4 | `useSessionTreePane` + `useSessionTree` hooks (with backoff reconnect) |
| 5 | `SessionTreePane` shell — collapse, drag resize, layout |
| 6 | `SessionTreeSidebar`, `SessionTreeMessages`, `SessionTreeHeader`, `SessionTreeComposer` |
| 7 | Wire into `App.tsx` + `SessionHeader` toggle button |
