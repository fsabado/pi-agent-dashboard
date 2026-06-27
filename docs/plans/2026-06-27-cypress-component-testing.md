# Cypress Component Testing Implementation Plan

> **For Claude:** Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Add Cypress 14 component testing for `AgentCardShell`, tool renderers, and `ChatView` — no Docker, with time-travel debugging.

**Architecture:** Cypress 14 + `@cypress/vite-dev-server` reading a lean `cypress.vite.config.ts` (strips server-specific plugins). A `mountWithProviders()` helper wraps the React context stack. Playwright E2E coexists unchanged. Specs live at `**/*.cy.tsx`.

**Tech Stack:** Cypress 14, `@cypress/vite-dev-server`, React 19, Tailwind v4 (`@tailwindcss/vite`), TypeScript.

---

## Task 1: Remove `frontmanPlugin` from Vite config

**Files:**
- Modify: `packages/client/vite.config.ts`

**Step 1: Remove frontman import and plugin entry**

```ts
// Remove these two lines:
import { frontmanPlugin } from '@frontman-ai/vite';
// and inside plugins[]:
frontmanPlugin({ host: 'localhost:4000' }),
```

**Step 2: Verify dev server still starts**

```bash
npm run build 2>&1 | tail -5
```
Expected: build succeeds (no frontman errors).

**Step 3: Commit**

```bash
git add packages/client/vite.config.ts
git commit -m "chore: remove frontmanPlugin (no longer needed)"
```

---

## Task 2: Install Cypress 14

**Files:**
- Modify: `package.json` (root)

**Step 1: Install**

```bash
npm install --save-dev cypress@14 @cypress/vite-dev-server
```

**Step 2: Verify**

```bash
npx cypress --version
```
Expected: `Cypress package version: 14.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cypress 14 + @cypress/vite-dev-server"
```

---

## Task 3: Create `cypress.vite.config.ts`

**Files:**
- Create: `cypress.vite.config.ts`

**Step 1: Write lean config**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Lean Vite config for Cypress component testing.
// Omits viteDashboardPluginsPlugin (monorepo plugin scanner — errors in CT context)
// and frontmanPlugin (removed). Keeps react, tailwindcss, and path aliases.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(
        __dirname,
        "packages/shared/src",
      ),
      "@blackbelt-technology/pi-dashboard-client-utils": path.resolve(
        __dirname,
        "packages/client-utils/src",
      ),
    },
  },
});
```

**Step 2: Commit**

```bash
git add cypress.vite.config.ts
git commit -m "chore: add cypress.vite.config.ts (lean, no server plugins)"
```

---

## Task 4: Create `cypress.config.ts`

**Files:**
- Create: `cypress.config.ts`

**Step 1: Write config**

```ts
import { defineConfig } from "cypress";
import viteConfig from "./cypress.vite.config.js";

export default defineConfig({
  component: {
    devServer: {
      framework: "react",
      bundler: "vite",
      viteConfig,
    },
    specPattern: "packages/**/*.cy.{ts,tsx}",
    supportFile: "cypress/support/component.ts",
  },
});
```

**Step 2: Commit**

```bash
git add cypress.config.ts
git commit -m "chore: add cypress.config.ts (component testing)"
```

---

## Task 5: Create Cypress support files

**Files:**
- Create: `cypress/support/component.ts`
- Create: `cypress/support/mount-with-providers.tsx`
- Create: `cypress/tsconfig.json`

**Step 1: Write `cypress/tsconfig.json`**

```json
{
  "extends": "../packages/client/tsconfig.json",
  "compilerOptions": {
    "types": ["cypress", "@cypress/vite-dev-server"],
    "rootDir": "."
  },
  "include": ["**/*.ts", "**/*.tsx", "../packages/**/*.cy.tsx"]
}
```

**Step 2: Write `cypress/support/component.ts`**

```ts
import "./mount-with-providers.js";
import "../../packages/client/src/index.css";

// Stub window.WebSocket globally — prevents real connection attempts
// in component context. Components under test receive WS state as props.
Cypress.on("window:before:load", (win) => {
  class StubWS extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = StubWS.OPEN;
    send() {}
    close() {}
  }
  win.WebSocket = StubWS as unknown as typeof WebSocket;
});
```

**Step 3: Write `cypress/support/mount-with-providers.tsx`**

```tsx
import React from "react";
import { mount } from "cypress/react18";
import { ThemeProvider } from "../../packages/client/src/components/ThemeProvider.js";
import { MobileProvider } from "../../packages/client/src/hooks/useMobile.js";
import { I18nProvider } from "../../packages/client/src/lib/i18n.js";
import {
  UiPrimitiveProvider,
  createUiPrimitiveRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";

const emptyRegistry = createUiPrimitiveRegistry();

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <UiPrimitiveProvider value={emptyRegistry}>
      <ThemeProvider>
        <I18nProvider>
          <MobileProvider>{children}</MobileProvider>
        </I18nProvider>
      </ThemeProvider>
    </UiPrimitiveProvider>
  );
}

