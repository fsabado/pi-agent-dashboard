import { describe, expect, it } from "vitest";
import { deriveFlowEdges, type FlowEdgeStep } from "../client/flow-edges.js";

const key = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

describe("deriveFlowEdges", () => {
  it("derives the four edge classes", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "b", type: "code", blockedBy: ["a"], onComplete: "d" }, // sequential a->b, route b->d
      { id: "d", type: "code-decision", blockedBy: ["b"], branches: { again: "b" } }, // branch d->b (back)
      { id: "sep", type: "fork", blockedBy: ["d"] },
      { id: "e", type: "agent", blockedBy: [] }, // implicit sep->e (no other incoming)
    ];
    const edges = deriveFlowEdges(steps);
    const byKey = new Map(edges.map((e) => [key(e), e]));

    expect(byKey.get("a->b")?.kind).toBe("sequential");
    expect(byKey.get("d->b")?.kind).toBe("branch");
    expect(byKey.get("d->b")?.label).toBe("again");
    expect(byKey.get("sep->e")?.kind).toBe("implicit");
    expect(byKey.get("b->d")?.kind).toBe("route");
  });

  it("does not serialize parallel siblings (no separator predecessor)", () => {
    // Three roots with no blockedBy and no separator between them: the engine
    // runs all three in wave 1 (parallel). No implicit chain should be drawn.
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "impl", type: "agent", blockedBy: [] },
      { id: "docs", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges).toHaveLength(0);
  });

  it("keeps the implicit edge across a separator boundary", () => {
    // A step with no blockedBy immediately after a separator falls through from it.
    const steps: FlowEdgeStep[] = [
      { id: "decide", type: "code-decision", blockedBy: [] },
      { id: "next", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.find((e) => key(e) === "decide->next")?.kind).toBe("implicit");
  });

  it("fans all no-blockedBy roots out from the preceding separator (parallel)", () => {
    // Two parallel roots after one separator: BOTH fall through from the
    // separator (parallel), not chained b->c.
    const steps: FlowEdgeStep[] = [
      { id: "sep", type: "fork", blockedBy: [] },
      { id: "b", type: "agent", blockedBy: [] },
      { id: "c", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.find((e) => key(e) === "sep->b")?.kind).toBe("implicit");
    expect(edges.find((e) => key(e) === "sep->c")?.kind).toBe("implicit");
    expect(edges.some((e) => key(e) === "b->c")).toBe(false);
  });

  it("flags backward edges", () => {
    const steps: FlowEdgeStep[] = [
      { id: "work", type: "agent", blockedBy: [] },
      { id: "gate", type: "code-decision", blockedBy: ["work"], branches: { again: "work", go: "done" } },
      { id: "done", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const back = edges.find((e) => key(e) === "gate->work")!;
    const fwd = edges.find((e) => key(e) === "gate->done")!;
    expect(back.backward).toBe(true);
    expect(fwd.backward).toBe(false);
  });

  it("collapses duplicate {from,to}, preferring labeled branch", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "fork", blockedBy: [], branches: { x: "b" } },
      { id: "b", type: "agent", blockedBy: ["a"] }, // sequential a->b AND branch a->b
    ];
    const edges = deriveFlowEdges(steps);
    const ab = edges.filter((e) => key(e) === "a->b");
    expect(ab).toHaveLength(1);
    expect(ab[0].kind).toBe("branch");
    expect(ab[0].label).toBe("x");
  });

  it("emits route edges only when onComplete/onError present", () => {
    const withRoute = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [], onComplete: "b" },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    expect(withRoute.find((e) => key(e) === "a->b")?.kind).toBe("route");

    const liveNoRoute = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [] },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    expect(liveNoRoute.some((e) => e.kind === "route")).toBe(false);
  });

  it("classifies an on_error route as returning when the handler rejoins the flow", () => {
    const steps: FlowEdgeStep[] = [
      { id: "validate", type: "code-decision", blockedBy: [], onError: "fixup" },
      { id: "transform", type: "agent", blockedBy: ["validate"] },
      { id: "fixup", type: "agent", blockedBy: [], onComplete: "validate" }, // rejoins the spine
    ];
    const r = deriveFlowEdges(steps).find((e) => key(e) === "validate->fixup")!;
    expect(r.kind).toBe("route");
    expect(r.label).toBe("on_error");
    expect(r.routeTopology).toBe("returning");
  });

  it("classifies an on_error route as terminal when the handler never rejoins", () => {
    const steps: FlowEdgeStep[] = [
      { id: "finalize", type: "agent", blockedBy: [], onError: "notify" },
      { id: "notify", type: "agent", blockedBy: [] }, // sink: no forward edge back to the flow
    ];
    const r = deriveFlowEdges(steps).find((e) => key(e) === "finalize->notify")!;
    expect(r.kind).toBe("route");
    expect(r.routeTopology).toBe("terminal");
  });

  it("leaves routeTopology unset on non-on_error routes", () => {
    const edges = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [], onComplete: "b" },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    const oc = edges.find((e) => key(e) === "a->b")!;
    expect(oc.kind).toBe("route");
    expect(oc.routeTopology).toBeUndefined();
  });

  it("skips edges with missing endpoints", () => {
    const edges = deriveFlowEdges([
      { id: "a", type: "agent", blockedBy: ["ghost"], branches: { x: "nowhere" } },
    ]);
    expect(edges).toHaveLength(0);
  });

  // Regression: a flow wired entirely via on_complete (no blockedBy), with a
  // routing step declared BEFORE any separator — the InvoiceBot `process` shape.
  // The pre-separator root must NOT be orphaned, and a routing target must not
  // also get a spurious implicit edge from the nearest separator.
  // See change: fix-flow-ui-graph-zoom-summary.
  it("on_complete-routed pre-separator root is connected (no orphan)", () => {
    const steps: FlowEdgeStep[] = [
      { id: "load-state", type: "code", blockedBy: [], onComplete: "resume-gate", onError: "hold" },
      { id: "resume-gate", type: "code-decision", blockedBy: [], branches: { new: "intake" } },
      { id: "intake", type: "code", blockedBy: [], onComplete: "hold" },
      { id: "hold", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const byKey = new Map(edges.map((e) => [key(e), e]));
    // load-state routes forward (not orphaned) and to its error sink.
    expect(byKey.get("load-state->resume-gate")?.kind).toBe("route");
    expect(byKey.get("load-state->hold")?.kind).toBe("route");
    // load-state has at least one outgoing edge.
    expect(edges.some((e) => e.from === "load-state")).toBe(true);
  });

  it("routing target suppresses a spurious implicit edge", () => {
    // `intake` has no blockedBy but is the on_complete target of `gate`; it must
    // get the route edge and NOT also an implicit edge from the separator.
    const steps: FlowEdgeStep[] = [
      { id: "gate", type: "code-decision", blockedBy: [], onComplete: "intake" },
      { id: "intake", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const incoming = edges.filter((e) => e.to === "intake");
    expect(incoming).toHaveLength(1);
    expect(incoming[0].kind).toBe("route");
  });

  it("omitting routing fields produces no route edges (backward compat)", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "code", blockedBy: [] },
      { id: "b", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.some((e) => e.kind === "route")).toBe(false);
  });

  it("live (branches only) and static (branches + routes) agree on shared classes", () => {
    const base: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "fork", type: "fork", blockedBy: ["a"], branches: { p: "b", q: "c" } },
      { id: "b", type: "agent", blockedBy: [] },
      { id: "c", type: "agent", blockedBy: [] },
    ];
    const live = deriveFlowEdges(base);
    const staticEdges = deriveFlowEdges(base.map((s) => ({ ...s, onError: s.id === "b" ? "c" : undefined })));
    const sharedLive = live.filter((e) => e.kind !== "route").map(key).sort();
    const sharedStatic = staticEdges.filter((e) => e.kind !== "route").map(key).sort();
    expect(sharedLive).toEqual(sharedStatic);
  });
});
