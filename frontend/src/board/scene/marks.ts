import {
  arcExtremaPoints,
  arcSamplePoints,
  arrowHeadPoints,
  cubicBounds,
  cubicPath,
  LABEL_CHARACTER_EM,
  sampleCubicSegments,
  smoothThroughPoints,
  type DiagramPoint,
} from "../diagramGeometry";
import { compileSafeExpression } from "../expression";
import type { BoardLabel, BoardPath } from "../geometry";
import type { LayoutBox } from "../layout";
import { formatAxisValue } from "../opDescriptions";
import {
  DIAGRAM_FILL,
  ellipseCircumference,
  normalizePaths,
  polylineLength,
  roughLinePaths,
  segmentLabel,
  stableSeed,
  styledLinePaths,
  styledPolylinePaths,
  type InkGenerator,
} from "../roughInk";
import { applyAffine, isIdentity, isTranslation, type Affine, type PlacedMark } from "./expand";
import type { FrameTransform } from "./frame";
import { labelBounds, type LabelMobility } from "./labelSolver";
import {
  assertInsideBox,
  distanceToPolyline,
  geometryFailure,
  isLiteral,
  perpendicularSegment,
  pointInPolygon,
  pointsBounds,
  straightSegment,
  tangentSegment,
  type MarkHandle,
  type Pixel,
  type RefResolver,
} from "./refs";
import {
  sampleFunction,
  sampleParametric,
  samplePolar,
  visibleSegments,
  type SamplePoint,
} from "./sample";
import type { Frame, MarkLabel, PointRef, Vec2 } from "./types";

/**
 * Geometry for every mark kind through one frame transform.
 *
 * Each kind owns one fixed convention, kept in this file only:
 * - stroke seeds derive from the mark's seed key (`key`, `key:segment-k`,
 *   `key:dash-j`, `key:arc` for sampled outlines, `key:head-left|right`,
 *   `key:i` for curve pieces);
 * - stroke groups: a mark's `group` covers all its strokes; without one,
 *   dashes and curve pieces reveal in turn and arrowheads come last;
 * - the natural label anchor (beside a point, off a segment's midpoint,
 *   above a closed shape, outside an arc or angle). Anchors are preferences:
 *   the board-wide label solver decides the final position.
 */

export interface MarkContext {
  elementId: string;
  frame: FrameTransform;
  resolver: RefResolver;
  generator: InkGenerator;
}

export interface RenderedMark {
  id: string;
  paths: BoardPath[];
  labels: BoardLabel[];
  /** Exact bounds of the ideal shape and its arrowheads (manifest parts). */
  bounds: LayoutBox;
  /** Pixel points that size an `ink`-sized element. */
  extent: Pixel[];
  handle: MarkHandle;
}

const ACCENT = "#d97a29";
const FAINT = "#b4bac4";
const POINT_DIAMETER = 16;
const LABEL_SIZES = { small: 24, normal: 31, large: 40 } as const;

type Mutable = [number, number];
const mutable = (point: Pixel): Mutable => [point[0], point[1]];

