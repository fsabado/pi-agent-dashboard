import React from "react";
import { mount } from "cypress/react";
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
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mountWithProviders(component: React.ReactElement): Cypress.Chainable<unknown>;
    }
  }
}

Cypress.Commands.add("mountWithProviders", (component) => {
  return mount(<AllProviders>{component}</AllProviders>);
});
