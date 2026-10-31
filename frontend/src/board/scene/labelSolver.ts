import { LABEL_CHARACTER_EM } from "../diagramGeometry";
import type { BoardGeometry } from "../geometry";
import type { LayoutBox } from "../layout";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../layout";

/**
 * One label placement pass for the whole board.
 *
 * Every label states only what it wants (a preferred position and how far it
 * may move); this solver decides where it goes, with one cost function for
 * every element kind. Labels are placed in commit order against the ink,
 * text blocks, and labels committed before them, so a later step can never
 * move an earlier label (prefix stability by construction).
 */

export type LabelMobility = "fixed" | "nudge" | "free";

export interface SolverLabel {
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  fontSize?: number;
  mobility: LabelMobility;
}

export interface SolverElement {
  /** Ink of this element as polylines in board coordinates. */
  ink: readonly (readonly [number, number])[][];
  /** Solid blocks such as typeset text or equations that labels must avoid. */
  blocks: readonly LayoutBox[];
  labels: readonly SolverLabel[];
  /**
   * Elements sharing a step commit together, so their labels also avoid the
   * ink of later ops in that step (still prefix-stable: a step is atomic).
   */
  step?: number;
}

export interface PlacedLabel extends SolverLabel {
  moved: boolean;
}

const CELL = 48;
const BOARD_MARGIN = 4;
const LABEL_PADDING = 6;
const NUDGE_RADIUS = 110;
const FREE_RADIUS = 150;
const MIN_FONT = 22;

export function labelBounds(label: Pick<SolverLabel, "text" | "x" | "y" | "anchor" | "fontSize">): LayoutBox {
  const fontSize = label.fontSize ?? 31;
  const width = Math.max(fontSize * 0.65, label.text.length * fontSize * LABEL_CHARACTER_EM);
  const left = label.anchor === "middle"
    ? label.x - width / 2
    : label.anchor === "end"
      ? label.x - width
      : label.x;
  return { x: left, y: label.y - fontSize, width, height: fontSize * 1.25 };
}

/** Segment index over a uniform grid so candidate scoring stays cheap. */
export class InkIndex {
  private readonly cells = new Map<string, Array<[number, number, number, number]>>();