export function renderMark(placed: PlacedMark, context: MarkContext): RenderedMark {
  const { frame, resolver, generator, elementId } = context;
  const { mark, affine, group } = placed;
  const frameId = frame.frame.id;
  const identity = isIdentity(affine);
  const toPx = (point: Vec2): Pixel => frame.toPixel(identity ? point : applyAffine(affine, point));
  const place = (ref: PointRef): Pixel =>
    isLiteral(ref) ? toPx(ref) : resolver.derived(ref, frameId, toPx);
  const key = mark.seed ?? `${elementId}:${placed.id}`;
  const stroke = mark.stroke ?? "solid";
  const handle = (geometry: Partial<MarkHandle>): MarkHandle => ({
    id: placed.id,
    frameId,
    frameBox: frame.frame.box,
    polylines: [],
    ...geometry,
  });
  const labelsFor = (natural: (text: string) => BoardLabel): BoardLabel[] =>
    mark.label ? [withGroup(withMobility(natural(mark.label.text), mark.label), group)] : [];

  switch (mark.kind) {
    case "point": {
      const point = place(mark.at);
      const extent = pointBox(point);
      return {
        id: placed.id,
        paths: dot(generator, point, key, group ?? 0),
        labels: labelsFor((text) => pointLabel(text, point)),
        bounds: pointsBounds(extent),
        extent,
        handle: handle({ point }),
      };
    }

    case "line": {
      const [from, to] = lineEnds(mark.line, place, resolver, frame, frameId, affine, mark.clip ?? false);
      return {
        id: placed.id,
        paths: styledLinePaths(generator, mutable(from), mutable(to), stroke, key, group),
        labels: labelsFor((text) => segmentLabel(text, mutable(from), mutable(to))),
        bounds: pointsBounds([from, to]),
        extent: [from, to],
        handle: handle({ polylines: [[from, to]] }),
      };
    }

    case "vector": {
      const from = place(mark.from);
      const to = place(mark.to);
      const [, left, right] = arrowHeadPoints(mutable(to), mutable(from));
      return {
        id: placed.id,
        paths: [
          ...styledLinePaths(generator, mutable(from), mutable(to), stroke, key, group),
          ...arrowHead(generator, to, left, right, key, group),
        ],
        labels: labelsFor((text) => segmentLabel(text, mutable(from), mutable(to))),
        bounds: pointsBounds([from, to, left, right]),
        extent: [from, to, left, right],
        handle: handle({ polylines: [[from, to]] }),
      };
    }

    case "path": {
      const points = mark.points.map(place);
      if (points.length < 2) throw geometryFailure("degenerate_geometry", "path has fewer than two points");
      const closed = Boolean(mark.closed) && points.length >= 3;
      if (mark.smooth !== undefined && points.length >= 3) {
        const segments = smoothThroughPoints(points.map(mutable), mark.smooth);
        const sampled = sampleCubicSegments(segments);
        const last = segments.at(-1)!;
        const paths = stroke === "solid"
          ? normalizePaths(
              generator.toPaths(
                generator.path(cubicPath(segments), {
                  seed: stableSeed(key),
                  roughness: 0.85,
                  strokeWidth: 4,
                }),
              ),
              group,
              polylineLength(sampled),
            )
          : styledPolylinePaths(generator, sampled, "dashed", key, group);
        const box = cubicBounds(segments);
        const extentPoints: Pixel[] = [[box.x, box.y], [box.x + box.width, box.y + box.height]];
        if (mark.arrow) {
          const [, left, right] = arrowHeadPoints(last.to, last.control2);
          paths.push(...arrowHead(generator, last.to, left, right, key, group));
          extentPoints.push(...arrowHeadPoints(last.to, last.control2));
        }
        return {
          id: placed.id,
          paths,
          labels: labelsFor((text) => segmentLabel(text, mutable(points.at(-2)!), mutable(points.at(-1)!))),
          bounds: pointsBounds(extentPoints),
          extent: extentPoints,
          handle: handle({ polylines: [sampled] }),
        };
      }
      const ring = closed ? [...points, points[0]] : points;
      const draw = mark.draw ?? (closed ? "stroke" : "segments");
      let paths: BoardPath[];
      if (draw === "segments") {
        paths = ring.slice(1).flatMap((to, index) =>
          styledLinePaths(
            generator,
            mutable(ring[index]),
            mutable(to),
            stroke,
            `${key}:segment-${index}`,
            group,
          ),
        );
      } else if (stroke === "dashed") {
        paths = styledPolylinePaths(generator, ring.map(mutable), "dashed", key, group);
      } else if (closed) {
        paths = normalizePaths(
          generator.toPaths(
            generator.polygon(points.map(mutable), {
              seed: stableSeed(key),
              ...(mark.fill ? { fill: DIAGRAM_FILL, fillStyle: "solid" } : {}),
            }),
          ),
          group,
          polylineLength(ring.map(mutable)),
        );
      } else {
        paths = normalizePaths(
          generator.toPaths(generator.linearPath(points.map(mutable), { seed: stableSeed(key) })),
          group,
          polylineLength(points.map(mutable)),
        );
      }
      const extent: Pixel[] = [...points];
      if (mark.arrow && !closed) {
        const heads = arrowHeadPoints(mutable(ring.at(-1)!), mutable(ring.at(-2)!));
        paths.push(...arrowHead(generator, heads[0], heads[1], heads[2], key, group));
        extent.push(...heads);
      }
      const bounds = pointsBounds(extent);
      return {
        id: placed.id,
        paths,
        labels: labelsFor((text) =>
          closed
            ? topLabel(text, bounds, 14)
            : segmentLabel(text, mutable(points.at(-2)!), mutable(points.at(-1)!))),
        bounds,
        extent,
        handle: handle({ polylines: [ring] }),
      };
    }

    case "circle":
    case "ellipse": {
      const center = place(mark.center);
      const [rx, ry] = mark.kind === "circle" ? [mark.r, mark.r] : [mark.rx, mark.ry];
      if (!isTranslation(affine)) {
        const outline = sampledOutline(center, rx, ry, 0, 360, frame, affine);
        return outlineMark(placed, generator, key, stroke, group, outline, true, mark.label, handle);
      }
      const width = rx * frame.unit[0] * 2;
      const height = ry * frame.unit[1] * 2;
      const fill = mark.fill ? { fill: DIAGRAM_FILL, fillStyle: "solid" } : {};
      const outline = Array.from({ length: 49 }, (_, index): Mutable => {
        const angle = (index / 48) * Math.PI * 2;
        return [center[0] + Math.cos(angle) * width / 2, center[1] + Math.sin(angle) * height / 2];
      });
      const paths = stroke === "solid"
        ? normalizePaths(
            generator.toPaths(
              generator.ellipse(center[0], center[1], width, height, { seed: stableSeed(key), ...fill }),
            ),
            group,
            ellipseCircumference(width / 2, height / 2),
          )
        : styledPolylinePaths(generator, outline, "dashed", key, group);
      const extent: Pixel[] = [
        [center[0] - rx * frame.unit[0], center[1] - ry * frame.unit[1]],
        [center[0] + rx * frame.unit[0], center[1] + ry * frame.unit[1]],
      ];
      return {
        id: placed.id,
        paths,
        labels: labelsFor((text) => ({
          text,
          x: center[0],
          y: center[1] - height / 2 - 14,
          anchor: "middle",
          autoPlace: true,
        })),
        bounds: pointsBounds(extent),
        extent,
        handle: handle({ polylines: [outline] }),
      };
    }

    case "arc": {
      const center = place(mark.center);
      if (!isTranslation(affine)) {
        const outline = sampledOutline(center, mark.rx, mark.ry, mark.start, mark.end, frame, affine);
        return outlineMark(placed, generator, key, stroke, group, outline, false, mark.label, handle, mark.arrow);
      }
      const rx = mark.rx * frame.unit[0];
      const ry = mark.ry * frame.unit[1];
      // Math degrees (counter-clockwise, y up) are screen degrees negated.
      const start = -mark.start;
      const end = -mark.end;
      const points = arcSamplePoints(center, rx, ry, start, end);
      const paths = styledPolylinePaths(generator, points, stroke, key, group);
      const extremes: Pixel[] = arcExtremaPoints(center, rx, ry, start, end);
      const extent: Pixel[] = [...points];
      if (mark.arrow) {
        const heads = arrowHeadPoints(points.at(-1)!, points.at(-2)!);
        paths.push(...arrowHead(generator, heads[0], heads[1], heads[2], key, group));
        extremes.push(...heads);
        extent.push(...heads);
      }
      const middle = points[Math.floor(points.length / 2)];
      return {
        id: placed.id,
        paths,
        labels: labelsFor((text) => ({
          text,
          x: middle[0],
          y: middle[1] - 18,
          anchor: "middle",
          autoPlace: true,
        })),
        bounds: pointsBounds(extremes),
        extent,
        handle: handle({ polylines: [points] }),
      };
    }

    case "angle": {
      const vertex = place(mark.vertex);
      const radius = mark.radius * frame.minSide;
      const [start, end] = "rays" in mark.angle
        ? rayAngles(vertex, place(mark.angle.rays[0]), place(mark.angle.rays[1]))
        : screenAngles(mark.angle.start, mark.angle.end, frame, affine);
      const middle = (((start + end) / 2) * Math.PI) / 180;
      const points = mark.square && Math.abs(Math.abs(end - start) - 90) <= RIGHT_ANGLE_TOLERANCE
        ? squareCorner(vertex, start, end, radius * Math.SQRT1_2)
        : arcSamplePoints(vertex, radius, radius, start, end);
      return {
        id: placed.id,
        paths: styledPolylinePaths(generator, points, stroke, key, group),
        labels: labelsFor((text) => ({
          text,
          x: vertex[0] + Math.cos(middle) * (radius + 24),
          y: vertex[1] + Math.sin(middle) * (radius + 24),
          anchor: "middle",
          autoPlace: true,
        })),
        bounds: pointsBounds(points),
        extent: points,
        handle: handle({ polylines: [points] }),
      };
    }

    case "fn":
    case "param":
    case "polar": {
      const window = frame.frame.window;
      let segments: SamplePoint[][];
      let fn: MarkHandle["fn"];
      if (mark.kind === "fn") {
        const domain = mark.domain ?? window.x;
        const samples = sampleFunction(mark.expr, domain);
        if (identity) {
          segments = visibleSegments(samples, window);
          const compiled = compileSafeExpression(mark.expr, "x");
          fn = { segments, evaluate: compiled.evaluate, toPixel: (point) => frame.toPixel(point) };
        } else {
          segments = visibleSegments(samples.map((point) => applyAffine(affine, point)), window);
        }
      } else {
        const samples = mark.kind === "param"
          ? sampleParametric(mark.x, mark.y, mark.t)
          : samplePolar(mark.r, mark.theta);
        segments = visibleSegments(
          identity ? samples : samples.map((point) => applyAffine(affine, point)),
          window,
        );
      }
      if (segments.length === 0) {
        throw geometryFailure("degenerate_geometry", "curve has fewer than two visible samples");
      }
      const visible = segments.map((segment) => segment.map((point): Mutable => mutable(frame.toPixel(point))));
      const color = mark.tone === "ink" ? "#2b2e36" : mark.tone === "faint" ? FAINT : ACCENT;
      const paths = visible.flatMap((pixels, index) =>
        stroke === "dashed"
          ? styledPolylinePaths(generator, pixels, "dashed", `${key}:${index}`, group ?? index)
          : normalizePaths(
              generator.toPaths(generator.curve(pixels, {
                seed: stableSeed(`${key}:${index}`),
                stroke: color,
                strokeWidth: 5,
                roughness: 0.75,
              })),
              group ?? index,
              polylineLength(pixels),
            ),
      );
      const extent = visible.flat();
      const last = visible.at(-1)!.at(-1)!;
      return {
        id: placed.id,
        paths,
        labels: labelsFor((text) => ({ text, x: last[0] + 10, y: last[1] - 12, autoPlace: true })),
        bounds: pointsBounds(extent),
        extent,
        handle: handle({ polylines: visible, ...(fn ? { fn } : {}) }),
      };
    }

    case "region": {
      const polygon = regionPolygon(mark.region, resolver, frameId, frame);
      // Holes are masked out of the fill, so they may overlap each other or
      // stick out of the shaded shape ("A but not B" in a Venn diagram).
      const holes = "inside" in mark.region
        ? (mark.region.except ?? []).map((id) => closedOutline(id, resolver, frameId))
        : [];
      const paths = normalizePaths(
        generator.toPaths(
          generator.polygon(polygon.map(mutable), {
            seed: stableSeed(key),
            fill: DIAGRAM_FILL,
            fillStyle: "solid",
            stroke: "none",
          }),
        ),
        group ?? 0,
        1,
      ).map((path) => (holes.length > 0 ? { ...path, holes: holes.map(outlinePath) } : path));
      const bounds = pointsBounds(polygon);
      const [labelX, labelY] = holes.length > 0
        ? roomiestPoint(polygon, holes, bounds)
        : [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
      return {
        id: placed.id,
        paths,
        labels: labelsFor((text) => ({
          text,
          x: labelX,
          y: labelY,
          anchor: "middle",
          autoPlace: true,
        })),
        bounds,
        extent: polygon,
        handle: handle({ polylines: [[...polygon, polygon[0]]] }),
      };
    }

    case "measure": {
      const from = place(mark.from);
      const to = place(mark.to);
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length <= 1e-7) throw geometryFailure("degenerate_geometry", "measure has no length");
      const normal: Pixel = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
      const offset = mark.offset ?? 24;
      const shift = (point: Pixel, distance: number): Mutable =>
        [point[0] + normal[0] * distance, point[1] + normal[1] * distance];
      const a = shift(from, offset);
      const b = shift(to, offset);
      return {
        id: placed.id,
        paths: [
          ...styledLinePaths(generator, a, b, stroke, key, group),
          ...roughLinePaths(generator, shift(from, offset - 8), shift(from, offset + 8), `${key}:tick-start`, group ?? 0),
          ...roughLinePaths(generator, shift(to, offset - 8), shift(to, offset + 8), `${key}:tick-end`, group ?? 0),
        ],
        labels: labelsFor((text) => segmentLabel(text, a, b)),
        bounds: pointsBounds([from, to, a, b]),
        extent: [from, to, a, b],
        handle: handle({ polylines: [[a, b]] }),
      };
    }

    case "label": {
      const [x, y] = place(mark.at);
      const fontSize = LABEL_SIZES[mark.size ?? "normal"];
      const label: BoardLabel = mark.side === "on"
        ? {
            text: mark.text,
            x,
            y,
            anchor: mark.align === "center" ? "middle" : mark.align === "right" ? "end" : "start",
            fontSize,
            mobility: mark.mobility ?? "nudge",
          }
        : { ...sideLabel(mark.text, x, y, mark.side, fontSize), fontSize, mobility: mark.mobility ?? "free" };
      const bounds = labelBounds(label);
      return {
        id: placed.id,
        // A transparent mark gives the writing its share of the reveal time.
        paths: [{
          d: `M ${x} ${y} l 0.01 0`,
          stroke: "transparent",
          strokeWidth: 0,
          fill: "none",
          ...(group === undefined ? {} : { revealGroup: group }),
          revealWeight: Math.max(1, mark.text.length * 5),
        }],
        labels: [withGroup(label, group)],
        bounds,
        extent: [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height]],
        handle: handle({ point: [x, y] }),
      };
    }
  }
}

