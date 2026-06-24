/**
 * PID file management for the dashboard server process.
 * Writes/reads/removes ~/.pi/dashboard/server.pid to track the running server.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

const DEFAULT_PID_PATH = path.join(os.homedir(), ".pi", "dashboard", "server.pid");
const DEFAULT_LOCK_PATH = path.join(os.homedir(), ".pi", "dashboard", "server.lock");

export interface ServerPidOptions {
  pidPath?: string;
}

/**
 * Re-export the platform's liveness primitive so existing importers of
 * `server-pid.ts::isProcessAlive` keep working. See change:
 * route-kill-paths-through-platform.
 */
export { isProcessAlive };

/**
 * Write the current process PID to the PID file.
 */
export function writePid(pid: number, options?: ServerPidOptions): void {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  const dir = path.dirname(pidPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pidPath, String(pid) + "\n");
}

/**
 * Read the PID from the PID file. Returns null if file doesn't exist or is invalid.
 */
export function readPid(options?: ServerPidOptions): number | null {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  try {
    const content = fs.readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Acquire an exclusive spawn lock using O_EXCL (atomic). Returns true if acquired,
 * false if another process already holds it. The lock is auto-expired after
 * `ttlMs` (default 30s) to recover from crashes before the lock is released.
 */
export function acquireSpawnLock(ttlMs = 30_000, lockPath = DEFAULT_LOCK_PATH): boolean {
  const dir = path.dirname(lockPath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    // O_EXCL = fail if exists (atomic on Linux/macOS)
    const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    // Lock exists — check if it's stale
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > ttlMs) {
        fs.unlinkSync(lockPath);
        return acquireSpawnLock(ttlMs, lockPath); // retry once
      }
    } catch { /* ignore */ }
    return false;
  }
}

/**
 * Release the spawn lock.
 */
export function releaseSpawnLock(lockPath = DEFAULT_LOCK_PATH): void {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

/**
 * Remove the PID file.
 */
export function removePid(options?: ServerPidOptions): void {
  const pidPath = options?.pidPath ?? DEFAULT_PID_PATH;
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if the dashboard server is currently running.
 * Returns the PID if running, null otherwise.
 * Cleans up stale PID files automatically.
 */
export async function isServerRunning(port: number, options?: ServerPidOptions): Promise<number | null> {
  const pid = readPid(options);

  if (pid === null) return null;

  // Process alive — verify it's actually our server via health check
  if (isProcessAlive(pid)) {
    const status = await isDashboardRunning(port);
    if (status.running) return pid;
    // Process alive but dashboard not responding — could be a recycled PID, treat as stale
  }

  // Stale PID file — clean up
  removePid(options);
  return null;
}
