import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import projectileLesson from "../../../demo/cached_lessons/projectile-range.lesson.json";
import { Board } from "./Board";
import { decodeLesson } from "./decode";
import { physicsDiagramLesson } from "./physicsTestFixture";
import { fitBoardText } from "./textLayout";

const lesson = decodeLesson(projectileLesson).lesson!;

describe("Board", () => {
  it("wraps long handwritten labels inside their allocated box", () => {
    const fitted = fitBoardText("Restoring force points toward equilibrium", {
      x: 0,
      y: 0,
      width: 310,
      height: 64,
    });
    expect(fitted.lines.length).toBeGreaterThan(1);
    expect(fitted.lines.join(" ")).toBe("Restoring force points toward equilibrium");
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(64);
  });

  it("breaks an unspaced model token instead of clipping it at the board edge", () => {
    const fitted = fitBoardText("averylongunbrokenmathematicalidentifier", {
      x: 0,
      y: 0,
      width: 180,
      height: 180,
    });

    expect(fitted.lines.length).toBeGreaterThan(1);
    expect(fitted.lines.join("")).toBe("averylongunbrokenmathematicalidentifier");
    expect(fitted.lines.every((line) => line.length * fitted.fontSize * 0.58 <= 180)).toBe(true);
  });

  it("retains a visibly partial sketch and stable path after rerender", () => {
    const view = render(
      <Board lesson={lesson} currentStepIndex={0} currentStepProgress={0.5} phase="FROZEN" />,
    );
    const sketch = view.container.querySelector('[data-element-id="cannon"]')!;
    expect(sketch.getAttribute("data-progress")).toBe("0.375");
    const path = sketch.querySelector("path")!;
    const originalD = path.getAttribute("d");
    const offsets = [...sketch.querySelectorAll("path")].map((candidate) =>
      Number(candidate.getAttribute("stroke-dashoffset")),
    );
    expect(offsets.some((offset) => offset === 0)).toBe(true);
    expect(offsets.some((offset) => offset > 0 && offset < 1)).toBe(true);
    expect(offsets.some((offset) => offset === 1)).toBe(true);

    view.rerender(
      <Board lesson={lesson} currentStepIndex={0} currentStepProgress={0.5} phase="QA" />,
    );
    expect(
      view.container.querySelector('[data-element-id="cannon"] path')?.getAttribute("d"),
    ).toBe(originalD);
  });

  it("records the first actually visible geometry once per measurement", () => {
    const onFirstVisibleInk = vi.fn();
    const view = render(
      <Board
        lesson={lesson}
        currentStepIndex={0}
        currentStepProgress={0}
        phase="TEACHING"
        measurementId="request-one"
        onFirstVisibleInk={onFirstVisibleInk}
      />,
    );
    expect(onFirstVisibleInk).not.toHaveBeenCalled();

    view.rerender(
      <Board
        lesson={lesson}
        currentStepIndex={0}
        currentStepProgress={0.01}
        phase="TEACHING"
        measurementId="request-one"
        onFirstVisibleInk={onFirstVisibleInk}
      />,
    );
    expect(onFirstVisibleInk).toHaveBeenCalledOnce();
    expect(onFirstVisibleInk).toHaveBeenCalledWith("request-one", expect.any(Number));

    view.rerender(
      <Board
        lesson={lesson}
        currentStepIndex={0}
        currentStepProgress={0.2}
        phase="TEACHING"
        measurementId="request-one"
        onFirstVisibleInk={onFirstVisibleInk}
      />,
    );
    expect(onFirstVisibleInk).toHaveBeenCalledOnce();
  });

  it("renders a complete shared-canvas physics diagram through the SVG board", () => {
    const physics = decodeLesson(physicsDiagramLesson()).lesson!;
    const view = render(
      <Board lesson={physics} currentStepIndex={1} currentStepProgress={1} phase="DONE" />,
    );
    expect(view.container.querySelector('[data-element-id="boundary"]')).not.toBeNull();
    expect(view.container.querySelectorAll('[data-element-id="normal"] path').length).toBeGreaterThan(4);
    expect(view.container.querySelectorAll('[data-element-id="incident"] path').length).toBeGreaterThan(2);
    expect(view.container.querySelector('[data-element-id="hit"]')).not.toBeNull();
    expect(view.container.querySelector('[data-element-id="theta"]')?.textContent).toContain("θ");
  });
});