/** Axes, zero references, ticks, titles, and grid of a frame, drawn by the element that owns it. */
export function renderFrame(
  transform: FrameTransform,
  generator: InkGenerator,
  /** Stroke groups for the axes; negative values draw them before any mark. */
  firstGroup = 0,
): { paths: BoardPath[]; labels: BoardLabel[] } {
  const frame: Frame = transform.frame;
  const paths: BoardPath[] = [];
  const labels: BoardLabel[] = [];
  const { x: [xMin, xMax], y: [yMin, yMax] } = frame.window;
  const left = frame.box.x;
  const right = frame.box.x + frame.box.width;
  const top = frame.box.y;
  const bottom = frame.box.y + frame.box.height;
  const faint = (d: string): BoardPath => ({ d, stroke: FAINT, strokeWidth: 2, fill: "none", revealGroup: firstGroup });
  if (frame.grid) {
    for (const value of gridValues(xMin, xMax)) {
      const [px] = transform.toPixel([value, yMin]);
      paths.push({ ...faint(`M ${px} ${bottom} L ${px} ${top}`), strokeWidth: 1 });
    }
    for (const value of gridValues(yMin, yMax)) {
      const [, py] = transform.toPixel([xMin, value]);
      paths.push({ ...faint(`M ${left} ${py} L ${right} ${py}`), strokeWidth: 1 });
    }
  }
  if (frame.axes === "none") return { paths, labels };

  const crossesY = yMin < 0 && yMax > 0;
  const crossesX = xMin < 0 && xMax > 0;
  const zeroY = crossesY ? transform.toPixel([xMin, 0])[1] : undefined;
  const zeroX = crossesX ? transform.toPixel([0, yMin])[0] : undefined;
  // Edge axes sit on the plot edges so they never cut through the data; a
  // range crossing zero gets a faint reference line. Origin axes cross at 0.
  const axisY = frame.axes === "origin" && zeroY !== undefined ? zeroY : bottom;
  const axisX = frame.axes === "origin" && zeroX !== undefined ? zeroX : left;
  paths.push(
    ...normalizePaths(
      generator.toPaths(generator.line(left, axisY, right, axisY, { seed: stableSeed(`${frame.id}:x`) })),
      firstGroup,
      right - left,
    ),
    ...normalizePaths(
      generator.toPaths(generator.line(axisX, bottom, axisX, top, { seed: stableSeed(`${frame.id}:y`) })),
      firstGroup + 1,
      bottom - top,
    ),
  );
  if (frame.axes === "edge") {
    if (zeroY !== undefined) paths.push(faint(`M ${left} ${zeroY} L ${right} ${zeroY}`));
    if (zeroX !== undefined) paths.push(faint(`M ${zeroX} ${bottom} L ${zeroX} ${top}`));
  }
  if (frame.titles) {
    // Titles describe an axis rather than mark a value, so the solver may nudge them.
    if (frame.titles.x) {
      labels.push({ text: frame.titles.x, x: (left + right) / 2, y: bottom + 42, anchor: "middle", mobility: "nudge" });
    }
    if (frame.titles.y) labels.push({ text: frame.titles.y, x: left + 8, y: top + 4, mobility: "nudge" });
  }
  // Range ends and the zero line each get a tick value; when zero sits next
  // to a range end the two values would print on top of each other, so the
  // end value gives way (the zero line is the more useful reference).
  const xTicks: BoardLabel[] = [
    { text: formatAxisValue(xMin), x: left, y: bottom + 30, anchor: "middle" },
    { text: formatAxisValue(xMax), x: right, y: bottom + 30, anchor: "middle" },
  ];
  const yTicks: BoardLabel[] = [
    { text: formatAxisValue(yMax), x: left - 14, y: top + 8, anchor: "end" },
    ...(yMin !== 0 ? [{ text: formatAxisValue(yMin), x: left - 14, y: bottom, anchor: "end" as const }] : []),
  ];
  const xZero: BoardLabel | undefined = zeroX === undefined
    ? undefined
    : { text: "0", x: zeroX, y: bottom + 30, anchor: "middle" };
  const yZero: BoardLabel | undefined = zeroY === undefined
    ? undefined
    : { text: "0", x: left - 14, y: zeroY + 8, anchor: "end" };
  const clearOfX = (tick: BoardLabel) =>
    !xZero || Math.abs(tick.x - xZero.x) >= (tickWidth(tick.text) + tickWidth(xZero.text)) / 2 + 6;
  const clearOfY = (tick: BoardLabel) => !yZero || Math.abs(tick.y - yZero.y) >= AXIS_FONT + 4;
  labels.push(
    ...xTicks.filter(clearOfX),
    ...yTicks.filter(clearOfY),
    ...(yZero ? [yZero] : []),
    ...(xZero ? [xZero] : []),
  );
  return { paths, labels };
}

