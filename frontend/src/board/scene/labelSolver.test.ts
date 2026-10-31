import { describe, expect, it } from "vitest";
import { InkIndex, labelBounds, pathToPolylines, solveLabels, type SolverElement } from "./labelSolver";

const horizontalStroke: Array<[number, number]> = [[200, 300], [900, 300]];

function inkHits(element: SolverElement, label: { text: string; x: number; y: number; fontSize?: number }) {
  const index = new InkIndex();
  for (const line of element.ink) index.add(line);
  return index.hits(labelBounds(label));
}

describe("board label solver", () => {
  it("moves a free label off any stroke it would cross", () => {
    const element: SolverElement = {
      ink: [horizontalStroke],
      blocks: [],
      labels: [{ text: "force", x: 500, y: 310, mobility: "free" }],
    };
    expect(inkHits(element, element.labels[0])).toBeGreaterThan(0);
    const [[placed]] = solveLabels([element]);
    expect(placed.moved).toBe(true);
    expect(inkHits(element, placed)).toBe(0);
    expect(Math.hypot(placed.x - 500, placed.y - 310)).toBeLessThan(80);
  });

  it("avoids ink and labels from earlier elements of any kind", () => {
    const earlier: SolverElement = {
      ink: [horizontalStroke],
      blocks: [{ x: 600, y: 200, width: 200, height: 80 }],
      labels: [{ text: "N", x: 640, y: 360, mobility: "fixed" }],
    };
    const later: SolverElement = {
      ink: [],
      blocks: [],
      labels: [{ text: "N", x: 640, y: 360, mobility: "free" }],
    };
    const [, [placed]] = solveLabels([earlier, later]);
    const first = labelBounds(earlier.labels[0]);
    const second = labelBounds(placed);
    const overlap =
      first.x < second.x + second.width && first.x + first.width > second.x &&
      first.y < second.y + second.height && first.y + first.height > second.y;
    expect(overlap).toBe(false);
  });

  it("never moves fixed labels", () => {
    const [[placed]] = solveLabels([{
      ink: [horizontalStroke],
      blocks: [],
      labels: [{ text: "0", x: 500, y: 310, mobility: "fixed" }],
    }]);
    expect(placed).toMatchObject({ x: 500, y: 310, moved: false });
  });

  it("keeps earlier labels where they were when later steps arrive", () => {
    const steps: SolverElement[] = [
      { ink: [horizontalStroke], blocks: [], labels: [{ text: "incident", x: 500, y: 310, mobility: "free" }] },
      { ink: [[[480, 200], [480, 500]]], blocks: [], labels: [{ text: "normal", x: 480, y: 250, mobility: "free" }] },
    ];
    const prefixOnly = solveLabels(steps.slice(0, 1));
    const withLaterStep = solveLabels(steps);
    expect(withLaterStep[0]).toEqual(prefixOnly[0]);
  });

  it("flattens rough.js style paths, including curves, into polylines", () => {
    const [line] = pathToPolylines("M 10 20 L 30 40 C 40 50, 60 70, 80 90");
    expect(line[0]).toEqual([10, 20]);
    expect(line[1]).toEqual([30, 40]);
    expect(line.at(-1)).toEqual([80, 90]);
    expect(line.length).toBe(8);
    expect(pathToPolylines("M0 0 L10 0 M 20 20 L 30 30")).toHaveLength(2);
  });
});
