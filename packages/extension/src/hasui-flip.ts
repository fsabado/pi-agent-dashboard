    /**
     * `flipHasUI(ctx)` — flip `ctx.hasUI` to `true` on the live pi extension
     * context after the bridge has installed PromptBus wrappers on `ctx.ui.*`.
     *
     * Rationale: extensions (`context-mode`, `pi-agent-browser`, …) branch on
     * `ctx.hasUI` to decide whether to call `ctx.ui.notify`, render dialogs, or
     * short-circuit interactive flows. The bridge already provides a working UI
     * surface via PromptBus over the patched `ctx.ui.*` methods, so `ctx.hasUI`
     * MUST reflect that reality.
     *
     * Contract:
     *   - Mutates the live `ctx` object: `ctx.hasUI = true`.
     *   - Caller MUST have captured the original `ctx.hasUI` into its own state
     *     BEFORE invoking this helper, since `source-detector.detectSessionSource`
     *     depends on the pi-supplied original value.
     *   - Wrapped in try/catch so a future pi release that makes `ctx.hasUI`
     *     non-writable (getter / frozen object) degrades gracefully: a single
     *     `[dashboard] failed to flip ctx.hasUI` warning, no throw.
     *   - `null` / `undefined` ctx is a silent no-op (defensive).
     *
     * Spec: openspec/changes/fix-bridge-hasui-for-headless-rpc/
     *       specs/bridge-extension/spec.md
     */
    export function flipHasUI(ctx: { hasUI?: boolean } | null | undefined): void {
      if (ctx == null) return;
      try {
        // Direct assignment fails when hasUI is a getter-only property (no setter).
        // Object.defineProperty overrides even getter-only descriptors as long as
        // the property is configurable — which it is on the pi SDK ctx object.
        Object.defineProperty(ctx, 'hasUI', {
          value: true,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch (err) {
        // Non-writable / frozen ctx — log once, continue. Worst case the bridge
        // behaves exactly as it did before this change.
        console.warn("[dashboard] failed to flip ctx.hasUI", err);
      }
    }
    
    
