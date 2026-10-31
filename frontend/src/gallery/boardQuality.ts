/**
 * Measured drawing-quality metrics for a rendered production board `<svg>`.
 *
 * All boxes are in logical board units (viewBox 0 0 1600 900), so results do
 * not depend on how large the board is drawn on screen. DOM reading is split
 * from analysis: `snapshotBoard` reads the SVG through an injectable
 * `BoardMeasurer`; `analyzeBoardSnapshot` is pure.
 */

export const BOARD_W = 1600;
export const BOARD_H = 900;
export const OVERLAP_RATIO_THRESHOLD = 0.12;
export const CLIP_TOLERANCE_PX = 1;
export const OUTSIDE_TOLERANCE_PX = 1;
export const MIN_EFFECTIVE_FONT_PX = 14;
export const SHORT_LAST_LINE_CHARS = 4;
/** Marks of these kinds are exempt from overlap with an axes/diagram that contains them. */
const PLOTTED_KINDS = new Set(["curve", "point", "line", "arrow", "angle_arc", "sketch", "figure"]);
const CONTAINER_KINDS = new Set(["axes", "diagram", "figure"]);
const CONTAINMENT_FRACTION = 0.9;
const INK_SAMPLE_STEP = 10;
const MAX_INK_SAMPLES = 600;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoardIssueType =
  | "overlap"
  | "clipped_equation"
  | "outside_board"
  | "small_text"
  | "short_last_line";

export const BOARD_ISSUE_TYPES: readonly BoardIssueType[] = [
  "overlap",
  "clipped_equation",
  "outside_board",
  "small_text",
  "short_last_line",
];

export interface BoardIssue {
  type: BoardIssueType;
  /** Offending element first; for overlaps, [text-bearing element, other element]. */
  elementIds: string[];
  /** Overlap ratio, overflow px, font px, or last-line length. Rounded. */
  value: number;
  detail: string;
}

export interface BoardQualityResult {
  elementCount: number;
  /** Union area of element boxes clipped to the board / board area. */
  coverage: number;
  issueCounts: Record<BoardIssueType, number>;
  issueTotal: number;
  issues: BoardIssue[];
}

export interface TextMarkSnapshot {
  role: "label" | "text";
  box: Box;
  fontSize?: number;
  lines: string[];
}

export interface EquationSnapshot {
  host: Box;
  /** Union of KaTeX `.base` runs; undefined if nothing laid out. */
  ink?: Box;
  fontSize?: number;
}

export interface ElementSnapshot {
  id: string;
  kind: string;
  /** Fine-grained ink cells (sampled along stroked paths). */
  ink: Box[];
  /** Whole-path bounding boxes, used for element extent. */
  inkBounds: Box[];
  texts: TextMarkSnapshot[];
  equation?: EquationSnapshot;
}

export interface BoardSnapshot {
  elements: ElementSnapshot[];
}

export interface BoardMeasurer {
  /** Box of an SVG or HTML element in board units. */
  box(element: Element): Box | undefined;
  /** Effective font size in board units. */
  fontSize(element: Element): number | undefined;
  /** Fine ink cells for a path, in board units. */
  inkCells(path: Element): Box[];
}

// ---------------------------------------------------------------- geometry

