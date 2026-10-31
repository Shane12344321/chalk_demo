import { describe, expect, it } from "vitest";
import { compileSafeCurve } from "./expression";
import { sampleVisibleCurveSegments } from "./scene/sample";

describe("safe curve expressions", () => {
  it("compiles and samples the projectile expression", () => {
    const curve = compileSafeCurve("sin(2 * x * pi / 180)");
    expect(curve.evaluate(45)).toBeCloseTo(1, 8);
    expect(curve.sample([0, 90], 25)).toHaveLength(25);
  });

  it.each([
    "v * x",
    "x = 2",
    "x[1]",
    "import(x)",
    "sin(x, 2)",
    "x ? 1 : 0",
  ])("rejects unsupported expression %s", (expression) => {
    expect(() => compileSafeCurve(expression)).toThrow();
  });

  it("rejects non-finite sampled output", () => {
    expect(() => compileSafeCurve("1 / (x - 0.5)").sample([0, 1], 121)).toThrow(
      /non-finite/i,
    );
  });

  it("splits visible samples at plot-window exits instead of drawing false chords", () => {
    const segments = sampleVisibleCurveSegments(
      { expr: "sin(x)", domain: [0, 7] },
      {
        x: { min: 0, max: 7, label: "x" },
        y: { min: -0.4, max: 0.4, label: "y" },
      },
    );
    expect(segments.length).toBeGreaterThan(2);
    for (const segment of segments) {
      expect(segment.every(([, y]) => y >= -0.4 && y <= 0.4)).toBe(true);
    }
  });
});
