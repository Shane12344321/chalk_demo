import { describe, expect, it } from "vitest";
import projectileLesson from "../../../demo/cached_lessons/projectile-range.lesson.json";
import { decodeLesson } from "./decode";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  layoutHardFindingVector,
  layoutSteps,
  overlapRatio,
  regionBox,
} from "./layout";
import { physicsDiagramLesson } from "./physicsTestFixture";

const lesson = decodeLesson(projectileLesson).lesson!;

describe("normalized board layout", () => {
  it("maps the named grid and broad regions inside the logical board", () => {
    expect(regionBox("A1")).toMatchObject({ x: 48, y: 48 });
    expect(regionBox("D3").x + regionBox("D3").width).toBe(BOARD_WIDTH - 48);
    expect(regionBox("D3").y + regionBox("D3").height).toBe(BOARD_HEIGHT - 48);
    expect(regionBox("left").width).toBe(regionBox("right").width);
    expect(regionBox("full")).toEqual({ x: 48, y: 48, width: 1504, height: 804 });
  });

  it("resolves anchors from accepted element boxes deterministically", () => {
    const first = layoutSteps(lesson.steps);
    const second = layoutSteps(lesson.steps);
    expect(second).toEqual(first);
    const equation = first.find(({ op }) => op.id === "formula")!;
    const anchored = first.find(({ op }) => op.id === "doubleangle")!;
    expect(anchored.box.y).toBeGreaterThanOrEqual(equation.box.y + equation.box.height);
    expect(anchored.box.x).toBeGreaterThanOrEqual(48);
    expect(anchored.box.x + anchored.box.width).toBeLessThanOrEqual(BOARD_WIDTH - 48);
  });

  it("keeps repeated region content bounded and non-overlapping", () => {
    const dense = decodeLesson({
      schema_version: "1.0",
      title: "Dense",
      steps: [0, 1].map((step) => ({
        id: `s${step + 1}`,
        script: "Place four short labels safely.",
        ops: [0, 1, 2, 3].map((op) => ({
          op: "text",
          id: `t${step}${op}`,
          region: "A1",
          content: `Label ${step}-${op}`,
        })),
        checkpoint: null,
      })),
    }).lesson!;
    const boxes = layoutSteps(dense.steps).map((item) => item.box);
    const region = regionBox("A1");
    boxes.forEach((box) => {
      expect(box.y).toBeGreaterThanOrEqual(region.y);
      expect(box.y + box.height).toBeLessThanOrEqual(region.y + region.height);
    });
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
    }
  });

  it("avoids collisions when broad and grid regions overlap", () => {
    const mixed = decodeLesson({
      schema_version: "1.0",
      title: "Mixed regions",
      steps: [
        {
          id: "s1",
          script: "Place content in a grid cell.",
          ops: [{ op: "text", id: "title", region: "A1", content: "A title" }],
          checkpoint: null,
        },
        {
          id: "s2",
          script: "Place broad content without covering it.",
          ops: [{ op: "equation", id: "broad", region: "left", latex: "y=f(x)" }],
          checkpoint: null,
        },
      ],
    }).lesson!;
    const layout = layoutSteps(mixed.steps);
    const title = layout.find(({ op }) => op.id === "title")!.box;
    const broad = layout.find(({ op }) => op.id === "broad")!.box;
    expect(overlapRatio(title, broad)).toBeLessThanOrEqual(0.15);
  });

  it("keeps related physics marks registered to one prefix-stable canvas", () => {
    const physics = decodeLesson(physicsDiagramLesson()).lesson!;
    const first = layoutSteps(physics.steps);
    const prefix = layoutSteps(physics.steps.slice(0, 1));
    const boundary = first.find(({ op }) => op.id === "boundary")!;
    const related = first.filter(({ op }) => ["normal", "incident", "hit", "reflected", "theta"].includes(op.id));

    expect(boundary.canvasBox).toBeDefined();
    related.forEach((item) => expect(item.canvasBox).toEqual(boundary.canvasBox));
    expect(first.slice(0, prefix.length)).toEqual(prefix);
    expect(first.find(({ op }) => op.id === "incident")!.box).not.toEqual(boundary.box);
  });

  it("resolves generic place and stack relations without topic-specific code", () => {
    const related = decodeLesson({
      schema_version: "1.2",
      title: "Structured working",
      steps: [{
        id: "s1",
        script: "Arrange three generic lines of working.",
        ops: [
          { op: "text", id: "work1", region: "left", content: "15 - 12 = 3" },
          { op: "text", id: "work2", region: "right", content: "bring down 6" },
          { op: "text", id: "work3", region: "A3", content: "36 - 36 = 0" },
        ],
        layout: [
          {
            kind: "place", id: "work2", relative_to: "work1",
            side: "below", align: "start", gap: 0.03,
          },
          {
            kind: "stack", ids: ["work1", "work2", "work3"],
            direction: "vertical", align: "end", gap: 0.025,
          },
        ],
        checkpoint: null,
      }],
    });
    expect(related.warnings).toEqual([]);
    const boxes = layoutSteps(related.lesson!.steps).map(({ box }) => box);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y + boxes[1].height);
    const rightEdges = boxes.map((box) => box.x + box.width);
    expect(new Set(rightEdges)).toHaveLength(1);
    boxes.forEach((box) => {
      expect(box.x).toBeGreaterThanOrEqual(48);
      expect(box.y).toBeGreaterThanOrEqual(48);
      expect(box.x + box.width).toBeLessThanOrEqual(BOARD_WIDTH - 48);
      expect(box.y + box.height).toBeLessThanOrEqual(BOARD_HEIGHT - 48);
    });
  });

  it("moves a diagram canvas with all of its dependent geometry", () => {
    const source = {
      schema_version: "1.2",
      title: "Bound diagram",
      steps: [
        {
          id: "s1",
          script: "Establish the heading and one existing condition.",
          ops: [
            { op: "text", id: "heading", region: "A1", content: "Optics" },
            { op: "text", id: "blocker", region: "A1", content: "Known condition" },
          ],
          checkpoint: null,
        },
        {
          id: "s2",
          script: "Move the diagram as one connected group.",
          ops: [
          {
            op: "line", id: "boundary", region: "right",
            from: [0.1, 0.5], to: [0.9, 0.5], stroke: "solid",
          },
          {
            op: "line", id: "normal", canvas_id: "boundary",
            from: [0.5, 0.1], to: [0.5, 0.9], stroke: "dashed",
          },
          {
            op: "arrow", id: "ray", canvas_id: "boundary",
            from: [0.2, 0.8], to: [0.5, 0.5], stroke: "solid",
          },
          ],
          layout: [{
            kind: "place", id: "boundary", relative_to: "heading",
            side: "below", align: "center", gap: 0.02,
          }],
          checkpoint: null,
        },
      ],
    };
    const decoded = decodeLesson(source);
    expect(decoded.warnings).toEqual([]);
    const preferred = layoutSteps(decoded.lesson!.steps, {
      candidatePlacement: "preferred-only",
    });
    const layout = layoutSteps(decoded.lesson!.steps);
    const canvas = layout.find(({ op }) => op.id === "boundary")!.canvasBox;
    for (const id of ["normal", "ray"]) {
      expect(layout.find(({ op }) => op.id === id)!.canvasBox).toEqual(canvas);
    }
    const preferredHard = layoutHardFindingVector(preferred, decoded.lesson!.steps);
    const resolvedHard = layoutHardFindingVector(layout, decoded.lesson!.steps);
    resolvedHard.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(preferredHard[index]);
    });
  });
});
