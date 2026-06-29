import { describe, it, expect, vi, afterEach } from "vitest";
import {
  initAutoUpdater,
  classifyUpdateError,
  checkForUpdatesNow,
  downloadAndInstall,
  quitAndInstall,
  __setTestAutoUpdater,
  type AppUpdateCallbacks,
} from "../lib/app-updater.js";

describe("app-updater", () => {
  it("returns noop cleanup in dev mode", () => {
    const origDev = process.env.ELECTRON_DEV;
    process.env.ELECTRON_DEV = "1";
    try {
      const callbacks: AppUpdateCallbacks = {
        onUpdateAvailable: vi.fn(),
        onUpdateDownloaded: vi.fn(),
        onError: vi.fn(),
      };
      const cleanup = initAutoUpdater(callbacks);
      expect(typeof cleanup).toBe("function");
      cleanup(); // should not throw
    } finally {
      if (origDev !== undefined) process.env.ELECTRON_DEV = origDev;
      else delete process.env.ELECTRON_DEV;
    }
  });

  it("returns noop when electron-updater is not available", () => {
    const origDev = process.env.ELECTRON_DEV;
    delete process.env.ELECTRON_DEV;
    try {
      const callbacks: AppUpdateCallbacks = {
        onUpdateAvailable: vi.fn(),
        onUpdateDownloaded: vi.fn(),
        onError: vi.fn(),
      };
      // electron-updater won't be available in test environment
      const cleanup = initAutoUpdater(callbacks);
      expect(typeof cleanup).toBe("function");
      cleanup();
    } finally {
      if (origDev !== undefined) process.env.ELECTRON_DEV = origDev;
      else delete process.env.ELECTRON_DEV;
    }
  });
});

describe("classifyUpdateError", () => {
  it("classifies update-not-available as debug", () => {
    expect(classifyUpdateError(new Error("No published versions on GitHub"))).toBe("debug");
    expect(classifyUpdateError(new Error("update-not-available"))).toBe("debug");
  });

  it("classifies signature / sha512 / parse failures as error", () => {
    expect(classifyUpdateError(new Error("sha512 checksum mismatch"))).toBe("error");
    expect(classifyUpdateError(new Error("code signature did not verify"))).toBe("error");
    expect(classifyUpdateError(new Error("Cannot parse latest.yml"))).toBe("error");
  });

  it("classifies network failures as warn", () => {
    expect(classifyUpdateError(new Error("connect ECONNREFUSED 1.2.3.4:443"))).toBe("warn");
    expect(classifyUpdateError(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("warn");
    expect(classifyUpdateError(new Error("HTTP 503 Service Unavailable"))).toBe("warn");
  });
});

describe("checkForUpdatesNow", () => {
  afterEach(() => __setTestAutoUpdater(null));

  it("returns error when electron-updater is unavailable", async () => {
    __setTestAutoUpdater(null);
    const result = await checkForUpdatesNow();
    expect(result.type).toBe("error");
  });

  it("returns update-available when a newer version is reported", async () => {
    __setTestAutoUpdater({
      currentVersion: { version: "1.0.0" },
      checkForUpdates: vi.fn().mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: "1.2.3" },
      }),
    });
    const result = await checkForUpdatesNow();
    expect(result).toEqual({ type: "update-available", version: "1.2.3" });
  });

  it("returns up-to-date when no newer version exists", async () => {
    __setTestAutoUpdater({
      currentVersion: { version: "1.2.3" },
      checkForUpdates: vi.fn().mockResolvedValue({
        isUpdateAvailable: false,
        updateInfo: { version: "1.2.3" },
      }),
    });
    const result = await checkForUpdatesNow();
    expect(result).toEqual({ type: "up-to-date", version: "1.2.3" });
  });

  it("returns error when the check throws", async () => {
    __setTestAutoUpdater({
      currentVersion: { version: "1.0.0" },
      checkForUpdates: vi.fn().mockRejectedValue(new Error("network unreachable")),
    });
    const result = await checkForUpdatesNow();
    expect(result).toEqual({ type: "error", message: "network unreachable" });
  });
});

describe("download vs quit are distinct entry points", () => {
  afterEach(() => __setTestAutoUpdater(null));

  it("downloadAndInstall calls downloadUpdate, not quitAndInstall", () => {
    const downloadUpdate = vi.fn();
    const quitAndInstallFn = vi.fn();
    __setTestAutoUpdater({ downloadUpdate, quitAndInstall: quitAndInstallFn });
    downloadAndInstall();
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(quitAndInstallFn).not.toHaveBeenCalled();
    quitAndInstall();
    expect(quitAndInstallFn).toHaveBeenCalledOnce();
  });
});
