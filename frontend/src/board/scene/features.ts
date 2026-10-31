import { applyAffine, expandMarks, type Affine, type LeafMark, type PlacedMark } from "./expand";
import { isLiteral } from "./refs";
import type { PointRef, Scene, Vec2 } from "./types";

/**
 * What a board shows, in the closed vocabulary of the drawing suite
 * (tests/eval/drawing-suite-v1.json). Counted on the compiled scene, so a
 * board from any wire version is judged by the same rules. Deliberately
 * lenient where an older vocabulary had to approximate (a diagram arc counts
 * as a round shape and as an angle marker; a freehand stroke counts as a
 * polygon when it closes and a curve when it bends).
 */
export const SUITE_FEATURES = [
  "plot",
  "curve",
  "region",
  "round",
  "polygon",
  "vector",
  "angle",
  "point",
  "line",
] as const;

export type SuiteFeature = (typeof SUITE_FEATURES)[number];
export type FeatureCounts = Record<SuiteFeature, number>;

export function sceneFeatures(scene: Scene): FeatureCounts {
  const counts = Object.fromEntries(SUITE_FEATURES.map((feature) => [feature, 0])) as FeatureCounts;
  const add = (feature: SuiteFeature, amount = 1) => {
    counts[feature] += amount;
  };
  const segments = new Map<string, Segment[]>();
  // Closed straight shapes add their edges to the graph too, so a shape split
  // by later strokes (a rectangle into squares) counts its parts; each one's
  // own cycle is already counted by `countMark`.
  const closedShapes = new Map<string, number>();
  const markers = new Map<string, Segment[][]>();
  const frames = new Map(scene.frames.map((frame) => [frame.id, frame]));
  const points = new Map<string, Vec2>();
  for (const frame of scene.frames) if (frame.axes !== "none") add("plot");
  for (const element of scene.elements) {
    let placed: PlacedMark[];
    try {
      placed = expandMarks(element.marks);
    } catch {
      continue;
    }
    const frame = element.frame === undefined ? undefined : frames.get(element.frame);
    for (const { id, mark, affine } of placed) {
      countMark(mark, add);
      if (!frame) continue;
      const resolve = (ref: PointRef) => resolvePoint(ref, affine, points);
      if (mark.kind === "point") {
        const at = resolve(mark.at);
        if (at) points.set(id, at);
      }
      const strokes = straightSegments(mark, resolve);
      if (strokes.length === 0) continue;
      segments.set(frame.id, [...(segments.get(frame.id) ?? []), ...strokes]);
      if (mark.kind === "path" && pathCloses(mark) && mark.points.length >= 3) {
        closedShapes.set(frame.id, (closedShapes.get(frame.id) ?? 0) + 1);
      }
      if (looksLikeRightAngleMarker(mark, strokes, frame)) markers.set(frame.id, [...(markers.get(frame.id) ?? []), strokes]);
    }
  }
  // Shapes drawn as separate strokes still read as shapes: closed cycles of
  // straight segments in one frame count as polygons, and two long
  // perpendicular strokes that meet count as hand-drawn axes.
  for (const frame of scene.frames) {
    const frameSegments = segments.get(frame.id) ?? [];
    const span = Math.max(frame.window.x[1] - frame.window.x[0], frame.window.y[1] - frame.window.y[0]);
    add("polygon", Math.max(0, cycleRank(frameSegments, span * 0.015) - (closedShapes.get(frame.id) ?? 0)));
    // A right-angle mark sits in a corner: both its open ends rest on other strokes.
    for (const marker of markers.get(frame.id) ?? []) {
      const others = frameSegments.filter((segment) => !marker.includes(segment));
      const rests = (point: Vec2) => others.some(([a, b]) => distanceToSegment(a, b, point) <= span * 0.015);
      if (rests(marker[0][0]) && rests(marker[1][1])) add("angle");
    }
    if (frame.axes === "none" && hasDrawnAxes(frameSegments, frame)) add("plot");
  }
  return counts;
}

