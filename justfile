# Pi Agent Dashboard — project task runner
# Usage: just <recipe> [args]
# Run `just` or `just help` to list all recipes

root := justfile_directory()
port := env_var_or_default("DASHBOARD_PORT", "8001")
api  := "http://localhost:" + port + "/api"

# List all recipes
help:
    @just --list

# ── Server ────────────────────────────────────────────────────────────────────

# Start the dashboard server
[group('server')]
start:
    cd "{{root}}" && pi-dashboard start

# Stop the dashboard server
[group('server')]
stop:
    cd "{{root}}" && pi-dashboard stop

# Restart via API (graceful, preserves mode)
[group('server')]
restart:
    #!/usr/bin/env bash
    set -euo pipefail
    curl -sf -X POST "{{api}}/restart" >/dev/null 2>&1 || true
    echo -n "waiting for server"
    for i in $(seq 1 20); do
        sleep 1
        if curl -sf "{{api}}/health" >/dev/null 2>&1; then
            echo " up"
            curl -sf "{{api}}/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mode='+d.get('mode','?'), 'uptime='+str(d.get('uptime','?'))+'s')"
            exit 0
        fi
        echo -n "."
    done
    echo " timed out — trying cold start"
    pi-dashboard start

# Restart into dev mode (Vite HMR)
[group('server')]
restart-dev:
    curl -sf -X POST "{{api}}/restart" -H "Content-Type: application/json" -d '{"dev":true}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))"

# Show server status and current mode
[group('server')]
status:
    @pi-dashboard status 2>&1 || true
    @curl -sf "{{api}}/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mode='+d.get('mode','?'), 'uptime='+str(d.get('uptime','?'))+'s')" 2>/dev/null || echo "(server not responding)"

# ── Build ─────────────────────────────────────────────────────────────────────

# Build the web client
[group('build')]
build:
    cd "{{root}}" && npm run build

# Build client + restart server (after client changes)
[group('build')]
deploy:
    just build
    just restart

# Build + restart + reload all pi sessions (full redeploy after any change)
[group('build')]
deploy-all:
    just build
    just restart
    just reload

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start Vite dev server (HMR for client changes)
[group('dev')]
dev:
    cd "{{root}}" && npm run dev

# Start dashboard in dev mode (server + Vite proxy)
[group('dev')]
dev-server:
    cd "{{root}}" && pi-dashboard start --dev

# Type-check without emitting
[group('dev')]
typecheck:
    cd "{{root}}" && npm run lint

# Run Biome linter
[group('dev')]
lint:
    cd "{{root}}" && npm run lint:biome

# Fix changed files (Biome auto-fix)
[group('dev')]
fix:
    cd "{{root}}" && npm run fix:changed

# Full quality gate: biome + tsc + tests (against changed files)
[group('dev')]
quality:
    cd "{{root}}" && npm run quality:changed

# ── Test ──────────────────────────────────────────────────────────────────────

# Run all unit tests
[group('test')]
test *args:
    cd "{{root}}" && npm test -- {{args}}

# Run tests in watch mode
[group('test')]
test-watch:
    cd "{{root}}" && npm run test:watch

# Run Playwright E2E tests (requires Docker + chromium)
[group('test')]
test-e2e *args:
    cd "{{root}}" && npm run test:e2e -- {{args}}

# ── Bridge ────────────────────────────────────────────────────────────────────

# Reload bridge extension in all connected pi sessions
[group('bridge')]
reload:
    cd "{{root}}" && npm run reload

# Type-check then reload bridge extension
[group('bridge')]
reload-check:
    cd "{{root}}" && npm run reload:check

# ── Electron ──────────────────────────────────────────────────────────────────

# Start Electron app in dev mode
[group('electron')]
electron-dev:
    cd "{{root}}" && npm run electron:dev

# Build Electron installer
[group('electron')]
electron-build:
    cd "{{root}}" && npm run electron:build

# ── Site ──────────────────────────────────────────────────────────────────────

# Start docs site dev server
[group('site')]
site-dev:
    cd "{{root}}" && npm run site:dev

# Build docs site
[group('site')]
site-build:
    cd "{{root}}" && npm run site:build

# ── Repo ──────────────────────────────────────────────────────────────────────

# Git status + recent commits
[group('repo')]
st:
    @git -C "{{root}}" status -s
    @git -C "{{root}}" log --oneline -5

# Pull with rebase
[group('repo')]
pull:
    git -C "{{root}}" pull --rebase

# Doctor: check all required tools are available
[group('repo')]
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    ok="  ✓"; fail="  ✗"
    command -v just         >/dev/null && echo "$ok just"          || echo "$fail just missing"
    command -v pi-dashboard >/dev/null && echo "$ok pi-dashboard"  || echo "$fail pi-dashboard missing"
    command -v node         >/dev/null && echo "$ok node $(node -v)" || echo "$fail node missing"
    command -v npm          >/dev/null && echo "$ok npm"           || echo "$fail npm missing"
    curl -sf "{{api}}/health" >/dev/null && echo "$ok server up ({{api}})" || echo "$fail server not running"
    [ -d "{{root}}/packages/client/dist" ] && echo "$ok client built" || echo "  ⚠ client not built — run 'just build'"
