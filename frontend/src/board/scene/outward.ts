import type { BoardLabel } from "../geometry";
import type { PlacedMark } from "./expand";
import type { FrameTransform } from "./frame";
import { labelBounds } from "./labelSolver";
import type { RenderedMark } from "./marks";
import { distanceToPolyline, pointInPolygon, type Pixel } from "./refs";

/**
 * Outward label anchors for figure frames.
 *
 * A hand naming parts of a figure writes where the next strokes will not go.
 * Later constructions (medians, radii, chords, resultants) go inside a
 * figure and grow out of what is already drawn, so:
 * - a point on a closed outline is named outside that outline;
 * - a point inside one (a centre, a centroid) is named on the side facing
 *   away from the ink already drawn around it;
 * - in a frameless figure, any other point or side label faces away from the
 *   window's centre, the middle of what the author planned to draw.
 * This runs after an element's marks render, over the figure ink drawn so far
 * (a point listed before its polygon still sees it); the board-wide solver
 * then resolves collisions from these anchors.
 */

const ON_OUTLINE_PX = 3;
const POINT_GAP = 12;
const SIDE_GAP = 10;
/** Near the window's centre "away" means nothing: keep the natural anchor. */
const CENTRE_DEAD_ZONE = 0.15;
/** Ink this close to an inside point decides which side is clear. */
const NEARBY_PX = 90;
/** Ink within the point's own dot says nothing about direction. */
const DOT_PX = 10;
/** Nearby ink balanced around the point (a centroid where medians cross) leaves no clear side. */
const MIN_IMBALANCE = 0.2;

export type LabelSide = "outside" | "away";

export interface FigureInk {
  /** Ideal centre-lines drawn in the frame so far, this element included. */
  ink: readonly (readonly Pixel[])[];
  /** The closed ones among them. */
  outlines: readonly (readonly Pixel[])[];
}

export function closedOutlines(polylines: readonly (readonly Pixel[])[]): Pixel[][] {
  return polylines
    .filter((line) => line.length >= 4 && distance(line[0], line.at(-1)!) < 0.5)
    .map((line) => [...line]);
}

export function withOutwardLabels(
  item: PlacedMark,
  mark: RenderedMark,
  figure: FigureInk,
  frame: FrameTransform,
  side: LabelSide,
): RenderedMark {
  const movable = mark.labels.filter((label) => label.autoPlace && label.mobility === undefined);
  if (movable.length === 0) return mark;
  const { outlines } = figure;
  const centre = side === "away" ? windowCentre(frame) : undefined;

  let place: ((label: BoardLabel) => BoardLabel) | undefined;
  if (item.mark.kind === "point" && mark.handle.point) {
    const point = mark.handle.point;
    const around = outlines.filter((outline) => distanceToPolyline(point, outline) <= ON_OUTLINE_PX);
    const direction = around.length > 0
      ? awayFrom(point, average(around.map(centroid)), 1)
      : outlines.some((outline) => pointInPolygon(outline, point))
        ? clearSide(point, figure.ink)
        : centre && awayFrom(point, centre, deadZone(frame));
    if (direction) place = (label) => toward(label, point, direction, POINT_GAP);
  } else if ((item.mark.kind === "line" || item.mark.kind === "vector") && mark.handle.polylines[0]?.length === 2) {
    const [start, end] = mark.handle.polylines[0];
    const shared = outlines.filter((outline) =>
      distanceToPolyline(start, outline) <= ON_OUTLINE_PX && distanceToPolyline(end, outline) <= ON_OUTLINE_PX);
    const from = shared.length > 0 ? average(shared.map(centroid)) : centre;
    const normal = from && sideAwayFrom(start, end, from, shared.length > 0 ? 1 : deadZone(frame));
    if (normal) {
      const middle: Pixel = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      place = (label) => toward(label, middle, normal, SIDE_GAP);
    }
  }
  if (!place) return mark;
  return {
    ...mark,
    labels: mark.labels.map((label) => (movable.includes(label) ? place(label) : label)),
  };
}

/** The label's box placed with its edge `gap` px from `at` along the unit `direction`. */
function toward(label: BoardLabel, at: Pixel, direction: Pixel, gap: number): BoardLabel {
  const box = labelBounds({ text: label.text, x: 0, y: 0, anchor: "middle", fontSize: label.fontSize });
  // Distance from the box centre to its edge along `direction`.
  const reach = (Math.abs(direction[0]) * box.width + Math.abs(direction[1]) * box.height) / 2;
  return {
    ...label,
    x: at[0] + direction[0] * (gap + reach),
    y: at[1] + direction[1] * (gap + reach) - (box.y + box.height / 2),
    anchor: "middle",
  };
}

/** The direction from `point` opposite the ink drawn close around it, if that ink leans one way. */
function clearSide(point: Pixel, ink: readonly (readonly Pixel[])[]): Pixel | undefined {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const line of ink) {
    for (let index = 1; index < line.length; index += 1) {
      const [ax, ay] = line[index - 1];
      const [bx, by] = line[index];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
      for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
        const x = ax + ((bx - ax) * step) / steps;
        const y = ay + ((by - ay) * step) / steps;
        const reach = Math.hypot(x - point[0], y - point[1]);
        if (reach <= DOT_PX || reach > NEARBY_PX) continue;
        // Unit vectors, so a long stroke counts by its spread, not its distance.
        sumX += (x - point[0]) / reach;
        sumY += (y - point[1]) / reach;
        count += 1;
      }
    }
  }
  if (count === 0) return undefined;
  const lean = Math.hypot(sumX, sumY) / count;
  return lean < MIN_IMBALANCE ? undefined : [-sumX / (lean * count), -sumY / (lean * count)];
}

/** Unit vector from `from` through `point`, if they are at least `minimum` px apart. */
function awayFrom(point: Pixel, from: Pixel, minimum: number): Pixel | undefined {
  const length = distance(point, from);
  return length < minimum ? undefined : [(point[0] - from[0]) / length, (point[1] - from[1]) / length];
}

/** The segment's unit normal on the side away from `from`; none when `from` is (nearly) on its line. */
function sideAwayFrom(start: Pixel, end: Pixel, from: Pixel, minimum: number): Pixel | undefined {
  const length = distance(start, end);
  if (length < 1) return undefined;
  const normal: Pixel = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
  const facing = normal[0] * (from[0] - start[0]) + normal[1] * (from[1] - start[1]);
  if (Math.abs(facing) < minimum) return undefined;
  return facing > 0 ? [-normal[0], -normal[1]] : normal;
}

function windowCentre(frame: FrameTransform): Pixel {
  const { x, y } = frame.frame.window;
  return frame.toPixel([(x[0] + x[1]) / 2, (y[0] + y[1]) / 2]);
}

function deadZone(frame: FrameTransform): number {
  const { width, height } = frame.frame.box;
  return (CENTRE_DEAD_ZONE * Math.hypot(width, height)) / 2;
}

/** Mean of a closed outline's points (the closing point counted once). */
function centroid(outline: readonly Pixel[]): Pixel {
  return average(outline.slice(0, -1));
}

function average(points: readonly Pixel[]): Pixel {
  const sum = points.reduce<[number, number]>((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function distance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
