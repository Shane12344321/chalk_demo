import type { FigureLeafMark, FigureMark, FigureOp, FigurePoint } from "./lesson.generated";
import { sampleFunction, sampleParametric, samplePolar, visibleSegments } from "./scene/sample";
import type { CoordinateWindow } from "./scene/types";

/**
 * Semantic rules for schema-1.5 `figure` ops, mirrored by
 * backend/app/figure_validation.py and pinned by shared/fixtures/figure-parity.json.
 * Mark IDs share one namespace with element IDs. A reference may name only a
 * mark drawn earlier in the same figure frame (an earlier step, an earlier
 * op, or an earlier mark of this op); forward references are invalid.
 * Expressions are compiled and sampled with the browser's locked-down sampler.
 * Exact intersections and other geometric truths stay with the renderer.
 */

export const MAX_EXPANDED_FIGURE_MARKS = 64;

export type FigureMarkKind = FigureMark["kind"];

export interface FigureMarkInfo {
  root: string;
  kind: FigureMarkKind;
  closed: boolean;
}

export interface FigureState {
  /** Figure element ID → the root figure whose frame it draws in. */
  roots: Map<string, string>;
  /** Root figure ID → its coordinate window. */
  windows: Map<string, CoordinateWindow>;
  marks: Map<string, FigureMarkInfo>;
}

export function createFigureState(): FigureState {
  return { roots: new Map(), windows: new Map(), marks: new Map() };
}

export interface FigureIssue {
  code: "invalid_op" | "duplicate_id" | "unknown_reference" | "invalid_expression";
  detail: string;
}

export interface AcceptedFigure {
  root: string;
  window: CoordinateWindow;
  marks: Array<[string, FigureMarkInfo]>;
}

const STROKE_KINDS = new Set<FigureMarkKind>([
  "segment", "polyline", "circle", "arc", "fn", "param", "polar", "tangent", "perpendicular",
]);
const STRAIGHT_KINDS = new Set<FigureMarkKind>(["segment", "tangent", "perpendicular"]);

export function validateFigureOp(
  op: FigureOp,
  state: FigureState,
  elementIds: ReadonlySet<string>,
): FigureIssue | AcceptedFigure {
  let root: string;
  let window: CoordinateWindow;
  if ("frame" in op) {
    const { x, y } = op.frame;
    if (!(x[0] < x[1]) || !(y[0] < y[1])) {
      return { code: "invalid_op", detail: "Figure frame ranges must increase." };
    }
    root = op.id;
    window = { x: [x[0], x[1]], y: [y[0], y[1]] };
  } else {
    const parent = state.roots.get(op.on);
    if (parent === undefined) {
      return { code: "unknown_reference", detail: `Figure ${op.on} is not an accepted figure.` };
    }
    root = parent;
    window = state.windows.get(parent)!;
  }
  if (expandedCount(op.marks) > MAX_EXPANDED_FIGURE_MARKS) {
    return { code: "invalid_op", detail: `A figure op may draw at most ${MAX_EXPANDED_FIGURE_MARKS} marks.` };
  }

  const known = new Map(state.marks);
  const added: Array<[string, FigureMarkInfo]> = [];
  const taken = (id: string) => elementIds.has(id) || known.has(id) || id === op.id;
  const visit = (mark: FigureMark, index: string): FigureIssue | undefined => {
    if (mark.id !== undefined && taken(mark.id)) {
      return { code: "duplicate_id", detail: `Mark ID ${mark.id} is already used on the board.` };
    }
    const issue = mark.kind === "group"
      ? visitGroup(mark, index)
      : leafIssue(mark, root, window, known);
    if (issue) return { ...issue, detail: `Mark ${index}: ${issue.detail}` };
    if (mark.id !== undefined) {
      const info: FigureMarkInfo = {
        root,
        kind: mark.kind,
        closed: mark.kind === "circle" || (mark.kind === "polyline" && Boolean(mark.closed)),
      };
      known.set(mark.id, info);
      added.push([mark.id, info]);
    }
    return undefined;
  };
  const visitGroup = (group: Extract<FigureMark, { kind: "group" }>, index: string) => {
    for (const [childIndex, child] of group.marks.entries()) {
      const issue = visit(child, `${index}.${childIndex}`);
      if (issue) return issue;
    }
    return undefined;
  };
  for (const [index, mark] of op.marks.entries()) {
    const issue = visit(mark, String(index));
    if (issue) return issue;
  }
  return { root, window, marks: added };
}

function expandedCount(marks: readonly FigureMark[]): number {
  return marks.reduce(
    (sum, mark) => sum + (mark.kind === "group" ? mark.marks.length * (mark.repeat ?? 1) : 1),
    0,
  );
}