  add(polyline: readonly (readonly [number, number])[]): void {
    for (let index = 1; index < polyline.length; index += 1) {
      const [x1, y1] = polyline[index - 1];
      const [x2, y2] = polyline[index];
      const segment: [number, number, number, number] = [x1, y1, x2, y2];
      for (const key of this.keysFor(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2))) {
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  /** Number of distinct ink segments crossing the box. */
  hits(box: LayoutBox): number {
    const seen = new Set<[number, number, number, number]>();
    for (const key of this.keysFor(box.x, box.y, box.x + box.width, box.y + box.height)) {
      for (const segment of this.cells.get(key) ?? []) {
        if (!seen.has(segment) && segmentTouchesBox(segment, box)) seen.add(segment);
      }
    }
    return seen.size;
  }

  private *keysFor(left: number, top: number, right: number, bottom: number): Generator<string> {
    for (let cx = Math.floor(left / CELL); cx <= Math.floor(right / CELL); cx += 1) {
      for (let cy = Math.floor(top / CELL); cy <= Math.floor(bottom / CELL); cy += 1) {
        yield `${cx}:${cy}`;
      }
    }
  }
}

export function solveLabels(elements: readonly SolverElement[]): PlacedLabel[][] {
  const ink = new InkIndex();
  const blocks: LayoutBox[] = [];
  const placedBoxes: LayoutBox[] = [];
  const result: PlacedLabel[][] = [];

  elements.forEach((element, elementIndex) => {
    // An element's own ink and blocks commit with it, so its labels avoid them
    // too; so does the ink of every later op of the same step.
    const startsStep = elementIndex === 0 || element.step === undefined ||
      element.step !== elements[elementIndex - 1].step;
    if (startsStep) {
      for (let next = elementIndex; next < elements.length; next += 1) {
        const member = elements[next];
        if (next > elementIndex && (member.step === undefined || member.step !== element.step)) break;
        for (const polyline of member.ink) ink.add(polyline);
        blocks.push(...member.blocks);
      }
    }
    // Fixed labels (tick values, positioned writing) go down first so the
    // labels that may move can avoid them, whatever order they were listed in.
    const order = element.labels
      .map((_, index) => index)
      .sort((left, right) =>
        MOBILITY_RANK[element.labels[left].mobility] - MOBILITY_RANK[element.labels[right].mobility] ||
        left - right);
    const placed: PlacedLabel[] = new Array(element.labels.length);
    for (const index of order) {
      const chosen = placeLabel(element.labels[index], ink, blocks, placedBoxes);
      placed[index] = chosen;
      placedBoxes.push(inflate(labelBounds(chosen), LABEL_PADDING));
    }
    result.push(placed);
  });
  return result;
}

const MOBILITY_RANK: Record<LabelMobility, number> = { fixed: 0, nudge: 1, free: 2 };

/** The label shifted just enough to sit fully on the board (itself when it already does). */
function onBoard(label: SolverLabel): SolverLabel {
  const box = labelBounds(label);
  const dx = box.x < BOARD_MARGIN
    ? BOARD_MARGIN - box.x
    : box.x + box.width > BOARD_WIDTH - BOARD_MARGIN
      ? BOARD_WIDTH - BOARD_MARGIN - (box.x + box.width)
      : 0;
  const dy = box.y < BOARD_MARGIN
    ? BOARD_MARGIN - box.y
    : box.y + box.height > BOARD_HEIGHT - BOARD_MARGIN
      ? BOARD_HEIGHT - BOARD_MARGIN - (box.y + box.height)
      : 0;
  return dx === 0 && dy === 0 ? label : { ...label, x: label.x + dx, y: label.y + dy };
}

const inkCache = new WeakMap<BoardGeometry, Array<Array<[number, number]>>>();

/** Visible ink of a geometry as board-space polylines (cached per geometry). */
export function geometryInk(geometry: BoardGeometry): Array<Array<[number, number]>> {
  let ink = inkCache.get(geometry);
  if (!ink) {
    ink = geometry.paths
      .filter((path) => path.stroke !== "transparent")
      .flatMap((path) => pathToPolylines(path.d));
    inkCache.set(geometry, ink);
  }
  return ink;
}

/**
 * Place every label on the board with one solver, in commit order. Geometry
 * builders only state a preferred position and a mobility; collisions with
 * any element's ink, typeset blocks, or earlier labels are resolved here.
 */
export function placeBoardLabels(geometries: readonly BoardGeometry[]): BoardGeometry[] {
  const solved = solveLabels(
    geometries.map((geometry) => ({
      ink: geometryInk(geometry),
      blocks: geometry.kind === "text" || geometry.kind === "equation" ? [geometry.box] : [],
      step: geometry.stepIndex,
      labels: geometry.labels.map((label) => ({
        text: label.text,
        x: label.x,
        y: label.y,
        anchor: label.anchor,
        fontSize: label.fontSize,
        mobility: label.mobility ?? (label.autoPlace ? "free" : "fixed"),
      })),
    })),
  );
  return geometries.map((geometry, index) => {
    if (!solved[index].some((label) => label.moved)) return geometry;
    return {
      ...geometry,
      labels: geometry.labels.map((label, labelIndex) => {
        const placed = solved[index][labelIndex];
        if (!placed.moved) return label;
        return {
          ...label,
          x: placed.x,
          y: placed.y,
          ...(placed.fontSize === undefined ? {} : { fontSize: placed.fontSize }),
        };
      }),
    };
  });
}

function placeLabel(
  requested: SolverLabel,
  ink: InkIndex,
  blocks: readonly LayoutBox[],
  placed: readonly LayoutBox[],
): PlacedLabel {
  // Text past the board edge is never readable, so every label starts on the board.
  const label = onBoard(requested);
  const original: PlacedLabel = { ...label, moved: label !== requested };
  if (label.mobility === "fixed") return original;

  const radius = label.mobility === "free" ? FREE_RADIUS : NUDGE_RADIUS;
  const sizes = [label.fontSize, ...((label.fontSize ?? 31) > MIN_FONT + 2 ? [MIN_FONT] : [])];
  let best = { label: original, cost: cost(original, label, ink, blocks, placed) };
  if (best.cost === 0) return original;

  for (const fontSize of sizes) {
    for (const [dx, dy] of candidateOffsets(radius)) {
      const candidate: PlacedLabel = {
        ...label,
        x: label.x + dx,
        y: label.y + dy,
        ...(fontSize === undefined ? {} : { fontSize }),
        moved: true,
      };
      const value = cost(candidate, label, ink, blocks, placed);
      if (value < best.cost) best = { label: candidate, cost: value };
    }
    // A clean spot at full size beats any spot at the smaller size.
    if (best.cost < OVERLAP_WEIGHT) break;
  }
  if (best.cost >= OVERLAP_WEIGHT) {
    // Nothing near is clear: a clean spot a little farther away reads better
    // than a collision, so widen the search once and take only a clean spot.
    for (const fontSize of sizes) {
      for (const [dx, dy] of candidateOffsets(WIDE_RADIUS)) {
        if (Math.hypot(dx, dy) <= radius) continue;
        const candidate: PlacedLabel = {
          ...label,
          x: label.x + dx,
          y: label.y + dy,
          ...(fontSize === undefined ? {} : { fontSize }),
          moved: true,
        };
        const value = cost(candidate, label, ink, blocks, placed);
        if (value < OVERLAP_WEIGHT && value < best.cost) best = { label: candidate, cost: value };
      }
      if (best.cost < OVERLAP_WEIGHT) break;
    }
  }
  return best.label;
}

const OVERLAP_WEIGHT = 1_000;
/**
 * Text stacked on text is unreadable, while a stroke crossing a label is not,
 * and one hand-drawn crossing already counts several ink segments; stacking
 * must cost more than any likely crossing.
 */
const STACK_WEIGHT = 8;
/** When nothing near is clear, look this far before accepting a collision. */
const WIDE_RADIUS = 210;

function cost(
  candidate: PlacedLabel,
  original: SolverLabel,
  ink: InkIndex,
  blocks: readonly LayoutBox[],
  placed: readonly LayoutBox[],
): number {
  const box = labelBounds(candidate);
  const offBoard =
    box.x < 4 || box.y < 4 || box.x + box.width > BOARD_WIDTH - 4 || box.y + box.height > BOARD_HEIGHT - 4;
  if (offBoard) return Number.POSITIVE_INFINITY;
  const padded = inflate(box, LABEL_PADDING);
  const collisions =
    ink.hits(padded) +
    blocks.filter((block) => overlaps(padded, block)).length * STACK_WEIGHT +
    placed.filter((other) => overlaps(padded, other)).length * STACK_WEIGHT;
  const distance = Math.hypot(candidate.x - original.x, candidate.y - original.y);
  const shrink = candidate.fontSize !== original.fontSize ? 40 : 0;
  return collisions * OVERLAP_WEIGHT + distance + shrink;
}

/** Rings of offsets ordered by distance, each ring trying 16 directions. */
function candidateOffsets(radius: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  for (let distance = 14; distance <= radius; distance += 14) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      offsets.push([Math.round(Math.cos(angle) * distance), Math.round(Math.sin(angle) * distance)]);
    }
  }
  return offsets;
}

