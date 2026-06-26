# Fork Session Integration — Implementation Plan

> **For Claude:** Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Fork in the right pane (SessionTreePane) spawns a real pi session, appears indented under its parent in the left pane, and two "Switch to" affordances in the right pane let you navigate the main view to it.

**Architecture:** Four sequential tasks — server spawn endpoint → client fork call + right-pane nav affordances → session type carries `parentSessionFile` → left pane renders fork sessions indented under parent.

**Tech Stack:** TypeScript, Fastify, React, existing `spawnPiSession` / `pendingForkRegistry` / `sessionManager` from `server.ts`.

---

### Task 1: `POST /api/session-tree/fork-and-spawn` server endpoint

**Files:**
- Modify: `packages/server/src/routes/session-tree-routes.ts`
- Modify: `packages/server/src/server.ts`

**Step 1: Add spawn deps to `registerSessionTreeRoutes` signature**

In `session-tree-routes.ts`, extend the `deps` parameter type and add the new route:

```typescript
// at top of file — add imports
import type { PendingForkRegistry } from "../pending-fork-registry.js";
import type { SessionManager } from "../directory-service.js";
import { spawnPiSession } from "../process-manager.js";
import { loadConfig } from "../config-api.js";

// extend deps type
export function registerSessionTreeRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    pendingForkRegistry?: PendingForkRegistry;
    sessionManager?: SessionManager;
  },
) {
```

**Step 2: Add the `fork-and-spawn` route inside `registerSessionTreeRoutes`**

Add after the existing `POST /api/session-tree/fork` handler:

```typescript
// POST /api/session-tree/fork-and-spawn
fastify.post<{ Body: { sessionFile?: string; entryId?: string; name?: string; parentSessionId?: string } }>(
  "/api/session-tree/fork-and-spawn",
  { preHandler: networkGuard },
  async (request, reply) => {
    const { sessionFile, entryId, name, parentSessionId } = request.body ?? {};
    if (!sessionFile || !entryId) {
      reply.code(400);
      return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
    }

    // 1. Create the fork .jsonl file (existing logic)
    let forkResult: { sessionFile: string };
    try {
      forkResult = forkSessionAfterEntry(sessionFile, entryId, name);
    } catch (e) {
      reply.code(400);
      return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
    }

    // 2. Determine cwd from the source session
    const cwd = (() => {
      // Try session manager first, fall back to reading from the fork file header
      if (deps.sessionManager && parentSessionId) {
        const sessions = deps.sessionManager.list();
        const parent = sessions.find(s => s.id === parentSessionId);
        if (parent?.cwd) return parent.cwd;
      }
      // Fall back: read cwd from the source sessionFile header
      try {
        const first = require("node:fs").readFileSync(sessionFile, "utf-8").split("\n")[0];
        const header = JSON.parse(first);
        return header.cwd as string;
      } catch {
        return null;
      }
    })();

    if (!cwd) {
      reply.code(400);
      return { success: false, error: "Could not determine cwd for fork" } satisfies ApiResponse;
    }

    // 3. Spawn pi in rpc mode with the fork file
    const config = loadConfig();
    const spawnResult = await spawnPiSession(cwd, {
      sessionFile: forkResult.sessionFile,
      mode: "fork",
      strategy: config.spawnStrategy,
    });

    // 4. Record fork for left-pane ordering
    if (parentSessionId && deps.pendingForkRegistry && spawnResult.spawnToken) {
      deps.pendingForkRegistry.recordFork(spawnResult.spawnToken, parentSessionId);
    }

    if (!spawnResult.success) {
      reply.code(500);
      return { success: false, error: spawnResult.message } satisfies ApiResponse;
    }

    return {
      success: true,
      data: { forkSessionFile: forkResult.sessionFile, spawnToken: spawnResult.spawnToken },
    } satisfies ApiResponse;
  },
);
```

**Step 3: Pass deps in `server.ts`**

Find the existing call (line ~807):
```typescript
registerSessionTreeRoutes(fastify, { networkGuard });
```
Replace with:
```typescript
registerSessionTreeRoutes(fastify, {
  networkGuard,
  pendingForkRegistry,
  sessionManager,
});
```

**Step 4: Build and check no TypeScript errors**
```bash
cd ~/src/pi-agent-dashboard && pnpm --filter @blackbelt-technology/pi-dashboard-server build 2>&1 | tail -20
```
Expected: no errors.

**Step 5: Commit**
```bash
cd ~/src/pi-agent-dashboard
git add packages/server/src/routes/session-tree-routes.ts packages/server/src/server.ts
git commit -m "feat(server): add fork-and-spawn endpoint for session tree"
```

---

