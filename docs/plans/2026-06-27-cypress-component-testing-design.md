# Cypress Component Testing — Design

Date: 2026-06-27  
Status: Approved  

---

## Goal

Add Cypress 14 component testing for the pi-agent-dashboard frontend.  
Primary drivers: component isolation (no Docker), time-travel debugging.  
Initial scope: `ChatView`, `AgentCardShell`, tool renderers.  
Long-term: Cypress replaces Playwright (E2E migration is follow-up work).

---

## Approach

Option A — component-first, Playwright coexists.  
Cypress owns component tests. Playwright E2E stays untouched for now.  
Migration of Playwright E2E specs to Cypress happens in follow-up iterations.  
CI gets a new `test:cypress` script alongside the existing `test:e2e`.

---

## Installation

- **Cypress 14** — required for React 19 (19.2.6 installed). Cypress 13 lacks React 19 support.
- **`@cypress/vite-dev-server`** — Cypress component testing bundler, reads a dedicated Vite config.
- No Docker dependency. Component tests run against mounted React components only.

```bash
npm install --save-dev cypress @cypress/vite-dev-server
```

---

## Vite Config for Cypress

Create `cypress.vite.config.ts` at repo root — a lean config that omits server-specific plugins.

Include:
- `react()` — JSX transform
- `tailwindcss()` — Tailwind v4 via `@tailwindcss/vite` (inherited, not PostCSS)
- Path aliases for `@blackbelt-technology/pi-dashboard-shared` and `@blackbelt-technology/pi-dashboard-client-utils`

Exclude:
- `viteDashboardPluginsPlugin` — scans monorepo for plugin packages; no meaning in component context, will error
- `frontmanPlugin` — removed from main vite config as part of this work (no longer needed)

---

## Cypress Config

`cypress.config.ts` at repo root:

```ts
import { defineConfig } from 'cypress'
import { devServer } from '@cypress/vite-dev-server'
import viteConfig from './cypress.vite.config.js'

export default defineConfig({
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
      viteConfig,
    },
    specPattern: 'packages/client/src/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/component.ts',
  },
})
```

Spec pattern `**/*.cy.tsx` does not overlap with vitest's `**/*.test.tsx` — no config collision.

---

## Support File

`cypress/support/component.ts`:

- `import mount from 'cypress/react'`
- Import `packages/client/src/index.css` — loads Tailwind v4 styles so components render correctly
- Stub `window.WebSocket` globally — prevents real connection attempts in component context
- Export nothing; Cypress auto-loads this file before every spec

---

## `mountWithProviders()` Helper

`cypress/support/mount-with-providers.tsx`:

Wraps `cy.mount()` with the same provider stack as `main.tsx`:

```
UiPrimitiveProvider (empty registry)
  └─ ThemeProvider
       └─ I18nProvider
            └─ MobileProvider
                 └─ {children}
```

`UiPrimitiveProvider` receives `createUiPrimitiveRegistry()` with no registrations.  
Known limitation: any child calling `useUiPrimitive(key)` for a registered primitive will get `undefined`. Acceptable for initial scope; extend registry in tests that need specific primitives.

WebSocket state (`send`, `onMessage`, `status`) is passed as **props** to components under test — no global WS stubbing needed at the component level. `window.WebSocket` is still stubbed globally in the support file to silence connection errors from any ambient code.

---

## TypeScript

`cypress/tsconfig.json` — extends `packages/client/tsconfig.json`, adds `cypress` and `@cypress/vite-dev-server` to `types`, sets `include` to `["**/*.ts", "**/*.tsx"]`.

---

## data-testid Gaps

Target components have sparse or zero testid coverage. Adding testids is part of this work:

| Component | Current testids | Needs |
|---|---|---|
| `AgentCardShell` | 0 | `agent-card-shell`, `agent-card-name`, `agent-card-status` |
| `ChatView` | 3 (steer/prompt/scroll) | `chat-view`, `chat-message-list`, `chat-input` |
| `BashToolRenderer` | 0 | `bash-tool-renderer`, `bash-output` |
| `ReadToolRenderer` | 0 | `read-tool-renderer` |
| `EditToolRenderer` | 0 | `edit-tool-renderer` |
| `WriteToolRenderer` | 0 | `write-tool-renderer` |
| `AskUserToolRenderer` | 0 | `ask-user-tool-renderer` |

---

## Initial Specs

Three spec files covering initial scope:

**`packages/client/src/components/tool-renderers/__tests__/ToolRenderers.cy.tsx`**
- `BashToolRenderer` renders command + output
- `ReadToolRenderer` renders filename + content
- `EditToolRenderer` renders diff view
- `WriteToolRenderer` renders content
- `AskUserToolRenderer` renders question + options

**`packages/client-utils/src/AgentCardShell.cy.tsx`**
- Renders with name + status
- Status variants: `running`, `complete`, `error`
- Renders children
- `onClick` fires when clicked
- `selected` state applies visual treatment

**`packages/client/src/components/ChatView.cy.tsx`**
- Renders empty state
- Renders message list with mock messages
- Scroll-to-bottom button appears when not at bottom
- Send input calls mock `send` prop

---

## npm Scripts

Add to root `package.json`:

```json
"test:cypress": "cypress run --component",
"test:cypress:open": "cypress open --component"
```

Playwright scripts (`test:e2e`, `test:e2e:ui`) untouched.

---

## CI Integration

Add a new step to `.github/workflows/ci.yml` after the existing `npm test` step:

```yaml
- name: Install Cypress browser
  run: npx cypress install --force

- name: Cypress component tests
  run: npm run test:cypress
```

No Docker required. Runs on `ubuntu-latest` (same runner as current CI).  
Cypress downloads its own Electron-based browser — no external browser install needed for component tests (`cypress run` uses Electron by default).

---

## File Structure

```
cypress/
  support/
    component.ts          # global setup, WS stub, CSS import
    mount-with-providers.tsx  # mountWithProviders() helper
  tsconfig.json           # extends packages/client/tsconfig.json
cypress.config.ts         # Cypress config (component testing)
cypress.vite.config.ts    # lean Vite config for Cypress

packages/
  client/src/components/
    ChatView.tsx           # add data-testid attrs
    tool-renderers/
      BashToolRenderer.tsx     # add data-testid
      ReadToolRenderer.tsx     # add data-testid
      EditToolRenderer.tsx     # add data-testid
      WriteToolRenderer.tsx    # add data-testid
      AskUserToolRenderer.tsx  # add data-testid
      __tests__/
        ToolRenderers.cy.tsx   # new Cypress spec
  client-utils/src/
    AgentCardShell.tsx         # add data-testid
    AgentCardShell.cy.tsx      # new Cypress spec
  client/src/components/
    ChatView.cy.tsx            # new Cypress spec
```

---

## Out of Scope (Follow-up)

- Migrating Playwright E2E specs (`tests/e2e/`) to Cypress E2E
- Deleting Playwright config once E2E coverage is matched
- Cypress component specs for navigation, dialogs, branch picker
- Cypress Cloud / parallelization
