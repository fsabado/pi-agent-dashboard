import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import forgeConfig from "../../forge.config.js";

/**
 * Build-config parity lint (change: fix-electron-auto-update-pipeline, §3.6).
 *
 * The packaged app's `app-update.yml` is written by electron-builder while the
 * .app / .deb originate from Forge. Auto-update breaks if the two toolchains
 * disagree on identity fields (appId drives the NSIS install identity + the
 * electron-updater cache dir). This test fails on drift between:
 *   - forge.config.ts          (Forge: packagerConfig)
 *   - electron-builder.yml     (electron-builder: mac DMG + linux AppImage)
 *   - electron-builder-nsis.json (electron-builder: Windows NSIS)
 */
const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const eb = parseYaml(readFileSync(path.join(electronRoot, "electron-builder.yml"), "utf8"));
const nsis = JSON.parse(readFileSync(path.join(electronRoot, "electron-builder-nsis.json"), "utf8"));
const pkg = forgeConfig.packagerConfig ?? {};

const CANONICAL_APP_ID = "com.blackbelt-technology.pi-dashboard";
const CANONICAL_EXECUTABLE = "pi-dashboard";
const CANONICAL_PRODUCT = "PI Dashboard";

describe("build-config parity", () => {
  it("all three configs declare the same appId", () => {
    expect(pkg.appBundleId).toBe(CANONICAL_APP_ID);
    expect(eb.appId).toBe(CANONICAL_APP_ID);
    expect(nsis.appId).toBe(CANONICAL_APP_ID);
  });

  it("all three configs declare the same executable name", () => {
    expect(pkg.executableName).toBe(CANONICAL_EXECUTABLE);
    expect(eb.executableName).toBe(CANONICAL_EXECUTABLE);
    expect(nsis.executableName).toBe(CANONICAL_EXECUTABLE);
  });

  it("electron-builder configs agree on productName", () => {
    expect(eb.productName).toBe(CANONICAL_PRODUCT);
    expect(nsis.productName).toBe(CANONICAL_PRODUCT);
  });

  it("icon paths all resolve to the resources/icon family", () => {
    // Forge uses an extensionless base ("resources/icon"); electron-builder
    // needs the concrete .icns / .png. All must share the `icon` basename.
    expect(path.basename(String(pkg.icon))).toBe("icon");
    expect(path.basename(eb.mac.icon, ".icns")).toBe("icon");
    expect(path.basename(eb.linux.icon, ".png")).toBe("icon");
    expect(String(nsis.win.icon)).toContain("installer-icon");
  });

  it("electron-builder configs target the same GitHub release stream", () => {
    for (const cfg of [eb, nsis]) {
      expect(cfg.publish.provider).toBe("github");
      expect(cfg.publish.owner).toBe("BlackBeltTechnology");
      expect(cfg.publish.repo).toBe("pi-agent-dashboard");
    }
  });
});
