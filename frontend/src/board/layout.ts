import type { LayoutRelation, LessonOp, Region } from "./lesson.generated";
import type { NormalizedStep } from "./decode";
import {
  ConstructionResolutionError,
  constructionBounds,
  isConstructionOp,
  resolveConstruction,
  type ConstructionFailureCode,
  type ConstructionOp,
  type ResolvedConstruction,
} from "./construction";
import { diagramBounds, mapDiagramPoint } from "./diagramGeometry";
import type { LayoutLintIssue } from "./layoutLint";
import type { RootMeasurement } from "./precommitMeasurement";

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
const PADDING = 48;
const GAP = 24;
const COLUMN_WIDTH = (BOARD_WIDTH - PADDING * 2 - GAP * 3) / 4;
const ROW_HEIGHT = (BOARD_HEIGHT - PADDING * 2 - GAP * 2) / 3;
const OCCUPANCY_COLUMNS = 40;
const OCCUPANCY_ROWS = 24;
const MAX_EMPTY_RECTANGLES = 8;
const READING_ORDER_TOLERANCE = 24;
const MATERIAL_OVERLAP_RATIO = 0.15;
const GRID_REGIONS = [
  "A1", "A2", "A3", "B1", "B2", "B3",
  "C1", "C2", "C3", "D1", "D2", "D3",
] as const satisfies readonly Region[];
const ALL_REGIONS = [...GRID_REGIONS, "left", "right", "full"] as const satisfies readonly Region[];

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutOp {
  op: LessonOp;
  box: LayoutBox;
  canvasBox?: LayoutBox;
  construction?: ResolvedConstruction;
  stepIndex: number;
  opIndex: number;
}

export interface LayoutResolutionWarning {
  id: string;
  code: ConstructionFailureCode | "missing_dependency";
  detail: string;
}

export interface OccupancyZoneStats {
  occupiedCells: number;
  totalCells: number;
  occupancyRatio: number;
  elementIds: string[];
  rootIds: string[];
}

export interface OccupancyComponent {
  bounds: LayoutBox;
  elementIds: string[];
}

export interface BoardOccupancyExpectations {
  /** Sparse findings are emitted only for zones the composition plan names. */
  expectedZones?: readonly Region[];
  /** Imbalance is meaningful only when the composition plan asks for two sides. */
  balance?: "horizontal";
}

export interface BoardOccupancyAnalysis {
  elementCount: number;
  occupiedCells: number;
  totalCells: number;
  occupancyRatio: number;
  components: OccupancyComponent[];
  emptyRectangles: LayoutBox[];
  zones: Record<Region, OccupancyZoneStats>;
  findings: LayoutLintIssue[];
}

export interface PlacementCandidateSet {
  preferred: LayoutBox;
  candidates: LayoutBox[];
}

export interface LayoutOptions {
  measurements?: ReadonlyMap<string, RootMeasurement>;
  /** Browser-owned expectations derived from a validated closed composition plan. */
  occupancyExpectations?: BoardOccupancyExpectations;
  /** Retained-evidence baseline; product callers always use bounded placement. */
  candidatePlacement?: "bounded" | "preferred-only";
  onWarning?: (warning: LayoutResolutionWarning) => void;
}

export function regionBox(region: Region): LayoutBox {
  if (region === "full") {
    return { x: PADDING, y: PADDING, width: BOARD_WIDTH - PADDING * 2, height: BOARD_HEIGHT - PADDING * 2 };
  }
  if (region === "left" || region === "right") {
    const x = region === "left" ? PADDING : PADDING + (COLUMN_WIDTH + GAP) * 2;
    return { x, y: PADDING, width: COLUMN_WIDTH * 2 + GAP, height: BOARD_HEIGHT - PADDING * 2 };
  }
  const column = region.charCodeAt(0) - "A".charCodeAt(0);
  const row = Number(region[1]) - 1;
  return {
    x: PADDING + column * (COLUMN_WIDTH + GAP),
    y: PADDING + row * (ROW_HEIGHT + GAP),
    width: COLUMN_WIDTH,
    height: ROW_HEIGHT,
  };
}

/**
 * Analyze the renderer's actual element bounds on a fixed, bounded grid.
 * Curves are represented by their axes and are therefore excluded; diagram
 * coordinate canvases are deliberately ignored in favor of each op's ink box.
 */
export function analyzeBoardOccupancy(
  laidOut: readonly LaidOutOp[],
  expectations: BoardOccupancyExpectations = {},
): BoardOccupancyAnalysis {
  const deduplicated = deduplicatedOccupancyElements(laidOut);
  const cellWidth = BOARD_WIDTH / OCCUPANCY_COLUMNS;
  const cellHeight = BOARD_HEIGHT / OCCUPANCY_ROWS;
  const cells = Array.from(
    { length: OCCUPANCY_ROWS },
    () => Array.from({ length: OCCUPANCY_COLUMNS }, () => new Set<string>()),
  );
  const elementIdsByCell = Array.from(
    { length: OCCUPANCY_ROWS },
    () => Array.from({ length: OCCUPANCY_COLUMNS }, () => new Set<string>()),
  );

  for (const element of deduplicated) {
    const clipped = intersectBox(element.box, boardBox());
    if (!clipped || clipped.width <= 0 || clipped.height <= 0) continue;
    const firstColumn = clampInteger(Math.floor(clipped.x / cellWidth), 0, OCCUPANCY_COLUMNS - 1);
    const lastColumn = clampInteger(
      Math.ceil((clipped.x + clipped.width) / cellWidth) - 1,
      0,
      OCCUPANCY_COLUMNS - 1,
    );
    const firstRow = clampInteger(Math.floor(clipped.y / cellHeight), 0, OCCUPANCY_ROWS - 1);
    const lastRow = clampInteger(
      Math.ceil((clipped.y + clipped.height) / cellHeight) - 1,
      0,
      OCCUPANCY_ROWS - 1,
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        cells[row][column].add(element.rootId);
        elementIdsByCell[row][column].add(element.id);
      }
    }
  }

  const occupiedCells = cells.reduce(
    (total, row) => total + row.filter((cell) => cell.size > 0).length,
    0,
  );
  const totalCells = OCCUPANCY_COLUMNS * OCCUPANCY_ROWS;
  const zones = Object.fromEntries(
    ALL_REGIONS.map((region) => [
      region,
      occupancyForZone(cells, elementIdsByCell, regionBox(region), cellWidth, cellHeight),
    ]),
  ) as Record<Region, OccupancyZoneStats>;
  const findings = densityFindings(deduplicated, zones, expectations);

  return {
    elementCount: deduplicated.length,
    occupiedCells,
    totalCells,
    occupancyRatio: occupiedCells / totalCells,
    components: occupiedComponents(cells, elementIdsByCell, cellWidth, cellHeight),
    emptyRectangles: largestEmptyRectangles(cells, cellWidth, cellHeight),
    zones,
    findings,
  };
}

/**
 * The only reading-order signal accepted by Phase 1: a later text/equation
 * explicitly references earlier geometry, while its resolved position reads
 * materially before that geometry (above, or left in the same visual band).
 */
