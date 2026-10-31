import { describe, expect, it } from "vitest";
import fixture from "../../../shared/fixtures/figure-parity.json";
import { decodeLesson } from "./decode";
import { RoughSvgBoardRenderer } from "./renderer";
import { sceneFeatures } from "./scene/features";

interface FigureCase {
  id: string;
  expect: "accept" | "reject";
  steps: Array<{ id: string; ops: Array<{ id: string }> }>;
}

const cases = fixture.cases as unknown as FigureCase[];

describe("shared schema-1.5 figure cases", () => {
  for (const testCase of cases) {
    it(`${testCase.expect}s ${testCase.id}`, () => {
      const decoded = decodeLesson({ schema_version: "1.5", title: testCase.id, steps: testCase.steps });
      const lastStep = testCase.steps.at(-1)!;
      const accepted = new Set(decoded.lesson?.steps.flatMap((step) => step.ops.map((op) => op.id)) ?? []);
      const setupIds = testCase.steps.slice(0, -1).flatMap((step) => step.ops.map((op) => op.id));
      expect(setupIds.every((id) => accepted.has(id))).toBe(true);
      if (testCase.expect === "accept") {
        expect(decoded.warnings).toEqual([]);
        expect(lastStep.ops.every((op) => accepted.has(op.id))).toBe(true);
        const prepared = new RoughSvgBoardRenderer().prepareLesson(decoded.lesson!);
        // Figures always take the scene pipeline and render with no skipped marks.
        expect(prepared.scene).toBeDefined();
        expect(prepared.build.warnings).toEqual([]);
        for (const op of lastStep.ops) {
          const geometry = prepared.build.geometries.find((item) => item.id === op.id)!;
          expect(geometry.paths.some((path) => path.stroke !== "transparent")).toBe(true);
        }
      } else {
        const rejected = lastStep.ops.find((op) => op.id === "bad") ?? lastStep.ops.at(-1)!;
        expect(accepted.has(rejected.id)).toBe(false);
      }
    });
  }

  it("counts figure marks as suite features", () => {
    const decoded = decodeLesson({ schema_version: "1.5", title: "t", steps: cases[0].steps });
    const prepared = new RoughSvgBoardRenderer().prepareLesson(decoded.lesson!);
    const counts = sceneFeatures(prepared.scene!);
    expect(counts).toMatchObject({ plot: 1, curve: 1, region: 1, point: 1, line: 1 });
  });
});
