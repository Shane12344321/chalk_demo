import type { BoardGeometry } from "./geometry";
import { geometryInk, InkIndex, labelBounds } from "./scene/labelSolver";
import { BOARD_HEIGHT, BOARD_WIDTH, overlapRatio, type LayoutBox } from "./layout";
import { fitBoardText } from "./textLayout";

export type LayoutLintCode =
  | "label_overlap"
  | "label_ink_overlap"
  | "label_out_of_bounds"
  | "text_overflow"
  | "region_crowded"
  | "board_imbalanced"
  | "region_sparse"
  | "reading_order_conflict"
  | "measurement_unavailable";

export type LayoutLintZone =
  | "A1" | "A2" | "A3"
  | "B1" | "B2" | "B3"
  | "C1" | "C2" | "C3"
  | "D1" | "D2" | "D3"
  | "left" | "right" | "full";

export interface LayoutLintIssue {
  code: LayoutLintCode;
  elementIds: string[];
  zone?: LayoutLintZone;
}

export type LayoutLintEvidence = "estimated" | "measured" | "semantic";

export function layoutLintEvidence(code: LayoutLintCode): LayoutLintEvidence {
  switch (code) {
    case "label_overlap":
    case "label_ink_overlap":
    case "label_out_of_bounds":
    case "text_overflow":
      return "estimated";
    case "region_crowded":
    case "board_imbalanced":
    case "region_sparse":
    case "reading_order_conflict":
      return "semantic";
    case "measurement_unavailable":
      return "measured";
  }
}

export function layoutLintKey(issue: LayoutLintIssue): string {
  return `${issue.code}:${issue.zone ?? ""}:${[...new Set(issue.elementIds)].sort().join(",")}`;
}

export function groupLayoutLintIssues(
  issues: readonly LayoutLintIssue[],
): LayoutLintIssue[] {
  const grouped: LayoutLintIssue[] = [];
  for (const groupKey of [...new Set(issues.map((issue) => `${issue.code}:${issue.zone ?? ""}`))]) {
    const matching = issues.filter(
      (issue) => `${issue.code}:${issue.zone ?? ""}` === groupKey,
    );
    const code = matching[0].code;
    const zone = matching[0].zone;
    const components: string[][] = [];
    for (const issue of matching) {
      const ids = [...new Set(issue.elementIds)];
      if (ids.length === 0) {
        if (!components.some((component) => component.length === 0)) components.push([]);
        continue;
      }
      const touching = components.filter((component) =>
        component.some((id) => ids.includes(id)),
      );
      const merged = [...new Set([...ids, ...touching.flat()])].sort();
      for (const component of touching) components.splice(components.indexOf(component), 1);
      components.push(merged);
    }
    grouped.push(...components.map((elementIds) => ({
      code,
      elementIds,
      ...(zone ? { zone } : {}),
    })));
  }
  return grouped.sort((left, right) => layoutLintKey(left).localeCompare(layoutLintKey(right)));
}

export class SurfacedLayoutFindings {
  private readonly keys = new Set<string>();

  unsurfaced(issues: readonly LayoutLintIssue[]): LayoutLintIssue[] {
    return groupLayoutLintIssues(issues).filter((issue) => !this.keys.has(layoutLintKey(issue)));
  }

  markSurfaced(issues: readonly LayoutLintIssue[]): void {
    for (const issue of groupLayoutLintIssues(issues)) this.keys.add(layoutLintKey(issue));
  }

  clear(): void {
    this.keys.clear();
  }
}

const MATERIAL_OVERLAP_RATIO = 0.15;
const BOUNDARY_TOLERANCE = 4;

export function lintBoardGeometry(
  geometries: readonly BoardGeometry[],
): LayoutLintIssue[] {
  const issues: LayoutLintIssue[] = [];
  // The same stroke-level ink model the label solver uses, across every element.
  const ink = new InkIndex();
  for (const geometry of geometries) for (const polyline of geometryInk(geometry)) ink.add(polyline);
  const labels = geometries.flatMap((geometry) =>
    geometry.labels.map((label) => ({
      elementId: geometry.id,
      solverPlaced: (label.mobility ?? (label.autoPlace ? "free" : "fixed")) !== "fixed",
      box: labelBounds(label),
      boundary: boardBoundary(),
    })),
  );

  for (let left = 0; left < labels.length; left += 1) {
    const label = labels[left];
    if (!containsWithTolerance(label.boundary, label.box)) {
      issues.push({ code: "label_out_of_bounds", elementIds: [label.elementId] });
    }
    if (label.solverPlaced && ink.hits(label.box) > 0) {
      issues.push({ code: "label_ink_overlap", elementIds: [label.elementId] });
    }
    for (let right = left + 1; right < labels.length; right += 1) {
      const other = labels[right];
      if (overlapRatio(label.box, other.box) > MATERIAL_OVERLAP_RATIO) {
        issues.push({
          code: "label_overlap",
          elementIds: [label.elementId, other.elementId],
        });
      }
    }
  }

  for (const geometry of geometries) {
    if (geometry.text && !fitBoardText(geometry.text, geometry.box).fits) {
      issues.push({ code: "text_overflow", elementIds: [geometry.id] });
    }
  }

  return issues;
}

function boardBoundary(): LayoutBox {
  return { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT };
}

function containsWithTolerance(boundary: LayoutBox, box: LayoutBox): boolean {
  return (
    box.x >= boundary.x - BOUNDARY_TOLERANCE &&
    box.y >= boundary.y - BOUNDARY_TOLERANCE &&
    box.x + box.width <= boundary.x + boundary.width + BOUNDARY_TOLERANCE &&
    box.y + box.height <= boundary.y + boundary.height + BOUNDARY_TOLERANCE
  );
}
