/**
 * Shared flow-edge derivation. ONE rule, consumed by both the live `FlowGraph`
 * (running runs, from `dagSteps`) and the static `flow_write` Mermaid snapshot
 * (from parsed YAML), so the two views never drift on what an edge is.
 *
 * Edge classes:
 *  - `sequential` — `blockedBy` dependency
 *  - `branch`     — decision `branches` (fork / agent-decision / code-decision)
 *  - `route`      — `on_complete` / `on_error` cross-segment routing
 *  - `implicit`   — a step after a separator with no `blockedBy` (segment fall-through)
 *
 * The function derives only the classes its input carries: the live caller
 * passes `branches` but not `onComplete`/`onError` (pi-flows omits those from
 * `flow:flow-started`), so `route` edges appear only in the static caller.
 *
 * See change: improve-flow-ui.
 */

export type FlowEdgeKind = "sequential" | "branch" | "route" | "implicit";

export interface FlowEdgeStep {
  id: string;
  /** Node kind (`agent` | `fork` | `agent-decision` | `code` | `code-decision`). */
  type: string;
  blockedBy: string[];
  /** Decision branch label → target step id. */
  branches?: Record<string, string>;
  onComplete?: string;
  onError?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  kind: FlowEdgeKind;
  /** Target declared at or before the source → render as backward/loop edge. */
  backward: boolean;
  /** Set only on `route` edges labeled `on_error`. `returning` = the handler's
   *  forward closure rejoins the main flow (live control flow → render as a loop
   *  arc); `terminal` = the handler is a sink that never rejoins (→ collapse into
   *  a tail sink node). Mirrors the engine, which keeps running every step
   *  reachable from an on_error target after routing to it. */
  routeTopology?: "returning" | "terminal";
}

/** Derive the canonical edge set for a flow. Pure; order-sensitive (array index
 *  defines forward/backward). Skips edges whose endpoints are not in `steps`,
 *  and collapses duplicate `{from,to}` pairs (labeled branch/route wins). */
/** Separator node types that close a DAG segment and open the next. A
 *  no-blockedBy step falling through from one of these is the only `implicit`
 *  edge the engine actually serializes. (`flow-ref` is NOT a separator.) The
 *  set covers both raw stepTypes (static YAML preview) and the live graph's
 *  mapped types, where `agent-decision` collapses to `fork`. */
const SEPARATOR_TYPES = new Set(["fork", "agent-decision", "code-decision"]);

export function deriveFlowEdges(steps: FlowEdgeStep[]): FlowEdge[] {
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const has = (id: string) => order.has(id);
  const edges: FlowEdge[] = [];

  const add = (from: string, to: string, kind: FlowEdgeKind, label?: string): void => {
    if (!has(from) || !has(to)) return;
    const backward = (order.get(to) ?? 0) <= (order.get(from) ?? 0);
    const existing = edges.find((e) => e.from === from && e.to === to);
    if (existing) {
      // De-dup: prefer the labeled branch/route classification over a plain
      // sequential/implicit edge for the same pair.
      const labeled = kind === "branch" || kind === "route";
      const existingLabeled = existing.kind === "branch" || existing.kind === "route";
      if (labeled && !existingLabeled) {
        existing.kind = kind;
        existing.label = label;
        existing.backward = backward;
      }
      return;
    }
    edges.push({ from, to, kind, label, backward });
  };

  // 1. Sequential edges (blockedBy).
  for (const s of steps) {
    for (const dep of s.blockedBy) add(dep, s.id, "sequential");
  }

  // 2. Decision-branch edges.
  for (const s of steps) {
    if (!s.branches) continue;
    for (const [label, target] of Object.entries(s.branches)) {
      add(s.id, target, "branch", label);
    }
  }

  // 3. Routing edges (on_complete / on_error).
  for (const s of steps) {
    if (s.onComplete) add(s.id, s.onComplete, "route", "on_complete");
    if (s.onError) add(s.id, s.onError, "route", "on_error");
  }

  // 4. Implicit-segment edges. The engine wave scheduler runs EVERY step whose
  //    blockedBy is satisfied at once — a step with no blockedBy is a root that
  //    fires in wave 1, in parallel with its siblings. Inter-segment ordering is
  //    enforced only by SEPARATOR steps (fork / agent-decision / code-decision),
  //    which close one segment and open the next. So a no-blockedBy step with no
  //    incoming edge falls through ONLY from the most recent separator (placing it
  //    after that boundary); two such roots after the same separator are parallel
  //    siblings and both fan out from it (never chained to each other). Roots
  //    before any separator stay un-parented → same rank → parallel.
  const incoming = new Set(edges.map((e) => e.to));
  let lastSeparator: string | undefined;
  for (const curr of steps) {
    const fallsThrough = curr.blockedBy.length === 0 && !incoming.has(curr.id);
    if (fallsThrough && lastSeparator && lastSeparator !== curr.id) {
      add(lastSeparator, curr.id, "implicit");
      incoming.add(curr.id);
    }
    if (SEPARATOR_TYPES.has(curr.type)) lastSeparator = curr.id;
  }

  // 5. on_error route topology. The engine keeps running everything reachable
  //    from an on_error target. A handler is `returning` when its forward
  //    closure rejoins the source or the source's success continuation
  //    (live control flow → loop arc); `terminal` otherwise (a sink).
  classifyRouteTopology(edges);

  return edges;
}

/** Tag each `on_error` route edge with `routeTopology`. Pure: reachability over
 *  the flow edges EXCLUDING on_error routes (those are what we classify). A
 *  handler is `returning` when its forward closure reaches the route source or
 *  any node on the source's success continuation; else `terminal`. */
function classifyRouteTopology(edges: FlowEdge[]): void {
  const errorRoutes = edges.filter((e) => e.kind === "route" && e.label === "on_error");
  if (errorRoutes.length === 0) return;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "route" && e.label === "on_error") continue; // exclude the edges under test
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  const cache = new Map<string, Set<string>>();
  const reach = (start: string): Set<string> => {
    const cached = cache.get(start);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop() as string;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of adj.get(n) ?? []) stack.push(m);
    }
    cache.set(start, seen);
    return seen;
  };

  for (const e of errorRoutes) {
    const fromClosure = reach(e.from); // source + its success continuation
    const handlerClosure = reach(e.to); // handler + its forward closure
    let returning = false;
    for (const n of handlerClosure) {
      if (n !== e.to && (n === e.from || fromClosure.has(n))) {
        returning = true;
        break;
      }
    }
    e.routeTopology = returning ? "returning" : "terminal";
  }
}
