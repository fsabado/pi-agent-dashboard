# Fork Session Integration Design

**Date:** 2026-06-26  
**Status:** Approved

## Problem

When you fork a session in the right pane (SessionTreePane), it creates a `.jsonl` file only — no live pi session is started. This means:

1. `resolveSessionId(forkSessionFile)` returns `undefined` — the "Open" button in the action bar is dead
2. The new fork never appears in the left pane session list
3. There is no way to switch the main ChatView to the fork from the right pane

## Goals

- Fork in right pane → spawns a real pi session → appears in left pane
- Left pane shows fork sessions indented under their parent
- Right pane provides two ways to switch the main view to a fork: hover button on fork label row + "Switch to" in action bar
- Main view does **not** auto-navigate on fork — user switches manually

## Non-Goals

- Recursive fork tree nesting in left pane (1 level indent only)
- Auto-navigating main view on fork
- Changing right pane transcript selection when main view changes

---

## Architecture

### 1. Fork → Real Session Spawn

**New endpoint:** `POST /api/session-tree/fork-and-spawn`

Replaces client calls to `/api/session-tree/fork` (file-only).

Server flow:
1. `forkSessionAfterEntry(sessionFile, entryId, name)` — creates fork `.jsonl` (existing logic)
2. `spawnPiSession(cwd, { sessionFile: forkFile, mode: "fork", strategy })` — starts pi in rpc mode
3. `pendingForkRegistry.recordFork(spawnToken, parentSessionId)` — left pane places fork after parent
4. Returns `{ success, data: { forkSessionFile, spawnToken } }`

`registerSessionTreeRoutes` receives additional deps: `spawnPiSession`, `pendingForkRegistry`, `sessionManager`, `loadConfig`.

**Client:** `handleFork` in `SessionTreePane` POSTs to `fork-and-spawn`. On success, calls `refetch()` to update right pane tree. Left pane updates automatically via existing session discovery WebSocket broadcast.

---

### 2. Left Pane — Fork Sessions Indented Under Parent

**Server:** Session scanner reads `parentSession` from `.jsonl` header (first line). Exposes it as `parentSessionFile?: string` on the session object.

**Client:** In `SessionList`, when rendering sessions for a cwd, detect sessions with `parentSessionFile`. Find the parent session by matching `session.sessionFile === child.parentSessionFile`. Render the child card indented (`pl-4`) immediately after its parent, with a dashed left border and small branch icon to signal the relationship.

Rules:
- 1 level indent only (forks-of-forks still indent 1 level, no recursive nesting)
- If parent not found in same cwd view, render at top level (graceful fallback)
- Fork sessions sorted by `createdAt` under their parent

---

### 3. Right Pane — Two "Switch to Fork" Entry Points

#### 3a. Hover button on fork label row (SessionTreeSidebar)

Fork label rows already show a `[🗑]` delete button on hover. Add a `[→]` switch button to the left of delete.

```
⎇ fork-name                    [→] [🗑]
```

- New prop: `onNavigate?: (nodeId: string) => void`
- `SessionTreePane` passes `onNavigate` that calls `handleSwitchBranch(resolveSessionId(node.sessionFile))`
- If `resolvedSessionId` is undefined (session not yet in left pane), button is disabled with a tooltip "Session not started yet"

#### 3b. Action bar "Switch to" button (SessionTreeActionBar)

When selected node is a non-root fork and no message entry is active, show:

```
branch    [→ Switch to]  [Delete branch]
```

- Rename existing "Open" → "Switch to" for clarity
- Remove gate on `resolvedSessionId` being pre-resolved — button always visible for non-root nodes with no active entry
- If `resolvedSessionId` is undefined, button is disabled ("Session not started")
- Prop: `onNavigate?: (sessionId: string) => void` (unchanged — still takes resolved session ID)

`SessionTreePane` passes `onNavigate` only when `resolvedSessionId` is defined (existing behaviour for enabling the button).

---

## Data Flow

```
Right pane fork click
  → POST /api/session-tree/fork-and-spawn
      → forkSessionAfterEntry()       creates .jsonl
      → spawnPiSession(mode: "fork")  starts pi rpc
      → pendingForkRegistry.record()  left pane ordering
  → refetch() in SessionTreePane      right pane tree refreshes
  → WS session_list broadcast         left pane shows new session (indented)

User clicks [→] on fork row OR [Switch to] in action bar
  → resolveSessionId(forkNode.sessionFile) → sessionId
  → navigate(`/session/${sessionId}`)
  → main ChatView switches to fork session
```

---

## File Changeset

| File | Change |
|---|---|
| `packages/server/src/routes/session-tree-routes.ts` | Add `POST /api/session-tree/fork-and-spawn`; accept spawn deps via `deps` |
| `packages/server/src/server.ts` | Pass `spawnPiSession`, `pendingForkRegistry`, `sessionManager`, `loadConfig` to `registerSessionTreeRoutes` |
| `packages/server/src/session-scanner.ts` (or session type) | Read `parentSession` from `.jsonl` header; expose as `parentSessionFile` |
| `packages/client/src/components/session-tree/SessionTreePane.tsx` | `handleFork` → `fork-and-spawn`; pass `onNavigate` to sidebar and action bar |
| `packages/client/src/components/session-tree/SessionTreeSidebar.tsx` | Add hover `[→]` button on fork label rows; new `onNavigate` prop |
| `packages/client/src/components/session-tree/SessionTreeActionBar.tsx` | Rename "Open" → "Switch to"; show when branch selected regardless of `resolvedSessionId`; disable + tooltip when no session yet |
| `packages/client/src/components/SessionList.tsx` | Detect `parentSessionFile`; render fork sessions indented under parent |
| `packages/client/src/components/SessionCard.tsx` | Accept `isForked?: boolean` + `depth?: number` props for indent rendering |

---

## Open Questions

- Does `session-scanner.ts` already read the full `.jsonl` header, or does it need a targeted read for `parentSession`? (Check before implementing.)
- `pendingForkRegistry` — confirm it is already accessible in the scope where `registerSessionTreeRoutes` is called in `server.ts`.
