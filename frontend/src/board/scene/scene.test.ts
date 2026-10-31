import { describe, expect, it } from "vitest";
import { compileSafeExpression } from "../expression";
import { labelBounds, pathToPolylines } from "./labelSolver";
import { expandMarks, applyAffine, transformMatrix } from "./expand";
import { frameTransform } from "./frame";
import { SceneGeometryStore } from "./render";
import { markDependencies, orderMarks } from "./refs";
import { sampleParametric, samplePolar, visibleSegments } from "./sample";
import type { Frame, Mark, Scene, SceneElement } from "./types";

const plot: Frame = {
  id: "plot",
  box: { x: 100, y: 100, width: 400, height: 200 },
  window: { x: [-2, 2], y: [-1, 1] },
  axes: "edge",
  grid: false,
  equalScale: false,
};

const square: Frame = { ...plot, id: "sq", axes: "none", equalScale: true, window: { x: [0, 4], y: [0, 2] } };

function element(id: string, frame: string, marks: Mark[], extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    kind: "diagram",
    stepIndex: 0,
    opIndex: 0,
    box: { x: 0, y: 0, width: 10, height: 10 },
    sizing: "ink",
    frame,
    marks,
    summary: id,
    ...extra,
  };
}

function build(scene: Scene) {
  return new SceneGeometryStore().build(scene);
}

describe("frame transform", () => {
  it("maps math y-up windows onto the pixel box and back", () => {
    const transform = frameTransform(plot);
    expect(transform.toPixel([-2, -1])).toEqual([100, 300]);
    expect(transform.toPixel([2, 1])).toEqual([500, 100]);
    expect(transform.toPixel([0, 0])).toEqual([300, 200]);
    expect(transform.toFrame([300, 200])).toEqual([0, 0]);
    expect(transform.unit).toEqual([100, 100]);
  });

  it("centres an equal-scale window so one unit is the same on both axes", () => {
    const transform = frameTransform({ ...plot, equalScale: true, window: { x: [0, 1], y: [0, 1] } });
    expect(transform.unit).toEqual([200, 200]);
    expect(transform.toPixel([0, 1])).toEqual([200, 100]);
    expect(transform.toPixel([1, 0])).toEqual([400, 300]);
  });

  it("rejects an empty window", () => {
    expect(() => frameTransform({ ...plot, window: { x: [1, 1], y: [0, 1] } })).toThrow();
  });
});

describe("per-variable sampling through the locked-down compiler", () => {
  it("allows exactly one free variable per mark kind", () => {
    expect(compileSafeExpression("sin(t) + pi", "t").evaluate(0)).toBeCloseTo(Math.PI);
    expect(compileSafeExpression("2 * theta", "theta").evaluate(1)).toBe(2);
    expect(() => compileSafeExpression("x + t", "t")).toThrow();
    expect(() => compileSafeExpression("theta", "x")).toThrow();
    expect(() => compileSafeExpression("cos.constructor", "t")).toThrow();
  });

  it("samples parametric and polar curves into frame coordinates", () => {
    const circle = sampleParametric("cos(t)", "sin(t)", [0, 2 * Math.PI], 33);
    expect(circle).toHaveLength(33);
    for (const [x, y] of circle) expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    const rose = samplePolar("1", [0, Math.PI], 17);
    expect(rose[0][0]).toBeCloseTo(1);
    expect(rose.at(-1)![0]).toBeCloseTo(-1);
  });

  it("keeps only visible runs of at least two samples", () => {
    const segments = visibleSegments(
      [[0, 0], [1, 5], [2, 0], [3, 0], [4, 5], [5, 0]],
      { x: [0, 5], y: [-1, 1] },
    );
    expect(segments).toEqual([[[2, 0], [3, 0]]]);
  });
});