export function findReadingOrderConflicts(
  laidOut: readonly LaidOutOp[],
  steps: readonly NormalizedStep[],
): LayoutLintIssue[] {
  const byId = new Map(laidOut.map((item) => [item.op.id, item]));
  const issues: LayoutLintIssue[] = [];
  for (const item of laidOut) {
    if (item.op.op !== "text" && item.op.op !== "equation") continue;
    const references = explicitReadingReferences(item, steps[item.stepIndex]);
    for (const referenceId of references) {
      const reference = byId.get(referenceId);
      if (
        !reference ||
        reference.op.op === "text" ||
        reference.op.op === "equation" ||
        !temporallyAfter(item, reference) ||
        !spatiallyPrecedes(item.box, reference.box)
      ) {
        continue;
      }
      issues.push({
        code: "reading_order_conflict",
        elementIds: [item.op.id, reference.op.id],
      });
    }
  }
  return issues;
}

/** Closed hard-finding vector used by retained candidate-regression evidence. */
export function layoutHardFindingVector(
  laidOut: readonly LaidOutOp[],
  steps: readonly NormalizedStep[],
): readonly [number, number, number] {
  const byRoot = new Map<string, OccupancyElement[]>();
  for (const element of deduplicatedOccupancyElements(laidOut)) {
    byRoot.set(element.rootId, [...(byRoot.get(element.rootId) ?? []), element]);
  }
  const groups = [...byRoot.values()];
  const boundaryEscapes = groups.filter((group) =>
    group.some((element) => !containsBox(boardBox(), element.box))
  ).length;
  let overlaps = 0;
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      if (
        groups[left].some((leftElement) =>
          groups[right].some((rightElement) =>
            overlapRatio(leftElement.box, rightElement.box) > MATERIAL_OVERLAP_RATIO
          )
        )
      ) {
        overlaps += 1;
      }
    }
  }
  return [boundaryEscapes, overlaps, findReadingOrderConflicts(laidOut, steps).length];
}

/** Exposes the bounded placement surface for property tests and future hosts. */
export function boundedPlacementCandidates(
  preferred: LayoutBox,
  probes: readonly LayoutBox[],
  elementId: string,
): PlacementCandidateSet {
  const unique = new Map<string, LayoutBox>();
  for (const candidate of [preferred, ...probes]) {
    unique.set(boxKey(candidate), candidate);
  }
  const alternatives = [...unique.values()]
    .filter((candidate) => boxKey(candidate) !== boxKey(preferred))
    .sort((left, right) => {
      const distance = boxDistance(left, preferred) - boxDistance(right, preferred);
      if (distance !== 0) return distance;
      return stableCandidateTie(elementId, left) - stableCandidateTie(elementId, right);
    })
    .slice(0, 2);
  return { preferred, candidates: [preferred, ...alternatives] };
}

export function layoutSteps(
  steps: readonly NormalizedStep[],
  options: LayoutOptions = {},
): LaidOutOp[] {
  // Placement may depend only on earlier ops so that streaming in a later
  // step can never move ink that is already on the board (prefix stability).
  const result: LaidOutOp[] = [];
  const boxes = new Map<string, LayoutBox>();
  const coordinateSpaces = new Map<string, LayoutBox>();
  const regionCursors = new Map<Region, number>();

  steps.forEach((step, stepIndex) => {
    const stepStart = result.length;
    const placeRelationIds = new Set(
      (step.layout ?? [])
        .filter((relation): relation is Extract<LayoutRelation, { kind: "place" }> =>
          relation.kind === "place")
        .map((relation) => relation.id),
    );
    step.ops.forEach((op, opIndex) => {
      let box: LayoutBox;
      let canvasBox: LayoutBox | undefined;
      let construction: ResolvedConstruction | undefined;
      if (isConstructionOp(op)) {
        try {
          construction = resolveConstruction(op, result.slice(0, stepStart));
        } catch (error) {
          const warning = error instanceof ConstructionResolutionError
            ? { id: op.id, code: error.code, detail: error.message }
            : {
                id: op.id,
                code: "unsupported_geometry" as const,
                detail: "Construction resolution failed.",
              };
          options.onWarning?.(warning);
          return;
        }
        canvasBox = construction.canvas;
        box = constructionBounds(construction);
      } else if (followsParent(op)) {
        const axesBox = boxes.get(op.op === "curve" ? op.axes_id : op.on);
        if (!axesBox) {
          options.onWarning?.({
            id: op.id,
            code: "missing_dependency",
            detail: "Curve dependency is not resolved.",
          });
          return;
        }
        box = axesBox;
      } else if (isDiagramOp(op)) {
        if ("canvas_id" in op) {
          canvasBox = coordinateSpaces.get(op.canvas_id);
          if (!canvasBox) {
            options.onWarning?.({
              id: op.id,
              code: "missing_dependency",
              detail: "Diagram canvas dependency is not resolved.",
            });
            return;
          }
        } else {
          canvasBox = squareDiagramCanvas(
            allocateRegionBox(op.region, intrinsicSize(op, options.measurements), regionCursors),
          );
          if (!placeRelationIds.has(op.id)) {
            canvasBox = resolveCollision(
              canvasBox,
              op,
              result,
              boxes,
              step,
              stepIndex,
              opIndex,
              options.measurements,
              options.occupancyExpectations,
              options.candidatePlacement,
            );
          }
          if (!placeRelationIds.has(op.id) && options.candidatePlacement !== "preferred-only") {
            const diagramOp = op;
            canvasBox = clearPlacement(canvasBox, result, (candidate) => diagramElementBounds(diagramOp, candidate));
          }
        }
        box = diagramElementBounds(op, canvasBox);
      } else if ("anchor" in op) {
        const target = boxes.get(op.anchor.el);
        if (!target) {
          options.onWarning?.({
            id: op.id,
            code: "missing_dependency",
            detail: "Anchor dependency is not resolved.",
          });
          return;
        }
        box = anchorBox(
          target,
          op.anchor.side,
          op.anchor.gap ?? 0.08,
          intrinsicSize(op, options.measurements),
        );
      } else {
        box = allocateRegionBox(op.region, intrinsicSize(op, options.measurements), regionCursors);
      }
      if (
        !construction &&
        !followsParent(op) &&
        !isDiagramOp(op) &&
        !placeRelationIds.has(op.id)
      ) {
        box = resolveCollision(
          box,
          op,
          result,
          boxes,
          step,
          stepIndex,
          opIndex,
          options.measurements,
          options.occupancyExpectations,
          options.candidatePlacement,
        );
        if (options.candidatePlacement !== "preferred-only") box = clearPlacement(box, result);
      }
      boxes.set(op.id, box);
      if (canvasBox) coordinateSpaces.set(op.id, canvasBox);
      result.push({
        op,
        box,
        ...(canvasBox ? { canvasBox } : {}),
        ...(construction ? { construction } : {}),
        stepIndex,
        opIndex,
      });
    });
    applyLayoutRelations(
      step.layout ?? [],
      result,
      boxes,
      coordinateSpaces,
      stepStart,
      step,
      options,
    );
  });
  return result;
}

