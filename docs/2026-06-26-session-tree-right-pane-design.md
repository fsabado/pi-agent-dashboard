# Session Tree Right Pane — Design

**Date:** 2026-06-26  
**Status:** Approved

---

## Problem

The dashboard shows each session as a flat chat transcript. Pi sessions can be forked into trees — but there is no way to see the tree, navigate branches, or manage them from inside the dashboard. You have to open the standalone `pi-session-tree-browser` server in a separate tab.

---

## Goal

Add a native collapsible right-side pane to the session detail view that shows the fork tree and full transcript for the current session, with all the interactive features of the standalone tree browser: navigation, fork-from-message, truncate, delete branch, composer, and live streaming.

---

## Architecture

### Layers

```
packages/shared/src/session-tree-types.ts   ← shared type contract (new)
packages/server/src/session-tree.ts         ← pure state-building logic (new)
packages/server/src/routes/
  session-tree-routes.ts                    ← Fastify routes: state + SSE + mutations (new)
packages/client/src/hooks/
  useSessionTreePane.ts                     ← open/width state, localStorage (new)
  useSessionTree.ts                         ← fetch + SSE, reconnect (new)
packages/client/src/components/session-tree/
  SessionTreePane.tsx                       ← outer shell, drag-resize, collapse (new)
  SessionTreeSidebar.tsx                    ← fork tree nav (new)
  SessionTreeMessages.tsx                   ← transcript viewer (new)
  SessionTreeHeader.tsx                     ← stats + toggles (new)
  SessionTreeComposer.tsx                   ← send message (new)
packages/client/src/App.tsx                 ← wire pane into session detail layout
packages/client/src/components/
  SessionHeader.tsx                         ← add tree toggle button
```

### Type sharing

All session-tree types (`SessionTreeState`, `SessionNode`, `SessionView`, `EntryView`, `MessageBlock`, `SessionStats`) live in `packages/shared/src/session-tree-types.ts`. Both the server (`session-tree.ts`) and client (`useSessionTree.ts`) import from `@blackbelt-technology/pi-dashboard-shared/session-tree-types.js` — same pattern as every other shared type in this codebase.

### Server state building

`packages/server/src/session-tree.ts` contains pure synchronous functions ported from `pi-session-tree-browser`:

- `parseSessionFile(path)` — reads and parses a JSONL file
- `findRootSession(path)` — walks `parentSession` links to the root
- `buildSessionTreeState(sessionFile)` — builds the full `SessionTreeState` from the root outward
- `forkSessionAfterEntry(sessionFile, entryId, name?)` — creates a new branched JSONL file, returns new path
- `truncateSessionAfterEntry(sessionFile, entryId)` — rewrites JSONL, deletes dependent child files
- `deleteBranch(rootSessionFile, nodeId)` — deletes a fork branch and all descendants

**Disk I/O note:** All functions are synchronous. For the current local-only use case this is acceptable. A follow-up can offload to a worker thread if session directories grow large.

### API routes

All routes require `networkGuard` (localhost-only):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/session-tree?sessionFile=` | Full `SessionTreeState` snapshot |
| `GET` | `/api/session-tree/events?sessionFile=` | SSE stream of state updates |
| `POST` | `/api/session-tree/fork` | Fork after an assistant entry |
| `POST` | `/api/session-tree/truncate-after` | Delete conversation after entry |
| `POST` | `/api/session-tree/delete-branch` | Delete a fork branch |

The SSE route watches `sessionDir` with `fs.watch`, debounces 120ms, and sends the full updated state. Heartbeat ping every 25s.

Send-message reuses the existing WebSocket flow — the composer calls the existing `send` function from `App.tsx` (passed as a prop) rather than a new REST endpoint. Fork-from-tree delegates to the existing `handleResumeSession(sessionId, "fork", entryId)` in `App.tsx` — same path as right-click fork in `ChatView`.

### Client pane layout

The `sessionDetail` block in `App.tsx` gains a horizontal flex wrapper:

```
┌─ flex-1 flex-col (existing) ──────┬─ SessionTreePane ─────────────────┐
│  SessionHeader  [⎇ toggle]        │  drag handle (left edge)          │
│                                   │  ┌─ 40% ──────┬─ 60% ───────────┐│
│  ChatView                         │  │ Sidebar     │ Messages        ││
│  (full height, scrolls)           │  │ tree nav    │ transcript      ││
│                                   │  │             │                 ││
│  SessionBanner                    │  └─────────────┴─────────────────┘│
│  StatusBar + Composer             │  SessionTreeComposer               │
└───────────────────────────────────┴───────────────────────────────────┘
```

Collapsed state: 28px strip, rotated "Tree" label, chevron button on left edge.

Default width: 420px. Min: 260px. Max: 640px. State persisted to `localStorage`.

Hidden on mobile (`hidden md:flex` wrapper).

### Pane open trigger

Default closed. User opens via `⎇` button in `SessionHeader` desktop toolbar. Button only shown when `selectedSession?.sessionFile` exists. State persisted to `localStorage` — once opened, stays open across navigation.

### Composer in the pane

The tree pane composer sends to whichever session node is currently selected in the sidebar (not necessarily the root). It calls the existing `send({ type: "send_prompt", sessionId, text })` WebSocket message — same as the main composer. `sessionId` is resolved by looking up `selectedSession.id` (the dashboard's session id) for the root node, or by finding the dashboard session whose `sessionFile` matches the selected node's file.

### Reconnect logic

`useSessionTree` wraps `EventSource` with exponential backoff reconnect: attempts 1, 2, 4 seconds, max 3 attempts, then gives up and shows a stale-data warning in the pane header. On reconnect it also refetches the full state snapshot via `GET /api/session-tree`.

---

## Data Flow

```
User clicks ⎇ in SessionHeader
  → sessionTreePane.toggle() sets open=true, persists to localStorage
  → SessionTreePane mounts
  → useSessionTree(sessionFile) fires:
      1. GET /api/session-tree → initial SessionTreeState
      2. EventSource /api/session-tree/events → live updates on JSONL change

User clicks sidebar entry
  → selectedNodeId + activeEntryId update in SessionTreePane state
  → SessionTreeMessages rerenders, scrolls to entry

User clicks "Fork after this message" in context menu
  → POST /api/session-tree/fork → returns new sessionFile + URL
  → state refetch via SSE update
  → selectedNodeId set to new fork node

User types in SessionTreeComposer and sends
  → resolves sessionId for selected node
  → calls send({ type: "send_prompt", sessionId, text }) via existing WS
  → live entry appears via existing event pipeline

File changes on disk (pi writes to JSONL)
  → fs.watch triggers in SSE route
  → debounce 120ms → buildSessionTreeState → SSE push
  → useSessionTree updates state → React rerenders
```

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| `sessionFile` undefined | Toggle button hidden, pane not rendered |
| `/api/session-tree` 404 | Error message in pane body |
| SSE drops | Reconnect with backoff (3 attempts), show stale indicator |
| Fork/truncate/delete fails | Toast error (reuse existing dashboard toast pattern) |
| Session for selected node not in dashboard | Composer send silently no-ops, shows "session not active" label |

---

## What's out of scope

- RPC runtime management (the tree browser manages its own Pi runtimes — the dashboard uses its existing send-prompt path)
- Showing live streaming tokens in the tree pane transcript (phase 2)
- Mobile layout (hidden on small screens)
- Syncing tree pane selection back to main `ChatView` scroll position
