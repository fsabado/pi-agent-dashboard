// packages/server/src/__tests__/session-tree.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSessionTreeState, parseSessionFile } from "../session-tree.js";

const TMP = join(tmpdir(), `session-tree-test-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

function makeSession(id: string, parentSession?: string): string {
  const file = join(TMP, `${id}.jsonl`);
  const header = {
    type: "session", version: 3, id, cwd: TMP,
    timestamp: new Date().toISOString(),
    ...(parentSession ? { parentSession } : {}),
  };
  const entry = {
    type: "message", id: "e1", parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "hello" },
  };
  writeFileSync(file, [header, entry].map(e => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

describe("parseSessionFile", () => {
  it("parses a valid session file", () => {
    const file = makeSession("parse-1");
    const result = parseSessionFile(file);
    expect(result).not.toBeUndefined();
    expect(result!.header.id).toBe("parse-1");
    expect(result!.entries).toHaveLength(1);
  });

  it("returns undefined for missing file", () => {
    expect(parseSessionFile(join(TMP, "nope.jsonl"))).toBeUndefined();
  });
});

describe("buildSessionTreeState", () => {
  it("returns state for a single session", () => {
    const file = makeSession("root-1");
    const state = buildSessionTreeState(file);
    expect(state).not.toBeNull();
    expect(state!.nodes).toHaveLength(1);
    expect(state!.nodes[0].id).toBe("ROOT");
    expect(state!.nodes[0].sessionFile).toBe(file);
  });

  it("returns null for missing file", () => {
    expect(buildSessionTreeState(join(TMP, "ghost.jsonl"))).toBeNull();
  });

  it("includes child fork session", () => {
    const root = makeSession("root-2");
    makeSession("child-2", root);
    const state = buildSessionTreeState(root);
    expect(state!.nodes).toHaveLength(2);
    const ids = state!.nodes.map(n => n.id);
    expect(ids).toContain("ROOT");
    expect(ids).toContain("S0001");
  });
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));
