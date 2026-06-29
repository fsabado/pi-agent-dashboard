## 1. Resolve open questions (design.md)

- [ ] 1.1 Confirm confirmed-good clear trigger granularity (first non-error `message_end` vs first token vs clean `agent_end`) — record decision in design.md
- [ ] 1.2 Confirm auto-retry header behavior (promote error header immediately vs keep retry-only sub-line until exhausted)
- [ ] 1.3 Confirm stale-error behavior on a brand-new (non-retry) user prompt (clear on send vs wait for confirmed-good)

## 2. Reducer — defer lastError clearing (error-detection)

- [ ] 2.1 Write failing test: `agent_start` no longer clears `lastError` (event-reducer test)
- [ ] 2.2 Write failing test: confirmed non-error `message_end` clears `lastError`; failed retry updates without a hidden intermediate frame
- [ ] 2.3 Remove `next.lastError = undefined` from the `agent_start` arm in `event-reducer.ts`
- [ ] 2.4 Add confirmed-good clear in the chosen arm (per 1.1)
- [ ] 2.5 Make tests 2.1/2.2 pass; update existing reducer tests that asserted the old `agent_start` clear

## 3. Selector + composed BannerState (session-status-banner)

- [ ] 3.1 Write failing test: `deriveBannerState` composes `error` + `retry` when both set; returns `hidden` only when both undefined; marks `limit-exceeded` via `USAGE_LIMIT_PATTERN`
- [ ] 3.2 Change `deriveBannerState` return shape to `{ variant: "hidden" } | { error?, retry? }`
- [ ] 3.3 Update all selector unit tests to the composed shape

## 4. SessionBanner UI — composed surface + dismiss semantics

- [ ] 4.1 Write failing component test: error anchor persists with retry sub-line composed on top; Stop retrying present
- [ ] 4.2 Render composed surface (persistent error header + swappable retry/Retry/limit sub-line) in `SessionBanner.tsx`, preserving `data-testid="error-banner"`, `error-banner-dismiss`, `retry-banner` markers
- [ ] 4.3 Wire Dismiss ✕ to be state-dependent: abort+clear on retrying/retryable, clear-only on limit-exceeded
- [ ] 4.4 Update `App.tsx` `onDismiss` handler to dispatch abort vs clear per state
- [ ] 4.5 Make component tests pass; migrate existing banner tests to composed surface

## 5. Single red surface — suppress duplicate inline error card

- [ ] 5.1 Write failing test for the suppression helper (failed attempt collapses while error-lifecycle surface active)
- [ ] 5.2 Extend `collapse-retried-errors.ts` (or add sibling helper) to collapse the inline failed-attempt card for the active surface failure
- [ ] 5.3 Wire helper into `ChatView.tsx` render path; render compact badge / hide
- [ ] 5.4 Make tests pass; add assertion that no simultaneous yellow-banner + red-inline-card for the same failure

## 6. Bridge — abort latch outlasts backoff (provider-retry-state)

- [ ] 6.1 Write failing test: latch re-aborts a retry that wakes after the 2 s scheduler window
- [ ] 6.2 Write failing tests: latch cleared by new user prompt (new turn not killed) and on settle (`agent_end`/idle)
- [ ] 6.3 Add per-session `abortRequested` latch in the bridge; honor it on retry-continuation; clear on settle / new prompt
- [ ] 6.4 Keep the existing persistent-abort scheduler as the fast path (rawAbort, streaming-transition break)
- [ ] 6.5 Make bridge tests pass

## 7. Integration + regression

- [ ] 7.1 Add reducer/integration test for the full lifecycle: error → retry-on-top → fail (no flicker) → retry → confirmed-good clear
- [ ] 7.2 Run `npm test`; fix regressions across client + extension suites
- [ ] 7.3 Manual QA: trigger a rate-limit; verify single surface, ✕ stops retry across a long backoff, error persists until a real success
- [ ] 7.4 Build + deploy: `npm run build` → `POST /api/restart`; bridge change → `npm run reload`
