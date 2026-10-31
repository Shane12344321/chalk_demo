import type { LayoutBox } from "../layout";
import type { SamplePoint } from "./sample";
import type { LineSpec, Mark, PointRef, RegionSpec, Side, Vec2 } from "./types";

/**
 * Point references: points derived from marks that are already drawn.
 *
 * References resolve against rendered geometry in board pixels (renderer
 * truth), so a constructed point lands exactly on the ink it names even when
 * a frame is not equal-scale. A mark may reference marks of earlier elements
 * or of its own element; `orderMarks` sorts an element's marks along that
 * dependency graph and rejects unknown, forward, and cyclic references. The
 * geometric rules here are the only implementation: the legacy construction
 * ops (`construction.ts`) delegate to them.
 */

export type Pixel = readonly [number, number];

export type GeometryFailureCode =
  | "unknown_reference"
  | "forward_reference"
  | "cycle"
  | "unsupported_geometry"
  | "coordinate_space_mismatch"
  | "ambiguous_geometry"
  | "parallel_geometry"
  | "no_intersection"
  | "degenerate_geometry"
  | "off_board";

export class GeometryReferenceError extends Error {
  constructor(
    readonly code: GeometryFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometryReferenceError";
  }
}

export function geometryFailure(code: GeometryFailureCode, message: string): GeometryReferenceError {
  return new GeometryReferenceError(code, message);
}

const EPSILON = 1e-7;
const TANGENT_MIN_DIRECTION_ALIGNMENT = Math.cos(Math.PI / 4);

/** What later references may read from a drawn mark, in board pixels. */
export interface MarkHandle {
  id: string;
  frameId: string;
  /** Pixel box of the frame the mark lives in (derived points must stay inside it). */
  frameBox: LayoutBox;
  point?: Pixel;
  /** Centre-lines of the ideal (un-roughened) shape; a straight mark has one two-point polyline. */
  polylines: Pixel[][];
  /** Function marks: visible data-space samples and the frame mapping, for `{on,x}` and tangents. */
  fn?: {
    segments: SamplePoint[][];
    evaluate: (x: number) => number;
    toPixel: (point: Vec2) => [number, number];
  };
}

// ---------------------------------------------------------------------------
// Dependency graph

/** Every mark ID a mark reads, in first-use order. */
export function markDependencies(mark: Mark): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const visitRef = (ref: PointRef) => {
    if (isLiteral(ref)) return;
    if ("at" in ref) add(ref.at);
    else if ("end" in ref) add(ref.end);
    else if ("mid" in ref) ref.mid.forEach(visitRef);
    else if ("on" in ref) add(ref.on);
    else if ("hit" in ref) ref.hit.forEach(add);
    else if ("foot" in ref) {
      visitRef(ref.foot);
      add(ref.onto);
    } else add(ref.beside);
  };
  const visitLine = (line: LineSpec) => {
    if ("from" in line) {
      visitRef(line.from);
      visitRef(line.to);
    } else if ("slope" in line) visitRef(line.through);
    else if ("tangentTo" in line) add(line.tangentTo);
    else {
      add(line.normalTo);
      visitRef(line.through);
    }
  };
  const visitRegion = (region: RegionSpec) => {
    if ("under" in region) add(region.under);
    else if ("between" in region) region.between.forEach(add);
    else [region.inside, ...(region.except ?? [])].forEach(add);
  };
  switch (mark.kind) {
    case "point":
      visitRef(mark.at);
      break;
    case "path":
      mark.points.forEach(visitRef);
      break;
    case "line":
      visitLine(mark.line);
      break;
    case "vector":
    case "measure":
      visitRef(mark.from);
      visitRef(mark.to);
      break;
    case "circle":
    case "ellipse":
    case "arc":
      visitRef(mark.center);
      break;
    case "angle":
      visitRef(mark.vertex);
      if ("rays" in mark.angle) mark.angle.rays.forEach(visitRef);
      break;
    case "label":
      visitRef(mark.at);
      break;
    case "region":
      visitRegion(mark.region);
      break;
    case "group": {
      const own = new Set(mark.marks.map((child) => child.id));
      for (const child of mark.marks) {
        for (const id of markDependencies(child)) if (!own.has(id)) add(id);
      }
      break;
    }
    case "fn":
    case "param":
    case "polar":
      break;
  }
  return ids;
}

