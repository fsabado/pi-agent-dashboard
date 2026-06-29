# Tasks — fix-flow-ui-graph-zoom-summary

Four independent fixes; order is non-binding. Each follows TDD: failing test first, then minimal implementation.

## 1. useZoomPan click-vs-drag threshold (D1)

- [x] `packages/client-utils/src/__tests__/useZoomPan.test.ts`: add failing tests — (a) `pointerdown`+`pointerup` no move ⇒ `setPointerCapture` NOT called, translate unchanged; (b) move ≤ threshold ⇒ no capture, no translate; (c) move > threshold ⇒ `setPointerCapture` called once + translate applied. Use a fake `currentTarget` with a `setPointerCapture` spy.
- [x] `packages/client-utils/src/useZoomPan.ts`: add `pendingStart` ref; `onPointerDown` records start, no capture; `onPointerMove` enters drag (capture + translate) only past THRESHOLD=4 (squared compare); `onPointerUp` clears pending + dragging. Verify: new tests pass; existing zoom/key tests still pass.
- [x] `packages/flows-plugin/src/client/FlowGraph.tsx`: remove the three `onPointerDown={(e) => e.stopPropagation()}` lines (Expand button, error-routes button, ZoomControls wrapper div). Verify: node `onClick` selection works; buttons still clickable (ZoomControls self-guards).

## 2. Hide empty summary rows (D2)

- [x] `packages/flows-plugin/src/__tests__/FlowSummary.test.tsx`: rewrite the `"row without summary/files/typedOutputs is not interactive"` (bare-step) test → assert the bare row is ABSENT from `flow-summaries` and the section is hidden when it is the only agent. Add: (a) filtered-count test — N agents, M with summary ⇒ header reads "Summaries (M)"; (b) section-hidden test — all agents summary-less ⇒ `flow-summaries` is null but `agent-card`s remain. These fail first.
- [x] `packages/flows-plugin/src/client/FlowSummary.tsx`: derive `summarised = agents.filter(a => a.summary)`; map `summarised` into rows; `Summaries ({summarised.length})`; wrap the whole Summaries subsection in `summarised.length > 0 && (...)`. Leave the frozen agent-card grid mapping over all `agents`. Verify tests pass.

## 3. Live-graph routing edges — cross-repo (D3)

### pi-flows (separate repo — `@blackbelt-technology/pi-flows`)
- [x] `extensions/flow-engine/flow-tui.ts` `onFlowStarted`: add `onComplete: (step as any).on_complete` and `onError: (step as any).on_error` to the serialized per-step object in the `flow:flow-started` payload. Add/extend a faux-flow test asserting the emitted steps carry the routing fields. Cut a pi-flows release.

### dashboard
- [x] `packages/shared/src/types.ts`: add `onComplete?: string; onError?: string` to `FlowState.dagSteps[]`.
- [x] `packages/flows-plugin/src/flow-reducer.ts` `flow_started`: copy `step.onComplete`/`step.onError` onto each stored `dagSteps` entry.
- [x] `packages/flows-plugin/src/client/FlowGraph.tsx`: thread `onComplete`/`onError` through `flowStateToGraphSteps` (carry on the graph step) and `computeLayout`'s `FlowEdgeStep` mapping into `deriveFlowEdges`.
- [x] Tests: `flow-edges.test.ts` — live-shaped steps with `onComplete`/`onError` produce `route` edges incl. a pre-separator root (no orphan), and a routing target suppresses the spurious `implicit` edge. `FlowGraph.test.ts` / reducer test — `flow_started` with routing fields lands them on `dagSteps`. Assert backward-compat: steps without the fields produce no `route` edges.

## 4. on_complete label policy (D4)

