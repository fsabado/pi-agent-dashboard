## MODIFIED Requirements

### Requirement: Shared flow-edge derivation

The flows plugin SHALL provide one pure edge-derivation function that maps a flow's steps to a canonical edge set, consumed by BOTH the live `FlowGraph` and the static `flow_write` Mermaid snapshot. Given a minimal step shape (`id`, `type`, `blockedBy`, optional `branches`, optional `onComplete`, optional `onError`) plus declared step order, it SHALL return a typed edge list where each edge carries `from`, `to`, optional `label`, a `kind` of `sequential` | `branch` | `route` | `implicit`, and a `backward` flag. Both renderers SHALL derive their edges from this function rather than from independent rules.

Both callers SHALL pass `onComplete`/`onError` when present so that `route` edges appear in BOTH the live graph and the static snapshot. The live caller obtains these fields from the `flow:flow-started` per-step payload; the static caller parses them from the flow YAML. The function derives only the edge classes its input carries — a step that declares no routing yields no `route` edge — so a flow whose forward flow is wired through `on_complete`/`on_error` (rather than `blockedBy`) SHALL render its routing edges identically in both views, including the edge from a step declared before any decision node.

An `implicit` edge models a **segment boundary** the engine serializes — NOT a generic fall-through. The function SHALL synthesize an `implicit` edge from a predecessor to a step only when that step has no `blockedBy`, has no other incoming edge (including no incoming `route` edge), AND its immediate predecessor in declared order is a **separator** (`fork` / `agent-decision` / `code-decision`; `flow-ref` is NOT a separator). Two ordinary steps in the same segment, where the later has no `blockedBy` and no dependency on the earlier, are **parallel siblings**: the function SHALL NOT synthesize an edge between them, so the layout places them at the same rank. This mirrors the engine wave scheduler, which runs every step whose `blockedBy ⊆ completed` — including any step with no `blockedBy` — in the same wave.

#### Scenario: Route edges appear in both views
- **WHEN** the derivation runs over two step lists carrying identical `blockedBy` + `branches` + `onComplete`/`onError` data (one from `flow:flow-started`, one from parsed YAML)
- **THEN** it SHALL produce the same set of `{from, to}` edges including the `route` edges (modulo renderer-specific styling)

#### Scenario: on_complete-routed step before any separator is connected
- **WHEN** a step declared before any separator routes forward only via `on_complete` (no `blockedBy`, not a branch target)
- **THEN** the derivation SHALL emit a `route` edge from that step to its `on_complete` target
- **AND** the step SHALL NOT be left without an outgoing edge in either renderer

#### Scenario: Routing target suppresses a spurious implicit edge
- **WHEN** a step with no `blockedBy` is the `on_complete`/`on_error` target of an earlier step
- **THEN** it SHALL have an incoming `route` edge and the derivation SHALL NOT additionally synthesize an `implicit` edge to it from the nearest separator

#### Scenario: Four edge classes derived
- **WHEN** a flow has `blockedBy` deps, decision `branches`, an `on_complete`/`on_error` route, and a step after a separator (`fork` / `agent-decision` / `code-decision`) with no `blockedBy` and no incoming route
- **THEN** the edge list SHALL include a `sequential`, a `branch`, a `route`, and an `implicit` edge respectively
- **AND** the separator set SHALL NOT include `flow-ref`

#### Scenario: Backward edge flagged
- **WHEN** a decision branch (or routing) targets a step declared earlier than its source
- **THEN** that edge SHALL have `backward: true`

#### Scenario: Duplicate edges collapse
- **WHEN** a decision branch target also appears in the same step's `blockedBy` (or an `on_complete` equals an existing sequential edge)
- **THEN** the derivation SHALL emit a single edge, preferring the labeled branch/route classification over the plain sequential one

## ADDED Requirements

### Requirement: on_complete route edges render without a label

Both the live `FlowGraph` and the static `flow_write` Mermaid snapshot SHALL render a `route` edge whose label is `on_complete` as a plain forward edge with NO visible label. Edge labels SHALL be shown only for `branch` edges (the branch name) and `on_error` route edges (their topology marker). This keeps a fully `on_complete`-routed flow legible — its happy-path spine reads as plain arrows rather than a chain of repeated `on_complete` labels — and keeps the two renderers visually consistent.

#### Scenario: on_complete edge is unlabeled
- **WHEN** a `route` edge carries the label `on_complete`
- **THEN** the rendered edge SHALL be a plain solid forward arrow with no text label, in both the live graph and the Mermaid snapshot

#### Scenario: branch and on_error labels retained
- **WHEN** an edge is a decision `branch` or an `on_error` route
- **THEN** its label (branch name, or the `on_error` topology marker ↺/⊗) SHALL still be rendered

### Requirement: Error-route layer hidden by default and its visibility persists

The live `FlowGraph` error-route layer SHALL default to **hidden**, so a graph first renders showing only the happy path; the `⚠` toggle reveals the on_error edges + error-only handler nodes. The toggle state SHALL persist on the frontend in `localStorage` as a single **global** viewing preference (key `dashboard:flow-show-error-routes`) — not per session — because `FlowGraph` is a shared low-level component (summary, live dashboard, expand dialog) without a reliable session id. Reads/writes SHALL degrade to in-memory on `localStorage` failure. A user who turns error routes on SHALL find them on across remounts and across other graphs until they turn them off.

#### Scenario: Hidden by default on first view
- **WHEN** a flow graph with on_error routes renders and no stored preference exists
- **THEN** the error-route layer SHALL be hidden (only the happy path shown), with the `⚠` toggle available to reveal it

#### Scenario: Toggle state persists globally
- **WHEN** the user toggles error routes on (or off) on any graph
- **THEN** the choice SHALL be written to `localStorage` and restored on remount and on other graphs, until changed
