## MODIFIED Requirements

### Requirement: Summary shows per-agent results
The summary SHALL list each agent with a status icon (✓ complete, ⚠ error/blocked, ○ pending) and file count. Each agent row SHALL be an independent expandable disclosure: collapsed it shows the status icon, label, step-type badge, file count, and a single truncated summary peek; expanded it reveals the full agent summary, the agent's typed outputs, the per-step file list, and the failure outcome where applicable.

#### Scenario: Agent with files
- **WHEN** an agent result has `files` entries
- **THEN** the collapsed summary line SHALL show the file count (e.g., "(3 files)")

#### Scenario: Collapsed row shows truncated peek
- **WHEN** an agent row is collapsed and the agent has summary text
- **THEN** the row SHALL show a leading collapsed chevron and a single truncated line of the summary

#### Scenario: Expanding a row reveals full detail
- **WHEN** the user clicks an agent row that has expandable content
- **THEN** the row SHALL expand to show the full agent summary rendered as markdown, any typed outputs as chips, the per-step file list, and the soft/hard failure outcome line when the agent failed

#### Scenario: Rows without detail are not expandable
- **WHEN** an agent row has no summary, no files, and no typed outputs
- **THEN** the row SHALL NOT show an interactive chevron and SHALL NOT expand

#### Scenario: Failed steps auto-expand
- **WHEN** the summary first renders and an agent has `status: "error"`
- **THEN** that agent's row SHALL render in the expanded state by default

#### Scenario: Per-row expansion is independent
- **WHEN** the user expands or collapses one agent row
- **THEN** the expanded state of other agent rows SHALL be unaffected