- [x] Tests first: `FlowYamlPreview.test.tsx` / `flow-yaml-parse` test — a `route` `on_complete` edge renders as plain `-->` (no `|on_complete|`); `branch`/`on_error` labels retained. `FlowGraph.test.ts` — live graph suppresses the `on_complete` edge label.
- [x] `packages/flows-plugin/src/client/flow-yaml-parse.ts` `flowToMermaid`: in the edge loop, treat `label === "on_complete"` as unlabeled (fall to the plain `-->` branch); keep `on_error` dashed + `branch` labeled.
- [x] `packages/flows-plugin/src/client/FlowGraph.tsx`: suppress the rendered edge label when `edge.label === "on_complete"`.

## 5. Persist flow panel collapse per session (D5)

- [x] Tests first: new `flow-collapse-storage` test (collapse persists per `sessionId`, isolated across sessions, default expanded, localStorage-throw degrades to in-memory). `FlowSummary.test.tsx` — collapse panel → remount same `sessionId` ⇒ collapsed; different `sessionId` ⇒ expanded. Add an equivalent `FlowDashboard` collapse test.
- [x] `packages/flows-plugin/src/client/flow-collapse-storage.ts` (new): `readBoolean`/`writeBoolean` try/catch helpers + `useFlowCollapsePersisted(sessionId, kind)` hook returning `[collapsed, toggle]`; keys `dashboard:flow-summary-collapsed:<sessionId>` / `dashboard:flow-dashboard-collapsed:<sessionId>`. Mirror `useSidebarState.ts`.
- [x] `FlowSummary.tsx`: back `panelCollapsed` with the hook (lazy init from storage, write-through on toggle); keep the Summaries-list `collapsed` and per-row `open` ephemeral.
- [x] `FlowDashboard.tsx`: back `collapsed` with the hook. Leave `mobileExpanded` ephemeral unless trivially shared.

## 6. Error-route layer hidden by default + persisted (added in QA)

- [x] `flow-collapse-storage.ts`: generalize to `usePersistedToggle(key, fallback)` (in-memory when key null; re-sync on key change; degrade on throw); refactor `useFlowCollapsePersisted` to delegate; export `FLOW_SHOW_ERROR_ROUTES_KEY`.
- [x] `FlowGraph.tsx`: default `showErrorRoutes` to **false**; back it with `usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false)` (global, not session-scoped); `⚠` button calls the persisted toggle.
- [x] Tests: `flow-collapse-storage.test.ts` — `usePersistedToggle` defaults to fallback, persists on/off across remounts under the global key, degrades on localStorage throw.

## Validate

- [x] `npm test` — 8407 passed; only failure is the pre-existing **environmental** `docker compose` interpolation test (the `docker` binary in this env is not compose v2: `unknown shorthand flag: 'f'`), unrelated to this change. All client-utils / flows-plugin / shared suites green incl. every new test.
- [x] Type-check + Biome on the diff: `tsc --noEmit` clean (exit 0); `biome check --write` applied formatting/import-order; remaining are **pre-existing** warnings only (8 cognitive-complexity on large functions; 2 noUnusedImports = `React` default + an mdi icon, both on HEAD). New `flow-collapse-storage.ts` warning-free; no new Biome errors. (Full `quality:changed` re-runs `npm test` → same env-only docker failure.)
- [x] Manual / e2e: load a fully `on_complete`-routed flow (e.g. InvoiceBot `process`); confirm `load-state → resume-gate` and the sequential spine render, no orphan node, no spurious parallel fan-out, happy-path arrows unlabeled, and live graph matches the `flow_write` Mermaid preview.
- [x] Manual: click a graph node → selects; drag over a node → pans; Expand/error-routes/zoom buttons clickable; FlowSummary with a summary-less step → that row absent, count correct.
- [x] Manual: collapse a session's flow panel → reload / re-navigate → stays collapsed; a different session → still expanded; live FlowDashboard collapse restored independently.
- [x] Code-review gate (`review-changes.ts`) on the diff before commit.
- [x] Rebuild + deploy: `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`. (Electron `out/`/`resources/` plugin copies refresh via build.)
