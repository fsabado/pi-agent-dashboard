## Why

Four related flow-UI defects, all surfaced while inspecting a real headless flow (`InvoiceBot/.pi/flows/flows/invoicebot/process/flow.yaml`):

1. **Node clicks are dead in the flow graph.** `useZoomPan.onPointerDown` calls `setPointerCapture` *immediately*. Pointer capture retargets the synthesized `click` to the container, so a node's `onClick` (graph⇄card selection) never fires. Three FlowGraph buttons (Expand, error-routes, ZoomControls) were band-aided with `onPointerDown → stopPropagation` to dodge the same capture; nodes never got the patch. The bug is the eager capture, not the buttons.

2. **Empty summary rows render as dead labels.** `FlowSummary` maps *every* agent into a `FlowSummaryRow`; a step with no summary text shows a bare status-icon + label and nothing else, and `Summaries (N)` counts them. Noise.

3. **The live flow graph drops `on_complete`/`on_error` edges, orphaning nodes.** pi-flows' `flow:flow-started` serializes only `{id, stepType, agent, blockedBy, branches}` — it omits the routing fields. Flows that wire their spine through `on_complete` (not `blockedBy`) lose every sequential edge on the live graph. `load-state` (declared before any decision node) gets no edge at all and dangles; downstream steps get misleading `implicit` fan-outs from the nearest decision node, inventing parallelism a `max_concurrent: 1` flow never runs. The static `flow_write` Mermaid renders these flows **correctly** (it parses the YAML directly), so the two views drift — contradicting the shared-deriver's stated invariant.

4. **`on_complete` label noise + view convergence.** Once route edges render live, a fully `on_complete`-routed flow labels *every* happy-path arrow `on_complete`. The shared renderers should suppress the `on_complete` label (plain solid arrow) and keep labels for `branch`/`on_error` only — applied identically to the live `FlowGraph` and the static Mermaid so they stay identical.

5. **Flow panel collapse does not persist.** The flow socket's collapse states (`FlowSummary.panelCollapsed`, `FlowDashboard.collapsed`) are ephemeral `useState(false)` — every remount/reload re-opens them, so a user who collapses a session's flow panel must collapse it again and again. The collapse state should persist per session on the frontend. (QA also surfaced that `FlowDashboard` never forwarded `sessionId` into the completed-flow `FlowSummary`, so even once persistence was added it no-opped — fixed here.)

6. **Error routes clutter the graph by default.** `FlowGraph` showed the on_error layer by default and reset the toggle on every remount. For a flow with many `on_error: hold` edges (e.g. InvoiceBot, where every step routes to `hold`) this buries the happy path. Error routes should be hidden by default and the toggle choice should persist.

## What Changes

- **Drag threshold in `useZoomPan`** (`packages/client-utils/src/useZoomPan.ts`): on `pointerdown` record the start point but do **not** capture; on `pointermove` enter drag (`setPointerCapture` + translate) only once movement exceeds a threshold (~4px, squared compare). A `pointerup` under threshold is a clean click → node `onClick` / button `onClick` fire normally. Delete the three `onPointerDown → stopPropagation` hacks in `FlowGraph.tsx` (lines 436/447/456). Shared hook → restores node selection in `FlowGraph`, leaves `MermaidBlock`/`ImageLightbox` click+pan working.
- **Hide empty summary rows** (`packages/flows-plugin/src/client/FlowSummary.tsx`): the Summaries list SHALL skip agents with no summary text (`!agent.summary`), even if they carry files/typed outputs (those remain visible in the frozen cards + graph). `Summaries (N)` reflects the *filtered* count; the whole Summaries subsection (header + divider) is hidden when zero rows remain. Frozen agent cards are unchanged (still one per agent).
- **Surface routing edges on the live graph** — cross-repo:
  - **pi-flows** (`extensions/flow-engine/flow-tui.ts onFlowStarted`): include `onComplete` / `onError` in the per-step `flow:flow-started` payload.
  - **dashboard**: thread the two fields through `FlowState.dagSteps` (`packages/shared/src/types.ts`), the `flow_started` reducer (`flow-reducer.ts`), `flowStateToGraphSteps` + `computeLayout`'s `FlowEdgeStep` mapping (`FlowGraph.tsx`). `deriveFlowEdges` already emits `route` edges — once fed the data the live graph converges onto the already-correct static Mermaid. Backward-compatible: absent fields → today's behavior (no route edges), so an old pi-flows keeps working.
