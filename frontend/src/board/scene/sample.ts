import { compileSafeExpression } from "../expression";
import type { AxesOp, CurveOp } from "../lesson.generated";
import type { CoordinateWindow } from "./types";

/**
 * Sampling for function-like marks through the one locked-down expression
 * compiler (`expression.ts`), with one free variable per mark kind:
 * `x` for y(x), `t` for x(t)/y(t), `theta` for r(θ). Samples are frame
 * coordinates; `visibleSegments` keeps only the parts inside the window.
 */

export type SamplePoint = [number, number];

export const FUNCTION_SAMPLES = 121;
export const CURVE_SAMPLES = 181;

export function sampleFunction(
  expr: string,
  domain: readonly [number, number],
  count = FUNCTION_SAMPLES,
): SamplePoint[] {
  return compileSafeExpression(expr, "x").sample(domain, count);
}

export function sampleParametric(
  x: string,
  y: string,
  range: readonly [number, number],
  count = CURVE_SAMPLES,
): SamplePoint[] {
  const xs = compileSafeExpression(x, "t").sample(range, count);
  const ys = compileSafeExpression(y, "t").sample(range, count);
  return xs.map(([, value], index) => [value, ys[index][1]]);
}

export function samplePolar(
  r: string,
  range: readonly [number, number],
  count = CURVE_SAMPLES,
): SamplePoint[] {
  return compileSafeExpression(r, "theta")
    .sample(range, count)
    .map(([theta, radius]) => [radius * Math.cos(theta), radius * Math.sin(theta)]);
}

/** Maximal runs of at least two consecutive samples inside the window (inclusive). */
export function visibleSegments(
  points: readonly SamplePoint[],
  window: CoordinateWindow,
): SamplePoint[][] {
  const segments: SamplePoint[][] = [];
  let segment: SamplePoint[] = [];
  const flush = () => {
    if (segment.length >= 2) segments.push(segment);
    segment = [];
  };
  for (const point of points) {
    const [x, y] = point;
    if (x >= window.x[0] && x <= window.x[1] && y >= window.y[0] && y <= window.y[1]) {
      segment.push(point);
    } else {
      flush();
    }
  }
  flush();
  return segments;
}

/** A schema curve on its axes: the visible pieces of y(x) in data coordinates. */
export function sampleVisibleCurveSegments(
  curve: Pick<CurveOp, "expr" | "domain">,
  axes: Pick<AxesOp, "x" | "y">,
): SamplePoint[][] {
  const window: CoordinateWindow = {
    x: [axes.x.min, axes.x.max],
    y: [axes.y.min, axes.y.max],
  };
  return visibleSegments(sampleFunction(curve.expr, curve.domain ?? window.x), window);
}