declare global {
  namespace Cypress {
    interface Chainable {
      mountWithProviders(
        component: React.ReactElement,
      ): Cypress.Chainable<unknown>;
    }
  }
}

Cypress.Commands.add("mountWithProviders", (component) => {
  return mount(<AllProviders>{component}</AllProviders>);
});
```

**Step 4: Verify Cypress opens without errors**

```bash
npx cypress open --component 2>&1 | head -20
```
Expected: Cypress GUI launches or exits cleanly (no import errors).

**Step 5: Commit**

```bash
git add cypress/
git commit -m "chore: add cypress support files and mountWithProviders helper"
```

---

## Task 6: Add npm scripts

**Files:**
- Modify: `package.json` (root `scripts`)

**Step 1: Add scripts**

```json
"test:cypress": "cypress run --component",
"test:cypress:open": "cypress open --component"
```

**Step 2: Verify script runs (will pass with 0 specs for now)**

```bash
npm run test:cypress 2>&1 | tail -10
```
Expected: "No spec files found" or 0 tests run — no crash.

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add test:cypress and test:cypress:open scripts"
```

---

## Task 7: Add `data-testid` to `AgentCardShell`

**Files:**
- Modify: `packages/client-utils/src/AgentCardShell.tsx`

**Step 1: Add testids to root, name, and status icon**

Add to the outer `<div>`:
```tsx
data-testid="agent-card-shell"
```

Add to the name `<span>`:
```tsx
data-testid="agent-card-name"
```

Add to the icon `<span>`:
```tsx
data-testid="agent-card-status-icon"
```

**Step 2: Commit**

```bash
git add packages/client-utils/src/AgentCardShell.tsx
git commit -m "test: add data-testid to AgentCardShell"
```

---

## Task 8: Write `AgentCardShell.cy.tsx`

**Files:**
- Create: `packages/client-utils/src/AgentCardShell.cy.tsx`

**Step 1: Write spec**

```tsx
import React from "react";
import { AgentCardShell } from "./AgentCardShell.js";

describe("AgentCardShell", () => {
  it("renders name", () => {
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete" />,
    );
    cy.get('[data-testid="agent-card-name"]').should("have.text", "Explore");
  });

  it("renders children", () => {
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete">
        <span data-testid="child">child content</span>
      </AgentCardShell>,
    );
    cy.get('[data-testid="child"]').should("exist");
  });

  it("calls onClick when clicked", () => {
    const onClick = cy.stub().as("onClick");
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete" onClick={onClick} />,
    );
    cy.get('[data-testid="agent-card-shell"]').click();
    cy.get("@onClick").should("have.been.calledOnce");
  });

  it("applies selected styling", () => {
    cy.mountWithProviders(
      <AgentCardShell name="Explore" status="complete" selected />,
    );
    cy.get('[data-testid="agent-card-shell"]').should(
      "have.class",
      "border-blue-500/60",
    );
  });

  for (const status of ["running", "error", "complete"] as const) {
    it(`renders status icon for: ${status}`, () => {
      cy.mountWithProviders(
        <AgentCardShell name="Agent" status={status} />,
      );
      cy.get('[data-testid="agent-card-status-icon"]').should("exist");
    });
  }
});
```

**Step 2: Run spec**

```bash
npm run test:cypress 2>&1 | tail -20
```
Expected: 7 passing.

**Step 3: Commit**

```bash
git add packages/client-utils/src/AgentCardShell.cy.tsx
git commit -m "test(cypress): AgentCardShell component spec"
```

---

## Task 9: Add `data-testid` to tool renderers

**Files:**
- Modify: `packages/client/src/components/tool-renderers/BashToolRenderer.tsx`
- Modify: `packages/client/src/components/tool-renderers/ReadToolRenderer.tsx`
- Modify: `packages/client/src/components/tool-renderers/EditToolRenderer.tsx`
- Modify: `packages/client/src/components/tool-renderers/WriteToolRenderer.tsx`
- Modify: `packages/client/src/components/tool-renderers/AskUserToolRenderer.tsx`

**Step 1: Add to each renderer's root `<div>`**

| File | testid |
|---|---|
| `BashToolRenderer` | `data-testid="bash-tool-renderer"` |
| `ReadToolRenderer` | `data-testid="read-tool-renderer"` |
| `EditToolRenderer` | `data-testid="edit-tool-renderer"` |
| `WriteToolRenderer` | `data-testid="write-tool-renderer"` |
| `AskUserToolRenderer` | `data-testid="ask-user-tool-renderer"` |

Also add `data-testid="bash-output"` to the `<pre>` inside `BashToolRenderer`.

**Step 2: Commit**

```bash
git add packages/client/src/components/tool-renderers/
git commit -m "test: add data-testid to tool renderers"
```

---

## Task 10: Write `ToolRenderers.cy.tsx`

**Files:**
- Create: `packages/client/src/components/tool-renderers/__tests__/ToolRenderers.cy.tsx`

