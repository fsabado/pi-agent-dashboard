# Pi Startup Performance

Investigation and fixes for slow `pi` startup (~6.3s → ~3.8s).

## Profiling Method

```bash
# Measure startup time
START=$(date +%s%N); pi --help 2>/dev/null | head -1; echo "$((( $(date +%s%N) - START ) / 1000000))ms"

# Count syscalls and find EFS reads
strace -e trace=openat -f node /home/sagemaker-user/.local/bin/pi --help 2>&1 | grep -c "openat"
strace -e trace=openat -f node /home/sagemaker-user/.local/bin/pi --help 2>&1 | grep "mnt/custom\|efs" | grep -v ENOENT

# Trace jiti extension loading
JITI_DEBUG=1 pi --help 2>&1 | grep -E "\[transpile\]|\[native\]|\[cache\]"

# Baseline without extensions
START=$(date +%s%N); pi -ne --help 2>/dev/null | head -1; echo "$((( $(date +%s%N) - START ) / 1000000))ms"
```

## Architecture of Extension Loading

Pi loads extensions via `jiti` (TypeScript runtime) on every startup:

1. Pi traverses CWD up to root looking for `package.json` with `"pi": { "extensions": [...] }`
2. Loads global extensions from `~/.pi/agent/extensions/`
3. Loads npm package extensions from `~/.pi/agent/npm/node_modules/*/`
4. Loads git package extensions from `~/.pi/agent/git/*/`

Each extension gets its own `createJiti()` instance (`moduleCache: false`). Jiti caches transpiled `.ts` → `.mjs` files in `/tmp/jiti/` (cleared on reboot).

**Key loader code:** `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`

## Root Causes Found

### 1. Accidental 5.6MB Global Extension (~1s)

During debugging, an esbuild bundle was left at `~/.pi/agent/extensions/bridge.js`. Pi's global extension discovery picked it up and loaded it on every startup — 43ms just to eval from jiti cache.

**Fix:** Delete it.

```bash
rm ~/.pi/agent/extensions/bridge.js
rm -rf ~/.pi/agent/extensions/node_modules
```

### 2. Eager Heavy Imports in `pi-web-access` (~300ms)

`pi-web-access/extract.ts` imports DOM/HTML parsing libraries at the module top level. These are only needed when actually fetching web content, not at startup.

**Offending imports:**
```ts
import { Readability } from "@mozilla/readability";  // ~2.6MB package
import { parseHTML } from "linkedom";                 // ~2.6MB package
import TurndownService from "turndown";
import pLimit from "p-limit";
```

**Fix applied to** `~/.pi/agent/npm/node_modules/pi-web-access/extract.ts` — made lazy with `require()` at call site.

Similarly `~/.pi/agent/npm/node_modules/pi-web-access/pdf-extract.ts` for `unpdf`.

> ⚠️ These changes will be lost if pi-web-access is updated. Re-apply after updates.

### 3. No V8 Bytecode Cache (~400ms on warm runs)

Node.js re-parses all JavaScript modules on every process start. `NODE_COMPILE_CACHE` (Node 22.8+) caches compiled V8 bytecode to disk.

**Fix:** Added to `~/.bashrc`:
```bash
export NODE_COMPILE_CACHE="$HOME/.pi/agent/compile-cache"
```

Cache lives at `~/.pi/agent/compile-cache/` (~17MB, auto-managed by Node).

### 4. Startup Log Noise (cosmetic)

`packages/extension/src/bridge.ts` logged `[dashboard] server announced restart` on every dashboard restart via `console.log`. Removed.

## Remaining Bottleneck

With all fixes applied, warm startup: ~3.8s vs ~1.5s baseline (no extensions).

The ~2.3s extension overhead comes from:

- **23 extensions loaded** on every startup (jiti creates one instance per extension)
- **pi-mcp-adapter**: loads full `@modelcontextprotocol/sdk` (3MB) + many `.ts` files eagerly
- **pi-dashboard extension**: ~50 `.ts` files on EFS, each requires a `stat()` over the network (even with jiti cache hit, freshness check hits EFS)
- **pi-subagents**: ~20 `.ts` files

### What Doesn't Work

**Bundling the dashboard extension to local disk:** Tried `esbuild` to create `~/.pi/agent/extensions/bridge.js`. The bundle bypasses jiti's `alias` mechanism, causing Node to resolve `@earendil-works/pi-coding-agent` as a fresh import (doubling parse time). Sizes:
- Full bundle (all deps inlined): 18MB → 35s startup
- Partial bundle (pi-coding-agent external): 5.6MB → 15s startup

**`NODE_COMPILE_CACHE` with jiti:** Cache helps for natively-imported `.js` files but jiti's CJS eval path (`vm.runInThisContext`) bypasses the compile cache. Limited benefit for extension-heavy workloads.

### Further Opportunities

1. **Lazy-load `pi-mcp-adapter`**: Only needed when MCP servers are configured. Top-level MCP SDK imports could be deferred.
2. **Persistent jiti cache**: Move `/tmp/jiti` to `~/.pi/agent/jiti` so it survives reboots. Setting `TMPDIR=~/.pi/agent` works but affects other tools. Better: symlink `/tmp/jiti → ~/.pi/agent/jiti` at startup.
3. **Reduce extension count**: Archive rarely-used global extensions from `~/.pi/agent/extensions/`.
4. **Pre-built extension bundle with proper alias injection**: Would need pi core to support a `"prebuilt": true` flag in the extension manifest, loading via native `import()` with virtual module sharing.

## Measurements

| State | Time |
|---|---|
| Original (with accidental bundle) | ~6.3s |
| After removing bundle | ~5.0s |
| After lazy loading extract.ts | ~4.6s |
| With warm `NODE_COMPILE_CACHE` | ~3.8s |
| No extensions (`pi -ne`) | ~1.5s |

## Files Changed

| File | Change |
|---|---|
| `packages/extension/src/bridge.ts` | Removed `console.log` for restart announcement |
| `~/.bashrc` | Added `NODE_COMPILE_CACHE` export |
| `~/.pi/agent/npm/node_modules/pi-web-access/extract.ts` | Lazy-load linkedom, readability, turndown, p-limit |
| `~/.pi/agent/npm/node_modules/pi-web-access/pdf-extract.ts` | Lazy-load unpdf |
| `~/.pi/agent/extensions/bridge.js` | Deleted (accidental artifact) |
