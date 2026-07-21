import rough from "roughjs/bin/rough";
import type { PathInfo } from "roughjs/bin/core";
import { axesPlotBox } from "./axesGeometry";
import {
  arrowHeadPoints,
  cubicPath,
  diagramArcPoints,
  diagramPrimitiveBounds,
  diagramTextFontSize,
  mapDiagramPoint,
  sampleCubicSegments,
  smoothThroughPoints,
} from "./diagramGeometry";
import { sampleVisibleCurveSegments } from "./expression";
import { renderSafeLatex } from "./latex";
import { equationFontSizeForContent } from "./equationSizing";
import type { AxesOp, DiagramOp, DiagramPrimitive, LessonOp } from "./lesson.generated";
import type { LaidOutOp, LayoutBox } from "./layout";

export interface BoardPath {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
  revealGroup?: number;
  revealWeight?: number;
}

export interface BoardLabel {
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  revealGroup?: number;
  fontSize?: number;
  autoPlace?: boolean;
}

export interface BoardManifestPart {
  id: string;
  kind: LessonOp["op"];
  box: LayoutBox;
  summary: string;
  revealGroup: number;
}

export interface BoardGeometry {
  id: string;
  kind: LessonOp["op"];
  box: LayoutBox;
  canvasBox?: LayoutBox;
  paths: BoardPath[];
  labels: BoardLabel[];
  inkBounds?: LayoutBox[];
  manifestParts?: BoardManifestPart[];
  text?: string;
  equationHtml?: string;
  equationFontSize?: number;
  manifestSummary: string;
  stepIndex: number;
  opIndex: number;
}

export interface GeometryBuildResult {
  geometries: BoardGeometry[];
  warnings: Array<{ id: string; detail: string }>;
}

interface CacheEntry {
  signature: string;
  geometry: BoardGeometry;
}

export class BoardGeometryStore {
  private readonly cache = new Map<string, CacheEntry>();

  build(laidOutOps: readonly LaidOutOp[]): GeometryBuildResult {
    const geometries: BoardGeometry[] = [];
    const warnings: Array<{ id: string; detail: string }> = [];
    const axes = new Map<string, { op: AxesOp; box: LayoutBox }>();
    const liveIds = new Set(laidOutOps.map(({ op }) => op.id));

    for (const item of laidOutOps) {
      if (item.op.op === "axes") axes.set(item.op.id, { op: item.op, box: item.box });
      const signature = JSON.stringify([
        item.op,
        item.box,
        item.canvasBox,
        item.stepIndex,
        item.opIndex,
      ]);
      const cached = this.cache.get(item.op.id);
      if (cached?.signature === signature) {
        geometries.push(cached.geometry);
        continue;
      }
      try {
        const geometry = createGeometry(item, axes);
        this.cache.set(item.op.id, { signature, geometry });
        geometries.push(geometry);
      } catch (error) {
        this.cache.delete(item.op.id);
        warnings.push({
          id: item.op.id,
          detail: error instanceof Error ? error.message : "Geometry generation failed.",
        });
      }
    }
    for (const id of this.cache.keys()) {
      if (!liveIds.has(id)) this.cache.delete(id);
    }
    return { geometries: declutterCanvasLabels(geometries), warnings };
  }
}

/**
 * Per-op geometry resolves label collisions only inside a single diagram op,
 * so standalone arrows, arcs, and points that converge on one vertex can
 * stack their labels into an unreadable pile. This pass re-runs the same
 * greedy placement across every op that shares a coordinate canvas. Cached
 * geometry keeps the raw positions; the pass is pure per build.
 */
