import { describe, expect, it } from "vitest";
import type { BoardLabel } from "../geometry";
import { frameTransform } from "./frame";
import { labelBounds } from "./labelSolver";
import { SceneGeometryStore } from "./render";
import type { Frame, Mark, Scene, SceneElement } from "./types";

const BOX = { x: 40, y: 40, width: 500, height: 500 };

function frame(labelSide: Frame["labelSide"]): Frame {
  return {
    id: "fig",
    box: BOX,
    window: { x: [0, 10], y: [0, 10] },
    axes: labelSide === "away" ? "none" : "edge",
    grid: false,
    equalScale: true,
    ...(labelSide ? { labelSide } : {}),
  };
}

function element(id: string, stepIndex: number, marks: Mark[]): SceneElement {
  return {
    id,
    kind: "figure",
    stepIndex,
    opIndex: 0,
    box: BOX,
    sizing: "slot",
    frame: "fig",
    marks,
    summary: id,
  };
}

function build(elements: SceneElement[], labelSide: Frame["labelSide"], store = new SceneGeometryStore()) {
  return store.build({ frames: [frame(labelSide)], elements } satisfies Scene).geometries;
}

const point = (id: string, at: [number, number], text: string): Mark =>
  ({ kind: "point", id, at, label: { text } });
const triangle: Mark[] = [
  point("a", [1, 1], "A"),
  point("b", [9, 1], "B"),
  point("c", [5, 8], "C"),
  { kind: "path", id: "abc", points: [{ at: "a" }, { at: "b" }, { at: "c" }], closed: true },
];

const labelOf = (geometries: ReturnType<typeof build>, id: string, text: string): BoardLabel => {
  const label = geometries.find((geometry) => geometry.id === id)?.labels.find((item) => item.text === text);
  if (!label) throw new Error(`no label ${text} on ${id}`);
  return label;
};
const centreOf = (label: BoardLabel): [number, number] => {
  const box = labelBounds(label);
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const px = (labelSide: Frame["labelSide"], at: [number, number]) => frameTransform(frame(labelSide)).toPixel(at);

describe("outward figure labels", () => {
  it("names a polygon's vertices outside it", () => {
    const geometries = build([element("tri", 0, triangle)], "away");
    const centroid = px("away", [5, 10 / 3]);
    for (const [text, at] of [["A", [1, 1]], ["B", [9, 1]], ["C", [5, 8]]] as const) {
      const vertex = px("away", [...at]);
      const [x, y] = centreOf(labelOf(geometries, "tri", text));
      const outward = (x - vertex[0]) * (vertex[0] - centroid[0]) + (y - vertex[1]) * (vertex[1] - centroid[1]);
      expect(outward, text).toBeGreaterThan(0);
    }
  });

  it("names a point on a circle outside it in a plot, and leaves other plot labels alone", () => {
    const on: [number, number] = [5 - 3 * Math.SQRT1_2, 5 - 3 * Math.SQRT1_2];
    const marks: Mark[] = [
      { kind: "circle", id: "ring", center: [5, 5], r: 3 },
      point("p", on, "P"),
      point("q", [8, 9.2], "Q"),
    ];
    const geometries = build([element("plot", 0, marks)], "outside");
    const centre = px("outside", [5, 5]);
    const [x, y] = centreOf(labelOf(geometries, "plot", "P"));
    expect(Math.hypot(x - centre[0], y - centre[1])).toBeGreaterThan(3 * 50);
    expect(x).toBeLessThan(px("outside", on)[0]);
    const natural = build([element("plot", 0, marks)], undefined);
    expect(labelOf(geometries, "plot", "Q")).toEqual(labelOf(natural, "plot", "Q"));
  });

  it("names a centre on the side away from the ink drawn around it", () => {
    const geometries = build([element("circle", 0, [
      { kind: "circle", id: "ring", center: [5, 5], r: 3 },
      point("o", [5, 5], "O"),
      { kind: "line", id: "radius", line: { from: { at: "o" }, to: [5, 8] } },
    ])], "away");
    expect(centreOf(labelOf(geometries, "circle", "O"))[1]).toBeGreaterThan(px("away", [5, 5])[1]);
  });

  it("keeps the natural anchor where nearby ink leaves no clear side", () => {
    const marks: Mark[] = [
      ...triangle,
      { kind: "line", id: "ma", line: { from: { at: "a" }, to: { mid: [{ at: "b" }, { at: "c" }] } } },
      { kind: "line", id: "mb", line: { from: { at: "b" }, to: { mid: [{ at: "a" }, { at: "c" }] } } },
      { kind: "line", id: "mc", line: { from: { at: "c" }, to: { mid: [{ at: "a" }, { at: "b" }] } } },
      { kind: "point", id: "g", at: { hit: ["ma", "mb"] }, label: { text: "G" } },
    ];
    expect(labelOf(build([element("tri", 0, marks)], "away"), "tri", "G"))
      .toEqual(labelOf(build([element("tri", 0, marks)], undefined), "tri", "G"));
  });

  it("reads outlines drawn by earlier steps without moving their labels", () => {
    const first = element("tri", 0, triangle);
    const later = element("mid", 1, [{ kind: "point", id: "m", at: { mid: [{ at: "a" }, { at: "b" }] }, label: { text: "M" } }]);
    const alone = build([first], "away");
    const both = build([first, later], "away");
    expect(both.find((geometry) => geometry.id === "tri")?.labels).toEqual(alone[0].labels);
    // M sits on side AB at the bottom of the triangle: named below it.
    expect(centreOf(labelOf(both, "mid", "M"))[1]).toBeGreaterThan(px("away", [5, 1])[1]);
  });

  it("re-anchors a cached later element when the figure drawn before it changes", () => {
    const store = new SceneGeometryStore();
    const shape = (a: [number, number], b: [number, number], c: [number, number]) =>
      element("tri", 0, [point("a", a, "A"), point("b", b, "B"), point("c", c, "C"), triangle[3]]);
    // M lies on side AB, then (the triangle redrawn elsewhere) near the window's centre.
    const later = element("free", 1, [point("m", [5, 4.5], "M")]);
    const before = labelOf(build([shape([1, 4.5], [9, 4.5], [5, 9]), later], "away", store), "free", "M");
    const moved = shape([0.5, 7], [3, 7], [1.75, 9.5]);
    const cached = labelOf(build([moved, later], "away", store), "free", "M");
    expect(cached).toEqual(labelOf(build([moved, later], "away"), "free", "M"));
    expect(cached).not.toEqual(before);
  });
});
