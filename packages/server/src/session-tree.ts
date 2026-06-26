// packages/server/src/session-tree.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  SessionTreeHeader,
  SessionTreeEntry,
  SessionTreeView,
  SessionTreeNode,
  SessionTreeState,
  EntryView,
  MessageBlock,
  SessionTreeStats,
  ForkResult,
  TruncateResult,
  DeleteBranchResult,
} from "@blackbelt-technology/pi-dashboard-shared/session-tree-types.js";

export type {
  SessionTreeState, SessionTreeNode, SessionTreeView, EntryView,
  MessageBlock, SessionTreeStats, ForkResult, TruncateResult, DeleteBranchResult,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

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
    return { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, type: entry.type, role: "system", blocks: [{ kind: "text", text: `Compaction: ${String(entry.summary ?? "")}` }] };
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
    if (role === "user") {
      stats.userMessages++;
    } else if (role === "assistant") {
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
    } else if (role === "toolResult") {
      stats.toolResults++;
    }
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
  parent: SessionTreeView,
  child: SessionTreeView,
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

type LoadedEntry = NonNullable<ReturnType<typeof loadView>>;

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

// ── Public API ────────────────────────────────────────────────────────────────

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

export function buildSessionTreeState(sessionFile: string): SessionTreeState | null {
  const requestedFile = path.resolve(sessionFile);
  const rootFile = findRootSession(requestedFile);
  const sessionDir = path.dirname(rootFile);

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

export function forkSessionAfterEntry(
  sessionFile: string, entryId: string, name?: string,
): ForkResult {
  const normalizedFile = path.resolve(sessionFile);
  const parsed = parseSessionFile(normalizedFile);
  if (!parsed) throw new Error("Session file not found.");

  const { header, entries } = parsed;
  const byId = new Map(entries.filter(e => e.id).map(e => [e.id, e]));
  if (!byId.has(entryId)) throw new Error("Entry not found.");

  const branch: SessionTreeEntry[] = [];
  let current = byId.get(entryId);
  while (current) {
    branch.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const newId = randomUUID();
  const timestamp = new Date().toISOString();
  const newFile = path.resolve(
    path.join(path.dirname(normalizedFile), `${timestamp.replace(/[:.]/g, "-")}_${newId}.jsonl`)
  );
  const newHeader: SessionTreeHeader = {
    type: "session", version: header.version ?? 3, id: newId,
    timestamp, cwd: header.cwd, parentSession: normalizedFile,
  };

  const rewritten = branch.map((e, i) => ({ ...e, parentId: i === 0 ? null : branch[i - 1].id }));

  if (name?.trim()) {
    rewritten.push({
      type: "session_info",
      id: randomUUID().slice(0, 8),
      parentId: rewritten.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      name: name.trim(),
    } as SessionTreeEntry);
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
      const cutoffTs = Date.parse(cutoffEntry?.timestamp ?? "");
      startsAfter = Number.isFinite(childCreated) && Number.isFinite(cutoffTs) && childCreated >= cutoffTs;
    }
    if (startsAfter) deleteNodeIds.add(child.id);
  }

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
