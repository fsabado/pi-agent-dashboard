# flow-panel-collapse-persistence Specification

## Purpose
TBD - created by archiving change fix-flow-ui-graph-zoom-summary. Update Purpose after archive.
## Requirements
### Requirement: Flow panel collapse state persists per session

The collapse/expand state of the flow socket SHALL persist per session across remounts and page reloads, so a user who collapses a session's flow panel does not have to collapse it again every time that session re-renders. Two collapse states are persisted, each keyed by session id:

- the **whole-panel collapse** of the completed-flow `FlowSummary` (its `panelCollapsed`), and
- the **live `FlowDashboard` collapse** (its `collapsed`).

State SHALL be stored on the frontend in `localStorage`, under keys namespaced by both purpose and session id (e.g. `dashboard:flow-summary-collapsed:<sessionId>` and `dashboard:flow-dashboard-collapsed:<sessionId>`). Reads and writes SHALL be wrapped so a `localStorage` failure (quota, disabled storage, private mode) degrades to in-memory state without throwing. A session that has never been collapsed SHALL default to **expanded** (current behavior). Persistence SHALL be scoped per session id: collapsing one session's panel SHALL NOT change another session's persisted state. The Summaries-list subsection toggle and the agent-row expansion remain ephemeral (not persisted) in this change.

#### Scenario: Collapse is remembered on remount
- **WHEN** the user collapses a session's flow panel and that component later remounts (navigation, reload, re-render)
- **THEN** the panel SHALL render collapsed for that session without further user action

#### Scenario: Untouched session defaults to expanded
- **WHEN** a session's flow panel has no stored collapse state
- **THEN** it SHALL render expanded

#### Scenario: Per-session isolation
- **WHEN** the user collapses session A's flow panel
- **THEN** session B's persisted collapse state SHALL be unchanged, and session B SHALL still render per its own stored (or default) state

#### Scenario: Live dashboard collapse persists independently
- **WHEN** the user collapses the live `FlowDashboard` for a session
- **THEN** that collapse SHALL be restored for the same session on remount, independently of the `FlowSummary` whole-panel collapse

#### Scenario: localStorage failure degrades gracefully
- **WHEN** reading or writing `localStorage` throws (disabled/quota/private mode)
- **THEN** the collapse toggle SHALL still function for the current mount using in-memory state and SHALL NOT throw