export interface MarkOrder<T extends { id: string; dependencies: readonly string[] }> {
  ordered: T[];
  failed: Array<{ item: T; code: GeometryFailureCode }>;
}

/**
 * Topological order of an element's marks (stable: ties keep authoring
 * order). `known` holds marks of earlier elements; `later` those of later
 * elements, which no mark may read (a later step must never change earlier ink).
 */
export function orderMarks<T extends { id: string; dependencies: readonly string[] }>(
  items: readonly T[],
  known: ReadonlySet<string>,
  later: ReadonlySet<string> = new Set(),
): MarkOrder<T> {
  const own = new Map(items.map((item) => [item.id, item]));
  const failed: Array<{ item: T; code: GeometryFailureCode }> = [];
  const pending = new Set<T>();
  for (const item of items) {
    const bad = item.dependencies.find((id) => !own.has(id) && !known.has(id));
    if (bad === undefined) pending.add(item);
    else failed.push({ item, code: later.has(bad) ? "forward_reference" : "unknown_reference" });
  }
  const ordered: T[] = [];
  const done = new Set<string>();
  // Always take the earliest-authored mark whose own references are drawn.
  for (;;) {
    const next = items.find((item) =>
      pending.has(item) && item.dependencies.every((id) => !own.has(id) || done.has(id)));
    if (!next) break;
    pending.delete(next);
    done.add(next.id);
    ordered.push(next);
  }
  for (const item of pending) failed.push({ item, code: "cycle" });
  return { ordered, failed };
}

// ---------------------------------------------------------------------------
// Resolution

export class RefResolver {
  constructor(private readonly handles: ReadonlyMap<string, MarkHandle>) {}

  handle(id: string, frameId: string): MarkHandle {
    const handle = this.handles.get(id);
    if (!handle) throw geometryFailure("unknown_reference", `geometry ${id} is not resolved`);
    if (handle.frameId !== frameId) {
      throw geometryFailure("coordinate_space_mismatch", "references do not share a coordinate space");
    }
    return handle;
  }

  /** A derived point in pixels; literal points are the caller's to map. */
  derived(ref: Exclude<PointRef, Vec2>, frameId: string, literal: (point: Vec2) => Pixel): Pixel {
    const point = this.derivedUnchecked(ref, frameId, literal);
    const frameBox = this.frameBoxOf(ref, frameId);
    if (frameBox) assertInsideBox(point, frameBox);
    return point;
  }

  private frameBoxOf(ref: Exclude<PointRef, Vec2>, frameId: string): LayoutBox | undefined {
    const id = "at" in ref ? ref.at
      : "end" in ref ? ref.end
        : "on" in ref ? ref.on
          : "hit" in ref ? ref.hit[0]
            : "foot" in ref ? ref.onto
              : "beside" in ref ? ref.beside
                : undefined;
    if (id !== undefined) return this.handle(id, frameId).frameBox;
    for (const part of (ref as { mid: readonly PointRef[] }).mid) {
      if (!isLiteral(part)) return this.frameBoxOf(part, frameId);
    }
    return undefined;
  }