function applyLayoutRelations(
  relations: readonly LayoutRelation[],
  result: LaidOutOp[],
  boxes: Map<string, LayoutBox>,
  coordinateSpaces: Map<string, LayoutBox>,
  stepStart: number,
  step: NormalizedStep,
  options: LayoutOptions,
): void {
  const currentIds = new Set(result.slice(stepStart).map(({ op }) => op.id));
  for (const relation of relations) {
    const movingIds = relation.kind === "place" ? [relation.id] : relation.ids;
    if (movingIds.some((id) => !currentIds.has(id))) continue;
    if (movingIds.some((id) => !isMovableRoot(result, id))) continue;

    if (relation.kind === "place") {
      const moving = boxes.get(relation.id);
      const reference = boxes.get(relation.relative_to);
      if (!moving || !reference) continue;
      const target = relativeLayoutBox(moving, reference, relation);
      const item = result.find(({ op }) => op.id === relation.id);
      if (!item || followsParent(item.op)) continue;
      const alternatives = (["above", "below", "left", "right"] as const)
        .filter((side) => side !== relation.side)
        .map((side) => relativeLayoutBox(moving, reference, { ...relation, side }));
      const chosen = selectPlacementCandidate(
        target,
        alternatives,
        item.op,
        result,
        boxes,
        step,
        item.stepIndex,
        item.opIndex,
        [relation.relative_to],
        undefined,
        options.occupancyExpectations,
        options.candidatePlacement,
        moving,
      );
      translateRoot(
        relation.id,
        chosen.x - moving.x,
        chosen.y - moving.y,
        result,
        boxes,
        coordinateSpaces,
      );
      clampRootGroup([relation.id], result, boxes, coordinateSpaces);
      continue;
    }

    if (relation.kind === "stack") {
      const memberBoxes = movingIds.map((id) => boxes.get(id)).filter(isLayoutBox);
      if (memberBoxes.length !== movingIds.length) continue;
      const crossSize = Math.max(...memberBoxes.map((box) =>
        relation.direction === "vertical" ? box.width : box.height));
      let cursor = relation.direction === "vertical"
        ? memberBoxes[0].y
        : memberBoxes[0].x;
      const gapPixels = relation.gap * (
        relation.direction === "vertical" ? BOARD_HEIGHT : BOARD_WIDTH
      );
      movingIds.forEach((id, index) => {
        const box = boxes.get(id)!;
        const targetX = relation.direction === "vertical"
          ? alignedCoordinate(memberBoxes[0].x, crossSize, box.width, relation.align)
          : cursor;
        const targetY = relation.direction === "vertical"
          ? cursor
          : alignedCoordinate(memberBoxes[0].y, crossSize, box.height, relation.align);
        translateRoot(id, targetX - box.x, targetY - box.y, result, boxes, coordinateSpaces);
        const moved = boxes.get(id)!;
        cursor += (relation.direction === "vertical" ? moved.height : moved.width) +
          (index === movingIds.length - 1 ? 0 : gapPixels);
      });
      clampRootGroup(movingIds, result, boxes, coordinateSpaces);
      continue;
    }

    if (relation.kind === "align") {
      const memberBoxes = movingIds.map((id) => boxes.get(id)).filter(isLayoutBox);
      if (memberBoxes.length !== movingIds.length) continue;
      const boundary = unionBoxes(memberBoxes);
      for (const id of movingIds) {
        const box = boxes.get(id)!;
        const target = relation.axis === "horizontal"
          ? alignedCoordinate(boundary.x, boundary.width, box.width, relation.alignment)
          : alignedCoordinate(boundary.y, boundary.height, box.height, relation.alignment);
        translateRoot(
          id,
          relation.axis === "horizontal" ? target - box.x : 0,
          relation.axis === "vertical" ? target - box.y : 0,
          result,
          boxes,
          coordinateSpaces,
        );
      }
      clampRootGroup(movingIds, result, boxes, coordinateSpaces);
      continue;
    }

    const memberBoxes = movingIds.map((id) => boxes.get(id)).filter(isLayoutBox);
    if (memberBoxes.length !== movingIds.length) continue;
    const boundary = unionBoxes(memberBoxes);
    const totalSize = memberBoxes.reduce(
      (sum, box) => sum + (relation.direction === "horizontal" ? box.width : box.height),
      0,
    );
    const span = relation.direction === "horizontal" ? boundary.width : boundary.height;
    const gap = Math.max(0, (span - totalSize) / (movingIds.length - 1));
    let cursor = relation.direction === "horizontal" ? boundary.x : boundary.y;
    for (const id of movingIds) {
      const box = boxes.get(id)!;
      translateRoot(
        id,
        relation.direction === "horizontal" ? cursor - box.x : 0,
        relation.direction === "vertical" ? cursor - box.y : 0,
        result,
        boxes,
        coordinateSpaces,
      );
      const moved = boxes.get(id)!;
      cursor += (relation.direction === "horizontal" ? moved.width : moved.height) + gap;
    }
    clampRootGroup(movingIds, result, boxes, coordinateSpaces);
  }
}

function isMovableRoot(result: readonly LaidOutOp[], id: string): boolean {
  const item = result.find(({ op }) => op.id === id);
  return Boolean(
    item && !item.construction && !followsParent(item.op) && !("canvas_id" in item.op),
  );
}

function relativeLayoutBox(
  moving: LayoutBox,
  reference: LayoutBox,
  relation: Extract<LayoutRelation, { kind: "place" }>,
): LayoutBox {
  const vertical = relation.side === "above" || relation.side === "below";
  const gap = relation.gap * (vertical ? BOARD_HEIGHT : BOARD_WIDTH);
  const crossStart = vertical ? reference.x : reference.y;
  const crossSize = vertical ? reference.width : reference.height;
  const movingCrossSize = vertical ? moving.width : moving.height;
  const cross = alignedCoordinate(crossStart, crossSize, movingCrossSize, relation.align);
  if (relation.side === "above") return { ...moving, x: cross, y: reference.y - moving.height - gap };
  if (relation.side === "below") return { ...moving, x: cross, y: reference.y + reference.height + gap };
  if (relation.side === "left") return { ...moving, x: reference.x - moving.width - gap, y: cross };
  return { ...moving, x: reference.x + reference.width + gap, y: cross };
}

function alignedCoordinate(
  start: number,
  available: number,
  size: number,
  alignment: "start" | "center" | "end",
): number {
  if (alignment === "start") return start;
  if (alignment === "end") return start + available - size;
  return start + (available - size) / 2;
}

function translateRoot(
  rootId: string,
  dx: number,
  dy: number,
  result: LaidOutOp[],
  boxes: Map<string, LayoutBox>,
  coordinateSpaces: Map<string, LayoutBox>,
): void {
  if (dx === 0 && dy === 0) return;
  const moved = new Set<string>();
  const visit = (id: string) => {
    if (moved.has(id)) return;
    moved.add(id);
    const index = result.findIndex(({ op }) => op.id === id);
    if (index < 0) return;
    const item = result[index];
    const box = translateBox(item.box, dx, dy);
    const canvasBox = item.canvasBox ? translateBox(item.canvasBox, dx, dy) : undefined;
    result[index] = { ...item, box, ...(canvasBox ? { canvasBox } : {}) };
    boxes.set(id, box);
    if (canvasBox) coordinateSpaces.set(id, canvasBox);
    for (const candidate of result) {
      if (
        parentOf(candidate.op) === id ||
        ("canvas_id" in candidate.op && candidate.op.canvas_id === id) ||
        ("anchor" in candidate.op && candidate.op.anchor.el === id)
      ) {
        visit(candidate.op.id);
      }
    }
  };
  visit(rootId);
}