describe("point references and the dependency graph", () => {
  it("collects every referenced mark", () => {
    expect(markDependencies({
      kind: "point",
      id: "m",
      at: { mid: [{ at: "a" }, { foot: [0, 0], onto: "l" }] },
    })).toEqual(["a", "l"]);
    expect(markDependencies({
      kind: "group",
      id: "g",
      marks: [
        { kind: "point", id: "inner", at: [0, 0] },
        { kind: "line", id: "seg", line: { from: { at: "inner" }, to: { at: "outer" } } },
      ],
    })).toEqual(["outer"]);
  });

  it("orders marks by dependency and rejects unknown, forward, and cyclic references", () => {
    const items = [
      { id: "b", dependencies: ["a"] },
      { id: "a", dependencies: [] },
      { id: "c", dependencies: ["d"] },
      { id: "d", dependencies: ["c"] },
      { id: "e", dependencies: ["future"] },
      { id: "f", dependencies: ["nowhere"] },
      { id: "g", dependencies: ["earlier"] },
    ];
    const { ordered, failed } = orderMarks(items, new Set(["earlier"]), new Set(["future"]));
    expect(ordered.map(({ id }) => id)).toEqual(["a", "b", "g"]);
    expect(failed.map(({ item, code }) => [item.id, code])).toEqual([
      ["e", "forward_reference"],
      ["f", "unknown_reference"],
      ["c", "cycle"],
      ["d", "cycle"],
    ]);
  });

  it("resolves derived points on rendered ink in any frame", () => {
    const { geometries, warnings } = build({
      frames: [plot],
      elements: [
        element("base", "plot", [{ kind: "fn", id: "f", expr: "x^2 / 4" }]),
        element("marks", "plot", [
          { kind: "point", id: "onf", at: { on: "f", x: 1 } },
          { kind: "line", id: "flat", line: { from: [-2, 0], to: [2, 0] } },
          { kind: "point", id: "foot", at: { foot: { at: "onf" }, onto: "flat" } },
          { kind: "point", id: "mid", at: { mid: [[-2, -1], { at: "foot" }] } },
          { kind: "line", id: "tan", line: { tangentTo: "f", x: 1, length: 0.5 } },
        ]),
      ],
    });
    expect(warnings).toEqual([]);
    const transform = frameTransform(plot);
    const dots = geometries[1].paths;
    expect(dots.length).toBeGreaterThan(0);
    // The foot of (1, 0.25) on y = 0 is (1, 0); the midpoint with (-2, -1) is (-0.5, -0.5).
    const box = geometries[1].box;
    const [footX, footY] = transform.toPixel([1, 0]);
    const [midX, midY] = transform.toPixel([-0.5, -0.5]);
    expect(box.x).toBeLessThanOrEqual(Math.min(footX, midX) - 8);
    expect(box.y + box.height).toBeGreaterThanOrEqual(Math.max(footY, midY) + 8);
  });

  it("skips a failing mark and its dependents but keeps the rest of the element", () => {
    const { geometries, warnings } = build({
      frames: [plot],
      elements: [
        element("two", "plot", [
          { kind: "line", id: "l1", line: { from: [-1, -1], to: [1, -1] } },
          { kind: "line", id: "l2", line: { from: [-1, 0], to: [1, 0] } },
          { kind: "point", id: "x", at: { hit: ["l1", "l2"] } },
          { kind: "label", id: "lx", text: "X", at: { at: "x" }, side: "above" },
          { kind: "point", id: "ok", at: [0, 0.5] },
        ]),
      ],
    });
    expect(warnings).toEqual([
      { id: "two", detail: "scene:parallel_geometry" },
      { id: "two", detail: "scene:unknown_reference" },
    ]);
    expect(geometries).toHaveLength(1);
    expect(geometries[0].labels).toEqual([]);
  });

  it("never lets a mark read a later element", () => {
    const { warnings } = build({
      frames: [plot],
      elements: [
        element("early", "plot", [{ kind: "point", id: "p", at: { at: "q" } }]),
        element("late", "plot", [{ kind: "point", id: "q", at: [0, 0] }]),
      ],
    });
    expect(warnings).toContainEqual({ id: "early", detail: "scene:forward_reference" });
  });

  it("rejects references across frames", () => {
    const { warnings } = build({
      frames: [plot, square],
      elements: [
        element("a", "plot", [{ kind: "point", id: "pa", at: [0, 0] }]),
        element("b", "sq", [{ kind: "line", id: "lb", line: { from: { at: "pa" }, to: [1, 1] } }]),
      ],
    });
    expect(warnings).toContainEqual({ id: "b", detail: "scene:coordinate_space_mismatch" });
  });
});

