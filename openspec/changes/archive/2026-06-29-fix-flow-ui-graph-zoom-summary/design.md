# Design — fix-flow-ui-graph-zoom-summary

Four independent fixes bundled because they were all found in one flow-UI inspection pass and share the flows-plugin blast radius. They do not depend on each other; they can land in any order.

## D1 — `useZoomPan` click-vs-drag threshold

### Root cause
A DOM `click` is synthesized from a `pointerdown`+`pointerup` pair on the **same target**. `setPointerCapture` retargets subsequent pointer events (incl. `pointerup`) to the capturing element. The hook captures on `pointerdown`, so the `pointerup` lands on the container, the click's target becomes the container, and a child node's `onClick` never fires. Even a zero-movement tap captures.

### State machine
`idle → pending(down, NOT captured) → dragging(captured)`.

- `onPointerDown`: `button !== 0` guard stays; record `pendingStart = {x, y, pointerId}` + `lastPointer`; **do not** capture, **do not** set `dragging`.
- `onPointerMove`: if `dragging` → translate (unchanged). Else if `pendingStart` set → if `dx*dx + dy*dy > THRESHOLD²` (THRESHOLD = 4, squared to avoid `sqrt`): set `dragging = true`, `setPointerCapture(pointerId)` on `e.currentTarget`, then translate. Keeping `lastPointer` from `pointerdown` makes the first translate apply the accumulated ~4px (no jump, no lost motion).
- `onPointerUp`: clear `dragging` + `pendingStart`. Capture auto-releases on `pointerup`; an explicit `releasePointerCapture` is belt-and-suspenders.

### Why this over the alternative
Node-scoped `stopPropagation` (the rejected fix) blocks `pointerdown` from reaching the container, so you can only start a pan on empty gaps — worse UX in a dense graph. The threshold lets clicks AND pans work from anywhere in one shared hook.

### Blast radius (verified)
- **FlowGraph**: restores node `onClick` selection; the three button `stopPropagation` lines are removed (an under-threshold tap no longer captures, so the click survives).
- **ZoomControls** self-guards (`onPointerDown → stopPropagation` at `ZoomControls.tsx:27`), independent of FlowGraph's wrapper — so removing FlowGraph's wrapper is safe; dragging on the zoom buttons still won't pan.
- **MermaidBlock**: pan handlers bound only when `focused`; threshold is neutral. Browser auto-releases capture on `pointerup`, no leak.
- **ImageLightbox**: backdrop-close keys on the backdrop target; a sub-threshold tap on the image becomes a click on the image (not the backdrop) → no accidental close (slightly safer).
- `ResizableSidebar` / `FileDiffView` / `OpenSpecBoardView` / `SessionList` have their own drag/`stopPropagation` but do NOT use `useZoomPan` — untouched.

### Tests
`useZoomPan.test.ts` currently asserts only handler-key presence + zoom math — **no** pointer-movement coverage (which is why the bug shipped). Add: no-move ⇒ no `setPointerCapture` + no translate; ≤4px ⇒ none; >4px ⇒ capture once + translate. Hook is `renderHook`-friendly; pass a fake `currentTarget` with a `setPointerCapture` spy.

## D2 — Hide empty summary rows

### Rule (decided with the user)
Filter the Summaries list on **`!agent.summary`** (summary *text* only). A code-decision verdict-only node (typed outputs, no summary) is hidden from the Summaries list but stays visible in the graph + frozen cards. The `files` channel is NOT consulted — see D-note below.

### Touch points (`FlowSummary.tsx`)
- Compute `summarised = agents.filter(a => a.summary)` (or equivalent) once.
- `Summaries ({summarised.length})` — filtered count.
- Map `summarised` (not `agents`) into `FlowSummaryRow`.
- Wrap the whole Summaries subsection (the `mt-2 pt-1.5 border-t` block incl. the `flow-summary-toggle` header) in `summarised.length > 0 && (...)`.
- Frozen agent-cards grid is unchanged (still one card per agent).

### Test impact
- `"row without summary/files/typedOutputs is not interactive"` (bare-step) **breaks** — its premise (a bare row exists) is negated. Rewrite → assert the bare row is absent from `flow-summaries`, and the section is hidden when it is the only agent.
- All other FlowSummary tests use agents with `summary: "S1"/"S2"` → survive.
- Add: filtered-count assertion; section-hidden-when-all-empty assertion.

## D3 — Live-graph routing edges (cross-repo)

