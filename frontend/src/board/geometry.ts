import { axesFrame } from "./axesGeometry";
import {
  arcSamplePoints,
  arrowHeadPoints,
  cubicPath,
  diagramArcPoints,
  diagramPrimitiveBounds,
  diagramTextFontSize,
  mapDiagramPoint,
  sampleCubicSegments,
  smoothThroughPoints,
} from "./diagramGeometry";
import { frameTransform } from "./scene/frame";
import { renderFrame } from "./scene/marks";
import { sampleVisibleCurveSegments } from "./scene/sample";
import { renderSafeLatex } from "./latex";
import { EQUATION_BASE_FONT_PX } from "./equationSizing";
import {
  describeDiagramPrimitive,
  formatAxisValue,
  formatNumber,
  manifestPartId,
} from "./opDescriptions";
import {
  DIAGRAM_FILL,
  ellipseCircumference,
  inkGenerator,
  normalizePaths,
  padBox,
  paddedPointBounds,
  polylineLength,
  roughLinePaths,
  segmentLabel,
  stableSeed,
  styledLinePaths,
  styledPolylinePaths,
  type InkGenerator,
} from "./roughInk";
import { placeBoardLabels, type LabelMobility } from "./scene/labelSolver";
import type { AxesOp, DiagramOp, DiagramPrimitive, LessonOp } from "./lesson.generated";
import type { LaidOutOp, LayoutBox } from "./layout";
import type { AlignedMorph, Subpath } from "./scene/morph";
import type { Motion } from "./scene/motion";

export interface BoardPath {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
  revealGroup?: number;
  revealWeight?: number;
  /** Cubic Bezier subpaths of `d` (scene pipeline), shared by reveal and morph. */
  subpaths?: Subpath[];
  /** Closed outlines masked out of this path's fill (a shaded set minus others). */
  holes?: string[];
}

/** A morph aligned once at preparation; the target's own paths take over at progress 1. */
export interface BoardMorph extends AlignedMorph {
  stroke: string;
  strokeWidth: number;
}

export interface BoardLabel {
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  revealGroup?: number;
  fontSize?: number;
  autoPlace?: boolean;
  /** How far the board-wide label solver may move this label; see scene/labelSolver.ts. */
  mobility?: LabelMobility;
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
  /** How the element arrives over its op progress (scene pipeline); absent is a stroke reveal. */
  motion?: Motion;
  morph?: BoardMorph;
  /** Element whose ink this one replaces once its motion starts. */
  takesOver?: string;
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
    return { geometries: placeBoardLabels(geometries), warnings };
  }
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
      equationFontSize: EQUATION_BASE_FONT_PX,
      manifestSummary: `equation: ${op.latex}`,
    };
  }

  const generator = inkGenerator();

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
        labels: label ? [{ text: label, x: x + 16, y: y - 12, autoPlace: true }] : [],
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
      const points = stroke.map((point) => mapDiagramPoint(point, box));
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
      labels: rendered.flatMap(({ labels }) => labels),
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
    const from = mapDiagramPoint(op.from, canvas);
    const to = mapDiagramPoint(op.to, canvas);
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
    const [x, y] = mapDiagramPoint(op.at, canvas);
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
    const center = mapDiagramPoint(op.center, canvas);
    const radius = op.radius * Math.min(canvas.width, canvas.height);
    const points = arcSamplePoints(center, radius, radius, op.start_deg, op.end_deg);
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
    // The same frame renderer the scene pipeline uses: axes on the plot edges,
    // faint zero references, ticks, and titles.
    const frame = renderFrame(frameTransform(axesFrame(op, box)), generator);
    return {
      ...base,
      paths: frame.paths,
      manifestSummary: `axes: ${op.x.label} ${op.x.min} to ${op.x.max}; ${op.y.label} ${op.y.min} to ${op.y.max}`,
      labels: frame.labels,
    };
  }

  if (op.op !== "curve") {
    throw new Error(`Unsupported geometry operation ${op.id}.`);
  }
  const target = axes.get(op.axes_id);
  if (!target) throw new Error(`Curve ${op.id} has no laid-out axes.`);
  const plot = frameTransform(axesFrame(target.op, target.box));
  const sampledSegments = sampleVisibleCurveSegments(op, target.op);
  const visibleSegments = sampledSegments.map((segment) => segment.map(plot.toPixel));
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

function renderDiagramPrimitive(
  generator: InkGenerator,
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
            ...(primitive.fill ? { fill: DIAGRAM_FILL, fillStyle: "solid" } : {}),
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
            ...(primitive.fill ? { fill: DIAGRAM_FILL, fillStyle: "solid" } : {}),
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
    labels = [{ text: primitive.content, x, y, anchor, fontSize, mobility: "nudge" }];
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

export { formatAxisValue, stableSeed };