type Segment = readonly [Vec2, Vec2];

/**
 * A point in frame coordinates: a literal through its mark's transform, an
 * earlier point by ID, or a midpoint of those. Points the renderer derives
 * from ink (on, hit, foot, beside, end) are not followed.
 */
function resolvePoint(ref: PointRef, affine: Affine, points: ReadonlyMap<string, Vec2>): Vec2 | undefined {
  if (isLiteral(ref)) return applyAffine(affine, ref);
  if ("at" in ref) return points.get(ref.at);
  if ("mid" in ref) {
    const [a, b] = ref.mid.map((part) => resolvePoint(part, affine, points));
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : undefined;
  }
  return undefined;
}

/** Straight strokes of a mark in frame coordinates; none when any of its points cannot be resolved. */
function straightSegments(mark: LeafMark, resolve: (ref: PointRef) => Vec2 | undefined): Segment[] {
  if (mark.kind === "line" && "from" in mark.line) {
    const from = resolve(mark.line.from);
    const to = resolve(mark.line.to);
    return from && to ? [[from, to]] : [];
  }
  if (mark.kind !== "path" || mark.smooth !== undefined) return [];
  const closes = pathCloses(mark);
  if (!closes && mark.draw === "stroke") return [];
  const resolved = mark.points.map(resolve);
  if (resolved.some((point) => point === undefined)) return [];
  const points = resolved as Vec2[];
  const ring = mark.closed ? [...points, points[0]] : points;
  return ring.slice(1).map((point, index): Segment => [ring[index], point]);
}

/** Two short perpendicular strokes meeting at a corner: the shape of a hand-drawn right-angle mark. */
function looksLikeRightAngleMarker(mark: LeafMark, strokes: readonly Segment[], frame: Scene["frames"][number]): boolean {
  if (mark.kind !== "path" || pathCloses(mark) || strokes.length !== 2) return false;
  const span = Math.max(frame.window.x[1] - frame.window.x[0], frame.window.y[1] - frame.window.y[0]);
  const [[a, corner], [, b]] = strokes;
  const first = [a[0] - corner[0], a[1] - corner[1]];
  const second = [b[0] - corner[0], b[1] - corner[1]];
  const lengths = [Math.hypot(first[0], first[1]), Math.hypot(second[0], second[1])];
  if (lengths.some((length) => length === 0 || length > 0.1 * span)) return false;
  return Math.abs(first[0] * second[0] + first[1] * second[1]) <= 0.1 * lengths[0] * lengths[1];
}

/** Independent cycles (E − V + C) of the segment graph after splitting at touches and crossings. */
function cycleRank(segments: readonly Segment[], tolerance: number): number {
  if (segments.length < 3) return 0;
  const vertices: Vec2[] = [];
  const vertex = (point: Vec2): number => {
    const found = vertices.findIndex((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) <= tolerance);
    if (found >= 0) return found;
    vertices.push(point);
    return vertices.length - 1;
  };
  const edges = new Set<string>();
  for (const [a, b] of segments) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= tolerance) continue;
    const cuts = [0, 1];
    for (const [c, d] of segments) {
      for (const point of [c, d]) {
        const t = projection(a, b, point);
        if (t > 0 && t < 1 && distanceToSegment(a, b, point) <= tolerance) cuts.push(t);
      }
      const crossing = crossingParameter(a, b, c, d);
      if (crossing !== undefined) cuts.push(crossing);
    }
    const ids = [...new Set(cuts.sort((x, y) => x - y).map((t) =>
      vertex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])))];
    for (let index = 1; index < ids.length; index += 1) {
      const [low, high] = [Math.min(ids[index - 1], ids[index]), Math.max(ids[index - 1], ids[index])];
      if (low !== high) edges.add(`${low}:${high}`);
    }
  }
  const parent = vertices.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (const edge of edges) {
    const [left, right] = edge.split(":").map(Number);
    parent[find(left)] = find(right);
  }
  const used = new Set([...edges].flatMap((edge) => edge.split(":").map(Number)));
  const components = new Set([...used].map(find)).size;
  return Math.max(0, edges.size - used.size + components);
}

