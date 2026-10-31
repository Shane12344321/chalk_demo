import type { BoardGeometry } from "./geometry";
import { BOARD_HEIGHT, BOARD_WIDTH, overlapRatio, type LayoutBox } from "./layout";
import { groupLayoutLintIssues, type LayoutLintIssue } from "./layoutLint";

const MATERIAL_OVERLAP_RATIO = 0.15;
const BOUNDARY_TOLERANCE = 4;

export interface MeasuredBoardMark {
  elementId: string;
  role: "label" | "ink";
  box: LayoutBox;
  boundary: LayoutBox;
  autoPlace?: boolean;
}

export function lintMeasuredBoardMarks(
  marks: readonly MeasuredBoardMark[],
): LayoutLintIssue[] {
  const labels = marks.filter((mark) => mark.role === "label");
  const ink = marks.filter((mark) => mark.role === "ink");
  const issues: LayoutLintIssue[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (!containsWithTolerance(label.boundary, label.box)) {
      issues.push({ code: "label_out_of_bounds", elementIds: [label.elementId] });
    }
    if (
      label.autoPlace &&
      ink.some((mark) =>
        mark.elementId === label.elementId &&
        overlapRatio(label.box, mark.box) > MATERIAL_OVERLAP_RATIO)
    ) {
      issues.push({ code: "label_ink_overlap", elementIds: [label.elementId] });
    }
    for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex += 1) {
      const other = labels[otherIndex];
      if (overlapRatio(label.box, other.box) > MATERIAL_OVERLAP_RATIO) {
        issues.push({
          code: "label_overlap",
          elementIds: [label.elementId, other.elementId],
        });
      }
    }
  }
  return groupLayoutLintIssues(issues);
}

export function measureRenderedBoard(
  svg: SVGSVGElement,
  geometries: readonly BoardGeometry[],
): LayoutLintIssue[] {
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]));
  const marks: MeasuredBoardMark[] = [];
  for (const node of svg.querySelectorAll<SVGGraphicsElement>("[data-board-mark]")) {
    // Labels live in the board's top label layer, tagged with their element.
    const owner = node.closest<SVGGElement>("[data-element-id], [data-label-for]");
    const elementId = owner?.dataset.elementId ?? owner?.dataset.labelFor;
    if (!elementId) continue;
    const geometry = geometryById.get(elementId);
    if (!geometry) continue;
    try {
      const measured = node.getBBox();
      if (![measured.x, measured.y, measured.width, measured.height].every(Number.isFinite)) {
        continue;
      }
      marks.push({
        elementId,
        role: node.dataset.boardMark === "label" ? "label" : "ink",
        box: {
          x: measured.x,
          y: measured.y,
          width: measured.width,
          height: measured.height,
        },
        boundary: geometry.canvasBox ?? {
          x: 0,
          y: 0,
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
        },
        autoPlace: node.dataset.autoPlace === "true",
      });
    } catch {
      // Some headless SVG implementations do not implement getBBox. The
      // estimated deterministic lints remain the fallback in that environment.
    }
  }
  return lintMeasuredBoardMarks(marks);
}

function containsWithTolerance(boundary: LayoutBox, box: LayoutBox): boolean {
  return (
    box.x >= boundary.x - BOUNDARY_TOLERANCE &&
    box.y >= boundary.y - BOUNDARY_TOLERANCE &&
    box.x + box.width <= boundary.x + boundary.width + BOUNDARY_TOLERANCE &&
    box.y + box.height <= boundary.y + boundary.height + BOUNDARY_TOLERANCE
  );
}