/** Axis tick values render at this size (`.board-axis-label`). */
const AXIS_FONT = 24;

function tickWidth(text: string): number {
  return Math.max(AXIS_FONT * 0.65, text.length * AXIS_FONT * LABEL_CHARACTER_EM);
}

function gridValues(min: number, max: number): number[] {
  const span = max - min;
  const rough = span / 8;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough)!;
  const values: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9 && values.length < 40; value += step) {
    if (value > min + 1e-9 && value < max - 1e-9) values.push(value);
  }
  return values;
}

function lineEnds(
  line: Extract<PlacedMark["mark"], { kind: "line" }>["line"],
  place: (ref: PointRef) => Pixel,
  resolver: RefResolver,
  frame: FrameTransform,
  frameId: string,
  affine: Affine,
  clip: boolean,
): [Pixel, Pixel] {
  if ("from" in line) return [place(line.from), place(line.to)];
  const halfLength = ((line.length ?? 0.4) * frame.minSide) / 2;
  let ends: [Pixel, Pixel];
  if ("slope" in line) {
    const through = place(line.through);
    const [dx, dy] = pixelDirection([1, line.slope], frame, affine);
    ends = [
      [through[0] - dx * halfLength, through[1] - dy * halfLength],
      [through[0] + dx * halfLength, through[1] + dy * halfLength],
    ];
  } else if ("tangentTo" in line) {
    const curve = resolver.handle(line.tangentTo, frameId);
    if (!curve.fn) throw geometryFailure("unsupported_geometry", "tangent_at requires one accepted curve");
    ends = tangentSegment(curve.fn.segments, line.x, curve.fn.toPixel, halfLength);
  } else {
    const straight = straightSegment(
      resolver.handle(line.normalTo, frameId),
      "perpendicular_through requires one straight line",
    );
    const through = place(line.through);
    const foot = footOnLine(through, straight);
    ends = line.length === undefined && Math.hypot(foot[0] - through[0], foot[1] - through[1]) > 1
      ? [through, foot]
      : perpendicularSegment(straight, through, halfLength);
  }
  if (clip) return clipToBox(ends, frame.frame.box);
  assertInsideBox(ends[0], frame.frame.box);
  assertInsideBox(ends[1], frame.frame.box);
  return ends;
}