function hasDrawnAxes(segments: readonly Segment[], frame: Scene["frames"][number]): boolean {
  const width = frame.window.x[1] - frame.window.x[0];
  const height = frame.window.y[1] - frame.window.y[0];
  const horizontal = segments.filter(([a, b]) =>
    Math.abs(b[1] - a[1]) <= 0.02 * height && Math.abs(b[0] - a[0]) >= 0.5 * width);
  const vertical = segments.filter(([a, b]) =>
    Math.abs(b[0] - a[0]) <= 0.02 * width && Math.abs(b[1] - a[1]) >= 0.5 * height);
  const tolerance = 0.05 * Math.max(width, height);
  return horizontal.some((h) => vertical.some((v) =>
    [...h, ...v].some((point) =>
      distanceToSegment(h[0], h[1], point) <= tolerance && distanceToSegment(v[0], v[1], point) <= tolerance)));
}

function projection(a: Vec2, b: Vec2, point: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
}

function distanceToSegment(a: Vec2, b: Vec2, point: Vec2): number {
  const t = Math.min(1, Math.max(0, projection(a, b, point)));
  return Math.hypot(a[0] + (b[0] - a[0]) * t - point[0], a[1] + (b[1] - a[1]) * t - point[1]);
}

function crossingParameter(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | undefined {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-12) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denominator;
  return t > 0 && t < 1 && u > 0 && u < 1 ? t : undefined;
}

function countMark(mark: LeafMark, add: (feature: SuiteFeature, amount?: number) => void): void {
  switch (mark.kind) {
    case "point":
      add("point");
      return;
    case "line":
    case "measure":
      add("line");
      return;
    case "vector":
      add("vector");
      return;
    case "circle":
    case "ellipse":
      add("round");
      if (mark.fill) add("region");
      return;
    case "arc":
      add("round");
      add("angle");
      return;
    case "angle":
      add("angle");
      return;
    case "fn":
    case "param":
    case "polar":
      add("curve");
      return;
    case "region":
      add("region");
      return;
    case "path": {
      const closes = pathCloses(mark);
      if (mark.smooth !== undefined) {
        add("curve");
      } else if (closes) {
        add("polygon");
      } else if (mark.draw === "stroke" && mark.points.length >= 4) {
        add("curve");
      } else {
        add("line", Math.max(1, mark.points.length - 1));
      }
      if (mark.fill && closes) add("region");
      if (mark.arrow) add("vector");
      return;
    }
    case "label":
      return;
  }
}

export interface FeatureRequirement {
  feature: SuiteFeature;
  count: number;
}

export function parseRequirement(value: string): FeatureRequirement {
  const [feature, count] = value.split(":");
  if (!(SUITE_FEATURES as readonly string[]).includes(feature)) {
    throw new Error(`Unknown suite feature ${feature}.`);
  }
  return { feature: feature as SuiteFeature, count: count === undefined ? 1 : Number(count) };
}

/** Share of a topic's required features the board shows (0..1), and which are missing. */
export function featureCoverage(
  counts: FeatureCounts,
  requires: readonly string[],
): { score: number; missing: string[] } {
  const requirements = requires.map(parseRequirement);
  const missing = requirements
    .filter(({ feature, count }) => counts[feature] < count)
    .map(({ feature, count }) => (count === 1 ? feature : `${feature}:${count}`));
  return {
    score: requirements.length === 0 ? 1 : (requirements.length - missing.length) / requirements.length,
    missing,
  };
}

/** A path that is closed, or whose last point returns to its first. */
function pathCloses(mark: Extract<LeafMark, { kind: "path" }>): boolean {
  if (mark.closed) return true;
  const literal = mark.points.filter(isLiteral);
  const first = literal[0];
  const last = literal.at(-1);
  return literal.length >= 4 && first !== undefined && last !== undefined &&
    Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.02 * Math.max(1, Math.abs(first[0]) + Math.abs(first[1]));
}
