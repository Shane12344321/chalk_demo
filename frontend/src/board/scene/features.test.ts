import { describe, expect, it } from "vitest";
import { featureCoverage, sceneFeatures } from "./features";
import type { Frame, Mark, Scene } from "./types";

const unit: Frame = {
  id: "f",
  box: { x: 0, y: 0, width: 400, height: 400 },
  window: { x: [0, 1], y: [0, 1] },
  axes: "none",
  grid: false,
  equalScale: true,
};

function scene(marks: Mark[], frame: Frame = unit): Scene {
  return {
    frames: [frame],
    elements: marks.map((mark, index) => ({
      id: `e${index}`,
      kind: "line",
      stepIndex: 0,
      opIndex: index,
      box: unit.box,
      sizing: "ink",
      frame: frame.id,
      marks: [mark],
      summary: "",
    })),
  };
}

const line = (id: string, from: [number, number], to: [number, number]): Mark =>
  ({ kind: "line", id, line: { from, to } });

describe("suite feature detection", () => {
  it("counts a triangle drawn as three separate lines as one polygon", () => {
    const counts = sceneFeatures(scene([
      line("a", [0.1, 0.1], [0.9, 0.1]),
      line("b", [0.9, 0.1], [0.5, 0.8]),
      line("c", [0.5, 0.8], [0.1, 0.1]),
    ]));
    expect(counts.polygon).toBe(1);
    expect(counts.line).toBe(3);
  });

  it("closes rectangles whose base lies on a longer axis line", () => {
    const marks: Mark[] = [line("axis", [0, 0.1], [1, 0.1])];
    for (const [index, left] of [0.2, 0.4, 0.6].entries()) {
      marks.push(
        line(`l${index}`, [left, 0.1], [left, 0.5]),
        line(`t${index}`, [left, 0.5], [left + 0.2, 0.5]),
        line(`r${index}`, [left + 0.2, 0.5], [left + 0.2, 0.1]),
      );
    }
    expect(sceneFeatures(scene(marks)).polygon).toBe(3);
  });

  it("finds no shape in crossing or open strokes and never double counts a closed path", () => {
    expect(sceneFeatures(scene([line("a", [0, 0], [1, 1]), line("b", [0, 1], [1, 0]), line("c", [0, 0.5], [1, 0.5])])).polygon).toBe(0);
    const square: Mark = { kind: "path", id: "sq", points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]] };
    expect(sceneFeatures(scene([square])).polygon).toBe(1);
  });

  it("counts the parts a closed shape is split into, once each", () => {
    const rectangle: Mark = { kind: "path", id: "rect", points: [[0, 0], [0.9, 0], [0.9, 0.5], [0, 0.5]], closed: true };
    expect(sceneFeatures(scene([rectangle])).polygon).toBe(1);
    expect(sceneFeatures(scene([rectangle, line("cut", [0.5, 0], [0.5, 0.5])])).polygon).toBe(2);
    expect(sceneFeatures(scene([rectangle, line("cut", [0.5, 0], [0.5, 0.5]), line("cut2", [0.5, 0.2], [0.9, 0.2])])).polygon)
      .toBe(3);
  });

  it("follows named points and their midpoints", () => {
    const corner = (id: string, at: [number, number]): Mark => ({ kind: "point", id, at });
    const side = (id: string, from: string, to: string): Mark =>
      ({ kind: "line", id, line: { from: { at: from }, to: { at: to } } });
    const counts = sceneFeatures(scene([
      corner("a", [0.1, 0.1]), corner("b", [0.9, 0.1]), corner("c", [0.5, 0.8]),
      side("ab", "a", "b"), side("bc", "b", "c"), side("ca", "c", "a"),
      { kind: "line", id: "median", line: { from: { at: "c" }, to: { mid: [{ at: "a" }, { at: "b" }] } } },
    ]));
    // The median splits the triangle into two.
    expect(counts.polygon).toBe(2);
  });

  it("reads a small L resting in a corner as a right-angle mark, but not a loose one", () => {
    const sides = [line("x", [0.1, 0.1], [0.9, 0.1]), line("y", [0.1, 0.1], [0.1, 0.9])];
    const ell = (id: string, at: [number, number]): Mark =>
      ({ kind: "path", id, points: [[at[0] + 0.06, at[1]], [at[0] + 0.06, at[1] + 0.06], [at[0], at[1] + 0.06]] });
    expect(sceneFeatures(scene([...sides, ell("corner", [0.1, 0.1])])).angle).toBe(1);
    expect(sceneFeatures(scene([...sides, ell("loose", [0.5, 0.5])])).angle).toBe(0);
  });

  it("reads two long perpendicular strokes that meet as hand-drawn axes", () => {
    expect(sceneFeatures(scene([line("x", [0.05, 0.1], [0.95, 0.1]), line("y", [0.1, 0.05], [0.1, 0.95])])).plot).toBe(1);
    expect(sceneFeatures(scene([line("x", [0.05, 0.1], [0.3, 0.1]), line("y", [0.1, 0.05], [0.1, 0.95])])).plot).toBe(0);
  });

  it("scores coverage against counted requirements", () => {
    const counts = sceneFeatures(scene([
      { kind: "fn", id: "f", expr: "x" },
      { kind: "region", id: "r", region: { under: "f" } },
    ], { ...unit, axes: "edge", equalScale: false }));
    expect(featureCoverage(counts, ["plot", "curve", "region"])).toEqual({ score: 1, missing: [] });
    expect(featureCoverage(counts, ["curve:2", "point"])).toEqual({ score: 0, missing: ["curve:2", "point"] });
  });
});
