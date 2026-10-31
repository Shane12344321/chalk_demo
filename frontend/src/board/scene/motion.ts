/**
 * Motion core: Manim's `interpolate(alpha)` contract on CHALK's clock.
 *
 * Every visual effect is a pure function of op progress, which the sync
 * reducer advances only while teaching. Freezing therefore costs nothing and
 * resuming continues from the same frame (see docs/research/manim-study.md).
 * Durations never come from the model: a step's time is split across its ops
 * by weight, and an element's time across its stroke groups by weight, both
 * with Manim's `lag_ratio` stagger (`lag = 1` is strictly one after another).
 */

export type RateName =
  | "linear"
  | "smooth"
  | "ease_in_out"
  | "there_and_back"
  | "rush_into"
  | "rush_from";

export type Rate = (t: number) => number;

/** Manim's `smooth`: quintic smoothstep, zero first and second derivatives at both ends. */
function smooth(t: number): number {
  const s = 1 - t;
  return t ** 3 * (10 * s * s + 5 * s * t + t * t);
}

const RATES: Record<RateName, Rate> = {
  linear: (t) => t,
  smooth,
  // The hand-drawn stroke default: cubic ease that accelerates out of the
  // start and settles into the end, with exact endpoints.
  ease_in_out: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  there_and_back: (t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t)),
  rush_into: (t) => 2 * smooth(t / 2),
  rush_from: (t) => 2 * smooth(t / 2 + 0.5) - 1,
};

export const RATE_NAMES = Object.keys(RATES) as RateName[];

export function rate(name: RateName): Rate {
  return RATES[name];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Manim `lag_ratio` over weighted parts. Part `i` occupies
 * `[lag·Σw<i, lag·Σw<i + w_i]` of the whole; the result is that part's own
 * progress at `alpha`. With `lag = 1` the parts run strictly in turn (how a
 * step's ops and an element's stroke groups have always been timed).
 */
export function staggerProgress(
  weights: readonly number[],
  index: number,
  alpha: number,
  lag = 1,
): number {
  let cursor = 0;
  let end = 0;
  let start: number | undefined;
  weights.forEach((weight, position) => {
    const partStart = lag === 1 ? cursor : lag * cursor;
    if (position === index) start = partStart;
    end = Math.max(end, partStart + weight);
    cursor += weight;
  });
  const own = weights[index] ?? 1;
  return clamp01((clamp01(alpha) * end - (start ?? (lag === 1 ? cursor : lag * cursor))) / own);
}

export interface StaggeredPath {
  revealGroup?: number;
  revealWeight?: number;
}

/**
 * Reveal of one stroke group inside an element: groups run in ascending
 * order, each weighted by its heaviest stroke, then the rate is applied to
 * the group's own progress (Manim applies `rate_func` to the sub-alpha).
 */
export function groupRevealProgress(
  paths: readonly StaggeredPath[],
  revealGroup: number,
  progress: number,
  rateName: RateName = "ease_in_out",
  lag = 1,
): number {
  const groups = new Map<number, number>();
  for (const path of paths) {
    if (path.revealGroup === undefined) continue;
    groups.set(
      path.revealGroup,
      Math.max(groups.get(path.revealGroup) ?? 0, path.revealWeight ?? 1),
    );
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => left - right);
  const total = ordered.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return clamp01(progress);
  const index = ordered.findIndex(([group]) => group === revealGroup);
  if (index >= 0) {
    return rate(rateName)(staggerProgress(ordered.map(([, weight]) => weight), index, progress, lag));
  }
  // A group with no strokes of its own starts after every lower group.
  const before = ordered
    .filter(([group]) => group < revealGroup)
    .reduce((sum, [, weight]) => sum + weight, 0);
  return rate(rateName)(clamp01((progress * total - before) / 1));
}

/** Reveal of one stroke: its group's reveal, or the whole element's when ungrouped. */
export function strokeRevealProgress(
  paths: readonly StaggeredPath[],
  path: StaggeredPath,
  progress: number,
  rateName: RateName = "ease_in_out",
  lag = 1,
): number {
  if (path.revealGroup === undefined) return rate(rateName)(clamp01(progress));
  return groupRevealProgress(paths, path.revealGroup, progress, rateName, lag);
}

/**
 * How an element arrives, in Manim's names. Phase 3 puts these on the wire;
 * today only the scene IR can request anything other than `create`.
 */
export type Motion =
  /** Draw the strokes (Manim Create). */
  | { kind: "create"; rate?: RateName; lag?: number }
  | { kind: "fade_in"; rate?: RateName }
  /** Pulse to `scale` and back (Manim Indicate). */
  | { kind: "indicate"; scale?: number }
  /** Morph the ink of element `from` into this element's ink, taking over its place (Manim Transform). */
  | { kind: "transform"; from: string; rate?: RateName };

export interface MotionFrame {
  /** Stroke reveal progress before per-group stagger and rate. */
  draw: number;
  opacity: number;
  scale: number;
  /** Morph parameter while a transform runs; undefined otherwise. */
  morph?: number;
}

const REST: MotionFrame = { draw: 1, opacity: 1, scale: 1 };

/**
 * The element's visual state at op progress `alpha`: a pure function, so the
 * same alpha always renders the same frame however it was reached.
 */
export function interpolate(motion: Motion | undefined, alpha: number): MotionFrame {
  const t = clamp01(alpha);
  if (!motion || motion.kind === "create") return { ...REST, draw: t };
  if (motion.kind === "fade_in") return { ...REST, opacity: rate(motion.rate ?? "smooth")(t) };
  if (motion.kind === "indicate") {
    return { ...REST, scale: 1 + ((motion.scale ?? 1.2) - 1) * rate("there_and_back")(t) };
  }
  return t >= 1 ? REST : { ...REST, morph: rate(motion.rate ?? "smooth")(t) };
}