  private derivedUnchecked(
    ref: Exclude<PointRef, Vec2>,
    frameId: string,
    literal: (point: Vec2) => Pixel,
  ): Pixel {
    const resolve = (part: PointRef): Pixel =>
      isLiteral(part) ? literal(part) : this.derivedUnchecked(part, frameId, literal);
    if ("at" in ref) {
      const handle = this.handle(ref.at, frameId);
      if (!handle.point) throw geometryFailure("unsupported_geometry", `${ref.at} is not a point`);
      return handle.point;
    }
    if ("end" in ref) return endpointOf(this.handle(ref.end, frameId), ref.which);
    if ("mid" in ref) {
      const [a, b] = ref.mid.map(resolve);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    if ("on" in ref) {
      const handle = this.handle(ref.on, frameId);
      if ("t" in ref) {
        if (handle.polylines.length !== 1) {
          throw geometryFailure("ambiguous_geometry", "along requires one contiguous line or curve");
        }
        return pointAlongPolyline(handle.polylines[0], ref.t);
      }
      if (!handle.fn) throw geometryFailure("unsupported_geometry", `${ref.on} is not a function`);
      return handle.fn.toPixel([ref.x, handle.fn.evaluate(ref.x)]);
    }
    if ("hit" in ref) {
      if (ref.hit[0] === ref.hit[1]) {
        throw geometryFailure("ambiguous_geometry", "intersection requires two distinct elements");
      }
      const a = this.handle(ref.hit[0], frameId);
      const b = this.handle(ref.hit[1], frameId);
      return uniqueIntersection(a.polylines, b.polylines);
    }
    if ("foot" in ref) {
      const [start, end] = straightSegment(this.handle(ref.onto, frameId), "foot requires one straight line");
      return footOfPerpendicular(resolve(ref.foot), start, end);
    }
    const handle = this.handle(ref.beside, frameId);
    return offsetPoint(
      handleBounds(handle),
      ref.side,
      ref.gap * handle.frameBox.width,
      ref.gap * handle.frameBox.height,
    );
  }
}

export function isLiteral(ref: PointRef): ref is Vec2 {
  return Array.isArray(ref);
}

function endpointOf(handle: MarkHandle, which: "start" | "end"): Pixel {
  if (handle.polylines.length !== 1 || handle.polylines[0].length < 2) {
    throw geometryFailure("unsupported_geometry", `${handle.id} has no unambiguous endpoints`);
  }
  const polyline = handle.polylines[0];
  return which === "start" ? polyline[0] : polyline.at(-1)!;
}

export function straightSegment(handle: MarkHandle, message: string): readonly [Pixel, Pixel] {
  if (handle.polylines.length !== 1 || handle.polylines[0].length !== 2) {
    throw geometryFailure("unsupported_geometry", message);
  }
  return [handle.polylines[0][0], handle.polylines[0][1]];
}

export function handleBounds(handle: MarkHandle): LayoutBox {
  return pointsBounds(handle.point ? [handle.point] : handle.polylines.flat());
}

// ---------------------------------------------------------------------------
// Geometry rules (pixel space)

export function pointsBounds(points: readonly Pixel[]): LayoutBox {
  if (points.length === 0) throw geometryFailure("degenerate_geometry", "geometry has no points");
  const left = Math.min(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const bottom = Math.max(...points.map(([, y]) => y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function assertInsideBox(point: Pixel, box: LayoutBox): void {
  if (
    !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
    point[0] < box.x - EPSILON || point[0] > box.x + box.width + EPSILON ||
    point[1] < box.y - EPSILON || point[1] > box.y + box.height + EPSILON
  ) {
    throw geometryFailure("off_board", "constructed geometry leaves its renderer-owned coordinate space");
  }
}

/** Even-odd point-in-polygon test (the polygon's closing point may repeat its first). */
export function pointInPolygon(polygon: readonly Pixel[], point: Pixel): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToPolyline(point: Pixel, line: readonly Pixel[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const [ax, ay] = line[index - 1];
    const [bx, by] = line[index];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / span));
    best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
  }
  return best;
}

export function offsetPoint(
  bounds: LayoutBox,
  side: Side,
  horizontalGap: number,
  verticalGap: number,
): Pixel {
  return side === "above"
    ? [bounds.x + bounds.width / 2, bounds.y - verticalGap]
    : side === "below"
      ? [bounds.x + bounds.width / 2, bounds.y + bounds.height + verticalGap]
      : side === "left"
        ? [bounds.x - horizontalGap, bounds.y + bounds.height / 2]
        : [bounds.x + bounds.width + horizontalGap, bounds.y + bounds.height / 2];
}

export function pointAlongPolyline(points: readonly Pixel[], t: number): Pixel {
  if (points.length < 2) throw geometryFailure("degenerate_geometry", "path has fewer than two points");
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= EPSILON) throw geometryFailure("degenerate_geometry", "path has no length");
  if (t <= 0) return points[0];
  if (t >= 1) return points.at(-1)!;
  const target = t * total;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (lengths[index] <= EPSILON) continue;
    const next = traversed + lengths[index];
    if (target <= next + EPSILON) {
      const local = (target - traversed) / lengths[index];
      return [
        points[index][0] + (points[index + 1][0] - points[index][0]) * local,
        points[index][1] + (points[index + 1][1] - points[index][1]) * local,
      ];
    }
    traversed = next;
  }
  return points.at(-1)!;
}

export function uniqueIntersection(
  a: readonly (readonly Pixel[])[],
  b: readonly (readonly Pixel[])[],
): Pixel {
  const intersections: Pixel[] = [];
  let sawParallel = false;
  let sawCollinear = false;
  for (const polylineA of a) {
    for (const polylineB of b) {
      for (let aIndex = 1; aIndex < polylineA.length; aIndex += 1) {
        for (let bIndex = 1; bIndex < polylineB.length; bIndex += 1) {
          const result = segmentIntersection(
            polylineA[aIndex - 1],
            polylineA[aIndex],
            polylineB[bIndex - 1],
            polylineB[bIndex],
          );
          if (result === "parallel") sawParallel = true;
          else if (result === "collinear") sawCollinear = true;
          else if (result && !intersections.some((point) => pointsNear(point, result))) {
            intersections.push(result);
          }
        }
      }
    }
  }
  if (sawCollinear) throw geometryFailure("ambiguous_geometry", "intersection contains overlapping geometry");
  if (intersections.length > 1) {
    throw geometryFailure("ambiguous_geometry", "intersection has more than one distinct point");
  }
  if (intersections.length === 0) {
    throw geometryFailure(
      sawParallel ? "parallel_geometry" : "no_intersection",
      sawParallel ? "parallel geometry has no intersection" : "bounded geometry does not intersect",
    );
  }
  return intersections[0];
}

function segmentIntersection(
  p: Pixel,
  p2: Pixel,
  q: Pixel,
  q2: Pixel,
): Pixel | "parallel" | "collinear" | undefined {
  const r: Pixel = [p2[0] - p[0], p2[1] - p[1]];
  const s: Pixel = [q2[0] - q[0], q2[1] - q[1]];
  const denominator = cross(r, s);
  const qMinusP: Pixel = [q[0] - p[0], q[1] - p[1]];
  if (Math.abs(denominator) <= EPSILON) {
    return Math.abs(cross(qMinusP, r)) <= EPSILON ? "collinear" : "parallel";
  }
  const t = cross(qMinusP, s) / denominator;
  const u = cross(qMinusP, r) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return undefined;
  }
  return [p[0] + Math.min(1, Math.max(0, t)) * r[0], p[1] + Math.min(1, Math.max(0, t)) * r[1]];
}