describe("mark vocabulary", () => {
  it("draws every new kind with ink inside its frame", () => {
    const { geometries, warnings } = build({
      frames: [plot],
      elements: [
        element("curves", "plot", [
          { kind: "fn", id: "parab", expr: "x^2 / 4 - 0.5" },
          { kind: "fn", id: "line0", expr: "0.5", stroke: "dashed" },
          { kind: "param", id: "loop", x: "cos(t)", y: "0.5 * sin(t)", t: [0, 6.283] },
          { kind: "polar", id: "spiral", r: "theta / 8", theta: [0, 6] },
          { kind: "region", id: "under", region: { under: "parab", from: -1, to: 1 } },
          { kind: "region", id: "between", region: { between: ["line0", "parab"] } },
          { kind: "circle", id: "c", center: [1, 0], r: 0.3, label: { text: "c" } },
          { kind: "measure", id: "span", from: [-1, -0.8], to: [1, -0.8], label: { text: "2" } },
          { kind: "angle", id: "ang", vertex: [0, 0], angle: { rays: [[1, 0], [0, 1]] }, radius: 0.1, label: { text: "90°" } },
          { kind: "label", id: "note", text: "f(x)", at: { on: "parab", x: 1.5 }, side: "right" },
          { kind: "vector", id: "v", from: [0, 0], to: [1, 0.5], label: { text: "v" } },
          { kind: "line", id: "slope", line: { through: [0, 0], slope: 1, length: 0.4 } },
        ]),
      ],
    });
    expect(warnings).toEqual([]);
    const geometry = geometries[0];
    const ink = geometry.paths
      .filter((path) => path.stroke !== "transparent")
      .flatMap((path) => pathToPolylines(path.d))
      .flat();
    expect(ink.length).toBeGreaterThan(100);
    for (const [x, y] of ink) {
      expect(x).toBeGreaterThan(plot.box.x - 40);
      expect(x).toBeLessThan(plot.box.x + plot.box.width + 40);
      expect(y).toBeGreaterThan(plot.box.y - 40);
      expect(y).toBeLessThan(plot.box.y + plot.box.height + 40);
    }
    expect(geometry.paths.filter((path) => path.fill !== "none")).toHaveLength(2);
    expect(geometry.labels.map((label) => label.text)).toEqual(["c", "2", "90°", "f(x)", "v"]);
    expect(geometry.paths.every((path) => path.stroke === "transparent" || path.subpaths)).toBe(true);
  });

  it("marks a right angle with the square corner only when asked, and other angles with an arc", () => {
    const angle = (id: string, to: [number, number], square: boolean): SceneElement =>
      element(id, "sq", [{ kind: "angle", id, vertex: [1, 1], angle: { rays: [[2, 1], to] }, radius: 0.1, square }]);
    const right: [number, number] = [1, 2];
    const sixty: [number, number] = [1 + Math.cos(Math.PI / 3), 1 + Math.sin(Math.PI / 3)];
    const { geometries } = build({
      frames: [square],
      elements: [angle("sq90", right, true), angle("arc90", right, false), angle("sq60", sixty, true), angle("arc60", sixty, false)],
    });
    const width = (id: string) => geometries.find((geometry) => geometry.id === id)!.box.width;
    // The square's far corner sits on the arc's circle: sides of r/√2 against the arc's r.
    expect(width("arc90") - width("sq90")).toBeCloseTo(20 * (1 - Math.SQRT1_2), 6);
    expect(width("sq60")).toBe(width("arc60"));
  });

  it("masks holes out of a shaded shape and labels the part left shaded", () => {
    const { geometries, warnings } = build({
      frames: [square],
      elements: [
        element("venn", "sq", [
          { kind: "path", id: "s", points: [[0.1, 0.1], [3.9, 0.1], [3.9, 1.9], [0.1, 1.9]], closed: true },
          { kind: "circle", id: "a", center: [1.6, 1], r: 0.7 },
          { kind: "circle", id: "b", center: [2.4, 1], r: 0.7 },
          { kind: "region", id: "rest", region: { inside: "s", except: ["a", "b"] }, label: { text: "neither" } },
        ]),
      ],
    });
    expect(warnings).toEqual([]);
    const fill = geometries[0].paths.find((path) => path.holes);
    expect(fill?.holes).toHaveLength(2);
    const transform = frameTransform(square);
    const label = geometries[0].labels.find((item) => item.text === "neither")!;
    const box = labelBounds(label);
    const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
    for (const circle of [[1.6, 1], [2.4, 1]] as const) {
      const [x, y] = transform.toPixel([...circle]);
      expect(Math.hypot(centre[0] - x, centre[1] - y)).toBeGreaterThan(0.7 * transform.unit[0]);
    }
  });

  it("fails a curve with no visible samples instead of drawing nothing", () => {
    const { geometries, warnings } = build({
      frames: [plot],
      elements: [element("off", "plot", [{ kind: "fn", id: "high", expr: "x + 10" }])],
    });
    expect(geometries).toEqual([]);
    expect(warnings).toEqual([
      { id: "off", detail: "scene:degenerate_geometry" },
      { id: "off", detail: "Element off has no drawable marks." },
    ]);
  });

  it("draws frame axes, references, ticks, titles, and grid", () => {
    const { geometries } = build({
      frames: [{ ...plot, grid: true, titles: { x: "x", y: "y" } }],
      elements: [element("ax", "plot", [], { kind: "axes", sizing: "slot", drawsFrame: true })],
    });
    const labels = geometries[0].labels.map((label) => label.text);
    expect(labels).toEqual(["x", "y", "-2", "2", "1", "-1", "0", "0"]);
    expect(geometries[0].paths.filter((path) => path.stroke === "#b4bac4").length).toBeGreaterThan(4);
  });
});