function clampRootGroup(
  ids: readonly string[],
  result: LaidOutOp[],
  boxes: Map<string, LayoutBox>,
  coordinateSpaces: Map<string, LayoutBox>,
): void {
  const memberBoxes = ids.map((id) => boxes.get(id)).filter(isLayoutBox);
  if (memberBoxes.length === 0) return;
  const boundary = unionBoxes(memberBoxes);
  const dx = boundary.x < PADDING
    ? PADDING - boundary.x
    : boundary.x + boundary.width > BOARD_WIDTH - PADDING
      ? BOARD_WIDTH - PADDING - boundary.x - boundary.width
      : 0;
  const dy = boundary.y < PADDING
    ? PADDING - boundary.y
    : boundary.y + boundary.height > BOARD_HEIGHT - PADDING
      ? BOARD_HEIGHT - PADDING - boundary.y - boundary.height
      : 0;
  if (dx === 0 && dy === 0) return;
  for (const id of ids) translateRoot(id, dx, dy, result, boxes, coordinateSpaces);
}

function unionBoxes(boxes: readonly LayoutBox[]): LayoutBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function translateBox(box: LayoutBox, dx: number, dy: number): LayoutBox {
  return { ...box, x: box.x + dx, y: box.y + dy };
}

function isLayoutBox(box: LayoutBox | undefined): box is LayoutBox {
  return box !== undefined;
}

/**
 * A diagram's normalized [0,1]² canvas must scale uniformly: a stretched canvas
 * draws circles as ellipses and makes angle arcs, perpendiculars, and slopes
 * disagree with the geometry they label.
 */
function squareDiagramCanvas(box: LayoutBox): LayoutBox {
  const side = Math.min(box.width, box.height);
  return { x: box.x + (box.width - side) / 2, y: box.y, width: side, height: side };
}

/** Any intrusion beyond this share of the smaller box counts as an overlap. */
const CLEAR_OVERLAP_RATIO = 0.02;
const CLEAR_SCAN_STEP = 24;
const CLEAR_SCALES = [1, 0.85, 0.72, 0.6] as const;

/**
 * The board-wide no-overlap guarantee for roots. Whatever placement scoring
 * chose, a root that still intrudes on a committed root moves to the nearest
 * clear spot, and only if none exists at full size does it shrink (text,
 * equations, and diagrams all fit whatever box they receive). Committed roots
 * are never moved, so this is prefix-stable. If nothing fits even at the
 * smallest scale, the scored placement stands and lints report the overlap.
 */
function clearPlacement(
  preferred: LayoutBox,
  laidOut: readonly LaidOutOp[],
  actualBounds: (candidate: LayoutBox) => LayoutBox = (candidate) => candidate,
): LayoutBox {
  const obstacles = laidOut.filter((item) => !followsParent(item.op)).map((item) => item.box);
  const board = boardBox();
  const isClear = (actual: LayoutBox) =>
    containsBox(board, actual) &&
    !obstacles.some((box) => overlapRatio(actual, box) > CLEAR_OVERLAP_RATIO);
  if (isClear(actualBounds(preferred))) return preferred;
  const centerX = preferred.x + preferred.width / 2;
  const centerY = preferred.y + preferred.height / 2;
  for (const scale of CLEAR_SCALES) {
    const width = preferred.width * scale;
    const height = preferred.height * scale;
    // Actual bounds translate with the box, so measure them once per scale.
    const origin = actualBounds({ x: 0, y: 0, width, height });
    let best: { box: LayoutBox; distance: number } | undefined;
    for (let y = board.y; y + height <= board.y + board.height; y += CLEAR_SCAN_STEP) {
      for (let x = board.x; x + width <= board.x + board.width; x += CLEAR_SCAN_STEP) {
        const distance = Math.hypot(x + width / 2 - centerX, y + height / 2 - centerY);
        if (best && distance >= best.distance) continue;
        if (isClear(translateBox(origin, x, y))) best = { box: { x, y, width, height }, distance };
      }
    }
    if (best) return best.box;
  }
  return preferred;
}

function allocateRegionBox(
  region: Region,
  size: { width: number; height: number },
  regionCursors: Map<Region, number>,
): LayoutBox {
  const boundary = regionBox(region);
  const availableHeight = boundary.height - 36;
  const cursor = regionCursors.get(region) ?? 0;
  const remaining = Math.max(0, availableHeight - cursor);
  // The first occupant may take its full intrinsic height; later occupants
  // take at most half the remaining room, preserving streamed prefixes.
  const height =
    cursor === 0 ? Math.min(size.height, remaining) : Math.min(size.height, remaining / 2);
  const gap = Math.min(16, Math.max(0, (remaining - height) / 2));
  regionCursors.set(region, cursor + height + gap);
  return {
    x: boundary.x + 20,
    y: boundary.y + 18 + cursor,
    width: Math.min(size.width, boundary.width - 40),
    height,
  };
}

function resolveCollision(
  preferred: LayoutBox,
  op: Exclude<LessonOp, { op: "curve" }>,
  laidOut: readonly LaidOutOp[],
  boxes: ReadonlyMap<string, LayoutBox>,
  step: NormalizedStep,
  stepIndex: number,
  opIndex: number,
  measurements?: ReadonlyMap<string, RootMeasurement>,
  occupancyExpectations: BoardOccupancyExpectations = {},
  candidatePlacement: "bounded" | "preferred-only" = "bounded",
): LayoutBox {
  if (candidatePlacement === "preferred-only") return preferred;
  const preferredActual = isDiagramOp(op) ? diagramElementBounds(op, preferred) : preferred;
  const preferredReferenceIds = "anchor" in op ? [op.anchor.el] : [];
  const temporary: LaidOutOp = { op, box: preferredActual, stepIndex, opIndex };
  const preferredDensityFindings = analyzeBoardOccupancy(
    [...laidOut, temporary],
    occupancyExpectations,
  ).findings.filter(isDensityFinding);
  if (
    containsBox(boardBox(), preferredActual) &&
    !laidOut.some(
      (item) => !followsParent(item.op) &&
        overlapRatio(preferredActual, item.box) > MATERIAL_OVERLAP_RATIO,
    ) &&
    !preferredReferenceIds.some((referenceId) => {
      const reference = laidOut.find((item) => item.op.id === referenceId);
      return Boolean(reference && temporallyAfter(temporary, reference) &&
        spatiallyPrecedes(preferredActual, reference.box));
    }) &&
    preferredDensityFindings.length === 0
  ) {
    return preferred;
  }
  const probes = "anchor" in op
    ? anchorProbes(op, boxes, preferred, measurements)
    : "region" in op
      ? regionProbes(
          preferred,
          regionBox(op.region),
          op,
          laidOut,
          occupancyExpectations,
        )
      : [preferred];
  return selectPlacementCandidate(
    preferred,
    probes,
    op,
    laidOut,
    boxes,
    step,
    stepIndex,
    opIndex,
    "anchor" in op ? [op.anchor.el] : [],
    isDiagramOp(op) ? (candidate) => diagramElementBounds(op, candidate) : undefined,
    occupancyExpectations,
    candidatePlacement,
  );
}

