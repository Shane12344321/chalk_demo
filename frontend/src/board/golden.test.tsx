import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Board } from "./Board";
import { decodeLesson } from "./decode";
import { layoutSteps, overlapRatio } from "./layout";

const fixtures = import.meta.glob("../../../tests/golden/*.lesson.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

describe("ten golden lesson renderer fixtures", () => {
  it("keeps the complete topic set checked in", () => {
    expect(Object.keys(fixtures)).toHaveLength(10);
  });

  for (const [path, source] of Object.entries(fixtures)) {
    it(`decodes and headlessly renders ${path.split("/").at(-1)}`, () => {
      const decoded = decodeLesson(source);
      expect(decoded.warnings).toEqual([]);
      expect(decoded.lesson).toBeDefined();
      const lesson = decoded.lesson!;
      const layout = layoutSteps(lesson.steps);
      const textBoxes = layout
        .filter(({ op }) => op.op === "text" || op.op === "equation")
        .map(({ op, box }) => ({ id: op.id, box }));
      for (let left = 0; left < textBoxes.length; left += 1) {
        for (let right = left + 1; right < textBoxes.length; right += 1) {
          expect(overlapRatio(textBoxes[left].box, textBoxes[right].box)).toBeLessThanOrEqual(
            0.15,
          );
        }
      }

      const rendered = render(
        <Board
          lesson={lesson}
          currentStepIndex={lesson.steps.length - 1}
          currentStepProgress={1}
          phase="DONE"
        />,
      );
      expect(rendered.container.querySelector(".board-warning")).toBeNull();
      expect(rendered.container.querySelectorAll("[data-element-id]").length).toBe(
        lesson.steps.reduce((sum, step) => sum + step.ops.length, 0),
      );
      rendered.unmount();
    });
  }
});
