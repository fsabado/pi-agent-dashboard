// packages/server/src/routes/session-tree-routes.ts
import { watch, readFileSync } from "node:fs";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { PendingForkRegistry } from "../pending-fork-registry.js";
import type { SessionManager } from "../memory-session-manager.js";
import { spawnPiSession } from "../process-manager.js";
import {
  buildSessionTreeState,
  forkSessionAfterEntry,
  truncateSessionAfterEntry,
  deleteBranch,
} from "../session-tree.js";

export function registerSessionTreeRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    pendingForkRegistry?: PendingForkRegistry;
    sessionManager?: SessionManager;
  },
) {
  const { networkGuard } = deps;

  // GET /api/session-tree?sessionFile=<path>
  fastify.get<{ Querystring: { sessionFile?: string } }>(
    "/api/session-tree",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile } = request.query;
      if (!sessionFile) {
        reply.code(400);
        return { success: false, error: "sessionFile required" } satisfies ApiResponse;
      }
      const state = buildSessionTreeState(sessionFile);
      if (!state) {
        reply.code(404);
        return { success: false, error: "Session not found." } satisfies ApiResponse;
      }
      return { success: true, data: state } satisfies ApiResponse;
    },
  );

  // GET /api/session-tree/events?sessionFile=<path>  — SSE live updates
  fastify.get<{ Querystring: { sessionFile?: string } }>(
    "/api/session-tree/events",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile } = request.query;
      if (!sessionFile) {
        reply.code(400).send("sessionFile required");
        return;
      }
      const state = buildSessionTreeState(sessionFile);
      if (!state) {
        reply.code(404).send("Session not found.");
        return;
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      (reply.raw as { flushHeaders?: () => void }).flushHeaders?.();

      let lastPayload = "";
      const sendState = () => {
        try {
          const current = buildSessionTreeState(sessionFile);
          if (!current) return;
          const payload = JSON.stringify(current);
          if (payload === lastPayload) return;
          lastPayload = payload;
          reply.raw.write(`event: state\ndata: ${payload}\n\n`);
        } catch { /* ignore */ }
      };

      sendState(); // send initial state immediately

      let watcher: ReturnType<typeof watch> | undefined;
      let pending: NodeJS.Timeout | undefined;
      try {
        watcher = watch(state.root.sessionDir, { persistent: false }, () => {
          if (pending) return;
          pending = setTimeout(() => { pending = undefined; sendState(); }, 120);
        });
        watcher.on("error", () => { /* directory may disappear */ });
      } catch { /* not watchable */ }

      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
      }, 25_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        watcher?.close();
      });
    },
  );

  // POST /api/session-tree/fork
  fastify.post<{ Body: { sessionFile?: string; entryId?: string; name?: string } }>(
    "/api/session-tree/fork",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile, entryId, name } = request.body ?? {};
      if (!sessionFile || !entryId) {
        reply.code(400);
        return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
      }
      try {
        const result = forkSessionAfterEntry(sessionFile, entryId, name);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );

  // POST /api/session-tree/fork-and-spawn
  fastify.post<{ Body: { sessionFile?: string; entryId?: string; name?: string; parentSessionId?: string } }>(
    "/api/session-tree/fork-and-spawn",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile, entryId, name, parentSessionId } = request.body ?? {};
      if (!sessionFile || !entryId) {
        reply.code(400);
        return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
      }

      // 1. Create the fork .jsonl file
      let forkResult: { sessionFile: string };
      try {
        forkResult = forkSessionAfterEntry(sessionFile, entryId, name);
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }

      // 2. Determine cwd — session manager first, fall back to reading header
      const cwd = (() => {
        if (deps.sessionManager && parentSessionId) {
          const sessions = deps.sessionManager.listAll();
          const parent = sessions.find((s) => s.id === parentSessionId);
          if (parent?.cwd) return parent.cwd;
        }
        try {
          const first = readFileSync(sessionFile, "utf-8").split("\n")[0];
          const header = JSON.parse(first) as { cwd?: string };
          return header.cwd ?? null;
        } catch {
          return null;
        }
      })();

      if (!cwd) {
        reply.code(400);
        return { success: false, error: "Could not determine cwd for fork" } satisfies ApiResponse;
      }

      // 3. Spawn pi in rpc mode with the fork file
      const config = loadConfig();
      const spawnResult = await spawnPiSession(cwd, {
        sessionFile: forkResult.sessionFile,
        mode: "fork",
        strategy: config.spawnStrategy,
      });

      // 4. Record fork for left-pane ordering
      if (parentSessionId && deps.pendingForkRegistry && spawnResult.spawnToken) {
        deps.pendingForkRegistry.recordFork(spawnResult.spawnToken, parentSessionId);
      }

      if (!spawnResult.success) {
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }

      return {
        success: true,
        data: { forkSessionFile: forkResult.sessionFile, spawnToken: spawnResult.spawnToken },
      } satisfies ApiResponse;
    },
  );

  // POST /api/session-tree/truncate-after
  fastify.post<{ Body: { sessionFile?: string; entryId?: string } }>(
    "/api/session-tree/truncate-after",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sessionFile, entryId } = request.body ?? {};
      if (!sessionFile || !entryId) {
        reply.code(400);
        return { success: false, error: "sessionFile and entryId required" } satisfies ApiResponse;
      }
      try {
        const result = truncateSessionAfterEntry(sessionFile, entryId);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );

  // POST /api/session-tree/delete-branch
  fastify.post<{ Body: { rootSessionFile?: string; nodeId?: string } }>(
    "/api/session-tree/delete-branch",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { rootSessionFile, nodeId } = request.body ?? {};
      if (!rootSessionFile || !nodeId) {
        reply.code(400);
        return { success: false, error: "rootSessionFile and nodeId required" } satisfies ApiResponse;
      }
      try {
        const result = deleteBranch(rootSessionFile, nodeId);
        return { success: true, data: result } satisfies ApiResponse;
      } catch (e) {
        reply.code(400);
        return { success: false, error: e instanceof Error ? e.message : String(e) } satisfies ApiResponse;
      }
    },
  );
}
