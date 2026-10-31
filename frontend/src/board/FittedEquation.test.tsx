import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { equationFitScale, MIN_FITTED_EQUATION_FONT_PX } from "./equationSizing";
import { FittedEquation } from "./FittedEquation";
import { renderSafeLatex } from "./latex";

function rect(width: number, height: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
}

/** Fake layout: the host is a fixed box; KaTeX ink grows linearly with font size. */
function mockLayout(box: { width: number; height: number }, inkAt31px: { width: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("board-equation")) return rect(box.width, box.height);
    if (this.classList.contains("base")) {
      const host = this.closest<HTMLElement>(".board-equation")!;
      const factor = Number.parseFloat(host.style.fontSize) / 31;
      return rect(inkAt31px.width * factor, inkAt31px.height * factor);
    }
    return rect(0, 0);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("equation fit scale", () => {
  it("never enlarges and shrinks by the tighter dimension", () => {
    expect(equationFitScale({ width: 200, height: 50 }, { width: 300, height: 100 })).toBe(1);
    expect(equationFitScale({ width: 330, height: 50 }, { width: 300, height: 100 })).toBeCloseTo(300 / 330);
    expect(equationFitScale({ width: 100, height: 200 }, { width: 300, height: 100 })).toBe(0.5);
  });

  it("ignores unmeasured layout instead of collapsing the equation", () => {
    expect(equationFitScale({ width: 0, height: 0 }, { width: 300, height: 100 })).toBe(1);
    expect(equationFitScale({ width: 330, height: 50 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("fitted equation painter", () => {
  const latex = String.raw`L=\frac{\lambda}{2}\quad\Rightarrow\quad\lambda=2L`;

  it("shrinks an overflowing equation until its ink fits the committed box", () => {
    mockLayout({ width: 300, height: 120 }, { width: 360, height: 60 });
    const { container } = render(
      <FittedEquation className="board-equation" fontSize={31} html={renderSafeLatex(latex)} />,
    );
    const host = container.querySelector<HTMLElement>(".board-equation")!;
    expect(Number.parseFloat(host.style.fontSize)).toBeCloseTo(((31 * 300) / 360) * 0.96, 5);
  });

  it("keeps the heuristic font when the equation already fits", () => {
    mockLayout({ width: 300, height: 120 }, { width: 220, height: 60 });
    const { container } = render(
      <FittedEquation className="board-equation" fontSize={31} html={renderSafeLatex(latex)} />,
    );
    expect(container.querySelector<HTMLElement>(".board-equation")!.style.fontSize).toBe("31px");
  });

  it("stops at the legibility floor for pathologically wide content", () => {
    mockLayout({ width: 300, height: 120 }, { width: 6_000, height: 60 });
    const { container } = render(
      <FittedEquation className="board-equation" fontSize={31} html={renderSafeLatex(latex)} />,
    );
    expect(container.querySelector<HTMLElement>(".board-equation")!.style.fontSize).toBe(
      `${MIN_FITTED_EQUATION_FONT_PX}px`,
    );
  });
});
