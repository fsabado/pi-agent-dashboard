// packages/server/src/routes/session-tree-routes.ts
import { watch } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  buildSessionTreeState,
  forkSessionAfterEntry,
  truncateSessionAfterEntry,
  deleteBranch,
} from "../session-tree.js";

export function registerSessionTreeRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
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
