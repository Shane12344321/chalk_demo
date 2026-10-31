import { axesFrame } from "./axesGeometry";
import { mapDiagramPoint } from "./diagramGeometry";
import { frameTransform } from "./scene/frame";
import {
  assertInsideBox,
  geometryFailure,
  GeometryReferenceError,
  offsetPoint,
  perpendicularSegment,
  pointAlongPolyline,
  pointsBounds,
  tangentSegment,
  uniqueIntersection,
  type GeometryFailureCode,
} from "./scene/refs";
import { sampleVisibleCurveSegments } from "./scene/sample";
import type {
  GeometryPointReference,
  LineConstructionOp,
  LessonOp,
  PointConstructionOp,
} from "./lesson.generated";
import type { LaidOutOp, LayoutBox } from "./layout";

export type ConstructionFailureCode = GeometryFailureCode;

export type ConstructionOp = LineConstructionOp | PointConstructionOp;
export type BoardPoint = readonly [number, number];

interface ConstructionBase {
  canvas: LayoutBox;
  spaceId: string;
  summary: string;
}

export interface ResolvedPointConstruction extends ConstructionBase {
  kind: "point";
  point: BoardPoint;
}

export interface ResolvedLineConstruction extends ConstructionBase {
  kind: "line";
  from: BoardPoint;
  to: BoardPoint;
}

export type ResolvedConstruction =
  | ResolvedPointConstruction
  | ResolvedLineConstruction;

interface SourceGeometry {
  id: string;
  canvas: LayoutBox;
  spaceId: string;
  polylines: BoardPoint[][];
  point?: BoardPoint;
}

/** Construction failures carry the shared point-reference codes (scene/refs.ts). */
export { GeometryReferenceError as ConstructionResolutionError };

export function isConstructionOp(op: LessonOp): op is ConstructionOp {
  return (op.op === "line" || op.op === "point") && "construct" in op;
}

/**
 * Resolve a schema-1.4 relation from already laid-out renderer truth. The
 * caller deliberately passes only earlier accepted items: constructors never
 * guess a coordinate and never read a future operation.
 */
