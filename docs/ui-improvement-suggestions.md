# UI Improvement Suggestions

Analysis of the current dashboard UI based on screenshot review and source inspection. Seven issues identified, ranked by impact.

---

## Summary Table

| # | Area | File(s) | Severity | Type |
|---|------|---------|----------|------|
| 1 | TokenStatsBar info density | `TokenStatsBar.tsx:54–75` | Medium | UX/Polish |
| 2 | SessionHeader overflow at narrow widths | `SessionHeader.tsx:355–430` | **High** | Layout Bug |
| 3 | Raw tool output around inline images | `ChatView.tsx:325–340`, `SkillInvocationCard.tsx` | **High** | UX/Feature |
| 4 | No steer vs. follow-up delivery UI | `CommandInput.tsx:466–480` | Medium | Feature Gap |
| 5 | StatusBar idle right side + action disconnection | `StatusBar.tsx:85–110`, `App.tsx:1467` | Low | Polish |
| 6 | Drag divider has no min-width/persistence | `App.tsx` (near `.w-1.cursor-col-resize`) | Medium | UX |
| 7 | Empty state jump + no loading timeout | `ChatView.tsx:598–612` | Medium | UX/Bug |

**Quick wins:** #2 (one-line `min-w-0 truncate` fix) and #3 (collapse raw metadata around `agent_browser` image output — most visually noisy thing in the current UI).

---

## 1. TokenStatsBar — Information Density vs. Cognitive Load

**Source:** `src/components/TokenStatsBar.tsx:54–75`

**Problem:** Stats panel renders 4 rows of dense 9px text with cryptic abbreviations (`↓241.3k`, `R34.5M`, `W827.4k`) and no labels. The butterfly chart has zero axis labels, tooltips only appear on hover, and the context bar has no visual warning gradient until `contextGradientColor` kicks in at an unknown threshold. A user cannot tell at a glance how expensive their session is or how much context is left.

**Suggestions:**

- Add a hover-expandable row that replaces abbreviations with full labels (`"Cache Read: 34.5M tokens"`, `"Cost: $16.67"`) — a `<details>` or Radix Tooltip per stat column.
- Add a ⚠ icon or color shift on the context bar when usage exceeds 75% (currently transitions somewhere inside `contextGradientColor` with no textual cue).
- Consider making `showStats` default to a collapsed view (just cost + a single progress bar) and expanding on click — avoids eating 75px of vertical real estate by default.
- The `R/W/↓/↑` notation is undocumented in the UI — add a `title` attribute to each stat span at minimum.

---

## 2. SessionHeader — Header Bar Overloaded at Small Widths

**Source:** `src/components/SessionHeader.tsx:355–430`

**Problem:** Desktop header crams session name + edit button + model name + thinking level + `FooterSegmentSlot` + spacer + attach/detach pill + Changed Files button + duration/resume+fork pills + refresh button into a single flex row. At the current ~508px right-panel width (drag divider at x=492), items start to overflow or truncate. The model name (`anthropic/claude-sonnet-4-6`) already wraps in screenshots. The `flex-1` spacer pushes trailing buttons right, but there's no `min-width: 0` protection on the session name span — long project names will push the model name off-screen.

**Suggestions:**

- Add `min-w-0 truncate` to the session name `<span>` so it ellipsizes instead of pushing everything else. Currently `font-medium flex items-center gap-1` with no overflow protection (`SessionHeader.tsx:362`).
- Move model name + thinking level into `StatusBar` exclusively — they're already duplicated there (`StatusBar.tsx:96`). Rendering in both header and status bar wastes space and can show stale divergence.
- Demote the "Changed Files" button (`hasFileChanges && onOpenDiffView`) and "Attach" button to a `⋯` overflow menu when the panel is narrower than a threshold, rather than always pinned inline.

---

## 3. ChatView — Skill Invocation Cards Show Raw Artifact Tool Output Inline

**Source:** `src/components/ChatView.tsx:325–340`, `src/components/SkillInvocationCard.tsx`

**Problem:** When the agent calls `agent_browser` and the output includes a saved screenshot path, the message bubble renders the entire raw text output (path, size, media type, session ID, CWD — ~10 lines) before/after the image. The image itself renders correctly inline (via the existing `PreviewCard` path), but surrounding metadata clutters the chat. Evidence: visible messages contain `Artifact type: image`, `Requested path: /home/sagemaker-user/...` rendered as plain text around the image.

**Suggestions:**

