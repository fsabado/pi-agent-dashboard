## MODIFIED Requirements

### Requirement: Summary shows per-agent results
The summary SHALL list each agent that has summary text with a status icon (✓ complete, ⚠ error/blocked, ○ pending) and file count. Each listed agent row SHALL be an independent expandable disclosure: collapsed it shows the status icon, label, step-type badge, file count, and a single truncated summary peek; expanded it reveals the full agent summary, the agent's typed outputs, the per-step file list, and the failure outcome where applicable.

Agents with no summary text SHALL be omitted from the per-agent Summaries list, even when they carry typed outputs or files — those agents remain visible in the frozen agent-card grid and in the flow graph. The `Summaries (N)` count SHALL be the number of listed (summary-bearing) agents, not the total agent count. When no agent has summary text, the entire Summaries subsection (its header, divider, and rows) SHALL NOT render. The frozen agent-card grid is unaffected by this filter and SHALL still show one card per agent.

#### Scenario: Agent with files
- **WHEN** a listed agent result has `files` entries
- **THEN** the collapsed summary line SHALL show the file count (e.g., "(3 files)")

#### Scenario: Collapsed row shows truncated peek
- **WHEN** an agent row is collapsed and the agent has summary text
- **THEN** the row SHALL show a leading collapsed chevron and a single truncated line of the summary

#### Scenario: Expanding a row reveals full detail
- **WHEN** the user clicks an agent row that has expandable content
- **THEN** the row SHALL expand to show the full agent summary rendered as markdown, any typed outputs as chips, the per-step file list, and the soft/hard failure outcome line when the agent failed

#### Scenario: Agent without summary text is omitted from the list
- **WHEN** an agent has no summary text (regardless of whether it has typed outputs or files)
- **THEN** that agent SHALL NOT appear as a row in the Summaries list
- **AND** it SHALL still appear in the frozen agent-card grid

#### Scenario: Count reflects only listed agents
- **WHEN** the flow has N agents of which M have summary text
- **THEN** the Summaries header SHALL read "Summaries (M)"

#### Scenario: Section hidden when no agent has summary text
- **WHEN** no agent in the flow has summary text
- **THEN** the Summaries subsection (header + divider + rows) SHALL NOT be rendered

#### Scenario: Failed steps auto-expand
- **WHEN** the summary first renders and a listed agent has `status: "error"`
- **THEN** that agent's row SHALL render in the expanded state by default

#### Scenario: Per-row expansion is independent
- **WHEN** the user expands or collapses one agent row
- **THEN** the expanded state of other agent rows SHALL be unaffected
