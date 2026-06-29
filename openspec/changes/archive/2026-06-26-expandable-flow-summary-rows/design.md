## Context

`FlowSummary.tsx` mounts as the `content-inline-footer` slot claim (`FlowSummaryClaim`) — a sticky band above the chat after a flow completes. It maps `flowState.agents` to one row each. Today each row is a flex line ending in `<span className="... truncate flex-1">{agent.summary}</span>`, so the summary clips to one line and the per-step `typedOutputs` / `files` (present in `FlowAgentState`) never render.

The rest of the app discloses detail with a per-item chevron + `useState` toggle (`ToolCallStep`, `SkillInvocationCard`, `CollapsedToolGroup`), and `FlowSummary` itself already uses that idiom for its single top-level collapse. This change brings the per-row level in line with that idiom. All data is already client-side state — no events, fetches, reducers, or shared types change.

## Goals / Non-Goals

**Goals:**
- Per-step rows expand/collapse independently, matching the `ToolCallStep` chevron idiom.
- Expanded rows surface full summary (markdown), typed-output chips, per-step files, and soft/hard outcome.
- Reuse design-system primitives and theme tokens — no bespoke CSS. The mockup's placement + mechanics are the target; its inline styles are not.
- Zero regression to the collapsed/skim view and the existing top-level collapse.

**Non-Goals:**
- No reducer, shared-type, server, or protocol changes.
- No change to the live `FlowDashboard` card grid (`FlowAgentCard` already has its own detail affordances).
- No new "fetch summary" path — summary text is already in `agent.summary`.
- No redesign of the DAG graph, YAML button, header line, or Next-step button.

## Decisions

**D1 — Extract a `FlowSummaryRow` sub-component.**
The agent `.map()` body becomes `<FlowSummaryRow agent={agent} />`, a local component owning `const [open, setOpen] = useState(autoExpand)`. Rationale: per-row state cannot live in the parent without an id→bool map; a sub-component is the React-idiomatic, smallest-diff approach and mirrors how `ToolCallStep` rows are self-contained. Alternative (parent-held `Set<stepId>`) rejected — more state plumbing, no benefit.

**D2 — Chevron + clickable header row.**
Leading `<Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.45} />` on the row header; `onClick={() => setOpen(!open)}` on the row. Matches `ToolCallStep` (which uses size 0.6 on larger rows; 0.45 fits the 11px summary row scale). The existing top-level chevron stays.

**D3 — Render the chevron only when expandable.**
`const hasDetail = !!agent.summary || (agent.files?.length ?? 0) > 0 || !!agent.typedOutputs;` Rows with nothing to show keep a non-interactive layout (spacer in the chevron slot) so alignment is preserved. Avoids dead chevrons.

**D4 — Expanded body via existing primitives.**
Full summary through `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)` (same primitive `FlowAgentCard` uses for its source popover). Typed outputs reuse the chip markup already in `FlowAgentCard` (`bg-surface` + `border-subtle`, `cyan` key). Files render as a wrapped monospace list. Outcome line reuses `FlowAgentCard`'s soft (amber) / hard (red) strings. Body wrapper uses a left-border + surface fill (`border-l-2 border-[var(--border-primary)] bg-[var(--bg-surface)]`) to read as nested drill-down, consistent with chat nested content.

**D5 — Auto-expand failed steps.**
`autoExpand = agent.status === "error"`. Mirrors `ToolCallStep`, which auto-opens failed/running steps — failures are exactly where the summary matters. Successful steps default collapsed.

**D6 — Summary text treated as markdown.**
Agent summaries are free text that may contain markdown; rendering through `ui:markdown-content` is safe for plain prose and richer for markdown. Resolves proposal open-question #2.

## Risks / Trade-offs

- [Expanded rows grow the sticky footer band vertically] → Per-row state means typically one open at a time; the top-level collapse still hides everything; body is scrollable within its container.
- [`ui:markdown-content` on a one-line plain summary adds wrapper margins] → Acceptable; matches chat markdown spacing. If too heavy, fall back to `whitespace-pre-wrap` — isolated to the body render.
- [Auto-expanding several failed steps at once lengthens the band] → Acceptable; failures are the high-value case and rare in count; user can collapse.

## Open Questions

- None blocking. (Proposal open-questions resolved: failed-step auto-expand = yes per D5; markdown vs plaintext = markdown per D6; Details popover = inline expand only for this change, the `FlowAgentCard` eye-button popover remains the "full run history" path and is out of scope here.)
