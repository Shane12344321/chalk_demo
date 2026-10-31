/**
 * Manim-style morph between drawn ink (see docs/research/manim-study.md).
 * Paths become cubic Bezier subpaths, are aligned once (subpaths sorted by
 * length, missing ones padded with a degenerate subpath, curve counts
 * equalised by length-aware de Casteljau subdivision), and then interpolate
 * pointwise. Alignment happens at geometry preparation (Manim's
 * `Animation.begin`); each frame is a pure function of alpha, so a morph is
 * driven by op progress and freezes and resumes like every other reveal.
 * Ink is never re-roughened per frame: at alpha 1 the renderer shows the
 * target's own seeded rough.js paths.
 */
export type Point = readonly [number, number];
export type Cubic = readonly [Point, Point, Point, Point];
export type Subpath = readonly Cubic[];

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const line = (a: Point, b: Point): Cubic => [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];

/** Absolute M/L/H/V/C/Q/Z only (what rough.js emits); anything else throws so callers can fall back. */
export function parseCubicPath(d: string): Subpath[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const subpaths: Cubic[][] = [];
  let index = 0;
  let command = "";
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  const num = () => Number(tokens[index++]);
  const pt = (): Point => [num(), num()];
  const push = (cubic: Cubic) => { subpaths[subpaths.length - 1]?.push(cubic); at = cubic[3]; };
  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    if (command === "M") { at = start = pt(); subpaths.push([]); command = "L"; }
    else if (command === "L") push(line(at, pt()));
    else if (command === "H") push(line(at, [num(), at[1]]));
    else if (command === "V") push(line(at, [at[0], num()]));
    else if (command === "C") push([at, pt(), pt(), pt()]);
    else if (command === "Q") { const q = pt(); const end = pt(); push([at, lerp(at, q, 2 / 3), lerp(end, q, 2 / 3), end]); }
    else if (command === "Z") { if (dist(at, start) > 1e-9) push(line(at, start)); command = ""; }
    else throw new Error(`pathMorph: unsupported path command "${command}"`);
  }
  return subpaths.filter((subpath) => subpath.length > 0);
}

/** De Casteljau: the part of `c` between parameters t0 < t1. */
function cubicSegment(c: Cubic, t0: number, t1: number): Cubic {
  const split = (k: Cubic, t: number): [Cubic, Cubic] => {
    const [a, b, e] = [lerp(k[0], k[1], t), lerp(k[1], k[2], t), lerp(k[2], k[3], t)];
    const [f, g] = [lerp(a, b, t), lerp(b, e, t)];
    const m = lerp(f, g, t);
    return [[k[0], a, f, m], [m, g, e, k[3]]];
  };
  const left = t1 >= 1 ? c : split(c, t1)[0];
  return t0 <= 0 ? left : split(left, t0 / t1)[1];
}

/** Add n curves, each cut going to the curve whose pieces are currently longest. */
export function insertCurves(subpath: Subpath, n: number): Subpath {
  const lengths = subpath.map((c) => dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]));
  const counts = subpath.map(() => 1);
  for (let k = 0; k < n; k += 1) {
    let best = 0;
    for (let i = 1; i < counts.length; i += 1) {
      if (lengths[i] / counts[i] > lengths[best] / counts[best]) best = i;
    }
    counts[best] += 1;
  }
  return subpath.flatMap((c, i) =>
    Array.from({ length: counts[i] }, (_, j) => cubicSegment(c, j / counts[i], (j + 1) / counts[i])),
  );
}

const subpathLength = (s: Subpath) => s.reduce((sum, c) => sum + dist(c[0], c[3]), 0);

/** Equal subpath counts and equal curve counts per subpath, so points pair up one to one. */
export function alignPaths(from: Subpath[], to: Subpath[]): [Subpath[], Subpath[]] {
  const [a, b] = [from, to].map((s) => [...s].sort((x, y) => subpathLength(y) - subpathLength(x)));
  const pad = (s: Subpath[], n: number): Subpath => {
    const p = s[s.length - 1]?.at(-1)?.[3] ?? [0, 0];
    return n < s.length ? s[n] : [[p, p, p, p]];
  };
  const out: [Subpath[], Subpath[]] = [[], []];
  for (let n = 0; n < Math.max(a.length, b.length); n += 1) {
    const [x, y] = [pad(a, n), pad(b, n)];
    out[0].push(insertCurves(x, Math.max(0, y.length - x.length)));
    out[1].push(insertCurves(y, Math.max(0, x.length - y.length)));
  }
  return out;
}

const fmt = (p: Point) => `${+p[0].toFixed(3)} ${+p[1].toFixed(3)}`;
export function toPathData(subpaths: readonly Subpath[]): string {
  return subpaths
    .map((s) => `M${fmt(s[0][0])}${s.map((c) => ` C${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])}`).join("")}`)
    .join(" ");
}

/** Align once (Manim's Animation.begin), then interpolate per frame. Endpoints return the inputs verbatim. */
export function createPathMorph(fromD: string, toD: string): (alpha: number) => string {
  const [a, b] = alignPaths(parseCubicPath(fromD), parseCubicPath(toD));
  return (alpha) => {
    if (!(alpha > 0)) return fromD;
    if (alpha >= 1) return toD;
    return toPathData(a.map((s, i) => s.map((c, j) => c.map((p, k) => lerp(p, b[i][j][k], alpha)) as unknown as Cubic)));
  };
}

/** The cubic Bezier subpaths of path data (absolute commands, as rough.js emits). */
export function cubicSubpaths(d: string): Subpath[] {
  return parseCubicPath(d);
}

/** Two inks aligned once: equal subpath counts and equal curve counts per pair. */
export interface AlignedMorph {
  from: Subpath[];
  to: Subpath[];
}

/** Align every stroke of the source ink with every stroke of the target ink. */
export function alignInk(fromPaths: readonly string[], toPaths: readonly string[]): AlignedMorph {
  const [from, to] = alignPaths(fromPaths.flatMap(parseCubicPath), toPaths.flatMap(parseCubicPath));
  return { from, to };
}

/** Path data of an aligned morph at alpha (clamped to [0, 1]); pure in alpha. */
export function morphAt(aligned: AlignedMorph, alpha: number): string {
  const t = Math.min(1, Math.max(0, alpha));
  return toPathData(
    aligned.from.map((subpath, i) =>
      subpath.map((cubic, j) => cubic.map((point, k) => lerp(point, aligned.to[i][j][k], t)) as unknown as Cubic),
    ),
  );
}