function footOfPerpendicular(point: Pixel, start: Pixel, end: Pixel): Pixel {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) throw geometryFailure("degenerate_geometry", "foot line has no direction");
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  return [start[0] + dx * t, start[1] + dy * t];
}

/** A segment of `2·halfLength` pixels through `through`, perpendicular to a straight line. */
export function perpendicularSegment(
  line: readonly [Pixel, Pixel],
  through: Pixel,
  halfLength: number,
): [Pixel, Pixel] {
  const [start, end] = line;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const magnitude = Math.hypot(dx, dy);
  if (magnitude <= EPSILON) {
    throw geometryFailure("degenerate_geometry", "perpendicular source line has no direction");
  }
  const normalX = -dy / magnitude;
  const normalY = dx / magnitude;
  return [
    [through[0] - normalX * halfLength, through[1] - normalY * halfLength],
    [through[0] + normalX * halfLength, through[1] + normalY * halfLength],
  ];
}

/**
 * A local tangent from the same finite sampled polyline that is drawn. This
 * intentionally does not claim an analytical derivative: it rejects endpoint,
 * discontinuity, and corner-like cases rather than drawing a plausible but
 * unsupported line.
 */
export function tangentSegment(
  segments: readonly SamplePoint[][],
  x: number,
  toPixel: (point: Vec2) => Pixel,
  halfLength: number,
): [Pixel, Pixel] {
  if (segments.length !== 1) {
    throw geometryFailure("ambiguous_geometry", "tangent_at requires one contiguous visible curve segment");
  }
  const dataPoints = segments[0];
  if (dataPoints.length < 5) {
    throw geometryFailure("degenerate_geometry", "curve has too few visible samples for a tangent");
  }
  const firstX = dataPoints[0][0];
  const lastX = dataPoints.at(-1)![0];
  const sampleWidth = Math.abs(lastX - firstX) / (dataPoints.length - 1);
  if (x < firstX - EPSILON || x > lastX + EPSILON) {
    throw geometryFailure("off_board", "tangent point is outside the visible curve segment");
  }
  const distanceToEdge = Math.min(x - firstX, lastX - x);
  if (!Number.isFinite(sampleWidth) || sampleWidth <= EPSILON || distanceToEdge <= sampleWidth * 1.5) {
    throw geometryFailure("unsupported_geometry", "tangent_at must be strictly inside a visible curve segment");
  }
  const window = Math.min(
    distanceToEdge / 2,
    Math.max(sampleWidth, Math.abs(lastX - firstX) * 0.01),
  );
  const center = toPixel(dataPointAtX(dataPoints, x));
  const before = toPixel(dataPointAtX(dataPoints, x - window));
  const after = toPixel(dataPointAtX(dataPoints, x + window));
  const incoming = unitVector([center[0] - before[0], center[1] - before[1]]);
  const outgoing = unitVector([after[0] - center[0], after[1] - center[1]]);
  if (!incoming || !outgoing) {
    throw geometryFailure("degenerate_geometry", "curve has no stable local direction at the tangent");
  }
  const alignment = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
  if (alignment < TANGENT_MIN_DIRECTION_ALIGNMENT) {
    throw geometryFailure("ambiguous_geometry", "curve changes direction too sharply for a local tangent");
  }
  const direction = unitVector([incoming[0] + outgoing[0], incoming[1] + outgoing[1]]);
  if (!direction) {
    throw geometryFailure("degenerate_geometry", "curve has no unambiguous tangent direction");
  }
  return [
    [center[0] - direction[0] * halfLength, center[1] - direction[1] * halfLength],
    [center[0] + direction[0] * halfLength, center[1] + direction[1] * halfLength],
  ];
}

function dataPointAtX(points: readonly SamplePoint[], x: number): SamplePoint {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (x < previous[0] - EPSILON || x > next[0] + EPSILON) continue;
    const span = next[0] - previous[0];
    if (Math.abs(span) <= EPSILON) {
      throw geometryFailure("degenerate_geometry", "curve sample has no horizontal extent");
    }
    const t = Math.min(1, Math.max(0, (x - previous[0]) / span));
    return [
      previous[0] + (next[0] - previous[0]) * t,
      previous[1] + (next[1] - previous[1]) * t,
    ];
  }
  throw geometryFailure("off_board", "tangent point is outside the visible curve segment");
}

function unitVector(vector: Pixel): Pixel | undefined {
  const magnitude = Math.hypot(vector[0], vector[1]);
  if (!Number.isFinite(magnitude) || magnitude <= EPSILON) return undefined;
  return [vector[0] / magnitude, vector[1] / magnitude];
}

function cross(a: Pixel, b: Pixel): number {
  return a[0] * b[1] - a[1] * b[0];
}

function pointsNear(a: Pixel, b: Pixel): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-5;
}