function footOnLine(point: Pixel, [start, end]: readonly [Pixel, Pixel]): Pixel {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy || 1);
  return [start[0] + dx * t, start[1] + dy * t];
}

/** Liang–Barsky: the part of a segment inside the box (rejected when none is). */
function clipToBox([a, b]: readonly [Pixel, Pixel], box: LayoutBox): [Pixel, Pixel] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let low = 0;
  let high = 1;
  const edges: Array<[number, number]> = [
    [-dx, a[0] - box.x],
    [dx, box.x + box.width - a[0]],
    [-dy, a[1] - box.y],
    [dy, box.y + box.height - a[1]],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) throw geometryFailure("off_board", "constructed line lies outside its frame");
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
  }
  if (high - low <= 1e-9) throw geometryFailure("off_board", "constructed line lies outside its frame");
  return [
    [a[0] + dx * low, a[1] + dy * low],
    [a[0] + dx * high, a[1] + dy * high],
  ];
}

/** A frame-space direction as a unit pixel direction (through the group affine and the frame). */
function pixelDirection(direction: Vec2, frame: FrameTransform, affine: Affine): Pixel {
  const local: Vec2 = [
    affine.a * direction[0] + affine.c * direction[1],
    affine.b * direction[0] + affine.d * direction[1],
  ];
  const px = local[0] * frame.unit[0];
  const py = -local[1] * frame.unit[1];
  const length = Math.hypot(px, py);
  if (!(length > 1e-12)) throw geometryFailure("degenerate_geometry", "direction has no length");
  return [px / length, py / length];
}