### Task 2: Client — wire `fork-and-spawn` + right-pane nav affordances

**Files:**
- Modify: `packages/client/src/components/session-tree/SessionTreePane.tsx`
- Modify: `packages/client/src/components/session-tree/SessionTreeSidebar.tsx`
- Modify: `packages/client/src/components/session-tree/SessionTreeActionBar.tsx`

**Step 1: Update `handleFork` in `SessionTreePane` to call `fork-and-spawn`**

Find `handleFork`:
```typescript
const handleFork = async (entryId: string) => {
  const selectedNode = state?.nodes.find(n => n.id === selectedNodeId);
  if (!selectedNode) return;
  try {
    const r = await fetch("/api/session-tree/fork", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionFile: selectedNode.sessionFile, entryId }),
    });
    const payload = await r.json() as { success: boolean; error?: string };
    if (!payload.success) throw new Error(payload.error);
    refetch();
  } catch (e) {
    alert(`Fork failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
```

Replace with:
```typescript
const handleFork = async (entryId: string) => {
  const selectedNode = state?.nodes.find(n => n.id === selectedNodeId);
  if (!selectedNode) return;
  try {
    const r = await fetch("/api/session-tree/fork-and-spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionFile: selectedNode.sessionFile,
        entryId,
        parentSessionId: rootSessionId,
      }),
    });
    const payload = await r.json() as { success: boolean; error?: string };
    if (!payload.success) throw new Error(payload.error);
    refetch();
  } catch (e) {
    alert(`Fork failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
```

**Step 2: Add `handleNavigateToForkNode` in `SessionTreePane` and wire it down**

Add a handler that resolves a node ID to a session ID and calls `handleSwitchBranch`:

In `SessionTreePane.tsx`, after `handleDeleteBranch`, add:
```typescript
const handleNavigateToNode = useCallback((nodeId: string) => {
  const node = state?.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const sessionId = resolveSessionId(node.sessionFile);
  if (sessionId) {
    // navigates main view via App's handleSwitchBranch
    // We call onNavigate which is wired to handleSwitchBranch(resolveSessionId(file))
    // but we already have the id — use it directly through the resolveSessionId path
    // by passing to SessionTreeActionBar's onNavigate
  }
}, [state, resolveSessionId]);
```

Actually, the cleanest approach: pass `resolveSessionId` down to sidebar and compute the sessionId at call time. Update `SessionTreePane`'s render to pass `onNavigateNode` to both sidebar and action bar:

In the expanded pane JSX, update `SessionTreeSidebar`:
```tsx
<SessionTreeSidebar
  state={state}
  selectedNodeId={selectedNodeId}
  activeEntryId={activeEntryId}
  onSelect={(nodeId, entryId) => {
    setSelectedNodeId(nodeId);
    setActiveEntryId(entryId);
  }}
  onDeleteBranch={handleDeleteBranch}
  onNavigateNode={(nodeId) => {
    const node = state?.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const sid = resolveSessionId(node.sessionFile);
    if (sid) {
      const fake = node.sessionFile;
      // Use the existing handleSwitchBranch path via resolveSessionId
      const id = resolveSessionId(fake);
      if (id) { /* navigate is wired through App */ }
    }
  }}
/>
```

Simpler: add `onNavigateNode?: (nodeId: string) => void` to `SessionTreePane` props and let `App.tsx` pass it. But `SessionTreePane` already has `resolveSessionId` as a prop. So just compute inside `SessionTreePane`:

```typescript
// In SessionTreePane, add this handler:
const handleNavigateNode = useCallback((nodeId: string) => {
  const node = state?.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const sid = resolveSessionId(node.sessionFile);
  if (sid) {
    // Reuse the same navigate path as the action bar's onNavigate
    // onNavigate from props navigates to resolvedSessionId
    // We need to call handleSwitchBranch — expose via a new prop
  }
}, [state, resolveSessionId]);
```

The cleanest path: add `onSwitchToSession?: (sessionFile: string) => void` to `SessionTreePane` props. App.tsx wires it to `handleSwitchBranch`. Then everything inside uses `onSwitchToSession(node.sessionFile)`.

**Revised Step 2: Add `onSwitchToSession` prop to `SessionTreePane`**

In `SessionTreePane.tsx`:
```typescript
export interface SessionTreePaneProps {
  sessionFile: string;
  pane: SessionTreePaneState;
  rootSessionId: string;
  resolveSessionId: (sessionFile: string) => string | undefined;
  onStateChange?: (state: SessionTreeState | null) => void;
  onSwitchToSession?: (sessionFile: string) => void;  // ← add
}
```

Use it to build `handleNavigateNode`:
```typescript
const handleNavigateNode = useCallback((nodeId: string) => {
  const node = state?.nodes.find(n => n.id === nodeId);
  if (!node) return;
  onSwitchToSession?.(node.sessionFile);
}, [state, onSwitchToSession]);
```

Pass down to sidebar and action bar:
```tsx
<SessionTreeSidebar
  ...
  onNavigateNode={handleNavigateNode}
/>
```
```tsx
<SessionTreeActionBar
  ...
  onNavigate={resolvedSessionId ? () => onSwitchToSession?.(selectedNode!.sessionFile) : undefined}
/>
```

**Step 3: Wire `onSwitchToSession` in `App.tsx`**

Find the existing `SessionTreePane` mount (~line 1650):
```tsx
<SessionTreePane
  sessionFile={selectedSession.sessionFile}
  pane={sessionTreePane}
  rootSessionId={selectedId!}
  resolveSessionId={resolveSessionId}
  onStateChange={setSessionTreeState}
/>
```

Add `onSwitchToSession`:
```tsx
<SessionTreePane
  sessionFile={selectedSession.sessionFile}
  pane={sessionTreePane}
  rootSessionId={selectedId!}
  resolveSessionId={resolveSessionId}
  onStateChange={setSessionTreeState}
  onSwitchToSession={handleSwitchBranch}
/>
```

**Step 4: Update `SessionTreeSidebar` — add hover `[→]` on fork label rows**

Add `onNavigateNode?: (nodeId: string) => void` to `Props`.

In the fork-label JSX block, alongside the existing delete button:
```tsx
{onNavigateNode && (
  <button
    onClick={(e) => { e.stopPropagation(); onNavigateNode(row.nodeId); }}
    className="px-1 py-0.5 text-[var(--text-tertiary)] hover:text-blue-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
    title="Switch main view to this branch"
  >
    <Icon path={mdiArrowRight} size={0.5} />
  </button>
)}
{hoveredFork === row.nodeId && (
  <button
    onClick={() => onDeleteBranch(row.nodeId)}
    ...
  >
```

Add `mdiArrowRight` to imports from `@mdi/js`.

**Step 5: Update `SessionTreeActionBar` — "Switch to" button**

Change the existing "Open" button:
```tsx
{/* Switch to branch as main view — show when non-root branch selected, no message active */}
{!isRoot && !hasActiveEntry && onNavigate && (
  <button
    onClick={() => onNavigate(resolvedSessionId)}
    title="Switch main view to this branch"
    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors"
  >
    <Icon path={mdiArrowRight} size={0.45} />
    Switch to
  </button>
)}
```

Remove the old gated `{onNavigate && resolvedSessionId && (...)}` block — replace entirely with the above.

Add `mdiArrowRight` to imports from `@mdi/js`.

**Step 6: Build client, check no TS errors**
```bash
cd ~/src/pi-agent-dashboard && pnpm --filter @blackbelt-technology/pi-dashboard-client build 2>&1 | tail -20
```

**Step 7: Commit**
```bash
cd ~/src/pi-agent-dashboard
git add packages/client/src/components/session-tree/ packages/client/src/App.tsx
git commit -m "feat(client): fork-and-spawn + Switch to affordances in session tree pane"
```

---

### Task 3: Expose `parentSessionFile` on `DashboardSession`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/session-scanner.ts`

**Step 1: Add field to `DashboardSession`**

In `packages/shared/src/types.ts`, inside `DashboardSession` after `sessionFile`:
```typescript
sessionFile?: string;
/** Absolute path of the parent session file for forked sessions. Absent for root sessions. */
parentSessionFile?: string;
```

**Step 2: Read `parentSession` in `readJsonlHeaderSync`**

Find the function signature:
```typescript
function readJsonlHeaderSync(filePath: string): { id: string; cwd: string; name?: string; firstMessage?: string } | null {
```

Change return type and add `parentSession` extraction:
```typescript
function readJsonlHeaderSync(filePath: string): {
  id: string; cwd: string; name?: string; firstMessage?: string; parentSession?: string;
} | null {
```

Inside the function, in the loop where `entry.type === "session"` is handled, add:
```typescript
if (entry.type === "session" && entry.id) {
  header = entry;  // already there
  // parentSession is on the header line itself — no need to keep scanning for it
}
```

Since `parentSession` is on the header line (first line), extract it right from `header`:
```typescript
if (!header) return null;
return {
  id: header.id,
  cwd: header.cwd,
  name,
  firstMessage,
  parentSession: typeof header.parentSession === "string" ? header.parentSession : undefined,
};
```

**Step 3: Propagate to session object in scanner**

Find where `sessions.push(sessionFromMeta(...))` is called after reading the header (around line 234). The call to `sessionFromMeta` eventually calls `sessionFromMeta(sessionId, sessionFile, sessionDir, meta, startedAt)`. Find `sessionFromMeta` and add `parentSessionFile`:

```typescript
// In sessionFromMeta or the push site, add:
parentSessionFile: header.parentSession
  ? path.resolve(path.dirname(sessionFile), header.parentSession)
  : undefined,
```

Locate the exact spot by finding where the broadcasted session payload is built and add the field there, matching how `sessionFile` is set.

**Step 4: Build shared + server**
```bash
cd ~/src/pi-agent-dashboard && pnpm --filter @blackbelt-technology/pi-dashboard-shared build && pnpm --filter @blackbelt-technology/pi-dashboard-server build 2>&1 | tail -20
```

**Step 5: Commit**
```bash
cd ~/src/pi-agent-dashboard
git add packages/shared/src/types.ts packages/server/src/session-scanner.ts
git commit -m "feat: expose parentSessionFile on DashboardSession for fork grouping"
```

---

### Task 4: Left pane — fork sessions indented under parent

**Files:**
- Modify: `packages/client/src/components/SessionList.tsx`
- Modify: `packages/client/src/components/SessionCard.tsx`

**Step 1: Understand current rendering structure in `SessionList`**

Sessions are rendered per-cwd. Find the section that maps sessions to `<SessionCard>` components. The key variable is the per-cwd `sessions` array passed to each group render.

**Step 2: Build a sorted+grouped session list per cwd**

In `SessionList.tsx`, inside the per-cwd render block, add a helper that orders sessions so children appear after their parent:

```typescript
function orderWithForkChildren(sessions: DashboardSession[]): Array<{ session: DashboardSession; depth: number }> {
  const byFile = new Map(sessions.filter(s => s.sessionFile).map(s => [s.sessionFile!, s]));
  const result: Array<{ session: DashboardSession; depth: number }> = [];
  const placed = new Set<string>();

  for (const session of sessions) {
    if (placed.has(session.id)) continue;
    if (session.parentSessionFile && byFile.has(session.parentSessionFile)) continue; // placed by parent
    result.push({ session, depth: 0 });
    placed.add(session.id);
    // Place direct children immediately after
    for (const child of sessions) {
      if (placed.has(child.id)) continue;
      if (child.parentSessionFile === session.sessionFile) {
        result.push({ session: child, depth: 1 });
        placed.add(child.id);
      }
    }
  }
  // Any remaining (parent not in same cwd view) — render at depth 0
  for (const session of sessions) {
    if (!placed.has(session.id)) result.push({ session, depth: 0 });
  }
  return result;
}
```

**Step 3: Use `orderWithForkChildren` when rendering the session card list**

Where sessions are currently mapped to cards, wrap with `orderWithForkChildren`:

```tsx
{orderWithForkChildren(cwdSessions).map(({ session, depth }) => (
  <SortableSessionCard
    key={session.id}
    session={session}
    depth={depth}   // ← new prop
    ...rest
  />
))}
```

**Step 4: Add `depth` prop to `SessionCard` for indent rendering**

In `SessionCard.tsx`, add to props:
```typescript
depth?: number;
```

In the card's root element, apply left padding based on depth:
```tsx
<div
  className={cn("...", depth && depth > 0 ? "pl-4 border-l-2 border-dashed border-[var(--border-secondary)] ml-2" : "")}
  ...
>
```

This gives a subtle dashed left rail + indent for fork children. No other card changes needed.

**Step 5: Add `depth` to `SortableSessionCard` passthrough**

`SortableSessionCard` wraps `SessionCard` — add `depth` to its props and pass through.

**Step 6: Build client, visual check**
```bash
cd ~/src/pi-agent-dashboard && pnpm --filter @blackbelt-technology/pi-dashboard-client build 2>&1 | tail -20
```

**Step 7: Commit**
```bash
cd ~/src/pi-agent-dashboard
git add packages/client/src/components/SessionList.tsx packages/client/src/components/SessionCard.tsx packages/client/src/components/SortableSessionCard.tsx
git commit -m "feat(client): render fork sessions indented under parent in session list"
```

---

## Verification

After all tasks:

1. Open dashboard, start a session, send a message, open the session tree pane
2. Right-click an assistant message → Fork — new session appears in left pane indented under parent ✓
3. Hover over the fork label in the right pane sidebar → `[→]` button appears ✓
4. Click `[→]` → main ChatView switches to the fork session ✓
5. Click the fork label (no message selected) → action bar shows `[Switch to]` + `[Delete branch]` ✓
6. Click `[Switch to]` → main ChatView switches to fork ✓
7. Fork session card in left pane is indented with dashed left border under parent ✓