function declutterCanvasLabels(
  geometries: readonly BoardGeometry[],
): BoardGeometry[] {
  const groups = new Map<string, number[]>();
  geometries.forEach((geometry, index) => {
    if (!geometry.canvasBox || geometry.labels.length === 0) return;
    const { x, y, width, height } = geometry.canvasBox;
    const key = `${x}:${y}:${width}:${height}`;
    const members = groups.get(key);
    if (members) members.push(index);
    else groups.set(key, [index]);
  });

  const result = [...geometries];
  for (const members of groups.values()) {
    const movable = members.filter((index) => geometries[index].kind !== "diagram");
    if (movable.length < 2 && (movable.length === 0 || members.length < 2)) continue;
    const occupied: LayoutBox[] = [];
    for (const index of members) {
      const geometry = geometries[index];
      if (geometry.kind === "diagram") {
        occupied.push(...geometry.labels.map(labelBox));
        occupied.push(...(geometry.inkBounds ?? []));
      } else if (isThinBox(geometry.box)) {
        occupied.push(geometry.box);
      }
    }
    for (const index of movable) {
      const geometry = geometries[index];
      const canvas = geometry.canvasBox;
      if (!canvas) continue;
      const placed = geometry.labels.map((label) =>
        placeLabelAvoiding(label, canvas, occupied),
      );
      occupied.push(...placed.map(labelBox));
      if (placed.some((label, i) => label !== geometry.labels[i])) {
        result[index] = { ...geometry, labels: placed };
      }
    }
  }
  return result;
}

function placeLabelAvoiding(
  label: BoardLabel,
  canvas: LayoutBox,
  occupied: readonly LayoutBox[],
): BoardLabel {
  if (!label.autoPlace) return label;
  const candidate = { ...label };
  for (const [dx, dy] of labelPlacementOffsets()) {
    candidate.x = label.x + dx;
    candidate.y = label.y + dy;
    clampLabelToCanvas(candidate, canvas);
    if (!occupied.some((box) => boxesOverlap(labelBox(candidate), box))) {
      return candidate.x === label.x && candidate.y === label.y
        ? label
        : candidate;
    }
  }
  // Nothing fits: keep the authored position instead of exiling the label.
  return label;
}

function isThinBox(box: LayoutBox): boolean {
  return Math.min(box.width, box.height) <= 60;
}

