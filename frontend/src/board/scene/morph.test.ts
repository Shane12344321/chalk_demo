import rough from "roughjs/bin/rough";
import { describe, expect, it } from "vitest";
import {
  alignInk,
  alignPaths,
  createPathMorph,
  insertCurves,
  morphAt,
  parseCubicPath,
  type Cubic,
  type Point,
} from "./morph";

const square = "M0 0 L100 0 L100 100 L0 100 Z";
const segment = "M0 50 L100 50";

function cubicAt(c: Cubic, t: number): Point {
  const s = 1 - t;
  return [0, 1].map((k) =>
    s ** 3 * c[0][k] + 3 * s * s * t * c[1][k] + 3 * s * t * t * c[2][k] + t ** 3 * c[3][k],
  ) as unknown as Point;
}

function numbers(d: string): number[] {
  return (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []).map(Number);
}

describe("pathMorph", () => {
  it("returns the exact input strings at the endpoints so committed ink never shifts", () => {
    const morph = createPathMorph(segment, square);
    expect(morph(0)).toBe(segment);
    expect(morph(-0.5)).toBe(segment);
    expect(morph(1)).toBe(square);
    expect(morph(1.2)).toBe(square);
  });

  it("aligns a one-curve segment and a four-curve square to the same structure", () => {
    const [a, b] = alignPaths(parseCubicPath(segment), parseCubicPath(square));
    expect(a.map((s) => s.length)).toEqual(b.map((s) => s.length));
    expect(a[0]).toHaveLength(4);
  });

  it("interpolates pointwise: halfway between two parallel lines is the middle line", () => {
    const mid = numbers(createPathMorph("M0 0 L100 0", "M0 40 L100 40")(0.5));
    const ys = mid.filter((_, index) => index % 2 === 1);
    expect(ys.every((y) => Math.abs(y - 20) < 1e-9)).toBe(true);
  });

  it("pads a missing subpath so different subpath counts still morph without NaN", () => {
    const twoStrokes = "M0 0 L50 0 M0 20 L50 20";
    const morph = createPathMorph("M0 0 L50 0", twoStrokes);
    const frame = morph(0.5);
    expect(frame.match(/M/g)).toHaveLength(2);
    expect(numbers(frame).every(Number.isFinite)).toBe(true);
  });

  it("subdivision keeps the original curve's shape", () => {
    const [curve] = parseCubicPath("M0 0 C30 90 70 -90 100 0")[0];
    const pieces = insertCurves([curve], 3);
    expect(pieces).toHaveLength(4);
    pieces.forEach((piece, index) => {
      const local = cubicAt(piece, 0.5);
      const global = cubicAt(curve, (index + 0.5) / 4);
      expect(Math.hypot(local[0] - global[0], local[1] - global[1])).toBeLessThan(1e-9);
    });
    expect(pieces[3][3]).toEqual(curve[3]);
  });

  it("is a pure function of alpha, independent of call history (freeze/resume safe)", () => {
    const morph = createPathMorph(segment, square);
    const fresh = createPathMorph(segment, square)(0.3);
    morph(0.9);
    morph(0.1);
    expect(morph(0.3)).toBe(fresh);
  });

  it("rejects commands outside the supported subset instead of drawing garbage", () => {
    expect(() => parseCubicPath("M0 0 A10 10 0 0 1 20 20")).toThrow(/unsupported/);
  });
});

describe("ink morph built once at preparation", () => {
  const generator = rough.generator();
  const roughD = (shape: ReturnType<typeof generator.line>) => generator.toPaths(shape).map((path) => path.d);
  const from = roughD(generator.line(0, 0, 100, 0, { seed: 3 }));
  const to = [
    ...roughD(generator.circle(50, 50, 40, { seed: 4 })),
    ...roughD(generator.line(0, 100, 100, 100, { seed: 5 })),
  ];

  it("aligns every stroke of both inks to one shared structure", () => {
    const aligned = alignInk(from, to);
    expect(aligned.from.length).toBe(aligned.to.length);
    aligned.from.forEach((subpath, index) => expect(subpath.length).toBe(aligned.to[index].length));
  });

  it("starts on the source and ends on the target geometry", () => {
    const aligned = alignInk(from, to);
    const ends = (d: string) => parseCubicPath(d).map((subpath) => [subpath[0][0], subpath.at(-1)![3]]);
    const sourceEnds = ends(morphAt(aligned, 0)).flat();
    const targetEnds = ends(morphAt(aligned, 1)).flat();
    const known = (ds: string[]) => ds.flatMap(ends).flat();
    for (const point of targetEnds) {
      expect(known(to).some((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < 1e-2)).toBe(true);
    }
    expect(sourceEnds.length).toBe(targetEnds.length);
  });

  it("is pure in alpha whatever order frames are asked for", () => {
    const aligned = alignInk(from, to);
    const alphas = [0.9, 0.1, 0.5, 0.1, 0.9, 0.5];
    const first = alphas.map((alpha) => morphAt(aligned, alpha));
    expect(alphas.map((alpha) => morphAt(aligned, alpha))).toEqual(first);
    expect(first[0]).toBe(first[4]);
  });
});
