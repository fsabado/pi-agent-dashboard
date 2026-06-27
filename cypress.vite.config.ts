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