function createGeometry(
  item: LaidOutOp,
  axes: ReadonlyMap<string, { op: AxesOp; box: LayoutBox }>,
): BoardGeometry {
  const { op, box, stepIndex, opIndex } = item;
  const base: BoardGeometry = {
    id: op.id,
    kind: op.op,
    box,
    ...(item.canvasBox ? { canvasBox: item.canvasBox } : {}),
    paths: [],
    labels: [],
    manifestSummary: op.op,
    stepIndex,
    opIndex,
  };

  if (op.op === "text") {
    return { ...base, text: op.content, manifestSummary: `text: ${op.content}` };
  }
  if (op.op === "equation") {
    return {
      ...base,
      equationHtml: renderSafeLatex(op.latex),
      equationFontSize: equationFontSizeForContent(op.latex, box.width),
      manifestSummary: `equation: ${op.latex}`,
    };
  }

  const generator = rough.generator({
    options: {
      roughness: 1.25,
      bowing: 1.1,
      stroke: "#2b2e36",
      strokeWidth: 4,
      disableMultiStroke: false,
    },
  });

  if (item.construction) {
    if (item.construction.kind === "point") {
      const [x, y] = item.construction.point;
      const label = "label" in op ? op.label : undefined;
      return {
        ...base,
        box: paddedPointBounds([[x - 8, y - 8], [x + 8, y + 8]]),
        paths: normalizePaths(
          generator.toPaths(
            generator.circle(x, y, 16, { seed: stableSeed(`${op.id}:construction-point`) }),
          ),
          0,
          50,
        ),
        labels: label ? [{ text: label, x: x + 16, y: y - 12 }] : [],
        manifestSummary: `${item.construction.summary}${label ? `; label ${label}` : ""}`,
      };
    }
    const from = [...item.construction.from] as [number, number];
    const to = [...item.construction.to] as [number, number];
    const label = "label" in op ? op.label : undefined;
    const stroke = op.op === "line" ? op.stroke : "solid";
    return {
      ...base,
      box: paddedPointBounds([from, to]),
      paths: styledLinePaths(generator, from, to, stroke, op.id),
      labels: label ? [segmentLabel(label, from, to)] : [],
      manifestSummary: `${item.construction.summary}${label ? `; label ${label}` : ""}`,
    };
  }

  if (op.op === "sketch") {
    const paths = op.strokes.flatMap((stroke, index) => {
      const points = stroke.map(([x, y]) => [
        box.x + x * box.width,
        box.y + y * box.height,
      ] as [number, number]);
      return normalizePaths(
        generator.toPaths(
          generator.linearPath(points, { seed: stableSeed(`${op.id}:${index}`) }),
        ),
        index,
        polylineLength(points),
      );
    });
    return {
      ...base,
      paths,
      manifestSummary: op.meaning ?? `sketch with ${op.strokes.length} strokes`,
    };
  }

  if (op.op === "diagram") {
    const canvas = item.canvasBox;
    if (!canvas) throw new Error(`Diagram ${op.id} has no coordinate canvas.`);
    const inkBounds = op.primitives.map((primitive) =>
      diagramPrimitiveBounds(primitive, canvas, op.tension ?? 0.55),
    );
    const rendered = op.primitives.map((primitive, index) =>
      renderDiagramPrimitive(generator, primitive, canvas, op, index),
    );
    const descriptions = op.primitives
      .map((primitive) => primitive.kind === "text" ? primitive.content : primitive.label ?? primitive.kind)
      .slice(0, 8)
      .join(", ");
    return {
      ...base,
      paths: rendered.flatMap(({ paths }) => paths),
      labels: resolveDiagramLabelCollisions(
        rendered.flatMap(({ labels }) => labels),
        canvas,
        inkBounds,
      ),
      inkBounds,
      manifestParts: op.primitives.map((primitive, index) => ({
        id: manifestPartId(op.id, index),
        kind: "diagram",
        box: padBox(diagramPrimitiveBounds(primitive, canvas, op.tension ?? 0.55), 18),
        summary: describeDiagramPrimitive(primitive),
        revealGroup: index,
      })),
      manifestSummary: `diagram with ${op.primitives.length} parts: ${descriptions}`,
    };
  }

  if ((op.op === "line" || op.op === "arrow") && "from" in op) {
    const canvas = item.canvasBox;
    if (!canvas) throw new Error(`Diagram ${op.id} has no coordinate canvas.`);
    const from = diagramPoint(op.from, canvas);
    const to = diagramPoint(op.to, canvas);
    const paths = styledLinePaths(generator, from, to, op.stroke, op.id);
    const extentPoints: [number, number][] = [from, to];
    if (op.op === "arrow") {
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const headLength = 24;
      const left: [number, number] = [
        to[0] - Math.cos(angle - Math.PI / 6) * headLength,
        to[1] - Math.sin(angle - Math.PI / 6) * headLength,
      ];
      const right: [number, number] = [
        to[0] - Math.cos(angle + Math.PI / 6) * headLength,
        to[1] - Math.sin(angle + Math.PI / 6) * headLength,
      ];
      paths.push(
        ...roughLinePaths(generator, to, left, `${op.id}:head-left`, 100),
        ...roughLinePaths(generator, to, right, `${op.id}:head-right`, 101),
      );
      extentPoints.push(left, right);
    }
    return {
      ...base,
      box: paddedPointBounds(extentPoints),
      paths,
      labels: op.label ? [segmentLabel(op.label, from, to)] : [],
      manifestSummary: op.op === "line" && op.meaning
        ? op.meaning
        : `${op.op}${op.label ? `: ${op.label}` : ""}`,
    };
  }

  if (op.op === "point" && "at" in op) {
    const canvas = item.canvasBox;
    if (!canvas) throw new Error(`Diagram ${op.id} has no coordinate canvas.`);
    const [x, y] = diagramPoint(op.at, canvas);
    return {
      ...base,
      box: paddedPointBounds([[x - 8, y - 8], [x + 8, y + 8]]),
      paths: normalizePaths(
        generator.toPaths(
          generator.circle(x, y, 16, { seed: stableSeed(`${op.id}:point`) }),
        ),
        0,
        50,
      ),
      labels: op.label
        ? [{ text: op.label, x: x + 16, y: y - 12, autoPlace: true }]
        : [],
      manifestSummary: `point${op.label ? `: ${op.label}` : ""}`,
    };
  }

  if (op.op === "angle_arc") {
    const canvas = item.canvasBox;
    if (!canvas) throw new Error(`Diagram ${op.id} has no coordinate canvas.`);
    const center = diagramPoint(op.center, canvas);
    const radius = op.radius * Math.min(canvas.width, canvas.height);
    const sweep = op.end_deg - op.start_deg;
    const sampleCount = Math.max(8, Math.ceil(Math.abs(sweep) / 8));
    const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
      const degrees = op.start_deg + (sweep * index) / sampleCount;
      const radians = (degrees * Math.PI) / 180;
      return [
        center[0] + Math.cos(radians) * radius,
        center[1] + Math.sin(radians) * radius,
      ] as [number, number];
    });
    const midpointRadians = (((op.start_deg + op.end_deg) / 2) * Math.PI) / 180;
    return {
      ...base,
      box: paddedPointBounds(points),
      paths: styledPolylinePaths(generator, points, op.stroke, op.id),
      labels: op.label
        ? [
            {
              text: op.label,
              x: center[0] + Math.cos(midpointRadians) * (radius + 24),
              y: center[1] + Math.sin(midpointRadians) * (radius + 24),
              anchor: "middle",
              autoPlace: true,
            },
          ]
        : [],
      manifestSummary: `angle arc${op.label ? `: ${op.label}` : ""}`,
    };
  }

  if (op.op === "axes") {
    const left = box.x + 58;
    const right = box.x + box.width - 24;
    const top = box.y + 24;
    const bottom = box.y + box.height - 52;
    const paths = [
      ...normalizePaths(
        generator.toPaths(
          generator.line(left, bottom, right, bottom, { seed: stableSeed(`${op.id}:x`) }),
        ),
        0,
        right - left,
      ),
      ...normalizePaths(
        generator.toPaths(
          generator.line(left, bottom, left, top, { seed: stableSeed(`${op.id}:y`) }),
        ),
        1,
        bottom - top,
      ),
    ];
    return {
      ...base,
      paths,
      manifestSummary: `axes: ${op.x.label} ${op.x.min} to ${op.x.max}; ${op.y.label} ${op.y.min} to ${op.y.max}`,
      labels: [
        { text: op.x.label, x: (left + right) / 2, y: bottom + 42, anchor: "middle" },
        { text: op.y.label, x: left + 8, y: top + 4 },
        { text: String(op.x.min), x: left, y: bottom + 30, anchor: "middle" },
        { text: String(op.x.max), x: right, y: bottom + 30, anchor: "middle" },
        { text: String(op.y.max), x: left - 14, y: top + 8, anchor: "end" },
      ],
    };
  }

  if (op.op !== "curve") {
    throw new Error(`Unsupported geometry operation ${op.id}.`);
  }
  const target = axes.get(op.axes_id);
  if (!target) throw new Error(`Curve ${op.id} has no laid-out axes.`);
  const plot = axesPlotBox(target.box);
  const sampledSegments = sampleVisibleCurveSegments(op, target.op);
  const visibleSegments = sampledSegments.map((segment) =>
    segment.map(([x, y]) => [
      plot.x + ((x - target.op.x.min) / (target.op.x.max - target.op.x.min)) * plot.width,
      plot.y + plot.height - ((y - target.op.y.min) / (target.op.y.max - target.op.y.min)) * plot.height,
    ] as [number, number]),
  );
  if (visibleSegments.length === 0) throw new Error(`Curve ${op.id} has fewer than two visible samples.`);
  const peak = sampledSegments
    .flat()
    .reduce((highest, point) => (point[1] > highest[1] ? point : highest));
  return {
    ...base,
    box: paddedPointBounds(visibleSegments.flat()),
    paths: visibleSegments.flatMap((visible, index) =>
      normalizePaths(
        generator.toPaths(generator.curve(visible, {
          seed: stableSeed(`${op.id}:${index}`),
          stroke: "#d97a29",
          strokeWidth: 5,
          roughness: 0.75,
        })),
        index,
        polylineLength(visible),
      ),
    ),
    manifestSummary: `curve on ${op.axes_id}; visible peak near x=${formatNumber(peak[0])}, y=${formatNumber(peak[1])}`,
  };
}

