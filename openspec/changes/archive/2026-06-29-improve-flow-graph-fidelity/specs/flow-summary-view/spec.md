## ADDED Requirements

### Requirement: Completed summary panel collapses to its header

The completed-flow `FlowSummary` SHALL provide a whole-panel collapse control in its header, beside Dismiss, distinct from BOTH the per-agent row disclosure AND the summary-lines section collapse. Activating it SHALL hide the entire panel body (flow graph, frozen agent cards, summary-lines section, and next-step suggestion), leaving only the header bar (flow name, status, step/duration meta, the toggle, and Dismiss). It SHALL default to expanded and SHALL be reversible. Collapsing SHALL NOT dismiss the panel — the socket/summary remains mounted.

#### Scenario: Collapse shrinks the panel to its header
- **WHEN** the user activates the whole-panel collapse control
- **THEN** the flow graph, frozen agent cards, summary-lines section, and next-step suggestion SHALL be hidden
- **AND** the header (flow name, meta, toggle, Dismiss) SHALL remain visible
- **AND** the summary SHALL NOT be dismissed

#### Scenario: Expand restores the body
- **WHEN** the user activates the control again on a collapsed panel
- **THEN** the full panel body SHALL render again

#### Scenario: Distinct from the footer section collapse
- **WHEN** the panel-level collapse is toggled
- **THEN** it SHALL operate independently of the existing summary-lines section collapse (the footer toggle that hides only the per-agent summary rows while keeping cards)