export function resolveConstruction(
  op: ConstructionOp,
  earlier: readonly LaidOutOp[],
): ResolvedConstruction {
  const byId = new Map(earlier.map((item) => [item.op.id, item]));
  if (op.op === "line") return resolveLineConstruction(op, byId);

  const relation = op.construct;
  if (relation.kind === "along") {
    const source = requiredSource(relation.element_id, byId);
    if (source.polylines.length !== 1) {
      throw failure("ambiguous_geometry", "along requires one contiguous line or curve");
    }
    const point = pointAlongPolyline(source.polylines[0], relation.t);
    assertInsideCanvas(point, source.canvas);
    return {
      kind: "point",
      point,
      canvas: source.canvas,
      spaceId: source.spaceId,
      summary: `point along ${relation.element_id} at t=${formatNumber(relation.t)}`,
    };
  }

  if (relation.kind === "midpoint_of") {
    const a = resolvePointReference(relation.a, byId);
    const b = resolvePointReference(relation.b, byId);
    assertSameSpace(a, b);
    const point: BoardPoint = [(a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2];
    assertInsideCanvas(point, a.canvas);
    return {
      kind: "point",
      point,
      canvas: a.canvas,
      spaceId: a.spaceId,
      summary: `midpoint of ${describePointReference(relation.a)} and ${describePointReference(relation.b)}`,
    };
  }

  if (relation.kind === "intersection_of") {
    if (relation.a === relation.b) {
      throw failure("ambiguous_geometry", "intersection requires two distinct elements");
    }
    const a = requiredSource(relation.a, byId);
    const b = requiredSource(relation.b, byId);
    assertSameSpace(a, b);
    const point = uniqueIntersection(a.polylines, b.polylines);
    assertInsideCanvas(point, a.canvas);
    return {
      kind: "point",
      point,
      canvas: a.canvas,
      spaceId: a.spaceId,
      summary: `intersection of ${relation.a} and ${relation.b}`,
    };
  }

  const source = requiredSource(relation.element_id, byId);
  const point = offsetPoint(
    pointsBounds(source.point ? [source.point] : source.polylines.flat()),
    relation.side,
    relation.gap * source.canvas.width,
    relation.gap * source.canvas.height,
  );
  assertInsideCanvas(point, source.canvas);
  return {
    kind: "point",
    point,
    canvas: source.canvas,
    spaceId: source.spaceId,
    summary: `${relation.side} offset from ${relation.element_id} by ${formatNumber(relation.gap)}`,
  };
}

export function constructionBounds(
  construction: ResolvedConstruction,
  padding = 18,
): LayoutBox {
  const points = construction.kind === "point"
    ? [construction.point]
    : [construction.from, construction.to];
  const left = Math.min(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const bottom = Math.max(...points.map(([, y]) => y));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}

function resolveLineConstruction(
  op: LineConstructionOp,
  byId: ReadonlyMap<string, LaidOutOp>,
): ResolvedLineConstruction {
  const relation = op.construct;
  if (relation.kind === "tangent_at") return resolveTangent(op, byId);
  const line = requiredSource(relation.line, byId);
  if (line.polylines.length !== 1 || line.polylines[0].length !== 2) {
    throw failure("unsupported_geometry", "perpendicular_through requires one straight line");
  }
  const point = resolvePointReference(relation.point, byId);
  assertSameSpace(line, point);
  const halfLength = (relation.length * Math.min(line.canvas.width, line.canvas.height)) / 2;
  const [from, to] = perpendicularSegment(
    [line.polylines[0][0], line.polylines[0][1]],
    point.point,
    halfLength,
  );
  assertInsideCanvas(from, line.canvas);
  assertInsideCanvas(to, line.canvas);
  return {
    kind: "line",
    from,
    to,
    canvas: line.canvas,
    spaceId: line.spaceId,
    summary: op.meaning ?? `perpendicular to ${relation.line} through ${describePointReference(relation.point)}`,
  };
}

/**
 * Construct a tangent from the same finite sampled polyline that the renderer
 * displays. This intentionally does not claim an analytical derivative: it
 * rejects endpoint, discontinuity, and corner-like cases rather than drawing
 * a plausible but unsupported line.
 */
function resolveTangent(
  op: LineConstructionOp,
  byId: ReadonlyMap<string, LaidOutOp>,
): ResolvedLineConstruction {
  const relation = op.construct;
  if (relation.kind !== "tangent_at") {
    throw failure("unsupported_geometry", "expected tangent_at construction");
  }
  const curveItem = byId.get(relation.curve);
  if (!curveItem) throw failure("unknown_reference", `geometry ${relation.curve} is not resolved`);
  if (curveItem.op.op !== "curve") {
    throw failure("unsupported_geometry", "tangent_at requires one accepted curve");
  }
  const axesItem = byId.get(curveItem.op.axes_id);
  if (!axesItem || axesItem.op.op !== "axes") {
    throw failure("unknown_reference", "tangent curve axes are not resolved");
  }

  const plot = frameTransform(axesFrame(axesItem.op, axesItem.box));
  const canvas = plot.frame.box;
  const halfLength = (relation.length * Math.min(canvas.width, canvas.height)) / 2;
  const [from, to] = tangentSegment(
    sampleVisibleCurveSegments(curveItem.op, axesItem.op),
    relation.x,
    plot.toPixel,
    halfLength,
  );
  assertInsideCanvas(from, canvas);
  assertInsideCanvas(to, canvas);
  return {
    kind: "line",
    from,
    to,
    canvas,
    spaceId: curveItem.op.axes_id,
    summary: op.meaning ?? `local tangent to ${relation.curve} at x=${formatNumber(relation.x)}`,
  };
}

interface ResolvedPointReference extends ConstructionBase {
  point: BoardPoint;
}

function resolvePointReference(
  reference: GeometryPointReference,
  byId: ReadonlyMap<string, LaidOutOp>,
): ResolvedPointReference {
  const source = requiredSource(reference.element_id, byId);
  if (reference.kind === "point") {
    if (!source.point) {
      throw failure("unsupported_geometry", `${reference.element_id} is not a point`);
    }
    return { point: source.point, canvas: source.canvas, spaceId: source.spaceId, summary: reference.element_id };
  }
  if (source.polylines.length !== 1 || source.polylines[0].length < 2) {
    throw failure("unsupported_geometry", `${reference.element_id} has no unambiguous endpoints`);
  }
  const polyline = source.polylines[0];
  const point = reference.endpoint === "start" ? polyline[0] : polyline.at(-1)!;
  return { point, canvas: source.canvas, spaceId: source.spaceId, summary: reference.element_id };
}

function requiredSource(
  id: string,
  byId: ReadonlyMap<string, LaidOutOp>,
): SourceGeometry {
  const item = byId.get(id);
  if (!item) throw failure("unknown_reference", `geometry ${id} is not resolved`);
  const source = sourceGeometry(item, byId);
  if (!source) throw failure("unsupported_geometry", `geometry ${id} is not constructable`);
  return source;
}

function sourceGeometry(
  item: LaidOutOp,
  byId: ReadonlyMap<string, LaidOutOp>,
): SourceGeometry | undefined {
  if (item.construction) {
    if (item.construction.kind === "point") {
      return {
        id: item.op.id,
        canvas: item.construction.canvas,
        spaceId: item.construction.spaceId,
        polylines: [],
        point: item.construction.point,
      };
    }
    return {
      id: item.op.id,
      canvas: item.construction.canvas,
      spaceId: item.construction.spaceId,
      polylines: [[item.construction.from, item.construction.to]],
    };
  }
  const op = item.op;
  if (op.op === "point" && "at" in op && item.canvasBox) {
    return {
      id: op.id,
      canvas: item.canvasBox,
      spaceId: sourceSpaceId(item, byId),
      polylines: [],
      point: mapDiagramPoint(op.at, item.canvasBox),
    };
  }
  if ((op.op === "line" || op.op === "arrow") && "from" in op && item.canvasBox) {
    return {
      id: op.id,
      canvas: item.canvasBox,
      spaceId: sourceSpaceId(item, byId),
      polylines: [[mapDiagramPoint(op.from, item.canvasBox), mapDiagramPoint(op.to, item.canvasBox)]],
    };
  }
  if (op.op === "curve") {
    const axesItem = byId.get(op.axes_id);
    if (!axesItem || axesItem.op.op !== "axes") return undefined;
    const plot = frameTransform(axesFrame(axesItem.op, axesItem.box));
    const segments = sampleVisibleCurveSegments(op, axesItem.op).map((segment) =>
      segment.map(plot.toPixel),
    );
    return { id: op.id, canvas: plot.frame.box, spaceId: op.axes_id, polylines: segments };
  }
  return undefined;
}

function sourceSpaceId(
  item: LaidOutOp,
  byId: ReadonlyMap<string, LaidOutOp>,
  visiting = new Set<string>(),
): string {
  if (item.construction) return item.construction.spaceId;
  if (!("canvas_id" in item.op)) return item.op.id;
  if (visiting.has(item.op.id)) {
    throw failure("ambiguous_geometry", "coordinate-space chain contains a cycle");
  }
  visiting.add(item.op.id);
  const parent = byId.get(item.op.canvas_id);
  return parent ? sourceSpaceId(parent, byId, visiting) : item.op.canvas_id;
}

function assertSameSpace(
  a: Pick<SourceGeometry, "spaceId" | "canvas">,
  b: Pick<SourceGeometry, "spaceId" | "canvas">,
): void {
  if (a.spaceId !== b.spaceId) {
    throw failure("coordinate_space_mismatch", "construction inputs do not share a coordinate space");
  }
}

function describePointReference(reference: GeometryPointReference): string {
  return reference.kind === "point"
    ? reference.element_id
    : `${reference.endpoint} of ${reference.element_id}`;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function failure(code: ConstructionFailureCode, message: string): GeometryReferenceError {
  return geometryFailure(code, message);
}

function assertInsideCanvas(point: BoardPoint, canvas: LayoutBox): void {
  assertInsideBox(point, canvas);
}
