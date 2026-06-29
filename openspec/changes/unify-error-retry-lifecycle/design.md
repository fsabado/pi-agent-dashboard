## Context

The retry/error UX has accreted six prior fix-changes (`fix-provider-retry-infinite-loop`, `unify-status-banner-and-terminal-limit-stop`, `fix-retry-banner-stuck-on-limit-exceeded`, `fix-retry-resends-last-user-message`, etc.). Each patched a symptom of one underlying model error: **retry and error are modeled as mutually-exclusive states that replace each other.**

Current data flow (see `event-reducer.ts`, `command-handler.ts`, `retry-tracker.ts`):

- pi-coding-agent retries internally and exposes NO retry events. The bridge `RetryTracker` infers retries from `message_end(stopReason:error)` matching `RETRYABLE_PATTERN` and synthesizes `auto_retry_start` / `auto_retry_end`.
- Reducer maps `retryState` (set by `auto_retry_start`) and `lastError` (set by `agent_end`) into a single `BannerState` via `deriveBannerState`; `retryState` wins.
- `agent_start` clears both `lastError` and `retryState`.
- `command-handler.ts` aborts via a wrapper-abort + a 200 ms-interval persistent-abort scheduler capped at `PERSISTENT_ABORT_MAX_MS = 2000`.

Constraints: pi exposes no retry settings (sentinel `-1` for `maxAttempts`/`delayMs`), no queue-mutation API, and retries happen entirely inside pi. The dashboard can only observe `message_end`/`agent_end` and call `cachedCtx.abort()`.

## Goals / Non-Goals

**Goals:**
- One per-session error-lifecycle surface: persistent error anchor + swappable live status sub-line.
- `lastError` survives until a confirmed non-error response; no optimistic clear on `agent_start`.
- ✕ on a retrying/retryable surface reliably stops pi's in-flight retry, even across long backoffs.
- No simultaneous yellow + red anywhere (banner, inline chat card, session dot).

**Non-Goals:**
- Changing pi-coding-agent's retry decisions or backoff schedule.
- Exposing pi's true retry settings (still unavailable → indeterminate UI stays).
- Persistent-side (JSONL) dedup; collapse remains a render-time concern.
- Reworking the `limit-exceeded` terminal path (it already hard-stops correctly).

## Decisions

### D1 — Composed surface, not XOR variants

Replace the `retrying | error | limit-exceeded | hidden` precedence with a surface that holds an optional **error anchor** AND an optional **live status**. `deriveBannerState` returns a structure that can carry both (`{ error?, retry? }`) rather than picking one. `SessionBanner` renders the error message as the persistent header and the retry status (countdown / "retrying…" / manual Retry / terminal hint) as a sub-line.

*Alternative considered:* keep XOR but reorder precedence so error wins. Rejected — error-wins hides the live retry progress the user wants to see; the actual need is composition.

### D2 — Confirmed-good clear trigger

Stop clearing `lastError` in the `agent_start` arm. Introduce a clear on the **first confirmed non-error signal** of the subsequent turn. Candidate trigger (see Open Questions): first assistant `message_start`/streamed token, OR first non-error `message_end`, OR clean `agent_end`. `retryState` clearing on `auto_retry_end` is unchanged.

*Alternative considered:* clear on `agent_start` but keep a "ghost" copy for display. Rejected — two sources of truth for the same error invites the exact desync this change removes.

### D3 — Abort that outlasts backoff

Two options:
- **(a) Extend/re-arm the persistent-abort scheduler** beyond 2 s to cover backoff (e.g. keep poking `rawAbort` until `isIdle` or `agent_end`, with a longer cap).
- **(b) Latch an `abortRequested` flag** in the bridge that is honored whenever pi re-enters `agent.continue()` after sleep, then cleared on the next `agent_end`/idle.

Preference: **(b)** — a latch is robust to arbitrary backoff length without busy-polling for tens of seconds; the scheduler's streaming-transition break (which prevents killing a user re-send) is preserved by clearing the latch on settle.

### D4 — Dismiss ✕ semantics by state

- Surface in a **retrying / retryable-error** state → ✕ aborts (D3) AND clears the surface.
- Surface in a **terminal `limit-exceeded`** state → ✕ only dismisses (nothing to abort; pi already stopped).

### D5 — Suppress duplicate inline error card

Extend `collapse-retried-errors.ts` (or add a sibling helper) so that while the error-lifecycle surface owns a failure, the corresponding inline failed-attempt card in the chat stream is collapsed to a compact badge — same pattern already used by `RetriedErrorBadge` for tool retries.

## Risks / Trade-offs

- [Confirmed-good clear is too late → success feels laggy] → trigger on the first assistant token, not `agent_end`; tune in D2.
- [Confirmed-good clear is too early → a token arrives then the turn errors again, flicker] → if first-token clear proves flickery, fall back to first non-error `message_end`.
- [Latch (D3b) leaks and kills a legitimate later turn] → clear the latch on the same settle conditions that stop the current scheduler (`agent_end` / `isIdle`); add a test for re-send within the window.
- [Composed surface regresses the many existing banner tests] → the `BannerState` shape change is breaking for tests; migrate them as part of the change, keep `data-testid`s stable.
- [Bridge wire-ordering invariants (already specced) interact with deferred clearing] → preserve the existing synth-before-agent_end ordering; only the reducer's clear timing moves.

## Migration Plan

1. Reducer: change `agent_start` arm + add confirmed-good clear; update `deriveBannerState` shape.
2. Bridge: add abort latch (D3b); keep persistent-abort scheduler as the fast path.
3. UI: compose `SessionBanner`; wire Dismiss→abort by state; suppress inline duplicate card.
4. Migrate banner/reducer tests; add new lifecycle tests.
5. Client change → `npm run build` + `/api/restart`; bridge change → `npm run reload`.

Rollback: revert the reducer clear-timing + bridge latch commits; banner composition is display-only and safe to revert independently.

## Open Questions

1. **Confirmed-good trigger granularity** — first streamed assistant token (snappiest), first non-error `message_end`, or clean `agent_end` (safest)? Leaning first non-error `message_end` as the balance.
2. **Auto-retry path header** — on an auto-retry, do we promote the failure to a visible error header immediately, or keep it as just the "retrying — <reason>" sub-line until retries are exhausted?
3. **Stale error across a brand-new user prompt** — when the user types a *new* prompt (not a retry of the same turn), should the prior error clear immediately on send, or also wait for confirmed-good?
