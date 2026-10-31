import { describe, expect, it } from "vitest";
import type { BoardGeometry } from "./geometry";
import {
  groupLayoutLintIssues,
  layoutLintEvidence,
  layoutLintKey,
  lintBoardGeometry,
  SurfacedLayoutFindings,
} from "./layoutLint";

describe("deterministic board geometry lints", () => {
  it("reports colliding primitive labels with closed evidence", () => {
    const issues = lintBoardGeometry([
      geometry("ray1", [{ text: "incident", x: 300, y: 300, anchor: "middle" }]),
      geometry("normal", [{ text: "normal", x: 310, y: 302, anchor: "middle" }]),
    ]);
    expect(issues).toContainEqual({
      code: "label_overlap",
      elementIds: ["ray1", "normal"],
    });
  });

  it("reports a label that leaves the board", () => {
    // Labels may use free board space beside their canvas; only the board edge bounds them.
    const item = geometry("ray1", [{ text: "outside", x: 1590, y: 90 }]);
    item.canvasBox = { x: 100, y: 100, width: 400, height: 300 };
    expect(lintBoardGeometry([item])).toContainEqual({
      code: "label_out_of_bounds",
      elementIds: ["ray1"],
    });
  });

  it("reports text that cannot fit at the minimum board font size", () => {
    const item = geometry("text1", []);
    item.kind = "text";
    item.text = "oneunbreakablewordthatcannotfitinsideaverysmallbox";
    item.box = { x: 0, y: 0, width: 80, height: 20 };
    expect(lintBoardGeometry([item])).toContainEqual({
      code: "text_overflow",
      elementIds: ["text1"],
    });
  });

  it("reports an automatically placed label that crosses drawn ink", () => {
    const item = geometry("diagram1", [
      { text: "force", x: 300, y: 315, anchor: "middle", autoPlace: true },
    ]);
    item.kind = "diagram";
    // A stroke running straight through the label, judged on the stroke itself.
    item.paths = [{ d: "M 180 300 L 420 300", stroke: "#2b2e36", strokeWidth: 4, fill: "none" }];
    expect(lintBoardGeometry([item])).toContainEqual({
      code: "label_ink_overlap",
      elementIds: ["diagram1"],
    });
  });

  it("classifies current approximate geometry findings honestly", () => {
    expect(layoutLintEvidence("label_overlap")).toBe("estimated");
    expect(layoutLintEvidence("text_overflow")).toBe("estimated");
  });

  it("groups a transitive collision into one stable finding", () => {
    const grouped = groupLayoutLintIssues([
      { code: "label_overlap", elementIds: ["b", "a"] },
      { code: "label_overlap", elementIds: ["b", "c"] },
      { code: "text_overflow", elementIds: ["z"] },
    ]);
    expect(grouped).toContainEqual({
      code: "label_overlap",
      elementIds: ["a", "b", "c"],
    });
    expect(layoutLintKey(grouped[0])).toMatch(/^[a-z_]+:/u);
  });

  it("surfaces an exact finding only once until reset", () => {
    const lifecycle = new SurfacedLayoutFindings();
    const issues = [{ code: "label_overlap" as const, elementIds: ["ray", "normal"] }];
    expect(lifecycle.unsurfaced(issues)).toHaveLength(1);
    lifecycle.markSurfaced(issues);
    expect(lifecycle.unsurfaced(issues)).toEqual([]);
    lifecycle.clear();
    expect(lifecycle.unsurfaced(issues)).toHaveLength(1);
  });
});

function geometry(
  id: string,
  labels: BoardGeometry["labels"],
): BoardGeometry {
  return {
    id,
    kind: "line",
    box: { x: 100, y: 100, width: 400, height: 300 },
    canvasBox: { x: 100, y: 100, width: 400, height: 300 },
    paths: [],
    labels,
    manifestSummary: "test geometry",
    stepIndex: 0,
    opIndex: 0,
  };
}