function anchorProbes(
  op: Extract<LessonOp, { anchor: unknown }>,
  boxes: ReadonlyMap<string, LayoutBox>,
  preferred: LayoutBox,
  measurements?: ReadonlyMap<string, RootMeasurement>,
): LayoutBox[] {
  const target = boxes.get(op.anchor.el);
  if (!target) return [preferred];
  const size = intrinsicSize(op, measurements);
  const opposite = {
    above: "below",
    below: "above",
    left: "right",
    right: "left",
  } as const;
  const remaining = (["above", "below", "left", "right"] as const)
    .filter((side) => side !== op.anchor.side && side !== opposite[op.anchor.side])
    .sort((left, right) =>
      stableStringTie(`${op.id}:${left}`) - stableStringTie(`${op.id}:${right}`));
  const sides = [op.anchor.side, opposite[op.anchor.side], remaining[0]] as const;
  return sides.map((side) =>
    anchorBox(target, side, op.anchor.gap ?? 0.08, size),
  );
}

function regionProbes(
  preferred: LayoutBox,
  boundary: LayoutBox,
  op: Exclude<LessonOp, { op: "curve" }>,
  occupied: readonly LaidOutOp[],
  expectations: BoardOccupancyExpectations,
): LayoutBox[] {
  const analysis = analyzeBoardOccupancy(occupied);
  const targetRectangles: LayoutBox[] = [];
  const expectedBoundaries = [...new Set(expectations.expectedZones ?? [])]
    .map(regionBox);
  for (const expectedBoundary of expectedBoundaries) {
    if (targetRectangles.length >= 2) break;
    targetRectangles.push(
      bestAvailableRectangle(expectedBoundary, analysis.emptyRectangles, preferred),
    );
  }
  for (const empty of analysis.emptyRectangles) {
    if (targetRectangles.length >= 2) break;
    const available = intersectBox(empty, boundary);
    if (available) targetRectangles.push(available);
  }
  if (targetRectangles.length === 0) targetRectangles.push(boundary);

  const probes = targetRectangles
    .slice(0, 2)
    .map((target) => fitCandidateInside(preferred, target))
    .filter(isLayoutBox);
  const actual = (candidate: LayoutBox) =>
    isDiagramOp(op) ? diagramElementBounds(op, candidate) : candidate;
  const ranked = probes
    .filter((candidate) => boxKey(candidate) !== boxKey(preferred))
    .sort((left, right) => {
      const leftActual = actual(left);
      const rightActual = actual(right);
      const leftOverlaps = occupied.filter(
        (item) => !followsParent(item.op) && overlapRatio(leftActual, item.box) > MATERIAL_OVERLAP_RATIO,
      ).length;
      const rightOverlaps = occupied.filter(
        (item) => !followsParent(item.op) && overlapRatio(rightActual, item.box) > MATERIAL_OVERLAP_RATIO,
      ).length;
      return leftOverlaps - rightOverlaps ||
        boxDistance(left, preferred) - boxDistance(right, preferred) ||
        stableCandidateTie(op.id, left) - stableCandidateTie(op.id, right);
    });
  return [preferred, ...ranked];
}

interface CandidateScore {
  box: LayoutBox;
  actualBox: LayoutBox;
  hard: readonly [number, number, number];
  crowdedRegions: number;
  sparseRegions: number;
  imbalancedRegions: number;
  referenceDistance: number;
  densityImbalance: number;
  movement: number;
  tie: number;
}

function selectPlacementCandidate(
  preferred: LayoutBox,
  probes: readonly LayoutBox[],
  op: Exclude<LessonOp, { op: "curve" }>,
  laidOut: readonly LaidOutOp[],
  _boxes: ReadonlyMap<string, LayoutBox>,
  step: NormalizedStep,
  stepIndex: number,
  opIndex: number,
  explicitReferences: readonly string[],
  actualFromPlacement: (box: LayoutBox) => LayoutBox = (box) => box,
  occupancyExpectations: BoardOccupancyExpectations = {},
  candidatePlacement: "bounded" | "preferred-only" = "bounded",
  movingOrigin?: LayoutBox,
): LayoutBox {
  if (candidatePlacement === "preferred-only") return preferred;
  const movingGroup = movingOrigin ? rootGroupItems(laidOut, op.id) : [];
  const movingIds = new Set(movingGroup.map((item) => item.op.id));
  const occupied = laidOut.filter((item) => !movingIds.has(item.op.id));
  const byId = new Map(occupied.map((item) => [item.op.id, item]));
  const boundedInput = boundedPlacementCandidates(preferred, probes, op.id).candidates;
  const score = (candidate: LayoutBox): CandidateScore => {
    const projected = movingGroup.length > 0 && movingOrigin
      ? projectRootGroup(movingGroup, op.id, movingOrigin, candidate)
      : [{ op, box: actualFromPlacement(candidate), stepIndex, opIndex }];
    const temporary = projected.find((item) => item.op.id === op.id)!;
    const actualBox = temporary.box;
    const hypothetical = [...occupied, ...projected];
    const analysis = analyzeBoardOccupancy(hypothetical, occupancyExpectations);
    const overlaps = projected.reduce(
      (total, projectedItem) => total + (
        followsParent(projectedItem.op)
          ? 0
          : occupied.filter(
              (item) => !followsParent(item.op) &&
                overlapRatio(projectedItem.box, item.box) > MATERIAL_OVERLAP_RATIO,
            ).length
      ),
      0,
    );
    const readingConflicts = explicitReferences.filter((referenceId) => {
      const reference = byId.get(referenceId);
      return Boolean(
        reference &&
        reference.op.op !== "text" &&
        reference.op.op !== "equation" &&
        temporallyAfter(temporary, reference) &&
        spatiallyPrecedes(actualBox, reference.box),
      );
    }).length;
    const boundaryEscapes = projected.filter(
      (item) => !followsParent(item.op) && !containsBox(boardBox(), item.box),
    ).length;
    const crowdedRegions = analysis.findings.filter(
      (finding) => finding.code === "region_crowded",
    ).length;
    const sparseRegions = analysis.findings.filter(
      (finding) => finding.code === "region_sparse",
    ).length;
    const imbalancedRegions = analysis.findings.filter(
      (finding) => finding.code === "board_imbalanced",
    ).length;
    const referenceDistance = explicitReferences.length === 0
      ? 0
      : explicitReferences.reduce(
          (total, referenceId) => total + edgeDistance(actualBox, byId.get(referenceId)?.box),
          0,
        ) / explicitReferences.length;
    return {
      box: candidate,
      actualBox,
      hard: [boundaryEscapes, overlaps, readingConflicts],
      crowdedRegions,
      sparseRegions,
      imbalancedRegions,
      referenceDistance,
      densityImbalance: roundDensity(
        Math.abs(analysis.zones.left.occupancyRatio - analysis.zones.right.occupancyRatio),
      ),
      movement: boxDistance(candidate, preferred),
      tie: stableCandidateTie(op.id, candidate),
    };
  };
  const preferredScore = score(preferred);
  const densityContext = preferredScore.crowdedRegions > 0 ||
    preferredScore.sparseRegions > 0 ||
    preferredScore.imbalancedRegions > 0;
  if (!preferredScore.hard.some((value) => value > 0) && !densityContext) return preferred;
  const alternatives = boundedInput
    .filter((candidate) => boxKey(candidate) !== boxKey(preferred))
    .map(score)
    .sort(compareCandidateScores)
    .slice(0, 2);
  const bounded = [preferredScore, ...alternatives];
  const improvements = bounded.filter((candidate) => {
    if (candidate === preferredScore || !hardVectorNoWorse(candidate.hard, preferredScore.hard)) {
      return false;
    }
    if (hardVectorStrictlyBetter(candidate.hard, preferredScore.hard)) return true;
    return densityContext &&
      compareCandidateSoftQuality(candidate, preferredScore) < 0;
  });
  if (improvements.length === 0) return preferred;
  return [...improvements].sort(compareCandidateScores)[0].box;
}