function describeDiagramPrimitive(primitive: DiagramPrimitive): string {
  if (primitive.meaning) return primitive.meaning;
  const name = primitive.kind !== "text" && primitive.label ? `${primitive.label}: ` : "";
  if (primitive.kind === "line" || primitive.kind === "smooth") {
    const from = primitive.points[0];
    const to = primitive.points.at(-1)!;
    return `${name}${primitive.stroke}${primitive.arrow ? " arrow" : ` ${primitive.kind}`} from ${qualitativePoint(from)} to ${qualitativePoint(to)}`;
  }
  if (primitive.kind === "rect") {
    return `${name}${primitive.fill ? "filled " : ""}rectangle from ${qualitativePoint(primitive.from)} to ${qualitativePoint(primitive.to)}`;
  }
  if (primitive.kind === "ellipse") {
    return `${name}${primitive.fill ? "filled " : ""}ellipse at ${qualitativePoint(primitive.center)}`;
  }
  if (primitive.kind === "arc") {
    return `${name}${primitive.stroke} arc at ${qualitativePoint(primitive.center)} from ${primitive.start_deg}° to ${primitive.end_deg}°${primitive.arrow ? " with arrow" : ""}`;
  }
  if (primitive.kind === "text") {
    return `writing "${primitive.content}" at ${qualitativePoint(primitive.at)}`;
  }
  return `${name}point at ${qualitativePoint(primitive.at)}`;
}

