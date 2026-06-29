## 1. Resolve open questions (design.md) — DONE

- [x] 1.1 RESOLVED: `flow:flow-started` carries `stepType` (separator info present) but NOT `on_error`/`on_complete`. → parallel correctness unblocked both paths; live on_error needs pi-flows to add `onComplete`/`onError` to the steps map (§8); static on_error unblocked. See design.md.
- [x] 1.2 RESOLVED: terminal-sink uses click-to-expand (nodes already clickable buttons)
- [x] 1.3 RESOLVED: shared returning handler → one node, one loop arc per source; no bundling in v1

## 2. Parallel correctness — implicit edge models separators only (flow-graph-edges)

- [x] 2.1 Write failing test: two same-segment steps with no `blockedBy` and no dependency between them produce NO implicit edge (parallel siblings, `flow-edges.test.ts`)
- [x] 2.2 Write failing test: a step immediately after a separator (`fork`/`agent-decision`/`code-decision`) with no `blockedBy` STILL gets an implicit edge from that separator
- [x] 2.3 Narrow the implicit-edge synthesis in `deriveFlowEdges` to fire only when the predecessor is a separator (last-separator model: all no-blockedBy roots fan out from the preceding separator, never chained to each other)
- [x] 2.4 Make 2.1/2.2 pass; existing `flow-edges.test.ts` cases unaffected (all prior implicit cases used a separator predecessor)
- [x] 2.5 Add `FlowGraph.test.ts` assertion: no-blockedBy parallel roots land in the same rank (same x, stacked y)

## 3. on_error topology classification (flow-graph-edges)

- [x] 3.1 Write failing test: a route edge whose handler rejoins the main path is classified `routeTopology: "returning"`
- [x] 3.2 Write failing test: a route edge whose handler never rejoins is classified `routeTopology: "terminal"`
- [x] 3.3 Implement the reachability pass in `deriveFlowEdges` (`classifyRouteTopology`, reachability over non-on_error edges) tagging each `on_error` route edge with `routeTopology`
- [x] 3.4 Make 3.1/3.2 pass; shared-handler case covered (collapse test routes two sources to one handler)

## 4. on_error rendering — returning loop arc + terminal sink (FlowGraph)

- [x] 4.1 Write failing render test: a returning route renders as a loop arc (`isError`) and is excluded from dagre forward edges
- [x] 4.2 Write failing render test: terminal routes collapse into ONE tail sink node (`errorSink` + `terminalEdges`)
- [x] 4.3 Render returning routes via the loop-arc path, red-tinted (`isError` → `#ef4444`)
- [x] 4.4 Render the collapsed `⚠ N exits` sink node; click toggles `sinkExpanded` (handler list stacks below)
- [x] 4.5 Make 4.1/4.2 pass (computeLayout data layer + SVG render)

## 5. Layout-aware error toggle (FlowGraph)

- [x] 5.1 Write failing test: with the error layer OFF, the dagre input contains no error nodes/edges and graph height equals the no-error-routes baseline
- [x] 5.2 Implement the toggle so OFF removes error-only nodes + all on_error edges from the dagre input (not opacity); `computeLayout(steps, { showErrorRoutes })` + `⚠ error routes` button re-runs layout via useMemo dep
- [x] 5.3 Make 5.1 pass

## 6. Static preview parity (flow_write Mermaid snapshot)

- [x] 6.1 Confirm `flow-yaml-parse.ts` supplies the fields the classification needs (passes `onComplete`/`onError`; shared `deriveFlowEdges` applies implicit-edge fix + `routeTopology` automatically)
- [x] 6.2 Render `on_error` routes topology-distinctly in the Mermaid snapshot (↺ returning loop / ⊗ terminal sink, always dashed); implicit-edge parity is inherited via shared `deriveFlowEdges`. +test

## 7. Validate

- [x] 7.1 flows-plugin suite green (127 pass) + client ResizableSidebar (9) + typecheck clean
- [x] 7.2 Biome on changed files: **0 errors** (CI hard-gate clean); 10 warn-tier remain, all pre-existing repo patterns (`useButtonType`, inherent layout complexity, `useExhaustiveDependencies`). Removed 3 unused `React` imports introduced into changed files. `quality:changed --changed` needs staged diff to scope; ran biome directly on the changed set instead.
- [x] 7.3 In-browser verified: graph layout (0 crossings, flatter), Expand opens centered dialog, pan/zoom in both inline + dialog, fit-window summary scroll box, left chevron. Live on_error topology remains gated on the deferred pi-flows companion (§8).
- [x] 7.4 `openspec validate improve-flow-graph-fidelity --strict` → valid