function compareCandidateScores(left: CandidateScore, right: CandidateScore): number {
  return compareNumberVectors(left.hard, right.hard) ||
    compareCandidateSoftQuality(left, right) ||
    left.tie - right.tie;
}

function compareCandidateSoftQuality(left: CandidateScore, right: CandidateScore): number {
  return left.crowdedRegions - right.crowdedRegions ||
    left.sparseRegions - right.sparseRegions ||
    left.imbalancedRegions - right.imbalancedRegions ||
    left.referenceDistance - right.referenceDistance ||
    left.densityImbalance - right.densityImbalance ||
    left.movement - right.movement;
}

function hardVectorNoWorse(left: readonly number[], right: readonly number[]): boolean {
  return left.every((value, index) => value <= (right[index] ?? 0));
}

function hardVectorStrictlyBetter(left: readonly number[], right: readonly number[]): boolean {
  return left.some((value, index) => value < (right[index] ?? 0));
}

function roundDensity(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function isDensityFinding(finding: LayoutLintIssue): boolean {
  return finding.code === "region_crowded" ||
    finding.code === "region_sparse" ||
    finding.code === "board_imbalanced";
}

function bestAvailableRectangle(
  boundary: LayoutBox,
  emptyRectangles: readonly LayoutBox[],
  candidate: LayoutBox,
): LayoutBox {
  const fitting = emptyRectangles
    .map((empty) => intersectBox(empty, boundary))
    .filter(isLayoutBox)
    .filter((available) =>
      available.width >= candidate.width && available.height >= candidate.height
    )
    .sort((left, right) =>
      right.width * right.height - left.width * left.height ||
      left.y - right.y ||
      left.x - right.x);
  return fitting[0] ?? boundary;
}

function fitCandidateInside(candidate: LayoutBox, boundary: LayoutBox): LayoutBox | undefined {
  if (candidate.width > boundary.width || candidate.height > boundary.height) return undefined;
  const x = Math.max(
    boundary.x,
    Math.min(candidate.x, boundary.x + boundary.width - candidate.width),
  );
  const y = Math.max(
    boundary.y,
    Math.min(candidate.y, boundary.y + boundary.height - candidate.height),
  );
  return { ...candidate, x, y };
}

function rootGroupItems(laidOut: readonly LaidOutOp[], rootId: string): LaidOutOp[] {
  const memberIds = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of laidOut) {
      const parentId = parentOf(candidate.op) !== undefined
        ? parentOf(candidate.op)
        : "canvas_id" in candidate.op
          ? candidate.op.canvas_id
          : "anchor" in candidate.op
            ? candidate.op.anchor.el
            : undefined;
      if (parentId && memberIds.has(parentId) && !memberIds.has(candidate.op.id)) {
        memberIds.add(candidate.op.id);
        changed = true;
      }
    }
  }
  return laidOut.filter((item) => memberIds.has(item.op.id));
}

function projectRootGroup(
  group: readonly LaidOutOp[],
  rootId: string,
  origin: LayoutBox,
  candidate: LayoutBox,
): LaidOutOp[] {
  const dx = candidate.x - origin.x;
  const dy = candidate.y - origin.y;
  return group.map((item) => ({
    ...item,
    box: item.op.id === rootId ? candidate : translateBox(item.box, dx, dy),
    ...(item.canvasBox ? { canvasBox: translateBox(item.canvasBox, dx, dy) } : {}),
  }));
}

function compareNumberVectors(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Intersection area as a share of the smaller box: the one overlap measure for boxes. */
export function overlapRatio(left: LayoutBox, right: LayoutBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea === 0 ? 0 : (width * height) / smallerArea;
}

interface OccupancyElement {
  id: string;
  rootId: string;
  box: LayoutBox;
}

function deduplicatedOccupancyElements(
  laidOut: readonly LaidOutOp[],
): OccupancyElement[] {
  const byId = new Map(laidOut.map((item) => [item.op.id, item]));
  const rootMemo = new Map<string, string>();
  const rootOf = (id: string, visiting = new Set<string>()): string => {
    const memoized = rootMemo.get(id);
    if (memoized) return memoized;
    if (visiting.has(id)) return id;
    visiting.add(id);
    const item = byId.get(id);
    const parentId = item && "canvas_id" in item.op
      ? item.op.canvas_id
      : item && "anchor" in item.op
        ? item.op.anchor.el
        : undefined;
    const rootId = parentId && byId.has(parentId) ? rootOf(parentId, visiting) : id;
    rootMemo.set(id, rootId);
    return rootId;
  };
  const elements = new Map<string, OccupancyElement>();
  for (const item of laidOut) {
    if (followsParent(item.op) || elements.has(item.op.id)) continue;
    if (
      ![item.box.x, item.box.y, item.box.width, item.box.height].every(Number.isFinite) ||
      item.box.width <= 0 ||
      item.box.height <= 0
    ) {
      continue;
    }
    elements.set(item.op.id, {
      id: item.op.id,
      rootId: rootOf(item.op.id),
      // Intentionally use actual resolved element ink bounds. `canvasBox` is
      // a coordinate system and would make a single ray occupy half a board.
      box: { ...item.box },
    });
  }
  return [...elements.values()];
}

function occupancyForZone(
  rootCells: readonly (readonly ReadonlySet<string>[])[],
  elementCells: readonly (readonly ReadonlySet<string>[])[],
  zone: LayoutBox,
  cellWidth: number,
  cellHeight: number,
): OccupancyZoneStats {
  const firstColumn = clampInteger(Math.floor(zone.x / cellWidth), 0, OCCUPANCY_COLUMNS - 1);
  const lastColumn = clampInteger(
    Math.ceil((zone.x + zone.width) / cellWidth) - 1,
    0,
    OCCUPANCY_COLUMNS - 1,
  );
  const firstRow = clampInteger(Math.floor(zone.y / cellHeight), 0, OCCUPANCY_ROWS - 1);
  const lastRow = clampInteger(
    Math.ceil((zone.y + zone.height) / cellHeight) - 1,
    0,
    OCCUPANCY_ROWS - 1,
  );
  const roots = new Set<string>();
  const elements = new Set<string>();
  let occupiedCells = 0;
  let totalCells = 0;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const centerX = (column + 0.5) * cellWidth;
      const centerY = (row + 0.5) * cellHeight;
      if (!pointInside(zone, centerX, centerY)) continue;
      totalCells += 1;
      if (rootCells[row][column].size > 0) occupiedCells += 1;
      rootCells[row][column].forEach((id) => roots.add(id));
      elementCells[row][column].forEach((id) => elements.add(id));
    }
  }
  return {
    occupiedCells,
    totalCells,
    occupancyRatio: totalCells === 0 ? 0 : occupiedCells / totalCells,
    elementIds: [...elements].sort(),
    rootIds: [...roots].sort(),
  };
}