function inflate(box: LayoutBox, amount: number): LayoutBox {
  return { x: box.x - amount, y: box.y - amount, width: box.width + amount * 2, height: box.height + amount * 2 };
}

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function segmentTouchesBox([x1, y1, x2, y2]: readonly number[], box: LayoutBox): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const inside = (x: number, y: number) => x >= left && x <= right && y >= top && y <= bottom;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  return (
    segmentsCross(x1, y1, x2, y2, left, top, right, top) ||
    segmentsCross(x1, y1, x2, y2, right, top, right, bottom) ||
    segmentsCross(x1, y1, x2, y2, left, bottom, right, bottom) ||
    segmentsCross(x1, y1, x2, y2, left, top, left, bottom)
  );
}

function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return (
    orient(ax, ay, bx, by, cx, cy) !== orient(ax, ay, bx, by, dx, dy) &&
    orient(cx, cy, dx, dy, ax, ay) !== orient(cx, cy, dx, dy, bx, by)
  );
}

/**
 * Flatten an SVG path (absolute M/L/H/V/C/Q/Z, as rough.js emits) into
 * polylines, sampling curves, so any ink kind can be collision-tested.
 */
export function pathToPolylines(d: string): Array<Array<[number, number]>> {
  const tokens = d.match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const lines: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let command = "";
  let index = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const next = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index];
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index += 1;
      if (command === "Z" || command === "z") {
        current.push([startX, startY]);
        x = startX;
        y = startY;
      }
      continue;
    }
    if (command === "M" || command === "m") {
      if (current.length > 1) lines.push(current);
      x = command === "m" ? x + next() : next();
      y = command === "m" ? y + next() : next();
      startX = x;
      startY = y;
      current = [[x, y]];
      command = command === "m" ? "l" : "L";
    } else if (command === "L" || command === "l") {
      x = command === "l" ? x + next() : next();
      y = command === "l" ? y + next() : next();
      current.push([x, y]);
    } else if (command === "H" || command === "h") {
      x = command === "h" ? x + next() : next();
      current.push([x, y]);
    } else if (command === "V" || command === "v") {
      y = command === "v" ? y + next() : next();
      current.push([x, y]);
    } else if (command === "C" || command === "c") {
      const relative = command === "c";
      const c1x = (relative ? x : 0) + next();
      const c1y = (relative ? y : 0) + next();
      const c2x = (relative ? x : 0) + next();
      const c2y = (relative ? y : 0) + next();
      const ex = (relative ? x : 0) + next();
      const ey = (relative ? y : 0) + next();
      for (let step = 1; step <= 6; step += 1) {
        const t = step / 6;
        const u = 1 - t;
        current.push([
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
      x = ex;
      y = ey;
    } else if (command === "Q" || command === "q") {
      const relative = command === "q";
      const cx = (relative ? x : 0) + next();
      const cy = (relative ? y : 0) + next();
      const ex = (relative ? x : 0) + next();
      const ey = (relative ? y : 0) + next();
      for (let step = 1; step <= 4; step += 1) {
        const t = step / 4;
        const u = 1 - t;
        current.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]);
      }
      x = ex;
      y = ey;
    } else {
      index += 1;
    }
  }
  if (current.length > 1) lines.push(current);
  return lines;
}