- In `ChatView.tsx`, when a `toolResult` message has images attached, suppress or collapse the plain-text result body if it's purely path/metadata. Heuristic: result text matches `/(Saved image|Artifact type|Requested path|Absolute path|Exists:|Size:|Media type:|Status:|Session:|CWD:|Machine data:)/`. Render just the image thumbnail with a collapsible "Show raw output" toggle.
- Cleaner fix: teach the `agent_browser` tool result renderer in `src/components/tool-renderers/` to detect `artifact_type: image` and render a card with the image front-and-center, pushing metadata into a collapsed section. Avoids the regex heuristic.
- For the user message side (long tool-call JSON embedded in user bubble text), `SkillInvocationCard` already collapses skill body — the same pattern could apply to messages containing embedded `agent_browser` tool-call JSON blocks.

---

## 4. CommandInput — No Delivery Mode Selector for Follow-up vs. Steer

**Source:** `src/components/CommandInput.tsx:466–480`

**Problem:** The send button always calls `handleSend("steer")` — every message sent while the agent is streaming is treated as a mid-turn interrupt. The `"followUp"` delivery mode exists in the type system and the bridge supports it, but there's no UI to choose it. Users see `QueuePanel` entries labeled "follow-up" but have no way to intentionally enqueue rather than steer.

**Suggestions:**

- Add a long-press or right-click context menu on the send button offering "Send now (steer)" vs. "Queue for after (follow-up)". A small dropdown arrow `▾` next to the send button — similar to GitHub's PR merge button — is the lowest-friction implementation.
- Alternatively, add a keyboard modifier: `Enter` = steer, `Shift+Enter` = follow-up (currently `Shift+Enter` does nothing since `handleKeyDown` uses `!e.shiftKey` to block newlines but the textarea still gets a newline).
- Source to modify: `CommandInput.tsx` around line 466 (`handleSend` call in the send `<button onClick>`).

---

## 5. StatusBar + ComposerSessionActions — Two-Row Status Area Feels Disconnected

**Source:** `src/components/StatusBar.tsx:85–110`, `App.tsx:1467`

**Problem:** Status bar contains model selector + thinking level + `|` divider + `ComposerSessionActions` (`OPENSPEC` / `JJ` / `Enable jj workspaces`) on one row, and a second row has working-status text. The "Enable jj workspaces" button is visually identical to a chip label with a git icon but appears orphaned — doesn't look actionable. `StatusBar` uses `justify-between` with working status on the right, but when idle the right side is empty, creating an unbalanced look.

**Suggestions:**

- Replace the right-side empty state with a subtle last-run indicator: `"Idle · last turn 5h 47m ago"` (duration already computed in `SessionHeader.tsx:formatDuration`, available from `session.startedAt`).
- Give `ComposerSessionActions` slot items consistent visual weight — the "Enable jj workspaces" button should look like the other pills (border + color) or be hidden when not relevant.
- The `|` separator pipe between leading and `ModelSelector` (`StatusBar.tsx:93`) uses `h-3 w-px` which can disappear at small font sizes. Use `mx-2` spacing instead.

---

## 6. Layout — Drag Divider Has No Min-Width Enforcement

**Source:** `App.tsx:1855`, CSS: `.w-1.cursor-col-resize`

**Problem:** The resizable pane divider at x=492 lets users drag the left panel to 0px or the right panel to 0px — no visible min/max stop indicator and no persistence of divider position across page reloads (`localStorage`). The right chat panel at ~508px is already narrow enough to cause header overflow (see suggestion #2).

**Suggestions:**

- Clamp drag to e.g. `leftPanelWidth ∈ [200, viewportWidth - 350]` and persist to `localStorage` under key `pi-panel-divider-x`.
- Add double-click-to-reset on the divider (reset to 50/50 split).
- Show a subtle blue highlight on the divider when the panel is near the minimum width as a hint it can't go further.

---

## 7. ChatView — Empty/Loading State Jumps From Center to Top on First Message

**Source:** `src/components/ChatView.tsx:598–612`

**Problem:** "No messages yet" and "Loading conversation…" states use `flex items-center justify-center h-full`, centering them in the scrollable container. Once messages appear, content starts from the top. This causes a jarring layout jump from center to top-aligned on first message arrival. Additionally the "Loading conversation…" spinner has no timeout fallback — if history loading silently fails, the user sees the spinner forever.

**Suggestions:**

- Use `flex-col items-center justify-end pb-8` for empty state so it sits at the bottom of the chat area (where the first message will appear), reducing perceived jump.
- Add a timeout in the `loadingHistory` logic (wherever `beginLoadingHistory` is called in `App.tsx`) that sets `loadingHistory = false` after ~10s and shows an error/retry nudge.
- The scroll-to-bottom button (`absolute bottom-4`) overlaps with `CommandInput` at certain scroll positions — add `bottom-16` or tie its position to the `CommandInput` height.