function densityFindings(
  elements: readonly OccupancyElement[],
  zones: Readonly<Record<Region, OccupancyZoneStats>>,
  expectations: BoardOccupancyExpectations,
): LayoutLintIssue[] {
  const findings: LayoutLintIssue[] = [];
  const boxesByRoot = unionBoxesByRoot(elements);
  for (const region of GRID_REGIONS) {
    const stats = zones[region];
    const rootBoxes = stats.rootIds
      .map((rootId) => boxesByRoot.get(rootId))
      .filter(isLayoutBox);
    if (
      stats.occupancyRatio >= 0.62 &&
      rootBoxes.length >= 2 &&
      minimumBoxSeparation(rootBoxes) < 24
    ) {
      findings.push({
        code: "region_crowded",
        elementIds: stats.elementIds.slice(0, 4),
        zone: region,
      });
    }
  }

  for (const region of [...new Set(expectations.expectedZones ?? [])]) {
    if (zones[region].occupancyRatio <= 0.06) {
      findings.push({ code: "region_sparse", elementIds: [], zone: region });
    }
  }

  if (expectations.balance === "horizontal") {
    const left = zones.left.occupancyRatio;
    const right = zones.right.occupancyRatio;
    if (Math.max(left, right) >= 0.12 && Math.abs(left - right) >= 0.32) {
      const overloaded = left > right ? "left" : "right";
      findings.push({
        code: "board_imbalanced",
        elementIds: zones[overloaded].elementIds.slice(0, 4),
        zone: overloaded,
      });
    }
  }
  return findings;
}

function unionBoxesByRoot(
  elements: readonly OccupancyElement[],
): Map<string, LayoutBox> {
  const grouped = new Map<string, LayoutBox[]>();
  for (const element of elements) {
    grouped.set(element.rootId, [...(grouped.get(element.rootId) ?? []), element.box]);
  }
  return new Map(
    [...grouped.entries()].map(([rootId, boxesForRoot]) => [rootId, unionBoxes(boxesForRoot)]),
  );
}

function minimumBoxSeparation(boxes: readonly LayoutBox[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      minimum = Math.min(minimum, edgeDistance(boxes[left], boxes[right]));
    }
  }
  return minimum;
}

function occupiedComponents(
  rootCells: readonly (readonly ReadonlySet<string>[])[],
  elementCells: readonly (readonly ReadonlySet<string>[])[],
  cellWidth: number,
  cellHeight: number,
): OccupancyComponent[] {
  const visited = new Set<string>();
  const components: OccupancyComponent[] = [];
  for (let row = 0; row < OCCUPANCY_ROWS; row += 1) {
    for (let column = 0; column < OCCUPANCY_COLUMNS; column += 1) {
      const key = `${row}:${column}`;
      if (visited.has(key) || rootCells[row][column].size === 0) continue;
      const queue: Array<[number, number]> = [[row, column]];
      visited.add(key);
      const occupied: Array<[number, number]> = [];
      const ids = new Set<string>();
      while (queue.length > 0) {
        const [currentRow, currentColumn] = queue.shift()!;
        occupied.push([currentRow, currentColumn]);
        elementCells[currentRow][currentColumn].forEach((id) => ids.add(id));
        for (const [nextRow, nextColumn] of [
          [currentRow - 1, currentColumn],
          [currentRow + 1, currentColumn],
          [currentRow, currentColumn - 1],
          [currentRow, currentColumn + 1],
        ] as const) {
          if (
            nextRow < 0 || nextRow >= OCCUPANCY_ROWS ||
            nextColumn < 0 || nextColumn >= OCCUPANCY_COLUMNS ||
            rootCells[nextRow][nextColumn].size === 0
          ) {
            continue;
          }
          const nextKey = `${nextRow}:${nextColumn}`;
          if (visited.has(nextKey)) continue;
          visited.add(nextKey);
          queue.push([nextRow, nextColumn]);
        }
      }
      const rows = occupied.map(([occupiedRow]) => occupiedRow);
      const columns = occupied.map(([, occupiedColumn]) => occupiedColumn);
      const top = Math.min(...rows);
      const left = Math.min(...columns);
      const bottom = Math.max(...rows);
      const right = Math.max(...columns);
      components.push({
        bounds: {
          x: left * cellWidth,
          y: top * cellHeight,
          width: (right - left + 1) * cellWidth,
          height: (bottom - top + 1) * cellHeight,
        },
        elementIds: [...ids].sort(),
      });
    }
  }
  return components;
}

function largestEmptyRectangles(
  rootCells: readonly (readonly ReadonlySet<string>[])[],
  cellWidth: number,
  cellHeight: number,
): LayoutBox[] {
  const best = new Map<string, LayoutBox>();
  for (let top = 0; top < OCCUPANCY_ROWS; top += 1) {
    const emptyColumns = Array.from({ length: OCCUPANCY_COLUMNS }, () => true);
    for (let bottom = top; bottom < OCCUPANCY_ROWS; bottom += 1) {
      for (let column = 0; column < OCCUPANCY_COLUMNS; column += 1) {
        emptyColumns[column] = emptyColumns[column] && rootCells[bottom][column].size === 0;
      }
      let runStart = -1;
      for (let column = 0; column <= OCCUPANCY_COLUMNS; column += 1) {
        if (column < OCCUPANCY_COLUMNS && emptyColumns[column]) {
          if (runStart < 0) runStart = column;
          continue;
        }
        if (runStart >= 0 && column - runStart >= 2 && bottom - top + 1 >= 2) {
          const rectangle = {
            x: runStart * cellWidth,
            y: top * cellHeight,
            width: (column - runStart) * cellWidth,
            height: (bottom - top + 1) * cellHeight,
          };
          best.set(boxKey(rectangle), rectangle);
        }
        runStart = -1;
      }
    }
  }
  return [...best.values()]
    .sort((left, right) =>
      right.width * right.height - left.width * left.height ||
      left.y - right.y ||
      left.x - right.x)
    .slice(0, MAX_EMPTY_RECTANGLES);
}

function explicitReadingReferences(
  item: LaidOutOp,
  step: NormalizedStep | undefined,
): string[] {
  const references = new Set<string>();
  if ("anchor" in item.op) references.add(item.op.anchor.el);
  for (const relation of step?.layout ?? []) {
    if (
      relation.kind === "place" &&
      relation.id === item.op.id
    ) {
      references.add(relation.relative_to);
    }
  }
  return [...references];
}

function temporallyAfter(later: LaidOutOp, earlier: LaidOutOp): boolean {
  return later.stepIndex > earlier.stepIndex ||
    (later.stepIndex === earlier.stepIndex && later.opIndex > earlier.opIndex);
}