function leafIssue(
  mark: FigureLeafMark,
  root: string,
  window: CoordinateWindow,
  known: ReadonlyMap<string, FigureMarkInfo>,
): Omit<FigureIssue, "detail"> & { detail: string } | undefined {
  const reference = (id: string, allowed: (info: FigureMarkInfo) => boolean, what: string) => {
    const info = known.get(id);
    if (!info || info.root !== root) {
      return { code: "unknown_reference" as const, detail: `${id} is not an earlier mark in this figure.` };
    }
    return allowed(info) ? undefined : { code: "invalid_op" as const, detail: `${id} is not ${what}.` };
  };
  const isPoint = (info: FigureMarkInfo) => info.kind === "point";
  const isStroke = (info: FigureMarkInfo) => STROKE_KINDS.has(info.kind);
  const isStraight = (info: FigureMarkInfo) => STRAIGHT_KINDS.has(info.kind);
  const isFn = (info: FigureMarkInfo) => info.kind === "fn";
  const point = (value: FigurePoint) => {
    if (Array.isArray(value)) return undefined;
    if ("at" in value) return reference(value.at, isPoint, "a point");
    if ("mid" in value) {
      return reference(value.mid[0], isPoint, "a point") ?? reference(value.mid[1], isPoint, "a point");
    }
    if ("on" in value) return "x" in value ? reference(value.on, isFn, "a function") : reference(value.on, isStroke, "a drawn line or curve");
    if ("hit" in value) {
      if (value.hit[0] === value.hit[1]) return { code: "invalid_op" as const, detail: "hit needs two different marks." };
      return reference(value.hit[0], isStroke, "a drawn line or curve") ?? reference(value.hit[1], isStroke, "a drawn line or curve");
    }
    return reference(value.foot, isPoint, "a point") ?? reference(value.onto, isStraight, "a straight line");
  };
  const points = (...values: FigurePoint[]) => {
    for (const value of values) {
      const issue = point(value);
      if (issue) return issue;
    }
    return undefined;
  };
  const sameLiteral = (values: readonly FigurePoint[]) => {
    const literal = values.filter(Array.isArray) as Array<[number, number]>;
    return literal.length === values.length &&
      literal.every((value) => value[0] === literal[0][0] && value[1] === literal[0][1]);
  };
  const sampled = (sample: () => Array<[number, number]>) => {
    try {
      if (visibleSegments(sample(), window).length === 0) {
        return { code: "invalid_expression" as const, detail: "curve has fewer than two visible samples inside the frame" };
      }
      return undefined;
    } catch (error) {
      return { code: "invalid_expression" as const, detail: error instanceof Error ? error.message : "curve cannot be sampled" };
    }
  };

  switch (mark.kind) {
    case "point":
    case "text":
      return point(mark.at);
    case "segment":
    case "measure":
      return points(mark.from, mark.to) ??
        (sameLiteral([mark.from, mark.to]) ? { code: "invalid_op", detail: "endpoints must differ" } : undefined);
    case "polyline":
      return points(...mark.points) ??
        (sameLiteral(mark.points) ? { code: "invalid_op", detail: "path has no length" } : undefined) ??
        (mark.arrow && sameLiteral(mark.points.slice(-2))
          ? { code: "invalid_op", detail: "arrow has no terminal direction" }
          : undefined);
    case "circle":
      return point(mark.center);
    case "arc":
      return point(mark.center) ??
        (Math.abs(mark.end - mark.start) < 1 ? { code: "invalid_op", detail: "arc must span at least one degree" } : undefined);
    case "angle":
      return points(mark.at, mark.from, mark.to) ??
        (sameLiteral([mark.at, mark.from]) || sameLiteral([mark.at, mark.to]) || sameLiteral([mark.from, mark.to])
          ? { code: "invalid_op", detail: "angle needs a vertex and two distinct rays" }
          : undefined);
    case "fn": {
      const domain = mark.domain ?? window.x;
      if (!(domain[0] < domain[1])) return { code: "invalid_expression", detail: "domain must increase" };
      return sampled(() => sampleFunction(mark.y, domain));
    }
    case "param":
      if (!(mark.t[0] < mark.t[1])) return { code: "invalid_expression", detail: "t range must increase" };
      return sampled(() => sampleParametric(mark.x, mark.y, mark.t));
    case "polar":
      if (!(mark.theta[0] < mark.theta[1])) return { code: "invalid_expression", detail: "theta range must increase" };
      return sampled(() => samplePolar(mark.r, mark.theta));
    case "shade": {
      if ("from" in mark && "to" in mark && mark.from !== undefined && mark.to !== undefined && !(mark.from < mark.to)) {
        return { code: "invalid_op", detail: "shade range must increase" };
      }
      if ("under" in mark) return reference(mark.under, isFn, "a function");
      if ("between" in mark) {
        if (mark.between[0] === mark.between[1]) return { code: "invalid_op", detail: "between needs two different functions" };
        return reference(mark.between[0], isFn, "a function") ?? reference(mark.between[1], isFn, "a function");
      }
      const holes: readonly string[] = mark.except ?? [];
      if (holes.includes(mark.inside)) return { code: "invalid_op", detail: "except cannot name the shape being shaded" };
      for (const id of [mark.inside, ...holes]) {
        const issue = reference(id, (info) => info.closed, "a closed shape");
        if (issue) return issue;
      }
      return undefined;
    }
    case "tangent":
      return reference(mark.to, isFn, "a function") ??
        (mark.x < window.x[0] || mark.x > window.x[1] ? { code: "invalid_op", detail: "tangent x is outside the frame" } : undefined);
    case "perpendicular":
      return reference(mark.to, isStraight, "a straight line") ?? point(mark.through);
  }
}