## 9. ResizableSidebar z-index occlusion fix (bug fix)

- [x] 9.1 Bump both collapse/expand toggle buttons `z-10` → `z-30` in `ResizableSidebar.tsx` so they win over the `content-header-sticky` slot
- [x] 9.2 Add `ResizableSidebar.test.tsx` assertion: both toggles carry `z-30`
- [x] 9.3 Full client suite green (1365 pass)

## 10. FlowSummary whole-panel collapse (flow-summary-view)

- [x] 10.1 Add `panelCollapsed` state + a header chevron beside Dismiss (distinct from the footer `collapsed`)
- [x] 10.2 Wrap the panel body (graph, cards, summary-lines, next-step) so collapse shrinks to the header bar; not dismiss
- [x] 10.3 Write `FlowSummary.test.tsx`: panel-toggle hides body + keeps name, reversible
- [x] 10.4 flows-plugin suite green (116 pass)
- [x] 10.5 Fit-window: wrap everything UNDER the graph (cards + summaries + next-step) in ONE fixed-height (`maxHeight:48vh`) `overflow-y-auto` scroll box so the panel always fits the viewport; summaries section + per-agent rows stay collapsible inside; Dialog kept outside the box. +test (`flow-summary-scrollbox`)

## 11. Graph layout/edge-routing overhaul — edges never cross nodes (F)

- [x] 11.1 Probe-verify dagre `acyclicer:"greedy"` routes the cyclic roundtrip graph with 0 node crossings + correct arrow direction
- [x] 11.2 Rewrite `computeLayout`: feed ALL edges (forward + backward + branch + route) to dagre with acyclicer; render every edge from dagre's node-avoiding waypoints. Terminal on_error edges redirect to a synthetic sink dagre-node (collapse preserved, routed cleanly)
- [x] 11.3 Collapse the 3 hand-routed render blocks (forward/loop/terminal) into ONE edges loop styled by class (red on_error ↺/⊗, purple loop, status-grey); delete the leg geometry that sliced through nodes
- [x] 11.4 Keep node style + sizes unchanged; cards untouched
- [x] 11.5 Update FlowGraph.test.ts to the new edge model (isLoop/isError/isReturning); 118 flows-plugin tests green, tsc clean
- [x] 11.6 Visual verify: new layout 0 edge-point-in-node crossings on the full roundtrip graph (loops + on_error fan-in)
- [x] 11.7 Re-enable pan/zoom in the in-socket (`fit`) view (was dialog-only): attach pan handlers + zoom transform + `ZoomControls` in fit too, clipped by the bounded socket (overflow:hidden); move Expand button to bottom-right to clear the top-right zoom stack
- [x] 11.8 Move FlowSummary whole-panel collapse chevron to the left (minimal, before the flow name), not beside Dismiss
- [x] 11.9 Flatter dagre params (nodesep 12 / edgesep 8 / ranksep 46) — ~19% shorter, edges may overlap slightly (accepted)
- [x] 11.10 Fix Expand + zoom/error controls click (pan `setPointerCapture` was swallowing them): `onPointerDown` stopPropagation on each control. Center the graph (`flex items-center justify-center` + full-size container) so the expanded dialog aligns to the middle; keep pan/zoom in BOTH inline and dialog

## 8. Deferred — pi-flows companion (separate repo; NOT part of this dashboard change)

Live on_error topology renders the moment the data arrives; the dashboard side is forward-compatible today. This is a tracked cross-repo follow-up, not a deliverable of this change. The static `flow_write` Mermaid preview (§6) already shows on_error topology regardless.

- pi-flows: add `onComplete`/`onError` to the per-step object emitted on `flow:flow-started` (`flow-tui.ts:573-582`)
- dashboard: widen `dagSteps` protocol type (`shared/types.ts:957`) + `FlowGraphStep` + `flowStateToGraphSteps` + the `FlowEdgeStep` mapping to carry them
- no new event / no `FLOW_EVENT_MAP` entry — the field rides inside the existing `flow_started` payload
- the two repos land independently; live topology appears once both ship