/** Math degrees through the affine as screen degrees, keeping the sweep's orientation. */
function screenAngles(start: number, end: number, frame: FrameTransform, affine: Affine): [number, number] {
  if (isTranslation(affine)) return [-start, -end];
  const angleOf = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    const [dx, dy] = pixelDirection([Math.cos(radians), Math.sin(radians)], frame, affine);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const screenStart = angleOf(start);
  const mirrored = affine.a * affine.d - affine.b * affine.c < 0;
  const sweep = (mirrored ? 1 : -1) * (end - start);
  return [screenStart, screenStart + sweep];
}

/** Screen angles from the first ray to the second, the short way round. */
/** Degrees from 90 (on screen) that still read as a right angle. */
const RIGHT_ANGLE_TOLERANCE = 1;

/** The right-angle mark: a square of side `side` in the corner between two screen directions (degrees). */
function squareCorner(vertex: Pixel, start: number, end: number, side: number): Mutable[] {
  const along = (degrees: number): Mutable =>
    [Math.cos((degrees * Math.PI) / 180) * side, Math.sin((degrees * Math.PI) / 180) * side];
  const [ax, ay] = along(start);
  const [bx, by] = along(end);
  return [
    [vertex[0] + ax, vertex[1] + ay],
    [vertex[0] + ax + bx, vertex[1] + ay + by],
    [vertex[0] + bx, vertex[1] + by],
  ];
}

