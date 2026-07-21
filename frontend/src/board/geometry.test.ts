import { describe, expect, it } from "vitest";
import projectileLesson from "../../../demo/cached_lessons/projectile-range.lesson.json";
import { decodeLesson } from "./decode";
import { BoardGeometryStore, stableSeed } from "./geometry";
import { layoutSteps } from "./layout";
import { lintBoardGeometry } from "./layoutLint";
import {
  alignedConstructionLesson,
  compositeDiagramLesson,
  physicsDiagramLesson,
} from "./physicsTestFixture";

const lesson = decodeLesson(projectileLesson).lesson!;
const laidOut = layoutSteps(lesson.steps);

describe("seeded rough geometry", () => {
  it("derives stable non-zero seeds from element IDs", () => {
    expect(stableSeed("rangecurve")).toBe(stableSeed("rangecurve"));
    expect(stableSeed("rangecurve")).not.toBe(stableSeed("cannon"));
    expect(stableSeed("rangecurve")).toBeGreaterThan(0);
  });

  it("returns the same cached geometry objects on rerender", () => {
    const store = new BoardGeometryStore();
    const first = store.build(laidOut);
    const second = store.build(laidOut.map((item) => ({ ...item, box: { ...item.box } })));
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(second.geometries).toHaveLength(first.geometries.length);
    first.geometries.forEach((geometry, index) => {
      expect(second.geometries[index]).toBe(geometry);
    });
  });

  it("produces identical rough paths in independent stores", () => {
    const first = new BoardGeometryStore().build(laidOut);
    const second = new BoardGeometryStore().build(laidOut);
    expect(second.geometries.map((item) => item.paths)).toEqual(
      first.geometries.map((item) => item.paths),
    );
  });

  it("renders dashed constructions, arrowheads, points, and angle marks", () => {
    const physics = decodeLesson(physicsDiagramLesson()).lesson!;
    const result = new BoardGeometryStore().build(layoutSteps(physics.steps));
    expect(result.warnings).toEqual([]);
    const normal = result.geometries.find(({ id }) => id === "normal")!;
    const incident = result.geometries.find(({ id }) => id === "incident")!;
    const hit = result.geometries.find(({ id }) => id === "hit")!;
    const theta = result.geometries.find(({ id }) => id === "theta")!;
    expect(normal.paths.length).toBeGreaterThan(4);
    expect(new Set(normal.paths.map((path) => path.revealGroup)).size).toBeGreaterThan(2);
    expect(incident.paths.length).toBeGreaterThan(2);
    expect(hit.paths.length).toBeGreaterThan(0);
    expect(theta.paths.length).toBeGreaterThan(0);
    expect(theta.labels[0].text).toBe("θ");
  });

  it("keeps labels from ops converging on one canvas vertex from overlapping", () => {
    const physics = decodeLesson(physicsDiagramLesson()).lesson!;
    const result = new BoardGeometryStore().build(layoutSteps(physics.steps));
    const labels = result.geometries
      .filter((geometry) => geometry.canvasBox)
      .flatMap((geometry) => geometry.labels);
    expect(labels.length).toBeGreaterThanOrEqual(4);
    const boxes = labels.map((label) => {
      const fontSize = label.fontSize ?? 31;
      const width = Math.max(fontSize * 0.65, label.text.length * fontSize * 0.58);
      const x = label.anchor === "end"
        ? label.x - width
        : label.anchor === "middle"
          ? label.x - width / 2
          : label.x;
      return { x, y: label.y - fontSize, width, height: fontSize * 1.25 };
    });
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const overlaps =
          boxes[a].x < boxes[b].x + boxes[b].width &&
          boxes[b].x < boxes[a].x + boxes[a].width &&
          boxes[a].y < boxes[b].y + boxes[b].height &&
          boxes[b].y < boxes[a].y + boxes[a].height;
        expect(overlaps, `labels "${labels[a].text}" and "${labels[b].text}" overlap`).toBe(false);
      }
    }
  });

  it("declutters labels identically across independent stores", () => {
    const physics = decodeLesson(physicsDiagramLesson()).lesson!;
    const first = new BoardGeometryStore().build(layoutSteps(physics.steps));
    const second = new BoardGeometryStore().build(layoutSteps(physics.steps));
    expect(first.geometries.map(({ labels }) => labels)).toEqual(
      second.geometries.map(({ labels }) => labels),
    );
  });

  it("renders a composite diagram as sequential smooth, bounded ink groups", () => {
    const composite = decodeLesson(compositeDiagramLesson()).lesson!;
    const result = new BoardGeometryStore().build(layoutSteps(composite.steps));
    expect(result.warnings).toEqual([]);
    expect(result.geometries).toHaveLength(1);
    const geometry = result.geometries[0];
    expect(geometry.kind).toBe("diagram");
    expect(geometry.labels.map(({ text }) => text)).toEqual(["support", "cord", "mass", "θ", "mg"]);
    expect(new Set(geometry.paths.map(({ revealGroup }) => revealGroup))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(geometry.paths.some(({ d }) => d.includes("C"))).toBe(true);
    expect(geometry.box.width).toBeLessThan(1600);
    expect(geometry.box.height).toBeLessThan(900);
    expect(
      lintBoardGeometry([geometry]).filter(
        ({ code }) => code === "label_overlap" || code === "label_ink_overlap",
      ),
    ).toEqual([]);
  });

  it("keeps positioned writing and rules in one reusable aligned construction", () => {
    const aligned = decodeLesson(alignedConstructionLesson()).lesson!;
    const result = new BoardGeometryStore().build(layoutSteps(aligned.steps));
    expect(result.warnings).toEqual([]);
    const geometry = result.geometries[0];
    expect(geometry.kind).toBe("diagram");
    expect(geometry.labels.map(({ text }) => text)).toEqual([
      "2x + 3 = 11", "2x = 8", "x = 4",
    ]);
    expect(geometry.labels.map(({ anchor }) => anchor)).toEqual([
      "middle", "middle", "middle",
    ]);
    expect(geometry.labels.map(({ revealGroup }) => revealGroup)).toEqual([0, 1, 3]);
    expect(new Set(geometry.paths.map(({ revealGroup }) => revealGroup))).toEqual(
      new Set([0, 1, 2, 3]),
    );
    expect(geometry.manifestParts?.map(({ summary }) => summary)).toEqual([
      "writing \"2x + 3 = 11\" at upper center",
      "writing \"2x = 8\" at center",
      "solid line from center to center",
      "writing \"x = 4\" at lower center",
    ]);
  });

});