function qualitativePoint([x, y]: readonly [number, number]): string {
  const horizontal = x < 0.34 ? "left" : x > 0.66 ? "right" : "center";
  const vertical = y < 0.34 ? "upper" : y > 0.66 ? "lower" : "middle";
  return vertical === "middle" && horizontal === "center"
    ? "center"
    : vertical === "middle"
      ? horizontal
      : horizontal === "center"
        ? `${vertical} center`
        : `${vertical}-${horizontal}`;
}

function padBox(box: LayoutBox, padding: number): LayoutBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

function manifestPartId(parentId: string, index: number): string {
  return `p${stableSeed(parentId).toString(36).slice(0, 7)}_${index}`;
}

function styledLinePaths(
  generator: ReturnType<typeof rough.generator>,
  from: [number, number],
  to: [number, number],
  stroke: "solid" | "dashed",
  seedId: string,
  revealGroup?: number,
): BoardPath[] {
  if (stroke === "solid") return roughLinePaths(generator, from, to, seedId, revealGroup ?? 0);
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.max(2, Math.ceil(distance / 42));
  return Array.from({ length: count }, (_, index) => {
    const start = index / count;
    const end = Math.min(1, start + 0.58 / count);
    const dashFrom: [number, number] = [
      from[0] + (to[0] - from[0]) * start,
      from[1] + (to[1] - from[1]) * start,
    ];
    const dashTo: [number, number] = [
      from[0] + (to[0] - from[0]) * end,
      from[1] + (to[1] - from[1]) * end,
    ];
    return roughLinePaths(
      generator,
      dashFrom,
      dashTo,
      `${seedId}:dash-${index}`,
      revealGroup ?? index,
    );
  }).flat();
}

