## Why

The flow graph (`packages/flows-plugin/src/client/FlowGraph.tsx`, edges from `flow-edges.ts`) has two fidelity defects that mislead authors reading a flow:

1. **`on_error` routing clutters the graph.** Every `route` edge is drawn alike, regardless of what the handler does. Multiple steps frequently route to ONE shared error handler, producing a fan-in of edges that cross the happy-path DAG and bury it. Worse, the naive "show the handler nodes" approaches reserve layout space even when the error topology is irrelevant to the reader.

2. **Parallel steps can render as a false serial chain.** The engine scheduler (`flow-execution.ts:393`) runs every step whose `blockedBy ⊆ completed` in the same wave — a step with **no `blockedBy` fires in wave 1, in parallel** with its siblings (ordering between segments is enforced separately by segment boundaries). But `deriveFlowEdges` synthesizes an `implicit` fall-through edge between ANY step and its immediate predecessor when the later one has no `blockedBy` and no incoming edge. Applied to two parallel siblings in the same segment, this manufactures a `A→B` edge that pushes them into consecutive dagre ranks — so they render left-to-right and read as sequential, contradicting how the engine actually runs them.

Both are rendering-layer defects: the engine behavior is correct; the graph misrepresents it.

## What Changes

- **Classify `on_error` routes by topology and render each flavor differently.** A route edge is **returning** when its handler, via forward edges, rejoins the main path (live control flow — the engine keeps running everything reachable from the handler, `flow-execution.ts:512`), or **terminal** when the handler's forward closure never rejoins (an exit/sink). Returning routes render as a backward/loop arc below the spine (reusing the existing hand-routed loop rendering, error-tinted) and do NOT feed dagre ranking. Terminal routes collapse into a single tail sink node instead of N inline handler nodes + N crossing edges.
- **Hidden error elements leave the layout entirely.** A layout-aware toggle for error routes SHALL remove error nodes/edges from the dagre input when off (graph height identical to a flow with no error routes), not merely style them invisible.
- **Fix the `implicit` edge so it models segment boundaries only.** `deriveFlowEdges` SHALL synthesize an `implicit` edge only when the predecessor is a **separator** (`fork` / `agent-decision` / `code-decision`) — i.e. an actual segment boundary the engine serializes. Two ordinary same-segment steps where the later has no `blockedBy` are **parallel siblings** and SHALL share a rank (no implicit edge between them), matching the engine's wave scheduler.
- Update `flow-edges.ts` unit tests and `FlowGraph` rendering tests for both changes.
- **Add a whole-panel collapse to the completed-flow `FlowSummary`.** A chevron beside Dismiss shrinks the panel to its header bar (hiding graph, cards, summary lines, next-step), distinct from the existing footer summary-lines collapse and from Dismiss. Ports the FlowDashboard collapse affordance to the completed summary, which only had Dismiss.
- **Fix a z-index occlusion bug** (bug fix, no behavioral contract): the `ResizableSidebar` collapse/expand toggle floats into the content area at `z-10`, where the `content-header-sticky` slot (also `z-10`) wins by DOM order and covers it. Bump the toggle to `z-30` so it stays clickable above sticky content.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `flow-graph-edges`: the `implicit` edge rule is narrowed to separator boundaries (parallel-sibling fidelity); `route` edges gain a derived topology classification (`returning` | `terminal`) and an associated render contract (returning → loop arc, terminal → collapsed tail sink, hidden → removed from layout).
- `flow-summary-view`: the completed-flow summary gains a whole-panel collapse (shrink-to-header), distinct from the footer summary-lines collapse and from Dismiss.

(The `ResizableSidebar` z-index change is a bug fix restoring intended stacking — no new behavioral contract, tracked as §9.)

## Cross-repo dependency (pi-flows)

Verified (design.md §1.1): `flow:flow-started` already carries `stepType` (so **separator info is present** — parallel correctness needs no engine change), but it emits steps WITHOUT `onComplete`/`onError` (`flow-tui.ts:573-582`). So:

- **Parallel correctness** (§2) and **static-preview `on_error`** (§6, `flow-yaml-parse.ts:73` already parses `onError`) land with **zero cross-repo coordination**.
- **Live-graph `on_error` topology** (§3–5) is gated on a one-field pi-flows companion (§8): add `onComplete`/`onError` to the `flow:flow-started` steps map. No new event, no `FLOW_EVENT_MAP` entry — the field rides inside the existing `flow_started` payload. The two repos land independently; the live behavior appears once both ship.

## Impact

- `packages/flows-plugin/src/client/flow-edges.ts` — narrow `implicit` rule to separator predecessors; add `routeTopology` classification (reachability pass) to `route` edges.
- `packages/flows-plugin/src/client/FlowGraph.tsx` — render returning routes as loop arcs; collapse terminal routes into a tail sink; layout-aware error toggle (remove from dagre input when hidden).
- `packages/flows-plugin/src/client/flow-yaml-parse.ts` — pass-through of any new fields needed for classification in the static preview.
- `packages/flows-plugin/src/client/FlowSummary.tsx` — whole-panel collapse (`panelCollapsed` state + header chevron + body wrap).
- `packages/client/src/components/ResizableSidebar.tsx` — collapse/expand toggle `z-10` → `z-30` (occlusion fix).
- Tests: `packages/flows-plugin/src/__tests__/flow-edges.test.ts`, `FlowGraph.test.ts`, `FlowSummary.test.tsx`; `packages/client/src/components/__tests__/ResizableSidebar.test.tsx`.
- Mockups (reference, not shipped): `/tmp/on-error-viz-mockups-v2.html`, `/tmp/parallel-layout-mockup.html`, `/tmp/on-error-final-ux.html`.