export function area(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function intersect(a: Box, b: Box): Box | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

export function boundingBox(boxes: readonly Box[]): Box | undefined {
  const valid = boxes.filter((box) => box.width >= 0 && box.height >= 0);
  if (valid.length === 0) return undefined;
  const x = Math.min(...valid.map((box) => box.x));
  const y = Math.min(...valid.map((box) => box.y));
  const right = Math.max(...valid.map((box) => box.x + box.width));
  const bottom = Math.max(...valid.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Exact union area of axis-aligned rectangles (x-slab sweep). */
export function unionArea(boxes: readonly Box[]): number {
  const rects = boxes.filter((box) => box.width > 0 && box.height > 0);
  if (rects.length === 0) return 0;
  const xs = [...new Set(rects.flatMap((box) => [box.x, box.x + box.width]))].sort((a, b) => a - b);
  let total = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index];
    const right = xs[index + 1];
    const intervals = rects
      .filter((box) => box.x <= left && box.x + box.width >= right)
      .map((box) => [box.y, box.y + box.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let start = -Infinity;
    let end = -Infinity;
    for (const [top, bottom] of intervals) {
      if (top > end) {
        if (end > start) covered += end - start;
        start = top;
        end = bottom;
      } else {
        end = Math.max(end, bottom);
      }
    }
    if (end > start) covered += end - start;
    total += covered * (right - left);
  }
  return total;
}

function containedFraction(inner: Box, outer: Box): number {
  const overlap = intersect(inner, outer);
  const innerArea = area(inner);
  if (innerArea === 0) {
    return inner.x >= outer.x && inner.x <= outer.x + outer.width &&
      inner.y >= outer.y && inner.y <= outer.y + outer.height ? 1 : 0;
  }
  return overlap ? area(overlap) / innerArea : 0;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------- analysis

interface Shape {
  /** One or more rectangles treated as a single mark. */
  boxes: Box[];
  area: number;
  bounds: Box;
}

function shapeOf(boxes: Box[]): Shape | undefined {
  const bounds = boundingBox(boxes);
  if (!bounds) return undefined;
  return { boxes, area: unionArea(boxes), bounds };
}

function overlapRatio(subject: Shape, other: Shape): number {
  if (!intersect(subject.bounds, other.bounds)) return 0;
  const smaller = Math.min(subject.area, other.area);
  if (smaller <= 0) return 0;
  const pieces: Box[] = [];
  for (const a of subject.boxes) {
    for (const b of other.boxes) {
      const piece = intersect(a, b);
      if (piece) pieces.push(piece);
    }
  }
  return unionArea(pieces) / smaller;
}

export function elementExtent(element: ElementSnapshot): Box | undefined {
  return boundingBox([
    ...element.inkBounds,
    ...element.texts.map((text) => text.box),
    ...(element.equation ? [element.equation.host] : []),
    ...(element.equation?.ink ? [element.equation.ink] : []),
  ]);
}

function textBearingShapes(element: ElementSnapshot): Shape[] {
  const shapes: Shape[] = [];
  for (const text of element.texts) {
    const shape = shapeOf([text.box]);
    if (shape) shapes.push(shape);
  }
  if (element.equation) {
    const shape = shapeOf([element.equation.ink ?? element.equation.host]);
    if (shape) shapes.push(shape);
  }
  return shapes;
}

function obstacleShapes(element: ElementSnapshot): Shape[] {
  const shapes = textBearingShapes(element);
  const ink = shapeOf(element.ink);
  if (ink) shapes.push(ink);
  return shapes;
}

function isPlottedInside(
  child: ElementSnapshot,
  childExtent: Box | undefined,
  container: ElementSnapshot,
  containerExtent: Box | undefined,
): boolean {
  return (
    PLOTTED_KINDS.has(child.kind) &&
    CONTAINER_KINDS.has(container.kind) &&
    childExtent !== undefined &&
    containerExtent !== undefined &&
    containedFraction(childExtent, containerExtent) >= CONTAINMENT_FRACTION
  );
}

export function analyzeBoardSnapshot(snapshot: BoardSnapshot): BoardQualityResult {
  const issues: BoardIssue[] = [];
  const elements = snapshot.elements;
  const extents = elements.map(elementExtent);
  const subjects = elements.map(textBearingShapes);
  const obstacles = elements.map(obstacleShapes);

  // Overlaps: each unordered pair reported once, with the worst ratio.
  const overlapByPair = new Map<string, BoardIssue>();
  for (let i = 0; i < elements.length; i += 1) {
    if (subjects[i].length === 0) continue;
    for (let j = 0; j < elements.length; j += 1) {
      if (i === j) continue;
      if (
        isPlottedInside(elements[i], extents[i], elements[j], extents[j]) ||
        isPlottedInside(elements[j], extents[j], elements[i], extents[i])
      ) {
        continue;
      }
      let worst = 0;
      for (const subject of subjects[i]) {
        for (const obstacle of obstacles[j]) {
          worst = Math.max(worst, overlapRatio(subject, obstacle));
        }
      }
      if (worst <= OVERLAP_RATIO_THRESHOLD) continue;
      const key = [elements[i].id, elements[j].id].sort().join("\u0000");
      const existing = overlapByPair.get(key);
      if (!existing) {
        const issue: BoardIssue = {
          type: "overlap",
          elementIds: [elements[i].id, elements[j].id],
          value: round(worst),
          detail: `${elements[i].id} overlaps ${elements[j].id} (${Math.round(worst * 100)}%)`,
        };
        overlapByPair.set(key, issue);
        issues.push(issue);
      } else if (round(worst) > existing.value) {
        existing.value = round(worst);
        existing.detail = `${existing.elementIds[0]} overlaps ${existing.elementIds[1]} (${Math.round(worst * 100)}%)`;
      }
    }
  }

  elements.forEach((element, index) => {
    const equation = element.equation;
    if (equation?.ink) {
      const overflowX = equation.ink.width - equation.host.width;
      const overflowY = equation.ink.height - equation.host.height;
      const overflow = Math.max(overflowX, overflowY);
      if (overflow > CLIP_TOLERANCE_PX) {
        issues.push({
          type: "clipped_equation",
          elementIds: [element.id],
          value: round(overflow, 1),
          detail: `${element.id} ink exceeds its box by ${overflowX.toFixed(1)}×${overflowY.toFixed(1)}px`,
        });
      }
    }

    const extent = extents[index];
    if (extent) {
      const beyond = Math.max(
        -extent.x,
        -extent.y,
        extent.x + extent.width - BOARD_W,
        extent.y + extent.height - BOARD_H,
      );
      if (beyond > OUTSIDE_TOLERANCE_PX) {
        issues.push({
          type: "outside_board",
          elementIds: [element.id],
          value: round(beyond, 1),
          detail: `${element.id} extends ${beyond.toFixed(1)}px beyond the board`,
        });
      }
    }

    const sizes = [
      ...element.texts.map((text) => text.fontSize),
      ...(equation ? [equation.fontSize] : []),
    ].filter((size): size is number => size !== undefined && Number.isFinite(size));
    if (sizes.length > 0) {
      const smallest = Math.min(...sizes);
      if (smallest < MIN_EFFECTIVE_FONT_PX) {
        issues.push({
          type: "small_text",
          elementIds: [element.id],
          value: round(smallest, 1),
          detail: `${element.id} renders at ${smallest.toFixed(1)}px`,
        });
      }
    }

    for (const text of element.texts) {
      if (text.role !== "text" || text.lines.length < 2) continue;
      const last = text.lines[text.lines.length - 1].trim();
      if (last.length <= SHORT_LAST_LINE_CHARS) {
        issues.push({
          type: "short_last_line",
          elementIds: [element.id],
          value: last.length,
          detail: `${element.id} wraps to a ${last.length}-character last line "${last}"`,
        });
      }
    }
  });

  const board: Box = { x: 0, y: 0, width: BOARD_W, height: BOARD_H };
  const clipped = extents
    .filter((box): box is Box => box !== undefined)
    .map((box) => intersect(box, board))
    .filter((box): box is Box => box !== undefined);
  const issueCounts = Object.fromEntries(
    BOARD_ISSUE_TYPES.map((type) => [type, issues.filter((issue) => issue.type === type).length]),
  ) as Record<BoardIssueType, number>;
  return {
    elementCount: elements.length,
    coverage: round(unionArea(clipped) / area(board), 4),
    issueCounts,
    issueTotal: issues.length,
    issues,
  };
}

// ---------------------------------------------------------------- DOM reading

/** Read the top-level `g[data-element-id]` groups of a production board. */
/** Fills at most this opaque are a background tint (`DIAGRAM_FILL` is 0.12). */
const TINT_MAX_ALPHA = 0.35;

/**
 * What a path puts on the board: nothing (an invisible reveal-timing path),
 * a translucent tint behind other marks, or ink. SVG's defaults apply: no
 * `stroke` attribute paints no stroke, no `fill` attribute fills black.
 */
function pathPaint(path: Element): "none" | "tint" | "ink" {
  const visible = (value: string | null) => value !== null && value !== "" && value !== "none" && value !== "transparent";
  if (visible(path.getAttribute("stroke"))) return "ink";
  const fill = path.getAttribute("fill");
  if (fill !== null && !visible(fill)) return "none";
  const alpha = fill === null ? 1 : Number(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/u.exec(fill)?.[1] ?? 1);
  return alpha <= TINT_MAX_ALPHA ? "tint" : "ink";
}

export function snapshotBoard(svg: SVGSVGElement, measurer: BoardMeasurer): BoardSnapshot {
  const elements: ElementSnapshot[] = [];
  const groups = Array.from(svg.querySelectorAll<SVGGElement>("g[data-element-id]")).filter(
    (group) => !group.parentElement?.closest("g[data-element-id]"),
  );
  for (const group of groups) {
    const id = group.getAttribute("data-element-id") ?? "";
    const kind = group.getAttribute("data-kind") ?? "unknown";
    const ink: Box[] = [];
    const inkBounds: Box[] = [];
    for (const path of group.querySelectorAll("path")) {
      // KaTeX draws radicals/arrows as nested <svg> paths inside the
      // equation's foreignObject; those are equation ink, not board ink.
      if (path.closest("clipPath, defs, marker, mask, foreignObject")) continue;
      const paint = pathPaint(path);
      if (paint === "none") continue;
      const bounds = measurer.box(path);
      if (bounds) inkBounds.push(bounds);
      // Text on a light tint stays legible: the tint is footprint, not an obstacle.
      if (paint === "ink") ink.push(...measurer.inkCells(path));
    }
    const texts: TextMarkSnapshot[] = [];
    // An element's labels render in the board's top label layer.
    const labelGroups = Array.from(svg.querySelectorAll<SVGGElement>("g[data-label-for]"))
      .filter((labels) => labels.getAttribute("data-label-for") === id);
    for (const text of [group, ...labelGroups].flatMap((owner) => Array.from(owner.querySelectorAll("text")))) {
      if (text.closest("clipPath, defs, foreignObject")) continue;
      const box = measurer.box(text);
      if (!box) continue;
      const tspans = Array.from(text.querySelectorAll("tspan"));
      const lines = tspans.length > 0
        ? tspans.map((tspan) => tspan.textContent ?? "")
        : [text.textContent ?? ""];
      const isLabel = text.getAttribute("data-board-mark") === "label";
      texts.push({
        role: isLabel ? "label" : "text",
        box,
        fontSize: measurer.fontSize(text),
        lines,
      });
    }
    let equation: EquationSnapshot | undefined;
    const host = group.querySelector(".board-equation");
    const foreignObject = host?.closest("foreignObject");
    if (host && foreignObject) {
      const hostBox = attributeBox(foreignObject) ?? measurer.box(host);
      if (hostBox) {
        const runs = Array.from(host.querySelectorAll(".katex-html .base"));
        const runBoxes = runs
          .map((run) => measurer.box(run))
          .filter((box): box is Box => box !== undefined && box.width > 0 && box.height > 0);
        const katex = host.querySelector(".katex");
        equation = {
          host: hostBox,
          ink: boundingBox(runBoxes),
          fontSize: measurer.fontSize(katex ?? host),
        };
      }
    }
    elements.push({ id, kind, ink, inkBounds, texts, ...(equation ? { equation } : {}) });
  }
  return { elements };
}

function attributeBox(element: Element): Box | undefined {
  const values = ["x", "y", "width", "height"].map((name) =>
    Number.parseFloat(element.getAttribute(name) ?? ""));
  if (!values.every(Number.isFinite)) return undefined;
  const [x, y, width, height] = values;
  return { x, y, width, height };
}

/** Browser measurer: SVG `getBBox` in user units, HTML rects mapped via the screen CTM. */
export function createDomMeasurer(svg: SVGSVGElement): BoardMeasurer {
  const inverse = svg.getScreenCTM()?.inverse();
  const toBoard = (x: number, y: number) => {
    if (!inverse) return { x, y };
    const point = new DOMPoint(x, y).matrixTransform(inverse);
    return { x: point.x, y: point.y };
  };
  const bbox = (element: Element): Box | undefined => {
    try {
      const box = (element as SVGGraphicsElement).getBBox();
      return [box.x, box.y, box.width, box.height].every(Number.isFinite)
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    box(element) {
      if (element instanceof SVGGraphicsElement) return bbox(element);
      const rect = element.getBoundingClientRect();
      const topLeft = toBoard(rect.left, rect.top);
      const bottomRight = toBoard(rect.right, rect.bottom);
      return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      };
    },
    fontSize(element) {
      // CSS px inside the SVG (and its foreignObject) are board user units.
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      return Number.isFinite(size) ? size : undefined;
    },
    inkCells(path) {
      const bounds = bbox(path);
      if (!bounds) return [];
      const fill = path.getAttribute("fill");
      const geometry = path as SVGPathElement;
      if ((fill && fill !== "none" && fill !== "transparent") || typeof geometry.getTotalLength !== "function") {
        return [bounds];
      }
      let total: number;
      try {
        total = geometry.getTotalLength();
      } catch {
        return [bounds];
      }
      if (!(total > 0)) return [bounds];
      const step = Math.max(INK_SAMPLE_STEP, total / MAX_INK_SAMPLES);
      const strokeWidth = Number.parseFloat(path.getAttribute("stroke-width") ?? "") || 2;
      const half = Math.max(step, strokeWidth) / 2;
      const cells: Box[] = [];
      for (let distance = 0; distance <= total; distance += step) {
        const point = geometry.getPointAtLength(distance);
        cells.push({ x: point.x - half, y: point.y - half, width: half * 2, height: half * 2 });
      }
      return cells;
    },
  };
}

/** Measure a rendered production board. Call after fonts and layout effects settle. */
export function measureBoardQuality(
  svg: SVGSVGElement,
  measurer: BoardMeasurer = createDomMeasurer(svg),
): BoardQualityResult {
  return analyzeBoardSnapshot(snapshotBoard(svg, measurer));
}