**Step 1: Write spec**

```tsx
import React from "react";
import { BashToolRenderer } from "../BashToolRenderer.js";
import { ReadToolRenderer } from "../ReadToolRenderer.js";
import { WriteToolRenderer } from "../WriteToolRenderer.js";
import type { ToolRendererProps } from "../types.js";

const context = { sessionId: "s1", cwd: "/tmp" } as ToolRendererProps["context"];
const baseProps = { status: "complete", context } as Partial<ToolRendererProps>;

describe("BashToolRenderer", () => {
  it("renders command", () => {
    cy.mountWithProviders(
      <BashToolRenderer
        {...(baseProps as ToolRendererProps)}
        args={{ command: "ls -la" }}
        result="total 0"
      />,
    );
    cy.get('[data-testid="bash-tool-renderer"]').should("exist");
    cy.contains("ls -la").should("exist");
  });

  it("renders output", () => {
    cy.mountWithProviders(
      <BashToolRenderer
        {...(baseProps as ToolRendererProps)}
        args={{ command: "echo hi" }}
        result="hi"
      />,
    );
    cy.get('[data-testid="bash-output"]').should("contain.text", "hi");
  });

  it("shows running state when no result", () => {
    cy.mountWithProviders(
      <BashToolRenderer
        {...(baseProps as ToolRendererProps)}
        status="running"
        args={{ command: "sleep 10" }}
      />,
    );
    cy.contains("Running").should("exist");
  });
});

describe("ReadToolRenderer", () => {
  it("renders", () => {
    cy.mountWithProviders(
      <ReadToolRenderer
        {...(baseProps as ToolRendererProps)}
        args={{ path: "/src/foo.ts" }}
        result="const x = 1;"
      />,
    );
    cy.get('[data-testid="read-tool-renderer"]').should("exist");
    cy.contains("foo.ts").should("exist");
  });
});

describe("WriteToolRenderer", () => {
  it("renders", () => {
    cy.mountWithProviders(
      <WriteToolRenderer
        {...(baseProps as ToolRendererProps)}
        args={{ path: "/src/bar.ts", content: "export const x = 1;" }}
      />,
    );
    cy.get('[data-testid="write-tool-renderer"]').should("exist");
    cy.contains("bar.ts").should("exist");
  });
});
```

**Step 2: Run spec**

```bash
npm run test:cypress 2>&1 | tail -20
```
Expected: all passing.

**Step 3: Commit**

```bash
git add packages/client/src/components/tool-renderers/__tests__/ToolRenderers.cy.tsx
git commit -m "test(cypress): tool renderer component specs"
```

---

## Task 11: Add `data-testid` to `ChatView`

**Files:**
- Modify: `packages/client/src/components/ChatView.tsx`

**Step 1: Add testids**

- Outer container `<div>`: `data-testid="chat-view"`
- Messages list container: `data-testid="chat-message-list"`

(The scroll-to-bottom button already has `data-testid="scroll-to-bottom"`.)

**Step 2: Commit**

```bash
git add packages/client/src/components/ChatView.tsx
git commit -m "test: add data-testid to ChatView"
```

---

## Task 12: Write `ChatView.cy.tsx`

**Files:**
- Create: `packages/client/src/components/ChatView.cy.tsx`

**Step 1: Write spec**

Note: `ChatView` has a rich `state: SessionState` prop. Use the minimal shape that satisfies the component (empty messages, `status: "idle"`).

```tsx
import React from "react";
import { ChatView } from "./ChatView.js";
import type { SessionState } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

const emptyState: SessionState = {
  status: "idle",
  entries: [],
  pendingQueues: { steering: [], prompts: [] },
} as unknown as SessionState;

const context = { sessionId: "s1", cwd: "/tmp" } as Parameters<typeof ChatView>[0]["toolContext"];

describe("ChatView", () => {
  it("renders empty state", () => {
    cy.mountWithProviders(
      <ChatView state={emptyState} toolContext={context} />,
    );
    cy.get('[data-testid="chat-view"]').should("exist");
  });

  it("renders message list container", () => {
    cy.mountWithProviders(
      <ChatView state={emptyState} toolContext={context} />,
    );
    cy.get('[data-testid="chat-message-list"]').should("exist");
  });
});
```

**Step 2: Run spec**

```bash
npm run test:cypress 2>&1 | tail -20
```
Expected: 2 passing.

**Step 3: Commit**

```bash
git add packages/client/src/components/ChatView.cy.tsx
git commit -m "test(cypress): ChatView component spec"
```

---

## Task 13: Update CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Add Cypress steps after `npm test`**

```yaml
- name: Install Cypress
  run: npx cypress install --force

- name: Cypress component tests
  run: npm run test:cypress
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add cypress component test step"
```

---

## Verification

```bash
npm run test:cypress        # all specs pass headless
npm run test:cypress:open   # time-travel UI opens
npm test                    # vitest still green (no collision)
npm run build               # client builds without frontmanPlugin
```
