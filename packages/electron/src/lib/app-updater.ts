/**
 * Electron app auto-updater using electron-updater + GitHub Releases.
 * Checks on launch and every 24 hours.
 */

// electron-updater is a runtime dependency that only works in packaged apps.
// In dev mode, we skip it entirely.

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface AppUpdateCallbacks {
  onUpdateAvailable: (version: string) => void;
  onUpdateDownloaded: (version: string) => void;
  onError: (error: Error) => void;
}

export type UpdateErrorSeverity = "debug" | "warn" | "error";

/** Result of a manual "Check for updates…" trigger. */
export type ManualCheckResult =
  | { type: "up-to-date"; version: string }
  | { type: "update-available"; version: string }
  | { type: "error"; message: string };

let intervalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Classify an `autoUpdater` error by severity so callers can route it to the
 * right log level. Pure function — no electron dependency, unit-testable.
 *
 * - `update-not-available` style messages ⇒ `debug` (chatty, not a failure)
 * - signature / sha512 / YAML-parse failures ⇒ `error` (publish-pipeline
 *   regressions — the most valuable signal)
 * - everything else (network: ECONNREFUSED/ETIMEDOUT/getaddrinfo/5xx) ⇒ `warn`
 */
export function classifyUpdateError(err: Error): UpdateErrorSeverity {
  const msg = (err?.message || String(err) || "").toLowerCase();

  if (/no (update|published versions)|update-not-available|not available/.test(msg)) {
    return "debug";
  }
  if (/sha512|signature|code signature|checksum|sha256|yaml|parse|cannot parse/.test(msg)) {
    return "error";
  }
  return "warn";
}

/**
 * Absolute path to the Electron main-process log file the updater writes to.
 * Resolved via `app.getPath('logs')`. Returns null when electron's `app` is
 * unavailable (dev / test runtime).
 */
export function getUpdateLogPath(): string | null {
  try {
    // Lazy require so vitest (no electron runtime) doesn't crash on import.
    const { app } = require("electron");
    const pathMod = require("node:path");
    return pathMod.join(app.getPath("logs"), "electron-main.log");
  } catch {
    return null;
  }
}

/** Append a severity-tagged line to the update log file. Best-effort. */
function logUpdate(severity: UpdateErrorSeverity, msg: string): void {
  const logPath = getUpdateLogPath();
  if (!logPath) return;
  try {
    const fs = require("node:fs");
    const pathMod = require("node:path");
    fs.mkdirSync(pathMod.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] [updater] [${severity}] ${msg}\n`,
    );
  } catch {
    /* logging is best-effort */
  }
}

// Test-only injection seam. The module resolves `electron-updater` via
// `require()` (works only in a packaged Electron runtime); vitest cannot
// intercept that, so tests inject a stub here instead.
let _testAutoUpdater: any = null;
export function __setTestAutoUpdater(mock: any): void {
  _testAutoUpdater = mock;
}

function getAutoUpdater(): any | null {
  if (_testAutoUpdater) return _testAutoUpdater;
  try {
    return require("electron-updater").autoUpdater;
  } catch {
    return null;
  }
}

/**
 * Initialize the auto-updater. Only works in packaged Electron apps.
 * Returns a cleanup function.
 */
export function initAutoUpdater(callbacks: AppUpdateCallbacks): () => void {
  // Skip in dev mode
  if (process.env.ELECTRON_DEV || !(process as any).resourcesPath) {
    return () => {};
  }

  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) return () => {};

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info: any) => {
    callbacks.onUpdateAvailable(info.version);
  });

  autoUpdater.on("update-downloaded", (info: any) => {
    callbacks.onUpdateDownloaded(info.version);
  });

  autoUpdater.on("error", (err: Error) => {
    // Surface to the log file with a severity tier — never silently swallow.
    const severity = classifyUpdateError(err);
    logUpdate(severity, `${err?.message || err}\n${err?.stack || ""}`.trim());
    callbacks.onError(err);
  });

  // Initial check after 60s
  const initialTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 60_000);

  // Periodic check
  intervalTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  };
}

/**
 * Trigger an immediate update check, bypassing the 24h timer. Resolves with
 * one of three result shapes so the caller can show the right native dialog.
 * No-op-safe in dev/test: returns an `error` result when the updater is
 * unavailable rather than throwing.
 */
export async function checkForUpdatesNow(): Promise<ManualCheckResult> {
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) {
    return { type: "error", message: "Updater unavailable" };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    // electron-updater resolves `isUpdateAvailable` on v6; fall back to a
    // version comparison against the running app when absent.
    const currentVersion: string = autoUpdater.currentVersion?.version
      ?? (() => {
        try {
          return require("electron").app.getVersion();
        } catch {
          return "";
        }
      })();
    const available =
      result?.isUpdateAvailable ??
      (!!info?.version && info.version !== currentVersion);

    if (available && info?.version) {
      return { type: "update-available", version: info.version };
    }
    return { type: "up-to-date", version: info?.version || currentVersion };
  } catch (err: any) {
    const message = err?.message || String(err);
    logUpdate(classifyUpdateError(err instanceof Error ? err : new Error(message)), message);
    return { type: "error", message };
  }
}

/**
 * Download and install the pending update.
 * The app will restart after installation.
 */
export function downloadAndInstall(): void {
  const autoUpdater = getAutoUpdater();
  // After download completes, autoInstallOnAppQuit will handle restart.
  // downloadUpdate() returns a Promise that rejects on failure; the 'error'
  // listener logs it, so swallow the rejection here to avoid an unhandled
  // promise rejection. See CodeRabbit review on PR #192.
  autoUpdater?.downloadUpdate?.()?.catch(() => {});
}

/**
 * Quit and install the downloaded update immediately.
 */
export function quitAndInstall(): void {
  const autoUpdater = getAutoUpdater();
  autoUpdater?.quitAndInstall();
}