function rayAngles(vertex: Pixel, first: Pixel, second: Pixel): [number, number] {
  const angle = (point: Pixel) => (Math.atan2(point[1] - vertex[1], point[0] - vertex[0]) * 180) / Math.PI;
  const start = angle(first);
  const sweep = ((angle(second) - start + 540) % 360) - 180;
  if (Math.abs(sweep) < 1e-9) throw geometryFailure("degenerate_geometry", "angle rays coincide");
  return [start, start + sweep];
}

/** An ellipse or arc under a general affine, sampled in frame coordinates. */
function sampledOutline(
  center: Pixel,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  frame: FrameTransform,
  affine: Affine,
): Mutable[] {
  const sweep = endDeg - startDeg;
  const samples = Math.max(8, Math.ceil(Math.abs(sweep) / 8));
  return Array.from({ length: samples + 1 }, (_, index): Mutable => {
    const radians = ((startDeg + (sweep * index) / samples) * Math.PI) / 180;
    const local: Vec2 = [rx * Math.cos(radians), ry * Math.sin(radians)];
    const x = affine.a * local[0] + affine.c * local[1];
    const y = affine.b * local[0] + affine.d * local[1];
    return [center[0] + x * frame.unit[0], center[1] - y * frame.unit[1]];
  });
}

function outlineMark(
  placed: PlacedMark,
  generator: InkGenerator,
  key: string,
  stroke: "solid" | "dashed",
  group: number | undefined,
  outline: Mutable[],
  closed: boolean,
  label: MarkLabel | undefined,
  handle: (geometry: Partial<MarkHandle>) => MarkHandle,
  arrow = false,
): RenderedMark {
  const paths = styledPolylinePaths(generator, outline, stroke, key, group);
  const extent: Pixel[] = [...outline];
  if (arrow && !closed) {
    const heads = arrowHeadPoints(outline.at(-1)!, outline.at(-2)!);
    paths.push(...arrowHead(generator, heads[0], heads[1], heads[2], key, group));
    extent.push(...heads);
  }
  const bounds = pointsBounds(extent);
  return {
    id: placed.id,
    paths,
    labels: label ? [withGroup(withMobility(topLabel(label.text, bounds, 14), label), group)] : [],
    bounds,
    extent,
    handle: handle({ polylines: [outline] }),
  };
}

