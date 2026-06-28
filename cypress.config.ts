import { defineConfig } from "cypress";
import viteConfig from "./cypress.vite.config.js";
import cypressMochawesomeReporter from "cypress-mochawesome-reporter/plugin";

export default defineConfig({
  reporter: "cypress-mochawesome-reporter",
  reporterOptions: {
    reportDir: "/home/sagemaker-user/studio/cypress",
    overwrite: false,
    html: false,   // individual spec HTMLs off — merge step produces the single report
    json: true,
    charts: true,
    embeddedScreenshots: true,
    inlineAssets: true,
    videoOnFailOnly: false,
    embeddedVideos: true,
  },
  component: {
    video: true,
    videosFolder: "/home/sagemaker-user/studio/cypress/videos",
    videoCompression: 32,
    devServer: {
      framework: "react",
      bundler: "vite",
      viteConfig,
    },
    specPattern: "packages/**/*.cy.{ts,tsx}",
    supportFile: "cypress/support/component.ts",
    setupNodeEvents(on) {
      cypressMochawesomeReporter(on);
    },
  },
});