### Root cause
`flow-tui.ts onFlowStarted` (pi-flows) serializes `{id, stepType, agent, blockedBy, branches}` — omitting `on_complete`/`on_error`. The dashboard's `deriveFlowEdges` already supports `route` edges (proven by the static `flow_write` Mermaid, which parses YAML directly and renders them). The live path is starved of the data, so `route` edges never appear and `on_complete`-routed flows collapse: pre-separator roots dangle (`load-state`), post-separator roots get misleading `implicit` fan-outs.

### Fix (data threading, no new edge logic)
1. **pi-flows** `onFlowStarted`: add `onComplete: (step as any).on_complete`, `onError: (step as any).on_error` to the serialized step.
2. **dashboard** `FlowState.dagSteps` type: add `onComplete?: string; onError?: string`.
3. **dashboard** `flow-reducer.ts` `flow_started`: copy the two fields onto each `dagSteps` entry.
4. **dashboard** `flowStateToGraphSteps` + `computeLayout` `FlowEdgeStep` mapping: pass `onComplete`/`onError` into `deriveFlowEdges`.

### Backward compatibility
All fields optional. An old pi-flows (no fields) → `deriveFlowEdges` derives no `route` edges → today's behavior. No version gate needed; the dashboard degrades gracefully. The cross-repo coupling is additive.

### Effect
`load-state → resume-gate` and the whole `on_complete` spine render as `route` edges; the bogus `implicit` fan-outs vanish (those roots now have real incoming edges); a `max_concurrent: 1` flow draws as the sequential chain it is; live `FlowGraph` matches the static Mermaid.

## D4 — `on_complete` label policy

A fully `on_complete`-routed flow would label every happy-path arrow `on_complete` — noise. In both renderers, treat a `route` edge whose label is `on_complete` as unlabeled (plain solid arrow); keep labels for `branch` and `on_error` (the latter already styled dashed with ↺/⊗ topology markers).

- `flow-yaml-parse.ts flowToMermaid`: the `else if (e.label)` branch must exclude `on_complete` → fall to the plain `-->` branch.
- `FlowGraph.tsx` edge label (`const label = edge.isError ? … : edge.label`): suppress when `edge.label === "on_complete"`.

Applied identically so the two views stay byte-for-byte consistent in edge semantics.

## D5 — Persist flow panel collapse per session

### Root cause
`FlowSummary.panelCollapsed` and `FlowDashboard.collapsed` are `useState(false)` — component-local, reset on every mount. Nothing is persisted, so each remount re-opens the panel.

### Mechanism
A small localStorage helper keyed by session id, mirroring `useSidebarState.ts` (try/catch reads + writes, boolean parse). Keys: `dashboard:flow-summary-collapsed:<sessionId>`, `dashboard:flow-dashboard-collapsed:<sessionId>`. Both `FlowSummary` and `FlowDashboard` already receive `sessionId`.

- Replace the two `useState(false)` initializers with lazy initializers that read the persisted value (`useState(() => readBoolean(key, false))`).
- On toggle, write through to localStorage (same try/catch-swallow pattern).
- A thin hook — `useFlowCollapsePersisted(sessionId, kind)` returning `[collapsed, toggle]` — keeps both call sites DRY. When `sessionId` is undefined (shouldn't happen for these claims) it falls back to pure in-memory state.
- localStorage failure → degrade to in-memory; never throw (matches `useSidebarState`).

### Scope guard
Only the two whole-panel/dashboard collapses persist. The Summaries-list `collapsed` and the per-row `open` stay ephemeral — persisting them was not requested and would multiply keys per agent. `FlowsUiStateContext` is explicitly per-mount (not per-session), so it is NOT the right home; the localStorage helper is.

### Tests
`FlowSummary.test.tsx` / a new `FlowDashboard` collapse test: collapse → unmount → remount with the same `sessionId` ⇒ renders collapsed; different `sessionId` ⇒ expanded; localStorage throwing ⇒ toggle still works. Stub/clear `localStorage` between tests.

## D-note — `files` is a dead channel (informs D2)

New pi-flows node return type is `StepResultValue { status, summary, fullOutput, outputs }`; the doc comment states the legacy `artifacts`/`files` fields are removed ("a produced path is a declared `*_path` output"). `code`/`code-decision` never emit `files`; new agents use declared outputs. The reducer's `files: result?.files` is near-always `undefined`. Hence D2 filters on `summary` alone and ignores `files`. Removing the dead field/line is explicitly **out of scope** (separate cleanup) to keep this change surgical.