function styledPolylinePaths(
  generator: ReturnType<typeof rough.generator>,
  points: readonly [number, number][],
  stroke: "solid" | "dashed",
  seedId: string,
  revealGroup?: number,
): BoardPath[] {
  if (stroke === "solid") {
    return normalizePaths(
      generator.toPaths(
        generator.linearPath([...points], { seed: stableSeed(`${seedId}:arc`) }),
      ),
      revealGroup ?? 0,
      polylineLength(points),
    );
  }
  return points.slice(1).flatMap((to, index) =>
    styledLinePaths(
      generator,
      points[index],
      to,
      "dashed",
      `${seedId}:arc-${index}`,
      revealGroup,
    ),
  );
}

function renderDiagramPrimitive(
  generator: ReturnType<typeof rough.generator>,
  primitive: DiagramPrimitive,
  canvas: LayoutBox,
  op: DiagramOp,
  index: number,
): { paths: BoardPath[]; labels: BoardLabel[] } {
  const seedId = `${op.id}:part-${index}`;
  const group = index;
  let paths: BoardPath[] = [];
  let labels: BoardLabel[] = [];

  if (primitive.kind === "line" || primitive.kind === "smooth") {
    const points = primitive.points.map((point) => mapDiagramPoint(point, canvas));
    let tangentFrom = points.at(-2)!;
    if (primitive.kind === "smooth") {
      const segments = smoothThroughPoints(points, op.tension ?? 0.55);
      const sampled = sampleCubicSegments(segments);
      tangentFrom = segments.at(-1)!.control2;
      paths = primitive.stroke === "solid"
        ? normalizePaths(
            generator.toPaths(
              generator.path(cubicPath(segments), {
                seed: stableSeed(seedId),
                roughness: 0.85,
                strokeWidth: 4,
              }),
            ),
            group,
            polylineLength(sampled),
          )
        : styledPolylinePaths(generator, sampled, "dashed", seedId, group);
    } else {
      paths = points.slice(1).flatMap((to, segmentIndex) =>
        styledLinePaths(
          generator,
          points[segmentIndex],
          to,
          primitive.stroke,
          `${seedId}:segment-${segmentIndex}`,
          group,
        ),
      );
    }
    if (primitive.arrow) {
      const [end, left, right] = arrowHeadPoints(points.at(-1)!, tangentFrom);
      paths.push(
        ...roughLinePaths(generator, end, left, `${seedId}:head-left`, group),
        ...roughLinePaths(generator, end, right, `${seedId}:head-right`, group),
      );
    }
    if (primitive.label) labels = [segmentLabel(primitive.label, points.at(-2)!, points.at(-1)!)];
  } else if (primitive.kind === "rect") {
    const from = mapDiagramPoint(primitive.from, canvas);
    const to = mapDiagramPoint(primitive.to, canvas);
    const x = Math.min(from[0], to[0]);
    const y = Math.min(from[1], to[1]);
    const width = Math.abs(to[0] - from[0]);
    const height = Math.abs(to[1] - from[1]);
    if (primitive.stroke === "solid") {
      paths = normalizePaths(
        generator.toPaths(
          generator.rectangle(x, y, width, height, {
            seed: stableSeed(seedId),
            ...(primitive.fill ? { fill: diagramFill(), fillStyle: "solid" } : {}),
          }),
        ),
        group,
        2 * (width + height),
      );
    } else {
      const corners: [number, number][] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
      paths = styledPolylinePaths(generator, corners, "dashed", seedId, group);
    }
    if (primitive.label) labels = [{ text: primitive.label, x: x + width / 2, y: y - 14, anchor: "middle", autoPlace: true }];
  } else if (primitive.kind === "ellipse") {
    const center = mapDiagramPoint(primitive.center, canvas);
    const width = primitive.radius[0] * canvas.width * 2;
    const height = primitive.radius[1] * canvas.height * 2;
    if (primitive.stroke === "solid") {
      paths = normalizePaths(
        generator.toPaths(
          generator.ellipse(center[0], center[1], width, height, {
            seed: stableSeed(seedId),
            ...(primitive.fill ? { fill: diagramFill(), fillStyle: "solid" } : {}),
          }),
        ),
        group,
        ellipseCircumference(width / 2, height / 2),
      );
    } else {
      const outline = Array.from({ length: 49 }, (_, pointIndex) => {
        const angle = (pointIndex / 48) * Math.PI * 2;
        return [center[0] + Math.cos(angle) * width / 2, center[1] + Math.sin(angle) * height / 2] as [number, number];
      });
      paths = styledPolylinePaths(generator, outline, "dashed", seedId, group);
    }
    if (primitive.label) labels = [{ text: primitive.label, x: center[0], y: center[1] - height / 2 - 14, anchor: "middle", autoPlace: true }];
  } else if (primitive.kind === "arc") {
    const points = diagramArcPoints(primitive, canvas);
    paths = styledPolylinePaths(generator, points, primitive.stroke, seedId, group);
    if (primitive.arrow) {
      const [end, left, right] = arrowHeadPoints(points.at(-1)!, points.at(-2)!);
      paths.push(
        ...roughLinePaths(generator, end, left, `${seedId}:head-left`, group),
        ...roughLinePaths(generator, end, right, `${seedId}:head-right`, group),
      );
    }
    if (primitive.label) {
      const midpoint = points[Math.floor(points.length / 2)];
      labels = [{ text: primitive.label, x: midpoint[0], y: midpoint[1] - 18, anchor: "middle", autoPlace: true }];
    }
  } else if (primitive.kind === "text") {
    const [x, y] = mapDiagramPoint(primitive.at, canvas);
    const anchor = primitive.align === "center" ? "middle" : primitive.align === "right" ? "end" : "start";
    const fontSize = diagramTextFontSize(primitive);
    labels = [{ text: primitive.content, x, y, anchor, fontSize }];
    paths = [{
      d: `M ${x} ${y} l 0.01 0`,
      stroke: "transparent",
      strokeWidth: 0,
      fill: "none",
      revealGroup: group,
      revealWeight: Math.max(1, primitive.content.length * 5),
    }];
  } else {
    const [x, y] = mapDiagramPoint(primitive.at, canvas);
    paths = normalizePaths(
      generator.toPaths(generator.circle(x, y, 16, { seed: stableSeed(seedId) })),
      group,
      50,
    );
    if (primitive.label) labels = [{ text: primitive.label, x: x + 16, y: y - 12, autoPlace: true }];
  }

  return {
    paths,
    labels: labels.map((label) => ({ ...label, revealGroup: group })),
  };
}

