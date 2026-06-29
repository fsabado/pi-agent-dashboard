## Why

The flow summary card (`FlowSummary`) renders each completed step as a single truncated line, clipping the agent's full summary and silently dropping the typed outputs and per-step files that already live in `FlowAgentState`. The user cannot read why a step decided what it did, or which files it touched, without leaving the summary. Every other disclosure in the app (`ToolCallStep`, `SkillInvocationCard`, `CollapsedToolGroup`) uses a per-row chevron expand; the summary card is the lone exception.

## What Changes

- Each per-step row in `FlowSummary` gains an independent chevron-disclosure (`▸`/`▾`), matching the `ToolCallStep` idiom.
- **Collapsed** row keeps today's behaviour: status icon, label, badges, file count, and the existing one-line truncated summary peek (no regression for skimming).
- **Expanded** row reveals the full agent `summary` (rendered via the `ui:markdown-content` primitive), the per-step `typedOutputs` as chips, the per-step `files` list, and the soft/hard failure outcome line — all data already present in `FlowAgentState`, no new events or fetches.
- Rows for failed steps (`status: "error"`) auto-expand on mount, mirroring `ToolCallStep`'s auto-open of failed steps.
- A chevron only renders when a row has expandable content (`summary || files?.length || typedOutputs`).
- Styling uses existing design-system primitives and theme tokens (no bespoke CSS) so the disclosure visually matches the rest of the chat surface.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `flow-summary-view`: per-agent summary lines become expandable disclosures that reveal full summary text, typed outputs, and per-step files instead of a single truncated line.

## Impact

- Code: `packages/flows-plugin/src/client/FlowSummary.tsx` (extract a `FlowSummaryRow` sub-component holding per-row expand state). No reducer, shared-type, server, or protocol changes — all rendered data is already folded into `FlowAgentState` / `FlowState`.
- Primitives consumed: `ui:markdown-content` (already used by `FlowAgentCard`'s source popover), existing `@mdi/js` chevron icons, theme CSS variables.
- Tests: new `FlowSummary.test.tsx` asserting chevron toggle, failed-step auto-expand, and conditional chevron rendering.
- No build/protocol surface change; client-only (rebuild + restart per the client change workflow).