describe("groups with transform and repeat", () => {
  it("composes scale, rotation, mirror, and translation about an origin", () => {
    const matrix = transformMatrix({ rotate: 90, origin: [1, 0], translate: [0, 2] });
    const [x, y] = applyAffine(matrix, [2, 0]);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(3);
    const mirrored = applyAffine(transformMatrix({ mirror: "x", origin: [1, 0] }), [3, 5]);
    expect(mirrored).toEqual([-1, 5]);
  });

  it("repeats a group with fresh IDs, seeds, and copy-local references", () => {
    const placed = expandMarks([{
      kind: "group",
      id: "spoke",
      repeat: { count: 3, transform: { rotate: 120 } },
      marks: [
        { kind: "point", id: "tip", seed: "tip", at: [1, 0] },
        { kind: "line", id: "arm", line: { from: [0, 0], to: { at: "tip" } } },
      ],
    }]);
    expect(placed.map((item) => item.id)).toEqual(["tip", "arm", "tip~1", "arm~1", "tip~2", "arm~2"]);
    expect(placed[3].dependencies).toEqual(["tip~1"]);
    expect(placed[4].mark.seed).toBe("tip~2");
    expect(placed.every((item) => item.top === 0)).toBe(true);
  });

  it("draws mirrored and rotated copies at their transformed positions", () => {
    const { geometries, warnings } = build({
      frames: [square],
      elements: [element("sym", "sq", [{
        kind: "group",
        id: "half",
        transform: { translate: [2, 1] },
        repeat: { count: 4, transform: { rotate: 90 } },
        marks: [
          { kind: "point", id: "p", at: [0.5, 0] },
          { kind: "arc", id: "a", center: [0, 0], rx: 0.5, ry: 0.5, start: 0, end: 45 },
          { kind: "circle", id: "c", center: [0.5, 0], r: 0.1 },
        ],
      }])],
    });
    expect(warnings).toEqual([]);
    const transform = frameTransform(square);
    // Four copies of the point around (2, 1): the element box spans ±0.5 units.
    const [left] = transform.toPixel([1.5, 1]);
    const [right] = transform.toPixel([2.5, 1]);
    expect(geometries[0].box.x).toBeLessThanOrEqual(left - 8);
    expect(geometries[0].box.x + geometries[0].box.width).toBeGreaterThanOrEqual(right + 8);
    expect(geometries[0].paths.length).toBeGreaterThan(8);
  });
});
