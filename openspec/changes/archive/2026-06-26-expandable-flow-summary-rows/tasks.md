## 1. Tests first (TDD)

- [x] 1.1 Add `packages/flows-plugin/src/__tests__/FlowSummary.test.tsx` rendering `FlowSummary` with a `FlowState` of mixed-status agents (success w/ summary+files+typedOutputs, success w/o detail, error).
- [x] 1.2 Assert: a complete row with summary renders a collapsed chevron + truncated peek; clicking it reveals full summary text, typed-output chips, and file list. → verify: test fails (red) before impl.
- [x] 1.3 Assert: an `error` row renders expanded on mount (auto-expand). → verify: red.
- [x] 1.4 Assert: a row with no summary/files/typedOutputs renders no interactive chevron and does not expand. → verify: red.
- [x] 1.5 Assert: expanding one row leaves siblings' expanded state unchanged (independent per-row state). → verify: red.

## 2. Implementation

- [x] 2.1 In `FlowSummary.tsx`, extract the per-agent `.map()` body into a local `FlowSummaryRow({ agent })` component holding `const [open, setOpen] = useState(agent.status === "error")`.
- [x] 2.2 Compute `hasDetail = !!agent.summary || (agent.files?.length ?? 0) > 0 || !!agent.typedOutputs`; render an interactive chevron (`mdiChevronRight`/`mdiChevronDown`, size 0.45) only when `hasDetail`, else a spacer to preserve alignment.
- [x] 2.3 Keep the collapsed row identical to today (icon, label, fork/loop badge, file count) plus the truncated summary peek; make the row header `onClick={() => hasDetail && setOpen(!open)}`.
- [x] 2.4 Add the expanded body (rendered when `open`): full summary via `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)`; typed-output chips reusing `FlowAgentCard`'s chip markup (filter out `branch`); per-step file list (wrapped monospace); soft/hard outcome line reusing `FlowAgentCard`'s amber/red strings. Wrap in `border-l-2 border-[var(--border-primary)] bg-[var(--bg-surface)]` nested block.
- [x] 2.5 Confirm no reducer/shared-type/server changes are needed (all fields already on `FlowAgentState`).

## 3. Validate

- [x] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` — all green, new tests pass. → verify: `grep -nE 'FAIL|✗' /tmp/pi-test.log` empty.
- [x] 3.2 Type-check via `npm run quality:changed` (biome + tsc on changed files). → verify: exit 0.
- [x] 3.3 Client change → `npm run build && curl -X POST http://localhost:8000/api/restart`; open a completed flow session in the dashboard, confirm rows expand/collapse, failed step auto-expands, markdown renders, alignment preserved across themes (light/dark). → verify: visual match to mockup placement + mechanics.
- [x] 3.4 Run the CodeRabbit review gate on the diff before commit (`npx tsx .pi/skills/implement/scripts/review-changes.ts`). → verify: no Critical/Warning left.