- **`on_complete` label policy**: in both renderers (`FlowGraph.tsx` edge labels + `flow-yaml-parse.ts flowToMermaid`), render `route` edges labeled `on_complete` as a plain solid arrow (no label); keep labels for `branch` and `on_error`.
- **Persist flow panel collapse per session** (frontend): a small localStorage-backed helper (`flow-collapse-storage.ts`, mirroring `useSidebarState.ts`) exposes a generic `usePersistedToggle(key, fallback)` plus a session-keyed `useFlowCollapsePersisted`. Backs `FlowSummary.panelCollapsed` and `FlowDashboard.collapsed`; keys namespaced by purpose + session id; default expanded; localStorage failure degrades to in-memory. `FlowDashboard` forwards `sessionId` into the completed-flow `FlowSummary` so persistence actually scopes (was unset → in-memory only). The Summaries-list toggle and per-row expansion stay ephemeral.
- **Error-route layer off by default + persisted** (frontend): `FlowGraph`'s `showErrorRoutes` defaults to **hidden** (happy path only; `⚠` toggle reveals on_error edges). The toggle persists as a single **global** viewing preference (`usePersistedToggle(FLOW_SHOW_ERROR_ROUTES_KEY, false)`) — not per session, since `FlowGraph` is a shared component without a reliable session id.

## Capabilities

### Added Capabilities

- `zoom-pan-click-threshold`: the shared `useZoomPan` hook disambiguates click from drag via a movement threshold, deferring pointer capture so under-threshold taps remain clicks across all three consumers (`FlowGraph` node selection, `MermaidBlock`, `ImageLightbox`).

- `flow-panel-collapse-persistence`: the flow socket's whole-panel (`FlowSummary`) and live-dashboard (`FlowDashboard`) collapse states persist per session in `localStorage`, defaulting to expanded.

### Modified Capabilities

- `flow-summary-view`: the per-agent Summaries list hides rows with no summary text and hides the whole subsection when none remain; the count is the filtered count. (Frozen cards unchanged.)
- `flow-graph-edges`: the live `FlowGraph` now receives `onComplete`/`onError` and derives `route` edges (was static-only), so both renderers produce matching edges for `on_complete`-routed flows; `route` edges labeled `on_complete` render unlabeled; the error-route layer is hidden by default and its visibility persists globally in `localStorage`.

## Impact

- **Code (dashboard)**: `packages/client-utils/src/useZoomPan.ts`, `packages/flows-plugin/src/client/{FlowGraph.tsx,FlowSummary.tsx,FlowDashboard.tsx,flow-yaml-parse.ts,flow-collapse-storage.ts (new)}`, `packages/flows-plugin/src/flow-reducer.ts`, `packages/shared/src/types.ts`.
- **Code (pi-flows, separate repo)**: `extensions/flow-engine/flow-tui.ts` (`onFlowStarted` payload). Requires a pi-flows release; the dashboard side is backward-compatible without it (route edges simply stay absent).
- **Tests**: `packages/client-utils/src/__tests__/useZoomPan.test.ts` (add pointer-threshold coverage — none today), `packages/flows-plugin/src/__tests__/FlowSummary.test.tsx` (rewrite the `bare-step` "not interactive" test → "hidden"; add filtered-count + section-hidden coverage), `packages/flows-plugin/src/__tests__/{flow-edges,FlowGraph,FlowYamlPreview}.test.*` (route edges on the live path + `on_complete` label suppression).
- **Build artifacts**: `packages/electron/{out,resources}/…/FlowGraph.tsx` are copied plugin resources; refreshed by `npm run build`, not edited.
- **Out of scope**: removing the latent-dead `files?: string[]` field on `FlowAgentState` and the `files: result?.files` reducer line (separate cleanup); `pointercancel` handling; making the drag threshold configurable.