function regionPolygon(
  region: Extract<PlacedMark["mark"], { kind: "region" }>["region"],
  resolver: RefResolver,
  frameId: string,
  frame: FrameTransform,
): Pixel[] {
  const window = frame.frame.window;
  const clampY = (value: number) => Math.min(window.y[1], Math.max(window.y[0], value));
  if ("inside" in region) return closedOutline(region.inside, resolver, frameId);
  const ids = "under" in region ? [region.under] : [...region.between];
  const functions = ids.map((id) => {
    const handle = resolver.handle(id, frameId);
    if (!handle.fn) throw geometryFailure("unsupported_geometry", `${id} is not a function`);
    const xs = handle.fn.segments.flat().map(([x]) => x);
    return { fn: handle.fn, from: Math.min(...xs), to: Math.max(...xs) };
  });
  const from = Math.max(region.from ?? -Infinity, ...functions.map((item) => item.from));
  const to = Math.min(region.to ?? Infinity, ...functions.map((item) => item.to));
  if (!(to > from)) throw geometryFailure("degenerate_geometry", "region has no width");
  const grid = Array.from({ length: 61 }, (_, index) => from + ((to - from) * index) / 60);
  const curve = (item: (typeof functions)[number]) =>
    grid.map((x) => item.fn.toPixel([x, clampY(item.fn.evaluate(x))]));
  const upper = curve(functions[0]);
  const lower = functions.length > 1
    ? curve(functions[1]).reverse()
    : [frame.toPixel([to, clampY(0)]), frame.toPixel([from, clampY(0)])];
  return [...upper, ...lower];
}

/** A closed shape's outline, without its repeated closing point. */
function closedOutline(id: string, resolver: RefResolver, frameId: string): Pixel[] {
  const shape = resolver.handle(id, frameId);
  if (shape.polylines.length !== 1 || shape.polylines[0].length < 4) {
    throw geometryFailure("unsupported_geometry", `${id} is not one closed shape`);
  }
  return shape.polylines[0].slice(0, -1);
}

function outlinePath(points: readonly Pixel[]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ")} Z`;
}

/** The grid point of the shaded part (inside `polygon`, outside every hole) farthest from any edge. */
function roomiestPoint(polygon: readonly Pixel[], holes: readonly Pixel[][], bounds: LayoutBox): Pixel {
  const rings = [polygon, ...holes].map((ring) => [...ring, ring[0]]);
  let best: { point: Pixel; room: number } | undefined;
  for (let row = 1; row < 12; row += 1) {
    for (let column = 1; column < 12; column += 1) {
      const point: Pixel = [bounds.x + (bounds.width * column) / 12, bounds.y + (bounds.height * row) / 12];
      if (!pointInPolygon(polygon, point) || holes.some((hole) => pointInPolygon(hole, point))) continue;
      const room = Math.min(...rings.map((ring) => distanceToPolyline(point, ring)));
      if (!best || room > best.room) best = { point, room };
    }
  }
  return best?.point ?? [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
}

function dot(generator: InkGenerator, point: Pixel, key: string, group: number): BoardPath[] {
  return normalizePaths(
    generator.toPaths(generator.circle(point[0], point[1], POINT_DIAMETER, { seed: stableSeed(key) })),
    group,
    50,
  );
}

/** Arrowheads come after the shaft: in the mark's group, else in their own last groups. */
function arrowHead(
  generator: InkGenerator,
  end: Pixel,
  left: DiagramPoint,
  right: DiagramPoint,
  key: string,
  group: number | undefined,
): BoardPath[] {
  return [
    ...roughLinePaths(generator, mutable(end), left, `${key}:head-left`, group ?? 100),
    ...roughLinePaths(generator, mutable(end), right, `${key}:head-right`, group ?? 101),
  ];
}

function pointBox(point: Pixel): Pixel[] {
  return [[point[0] - 8, point[1] - 8], [point[0] + 8, point[1] + 8]];
}

function pointLabel(text: string, point: Pixel): BoardLabel {
  return { text, x: point[0] + 16, y: point[1] - 12, autoPlace: true };
}

function topLabel(text: string, bounds: LayoutBox, gap: number): BoardLabel {
  return { text, x: bounds.x + bounds.width / 2, y: bounds.y - gap, anchor: "middle", autoPlace: true };
}

function sideLabel(
  text: string,
  x: number,
  y: number,
  side: "above" | "below" | "left" | "right",
  fontSize: number,
): BoardLabel {
  if (side === "above") return { text, x, y: y - 12, anchor: "middle" };
  if (side === "below") return { text, x, y: y + fontSize + 4, anchor: "middle" };
  if (side === "left") return { text, x: x - 12, y: y + fontSize * 0.35, anchor: "end" };
  return { text, x: x + 12, y: y + fontSize * 0.35, anchor: "start" };
}

function withMobility(label: BoardLabel, source: { mobility?: LabelMobility }): BoardLabel {
  return source.mobility ? { ...label, mobility: source.mobility } : label;
}

function withGroup(label: BoardLabel, group: number | undefined): BoardLabel {
  return group === undefined ? label : { ...label, revealGroup: group };
}