function diagramFill(): string {
  return "rgba(217, 122, 41, 0.12)";
}

function ellipseCircumference(radiusX: number, radiusY: number): number {
  return Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
}

function roughLinePaths(
  generator: ReturnType<typeof rough.generator>,
  from: [number, number],
  to: [number, number],
  seedId: string,
  revealGroup: number,
): BoardPath[] {
  return normalizePaths(
    generator.toPaths(
      generator.line(from[0], from[1], to[0], to[1], {
        seed: stableSeed(seedId),
      }),
    ),
    revealGroup,
    Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1])),
  );
}

function segmentLabel(
  text: string,
  from: [number, number],
  to: [number, number],
): BoardLabel {
  const length = Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1]));
  return {
    text,
    x: (from[0] + to[0]) / 2 - ((to[1] - from[1]) / length) * 20,
    y: (from[1] + to[1]) / 2 + ((to[0] - from[0]) / length) * 20,
    anchor: "middle",
    autoPlace: true,
  };
}

function resolveDiagramLabelCollisions(
  labels: readonly BoardLabel[],
  canvas: LayoutBox,
  inkBounds: readonly LayoutBox[],
): BoardLabel[] {
  const resolved = labels.map((label) => ({ ...label }));
  const occupied = resolved
    .filter((label) => !label.autoPlace)
    .map(labelBox);
  const offsets = labelPlacementOffsets();
  for (const label of resolved) {
    if (!label.autoPlace) continue;
    const original = { x: label.x, y: label.y };
    let chosen = labelBox(label);
    let chosenPosition = { ...original };
    for (const [dx, dy] of offsets) {
      label.x = original.x + dx;
      label.y = original.y + dy;
      clampLabelToCanvas(label, canvas);
      const candidate = labelBox(label);
      chosen = candidate;
      chosenPosition = { x: label.x, y: label.y };
      if (
        !occupied.some((box) => boxesOverlap(candidate, box)) &&
        !inkBounds.some((box) => boxesOverlap(candidate, box))
      ) {
        break;
      }
    }
    label.x = chosenPosition.x;
    label.y = chosenPosition.y;
    occupied.push(chosen);
  }
  return resolved;
}