function spatiallyPrecedes(explanation: LayoutBox, reference: LayoutBox): boolean {
  const explanationCenterX = explanation.x + explanation.width / 2;
  const explanationCenterY = explanation.y + explanation.height / 2;
  const referenceCenterX = reference.x + reference.width / 2;
  const referenceCenterY = reference.y + reference.height / 2;
  const materiallyAbove = referenceCenterY - explanationCenterY > READING_ORDER_TOLERANCE;
  const sameVisualBand = Math.abs(referenceCenterY - explanationCenterY) <=
    Math.max(explanation.height, reference.height) / 2 + READING_ORDER_TOLERANCE;
  const materiallyLeft = sameVisualBand &&
    referenceCenterX - explanationCenterX > READING_ORDER_TOLERANCE;
  return materiallyAbove || materiallyLeft;
}

function edgeDistance(left: LayoutBox, right: LayoutBox | undefined): number {
  if (!right) return BOARD_WIDTH + BOARD_HEIGHT;
  const dx = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0);
  const dy = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0);
  return Math.hypot(dx, dy);
}

function intersectBox(left: LayoutBox, right: LayoutBox): LayoutBox | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);
  return maxX > x && maxY > y ? { x, y, width: maxX - x, height: maxY - y } : undefined;
}

function containsBox(boundary: LayoutBox, box: LayoutBox): boolean {
  return box.x >= boundary.x && box.y >= boundary.y &&
    box.x + box.width <= boundary.x + boundary.width &&
    box.y + box.height <= boundary.y + boundary.height;
}

function boardBox(): LayoutBox {
  return { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT };
}

function pointInside(box: LayoutBox, x: number, y: number): boolean {
  return x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function boxKey(box: LayoutBox): string {
  return [box.x, box.y, box.width, box.height].map((value) => value.toFixed(4)).join(":");
}

function stableCandidateTie(id: string, box: LayoutBox): number {
  return stableStringTie(`${id}:${boxKey(box)}`);
}

function stableStringTie(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function boxDistance(left: LayoutBox, right: LayoutBox): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function intrinsicSize(
  op: LessonOp,
  measurements?: ReadonlyMap<string, RootMeasurement>,
): { width: number; height: number } {
  const measured = measurements?.get(op.id);
  if ((op.op === "text" || op.op === "equation") && measured) {
    return { width: measured.width, height: measured.height };
  }
  switch (op.op) {
    case "axes":
      return { width: 700, height: 430 };
    case "sketch":
      return { width: 318, height: 190 };
    case "equation":
      return {
        width: Math.min(700, Math.max(310, 160 + visibleLatexLength(op.latex) * 12)),
        height: 92,
      };
    case "text":
      return { width: 310, height: 64 };
    case "curve":
      return { width: 0, height: 0 };
    case "figure":
      return "frame" in op ? figureSize(op.frame) : { width: 0, height: 0 };
    case "diagram":
    case "line":
    case "arrow":
    case "point":
    case "angle_arc":
      // Square, so the normalized canvas maps uniformly (see squareDiagramCanvas).
      return { width: 520, height: 520 };
  }
}

/**
 * Ops drawn in a parent's coordinate frame (a curve on its axes, `figure on`
 * marks added to an earlier figure). They own no layout slot: their box is
 * the parent's, and they move only with it.
 */
export function parentOf(op: LessonOp): string | undefined {
  if (op.op === "curve") return op.axes_id;
  if (op.op === "figure" && "on" in op) return op.on;
  return undefined;
}

function followsParent(
  op: LessonOp,
): op is Extract<LessonOp, { op: "curve" }> | Extract<LessonOp, { on: string }> {
  return parentOf(op) !== undefined;
}

/** Plot frames take the axes slot; other frames take a slot with their window's aspect. */
function figureSize(frame: Extract<LessonOp, { op: "figure"; frame: unknown }>["frame"]): {
  width: number;
  height: number;
} {
  const axes = frame.axes ?? "none";
  const equal = frame.equal_scale ?? axes === "none";
  if (!equal) return { width: 700, height: 430 };
  const spanX = frame.x[1] - frame.x[0];
  const spanY = frame.y[1] - frame.y[0];
  const [marginX, marginY] = axes === "none" ? [24, 24] : [82, 76];
  const scale = Math.min((620 - marginX) / spanX, (480 - marginY) / spanY);
  return {
    width: Math.max(160, spanX * scale + marginX),
    height: Math.max(140, spanY * scale + marginY),
  };
}

function isDiagramOp(
  op: LessonOp,
): op is Exclude<
  Extract<LessonOp, { op: "diagram" | "line" | "arrow" | "point" | "angle_arc" }>,
  ConstructionOp
> {
  return !isConstructionOp(op) &&
    ["diagram", "line", "arrow", "point", "angle_arc"].includes(op.op);
}

function diagramElementBounds(
  op: Extract<LessonOp, { op: "diagram" | "line" | "arrow" | "point" | "angle_arc" }>,
  canvas: LayoutBox,
): LayoutBox {
  const padding = 18;
  if (op.op === "diagram") {
    return diagramBounds(op.primitives, canvas, op.tension ?? 0.55);
  }
  if (op.op === "point") {
    if (!("at" in op)) throw new Error("Unresolved point construction reached canvas layout.");
    const [x, y] = mapDiagramPoint(op.at, canvas);
    return { x: x - padding, y: y - padding, width: padding * 2, height: padding * 2 };
  }
  if (op.op === "angle_arc") {
    const [x, y] = mapDiagramPoint(op.center, canvas);
    const radius = op.radius * Math.min(canvas.width, canvas.height);
    return {
      x: x - radius - padding,
      y: y - radius - padding,
      width: (radius + padding) * 2,
      height: (radius + padding) * 2,
    };
  }
  if (!("from" in op)) throw new Error("Unresolved line construction reached canvas layout.");
  const [fromX, fromY] = mapDiagramPoint(op.from, canvas);
  const [toX, toY] = mapDiagramPoint(op.to, canvas);
  return {
    x: Math.min(fromX, toX) - padding,
    y: Math.min(fromY, toY) - padding,
    width: Math.abs(toX - fromX) + padding * 2,
    height: Math.abs(toY - fromY) + padding * 2,
  };
}

function visibleLatexLength(latex: string): number {
  return latex
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}\\_^|]/g, "")
    .length;
}

function anchorBox(
  target: LayoutBox,
  side: "above" | "below" | "left" | "right",
  normalizedGap: number,
  size: { width: number; height: number },
): LayoutBox {
  const gap = normalizedGap * (side === "above" || side === "below" ? target.height : target.width);
  const centeredX = target.x + (target.width - size.width) / 2;
  const centeredY = target.y + (target.height - size.height) / 2;
  const candidate =
    side === "above"
      ? { x: centeredX, y: target.y - size.height - gap }
      : side === "below"
        ? { x: centeredX, y: target.y + target.height + gap }
        : side === "left"
          ? { x: target.x - size.width - gap, y: centeredY }
          : { x: target.x + target.width + gap, y: centeredY };
  return {
    x: clamp(candidate.x, PADDING, BOARD_WIDTH - PADDING - size.width),
    y: clamp(candidate.y, PADDING, BOARD_HEIGHT - PADDING - size.height),
    width: size.width,
    height: size.height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
