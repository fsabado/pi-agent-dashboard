# Design

## Context

Two independent fidelity defects in the flow graph, both rooted in `deriveFlowEdges` + `FlowGraph` rendering, both verified against the pi-flows engine (`../pi-flows/extensions/flow-engine/flow-execution.ts`). Engine behavior is authoritative; the graph must mirror it.

## Decision 1 — `on_error` topology classification

### Engine fact

`on_error` routes to a real DAG step (`flow-execution.ts:507`). On routing, the engine narrows active steps to **those reachable from the target** (`computeActiveSteps(steps, routeTarget)`, `:512`). The handler is therefore NOT a dead end: everything downstream of it runs, including re-joining the happy path. So a handler has two topological flavors:

```
RETURNING handler                    TERMINAL handler (sink)
validate ──err──▶ fixup              finalize ──err──▶ notify
   ▲               │                              (nothing rejoins;
   └──── rejoins ──┘                               flow exits here)
   = live control flow                 = an outcome, not flow
```

### Classification (pure pass over derived edges)

For each `route` edge labeled `on_error` with source `S` and handler target `H`:

- **returning** — following forward edges from `H` (sequential `blockedBy`, `branch`, `on_complete`), the forward closure reaches a step on the main path at or after `S` (the handler rejoins the spine).
- **terminal** — otherwise (the forward closure from `H` never rejoins the main path).

This is a graph reachability computation on the already-derived edge set; no engine call. Tag the edge with `routeTopology: "returning" | "terminal"`.

### Render contract

| topology | render | rationale |
|---|---|---|
| returning | backward/loop arc below the spine, error-tinted; **excluded from dagre forward edges** | it IS a loop; `FlowGraph` already hand-routes backward edges below the band (`FlowGraph.tsx:178`) for agent-decision loops — reuse that path |
| terminal | collapse ALL terminal handlers into ONE tail sink node (`⚠ N exits`, expandable) | sinks are outcomes, not flow; collapsing kills the fan-in spaghetti |
| hidden (toggle off) | removed from dagre input entirely | graph height == a flow with no error routes; no reserved/ghost cells |

Mockup: `/tmp/on-error-viz-mockups-v2.html` (panels 1 + 3 = the shipped combination).

### Why not the simpler options

- Plain "show all route edges" (today's static preview) → fan-in spaghetti; this is the defect.
- "Hide behind a toggle but keep nodes in layout" → rejected: ghost nodes still inflate graph height (the explicit complaint that drove this design).
- "Badge-only, never draw" → loses the returning-loop signal, which is real control flow worth seeing.

## Decision 2 — `implicit` edge models separator boundaries only

### Engine fact

The wave scheduler (`flow-execution.ts:393`):

```js
const unblocked = steps.filter(s => {
  if (completed.has(s.id)) return false;
  if (!s.blockedBy) return true;                 // no blockedBy ⇒ unblocked in wave 1
  return s.blockedBy.every(dep => completed.has(dep) || !segmentStepIds.has(dep));
});
```

A no-`blockedBy` step runs in the FIRST wave, parallel with all other unblocked steps in its segment. There is no "fall through from the previous step." Inter-segment ordering is enforced by segmentation (`:368-370` — deps outside the segment are pre-satisfied because the preceding separator already completed).

### The defect

`deriveFlowEdges` kind #4 currently synthesizes `predecessor → step` whenever `step` has no `blockedBy` and no incoming edge. For two parallel siblings in one segment this is a FALSE serialization → they get consecutive dagre ranks → render in a row → read as sequential.

### Fix

Synthesize an `implicit` edge ONLY when the immediate predecessor is a **separator** (`fork` / `agent-decision` / `code-decision` — the same separator set the existing spec already names, excluding `flow-ref`). That models the real segment boundary. Two ordinary steps with no dependency between them get NO implicit edge → same dagre rank → vertical stack → reads as parallel.

```
no blockedBy, same segment          no blockedBy, after a separator
   impl   docs   (parallel)            decision ──▶ next  (segment boundary)
     └ same rank, stacked ┘               └ implicit edge kept ┘
```

Mockup: `/tmp/parallel-layout-mockup.html` (panel 1 correct, panel 2 the trap this fixes).

## Resolved questions

1. **Live-graph data — RESOLVED (split the work).** Verified the payload end-to-end:
   - `flow:flow-started` emits per-step `{ id, stepType, agent, blockedBy, branches }` (`pi-flows/extensions/flow-engine/flow-tui.ts:573-582`); the dashboard protocol type matches (`packages/shared/src/types.ts:957`). **No `on_error`/`on_complete`.**
   - **`stepType` IS carried** and `mapStepType` (`FlowGraph.tsx:35`) preserves separator identity (`fork` and `agent-decision`→`"fork"`, `code-decision`→`"code-decision"`).

   Therefore:
   - **Parallel correctness is unblocked on BOTH paths today** — separator detection needs only `stepType`, which is present live and in the static YAML. No pi-flows change required.
   - **on_error topology is unblocked on the static preview** (`flow-yaml-parse.ts:73` already parses `onError`) but **blocked on the live graph** until pi-flows adds `onComplete`/`onError` to the `flow:flow-started` steps map. Exact companion change: extend the `steps.map(...)` object in `flow-tui.ts:573-582` with `onComplete`/`onError`, then widen `dagSteps` in `types.ts:957`, `flowStateToGraphSteps` + `FlowGraphStep` (`FlowGraph.tsx:45`), and the `FlowEdgeStep` mapping (`FlowGraph.tsx:195`) to pass them through. No new event, no `FLOW_EVENT_MAP` entry (the field rides inside the existing `flow_started` payload).
   - **Landing order:** parallel correctness (§2) + static-preview on_error (§6) land with zero cross-repo coordination; the live on_error path (§3–5) lands after the pi-flows field addition.
2. **Terminal-sink expansion UX — RESOLVED.** Click-to-expand the collapsed `⚠ N exits` node into the individual handlers (graph nodes are already clickable buttons, `FlowGraph.tsx:388`). No hover-tooltip dependency.
3. **Returning + shared handler — RESOLVED.** Render the handler node once; draw one loop arc per source into it. No bundling in v1 — revisit only if a single handler accrues enough sources to crowd.

## Risks

- Reachability classification is O(nodes·edges) worst case per render — negligible for flow sizes (tens of steps), but memoize on the derived edge set.
- Narrowing `implicit` may remove edges some existing snapshot tests assert. Update tests to the engine-faithful behavior (the old assertions encoded the defect).
