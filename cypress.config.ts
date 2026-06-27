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