function labelPlacementOffsets(): readonly [number, number][] {
  const result: [number, number][] = [[0, 0]];
  for (const distance of [34, 68, 102]) {
    result.push(
      [0, -distance], [0, distance],
      [distance, 0], [-distance, 0],
      [distance, -distance], [-distance, -distance],
      [distance, distance], [-distance, distance],
    );
  }
  return result;
}

function labelBox(label: BoardLabel): LayoutBox {
  const fontSize = label.fontSize ?? 31;
  const width = Math.max(fontSize * 0.65, label.text.length * fontSize * 0.58);
  const x = label.anchor === "end"
    ? label.x - width
    : label.anchor === "middle"
      ? label.x - width / 2
      : label.x;
  return { x, y: label.y - fontSize, width, height: fontSize * 1.25 };
}

function clampLabelToCanvas(label: BoardLabel, canvas: LayoutBox): void {
  const box = labelBox(label);
  const dx = box.x < canvas.x
    ? canvas.x - box.x
    : box.x + box.width > canvas.x + canvas.width
      ? canvas.x + canvas.width - box.x - box.width
      : 0;
  const dy = box.y < canvas.y
    ? canvas.y - box.y
    : box.y + box.height > canvas.y + canvas.height
      ? canvas.y + canvas.height - box.y - box.height
      : 0;
  label.x += dx;
  label.y += dy;
}

function boxesOverlap(left: LayoutBox, right: LayoutBox): boolean {
  const padding = 8;
  return left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y;
}

function diagramPoint(
  point: readonly [number, number],
  canvas: LayoutBox,
): [number, number] {
  return [canvas.x + point[0] * canvas.width, canvas.y + point[1] * canvas.height];
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function normalizePaths(
  paths: PathInfo[],
  revealGroup?: number,
  revealWeight?: number,
): BoardPath[] {
  return paths.map((path) => ({
    d: path.d,
    stroke: path.stroke || "#2b2e36",
    strokeWidth: path.strokeWidth || 4,
    fill: path.fill && path.fill !== "none" ? path.fill : "none",
    ...(revealGroup === undefined ? {} : { revealGroup }),
    ...(revealWeight === undefined ? {} : { revealWeight }),
  }));
}

function polylineLength(points: readonly [number, number][]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [x, y] = points[index];
    length += Math.hypot(x - previousX, y - previousY);
  }
  return Math.max(1, length);
}

function paddedPointBounds(points: readonly [number, number][], padding = 18): LayoutBox {
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

export function stableSeed(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) || 1;
}
