## MODIFIED Requirements

### Requirement: Shared flow-edge derivation

The flows plugin SHALL provide one pure edge-derivation function that maps a flow's steps to a canonical edge set, consumed by BOTH the live `FlowGraph` and the static `flow_write` Mermaid snapshot. Given a minimal step shape (`id`, `type`, `blockedBy`, optional `branches`, optional `onComplete`, optional `onError`) plus declared step order, it SHALL return a typed edge list where each edge carries `from`, `to`, optional `label`, a `kind` of `sequential` | `branch` | `route` | `implicit`, and a `backward` flag. Both renderers SHALL derive their edges from this function rather than from independent rules. The function derives only the edge classes its input carries: the live caller passes `branches` (but no `onComplete`/`onError`, which pi-flows omits from `flow:flow-started`), so `route` edges appear only in the static caller's output.

An `implicit` edge models a **segment boundary** the engine serializes — NOT a generic fall-through. The function SHALL synthesize an `implicit` edge from a predecessor to a step only when that step has no `blockedBy`, has no other incoming edge, AND its immediate predecessor in declared order is a **separator** (`fork` / `agent-decision` / `code-decision`; `flow-ref` is NOT a separator). Two ordinary steps in the same segment, where the later has no `blockedBy` and no dependency on the earlier, are **parallel siblings**: the function SHALL NOT synthesize an edge between them, so the layout places them at the same rank. This mirrors the engine wave scheduler, which runs every step whose `blockedBy ⊆ completed` — including any step with no `blockedBy` — in the same wave.

#### Scenario: Same inputs yield the same edge set
- **WHEN** the derivation runs over two step lists carrying identical `blockedBy` + `branches` data
- **THEN** it SHALL produce the same set of `{from, to}` edges (modulo renderer-specific styling)
- **AND** any `route` edges SHALL appear only when the input carries `onComplete`/`onError`

#### Scenario: Four edge classes derived
- **WHEN** a flow has `blockedBy` deps, decision `branches`, an `on_complete`/`on_error` route, and a step after a separator (`fork` / `agent-decision` / `code-decision`) with no `blockedBy`
- **THEN** the edge list SHALL include a `sequential`, a `branch`, a `route`, and an `implicit` edge respectively
- **AND** the separator set SHALL NOT include `flow-ref`

#### Scenario: Parallel siblings are not serialized
- **WHEN** two steps in the same segment each have no `blockedBy` (or share the same `blockedBy`) and neither depends on the other, and the predecessor in declared order is NOT a separator
- **THEN** the derivation SHALL NOT synthesize an `implicit` edge between them
- **AND** the two steps SHALL be eligible for the same layout rank (rendered as a vertical stack, not a left-to-right chain)

#### Scenario: Implicit edge kept only across a separator boundary
- **WHEN** a step with no `blockedBy` and no incoming edge immediately follows a separator step (`fork` / `agent-decision` / `code-decision`)
- **THEN** the derivation SHALL synthesize an `implicit` edge from that separator to the step

#### Scenario: Backward edge flagged
- **WHEN** a decision branch (or routing) targets a step declared earlier than its source
- **THEN** that edge SHALL have `backward: true`

#### Scenario: Duplicate edges collapse
- **WHEN** a decision branch target also appears in the same step's `blockedBy` (or an `on_complete` equals an existing sequential edge)
- **THEN** the derivation SHALL emit a single edge, preferring the labeled branch/route classification over the plain sequential one

## ADDED Requirements

### Requirement: on_error routes classified and rendered by topology

Each `route` edge labeled `on_error` SHALL carry a derived `routeTopology` of `returning` or `terminal`, computed purely from the derived edge set (no engine call). A route is **returning** when, following forward edges (`sequential` / `branch` / `on_complete`) from its handler target, the forward closure reaches a step on the main path at or after the route's source — the handler rejoins the flow. A route is **terminal** otherwise — its handler's forward closure never rejoins the main path. The classification reflects the engine, which keeps executing every step reachable from an `on_error` target after routing to it.

Renderers SHALL draw the two flavors differently. The error-route layer SHALL be shown by default and SHALL be toggleable per graph:

- Every edge (including backward/loop and on_error routes) SHALL be routed by the layout engine through node-avoiding channels, such that no edge's rendered path intersects a node's bounding box. Hand-routed paths that only clear nodes on their horizontal run are NOT permitted.
- A **returning** route SHALL be styled as an error-tinted loop edge (visually distinct from a normal decision loop — e.g. red vs purple) carrying its `returning` topology, routed (not hand-arced) so it does not cross nodes.
- All **terminal** routes SHALL collapse into a single tail sink node (e.g. `⚠ N exits`) rather than N inline handler nodes with N crossing edges; the node SHALL be expandable to reveal the individual handler ids.
- When the error-route layer is toggled off, ALL on_error edges AND every **error-only** node (a node whose only incoming edges are on_error routes — both returning and terminal handlers) SHALL be removed from the dagre layout input entirely, such that graph height equals that of an otherwise-identical flow declaring no error routes. Hiding SHALL NOT be implemented as opacity over reserved layout cells.

#### Scenario: Returning handler classified and looped
- **WHEN** a step's `on_error` targets a handler whose forward edges rejoin the main path
- **THEN** the route edge SHALL have `routeTopology: "returning"`
- **AND** it SHALL render as an error-tinted loop-styled edge whose routed polyline does not intersect any node box

#### Scenario: No edge crosses a node
- **WHEN** a flow contains loops and/or on_error routes (backward branches, returning/terminal handlers)
- **THEN** every rendered edge polyline SHALL avoid all node bounding boxes (zero edge-point-in-node intersections)

#### Scenario: Terminal handlers collapse to one sink
- **WHEN** two or more steps route `on_error` to handlers whose forward closures never rejoin the main path
- **THEN** each such route edge SHALL have `routeTopology: "terminal"`
- **AND** the renderer SHALL collapse them into a single expandable tail sink node rather than drawing each handler inline

#### Scenario: Hidden error layer costs no layout
- **WHEN** the error-route layer is toggled off
- **THEN** the dagre layout input SHALL contain no error nodes or error edges
- **AND** the resulting graph height SHALL equal that of the same flow with no `on_error` declared
