import { axesFrame } from "../axesGeometry";
import { isConstructionOp, type ConstructionOp } from "../construction";
import type { LaidOutOp, LayoutBox } from "../layout";
import type {
  AxesOp,
  DiagramPrimitive,
  GeometryPointReference,
  LessonOp,
} from "../lesson.generated";
import { describeDiagramPrimitive, formatNumber } from "../opDescriptions";
import { compileFigure, figureFrame } from "./compileFigure";
import { sampleVisibleCurveSegments } from "./sample";
import type { Frame, Mark, PointRef, SceneElement, Scene, Vec2 } from "./types";

/**
 * Schema-1.4 ops → scene IR, with no change to what the board shows.
 *
 * - text / equation → notes in their layout slot;
 * - axes → a plot frame (data window on the plot interior, axes on its edges);
 * - curve → an `fn` mark in its axes' frame;
 * - diagram, sketch, and standalone line/arrow/point/angle_arc → equal-scale
 *   frames over their canvas, with the normalized y-down `v` flipped to math y-up;
 * - constructions → marks whose points are references to earlier ink;
 * - diagram text → a `label` written `on` its point;
 * - schema-1.5 `figure` ops → their own frame and marks (`compileFigure.ts`).
 *
 * Placement (the layout slot of every root) still comes from `layout.ts`.
 * Seed keys and reveal groups are the ones the op renderer always used, so a
 * cached lesson draws the same strokes on either pipeline.
 */
export function compileLegacy(laidOut: readonly LaidOutOp[]): Scene {
  const frames: Frame[] = [];
  const frameOf = new Map<string, string>();
  const axes = new Map<string, AxesOp>();
  const elements: SceneElement[] = [];
  const addFrame = (frame: Frame) => {
    frames.push(frame);
    frameOf.set(frame.id, frame.id);
    return frame.id;
  };

  for (const item of laidOut) {
    const { op } = item;
    const base = {
      id: op.id,
      kind: op.op,
      stepIndex: item.stepIndex,
      opIndex: item.opIndex,
      box: item.box,
      ...(item.canvasBox ? { canvasBox: item.canvasBox } : {}),
    };

    if (op.op === "text") {
      elements.push({ ...base, sizing: "slot", note: { text: op.content }, marks: [], summary: `text: ${op.content}` });
      continue;
    }
    if (op.op === "equation") {
      elements.push({ ...base, sizing: "slot", note: { tex: op.latex }, marks: [], summary: `equation: ${op.latex}` });
      continue;
    }
    if (op.op === "axes") {
      axes.set(op.id, op);
      elements.push({
        ...base,
        sizing: "slot",
        frame: addFrame(axesFrame(op, item.box)),
        drawsFrame: true,
        marks: [],
        summary: `axes: ${op.x.label} ${op.x.min} to ${op.x.max}; ${op.y.label} ${op.y.min} to ${op.y.max}`,
      });
      continue;
    }
    if (op.op === "curve") {
      frameOf.set(op.id, op.axes_id);
      elements.push({
        ...base,
        sizing: "ink",
        frame: op.axes_id,
        marks: [{ kind: "fn", id: op.id, seed: op.id, expr: op.expr, ...(op.domain ? { domain: op.domain } : {}) }],
        summary: curveSummary(op, axes.get(op.axes_id)),
      });
      continue;
    }
    if (op.op === "sketch") {
      const aspect = item.box.height > 0 ? item.box.width / item.box.height : 0;
      // The sketch space is the slot itself, stretched; an equal-scale window
      // with the slot's aspect keeps every stroke where it always was.
      const window = aspect > 0 && Number.isFinite(aspect)
        ? { x: [0, aspect] as const, y: [0, 1] as const }
        : { x: [0, 1] as const, y: [0, 1] as const };
      const scaleX = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
      elements.push({
        ...base,
        sizing: "slot",
        frame: addFrame(canvasFrame(op.id, item.box, window, aspect > 0 && Number.isFinite(aspect))),
        marks: op.strokes.map((stroke, index): Mark => ({
          kind: "path",
          id: `${op.id}#${index}`,
          seed: `${op.id}:${index}`,
          points: stroke.map(([u, v]): Vec2 => [u * scaleX, 1 - v]),
          draw: "stroke",
          group: index,
        })),
        summary: op.meaning ?? `sketch with ${op.strokes.length} strokes`,
      });
      continue;
    }

    if (op.op === "figure") {
      const frame = "frame" in op ? addFrame(figureFrame(op, item.box)) : frameOf.get(op.on);
      if (frame) frameOf.set(op.id, frame);
      elements.push(compileFigure({ ...item, op }, frame));
      continue;
    }

    if (isConstructionOp(op)) {
      const frame = frameOf.get(constructionInputs(op)[0]);
      if (frame) frameOf.set(op.id, frame);
      elements.push({
        ...base,
        sizing: "ink",
        ...(frame ? { frame } : {}),
        marks: [constructionMark(op)],
        summary: `${constructionSummary(op)}${op.label ? `; label ${op.label}` : ""}`,
      });
      continue;
    }

    // Diagram family: one equal-scale unit frame per canvas; canvas_id ops join theirs.
    const frame = "canvas_id" in op
      ? frameOf.get(op.canvas_id)
      : item.canvasBox
        ? addFrame(canvasFrame(op.id, item.canvasBox, { x: [0, 1], y: [0, 1] }, true))
        : undefined;
    if (frame) frameOf.set(op.id, frame);
    const placement = { ...(frame ? { frame } : {}) };

    if (op.op === "diagram") {
      elements.push({
        ...base,
        ...placement,
        sizing: "slot",
        parts: true,
        marks: op.primitives.map((primitive, index) =>
          primitiveMark(primitive, `${op.id}#${index}`, `${op.id}:part-${index}`, index, op.tension ?? 0.55)),
        summary: `diagram with ${op.primitives.length} parts: ${op.primitives
          .map((primitive) => primitive.kind === "text" ? primitive.content : primitive.label ?? primitive.kind)
          .slice(0, 8)
          .join(", ")}`,
      });
      continue;
    }
    elements.push({ ...base, ...placement, sizing: "ink", marks: [standaloneMark(op)], summary: standaloneSummary(op) });
  }
  return { frames, elements };
}

function canvasFrame(
  id: string,
  box: LayoutBox,
  window: Frame["window"],
  equalScale: boolean,
): Frame {
  return { id, box, window, axes: "none", grid: false, equalScale };
}

/** A normalized y-down canvas point in a unit frame (math y-up). */
function flip([u, v]: readonly [number, number]): Vec2 {
  return [u, 1 - v];
}

function label(text: string | undefined): Pick<Mark, "label"> {
  return text ? { label: { text } } : {};
}

function primitiveMark(
  primitive: DiagramPrimitive,
  id: string,
  seed: string,
  group: number,
  tension: number,
): Mark {
  const common = { id, seed, group, meaning: describeDiagramPrimitive(primitive) };
  switch (primitive.kind) {
    case "line":
    case "smooth":
      return {
        ...common,
        kind: "path",
        points: primitive.points.map(flip),
        stroke: primitive.stroke,
        ...(primitive.kind === "smooth" ? { smooth: tension } : { draw: "segments" as const }),
        ...(primitive.arrow ? { arrow: true } : {}),
        ...label(primitive.label),
      };
    case "rect": {
      const [left, right] = [Math.min(primitive.from[0], primitive.to[0]), Math.max(primitive.from[0], primitive.to[0])];
      const [top, bottom] = [Math.min(primitive.from[1], primitive.to[1]), Math.max(primitive.from[1], primitive.to[1])];
      // Corners in on-screen order from the top-left, as the rectangle has always been stroked.
      return {
        ...common,
        kind: "path",
        points: [flip([left, top]), flip([right, top]), flip([right, bottom]), flip([left, bottom])],
        closed: true,
        draw: "stroke",
        stroke: primitive.stroke,
        ...(primitive.fill ? { fill: true } : {}),
        ...label(primitive.label),
      };
    }
    case "ellipse":
      return {
        ...common,
        kind: "ellipse",
        center: flip(primitive.center),
        rx: primitive.radius[0],
        ry: primitive.radius[1],
        stroke: primitive.stroke,
        ...(primitive.fill ? { fill: true } : {}),
        ...label(primitive.label),
      };
    case "arc":
      return {
        ...common,
        kind: "arc",
        center: flip(primitive.center),
        rx: primitive.radius[0],
        ry: primitive.radius[1],
        // Schema degrees run clockwise on screen; math degrees run counter-clockwise.
        start: -primitive.start_deg,
        end: -primitive.end_deg,
        stroke: primitive.stroke,
        ...(primitive.arrow ? { arrow: true } : {}),
        ...label(primitive.label),
      };
    case "text":
      return {
        ...common,
        kind: "label",
        text: primitive.content,
        at: flip(primitive.at),
        side: "on",
        ...(primitive.align ? { align: primitive.align } : {}),
        ...(primitive.size ? { size: primitive.size } : {}),
        mobility: "nudge",
      };
    case "point":
      return { ...common, kind: "point", at: flip(primitive.at), ...label(primitive.label) };
  }
}

type StandaloneOp = Exclude<
  Extract<LessonOp, { op: "line" | "arrow" | "point" | "angle_arc" }>,
  ConstructionOp
>;

function standaloneMark(op: StandaloneOp): Mark {
  if (op.op === "line") {
    return { kind: "line", id: op.id, seed: op.id, line: { from: flip(op.from), to: flip(op.to) }, stroke: op.stroke, ...label(op.label) };
  }
  if (op.op === "arrow") {
    return { kind: "vector", id: op.id, seed: op.id, from: flip(op.from), to: flip(op.to), stroke: op.stroke, ...label(op.label) };
  }
  if (op.op === "point") {
    return { kind: "point", id: op.id, seed: `${op.id}:point`, at: flip(op.at), ...label(op.label) };
  }
  return {
    kind: "angle",
    id: op.id,
    seed: op.id,
    vertex: flip(op.center),
    angle: { start: -op.start_deg, end: -op.end_deg },
    radius: op.radius,
    stroke: op.stroke,
    ...label(op.label),
  };
}

function standaloneSummary(op: StandaloneOp): string {
  if (op.op === "line" && op.meaning) return op.meaning;
  const name = op.op === "angle_arc" ? "angle arc" : op.op;
  return `${name}${op.label ? `: ${op.label}` : ""}`;
}

function pointRef(reference: GeometryPointReference): PointRef {
  return reference.kind === "point"
    ? { at: reference.element_id }
    : { end: reference.element_id, which: reference.endpoint };
}

function constructionInputs(op: ConstructionOp): string[] {
  const relation = op.construct;
  switch (relation.kind) {
    case "along":
    case "offset_from":
      return [relation.element_id];
    case "midpoint_of":
      return [relation.a.element_id, relation.b.element_id];
    case "intersection_of":
      return [relation.a, relation.b];
    case "perpendicular_through":
      return [relation.line, relation.point.element_id];
    case "tangent_at":
      return [relation.curve];
  }
}

function constructionMark(op: ConstructionOp): Mark {
  const relation = op.construct;
  const labelled = label(op.label);
  if (op.op === "point") {
    const point = { kind: "point" as const, id: op.id, seed: `${op.id}:construction-point`, ...labelled };
    switch (relation.kind) {
      case "along":
        return { ...point, at: { on: relation.element_id, t: relation.t } };
      case "midpoint_of":
        return { ...point, at: { mid: [pointRef(relation.a), pointRef(relation.b)] } };
      case "intersection_of":
        return { ...point, at: { hit: [relation.a, relation.b] } };
      case "offset_from":
        return { ...point, at: { beside: relation.element_id, side: relation.side, gap: relation.gap } };
      default:
        throw new Error("Unsupported point construction.");
    }
  }
  const line = { kind: "line" as const, id: op.id, seed: op.id, stroke: op.stroke, ...labelled };
  if (relation.kind === "tangent_at") {
    return { ...line, line: { tangentTo: relation.curve, x: relation.x, length: relation.length } };
  }
  if (relation.kind === "perpendicular_through") {
    return { ...line, line: { normalTo: relation.line, through: pointRef(relation.point), length: relation.length } };
  }
  throw new Error("Unsupported line construction.");
}

function constructionSummary(op: ConstructionOp): string {
  const relation = op.construct;
  const describe = (reference: GeometryPointReference) =>
    reference.kind === "point" ? reference.element_id : `${reference.endpoint} of ${reference.element_id}`;
  const number = (value: number) => Number(value.toFixed(4)).toString();
  switch (relation.kind) {
    case "along":
      return `point along ${relation.element_id} at t=${number(relation.t)}`;
    case "midpoint_of":
      return `midpoint of ${describe(relation.a)} and ${describe(relation.b)}`;
    case "intersection_of":
      return `intersection of ${relation.a} and ${relation.b}`;
    case "offset_from":
      return `${relation.side} offset from ${relation.element_id} by ${number(relation.gap)}`;
    case "perpendicular_through":
      return (op.op === "line" ? op.meaning : undefined) ??
        `perpendicular to ${relation.line} through ${describe(relation.point)}`;
    case "tangent_at":
      return (op.op === "line" ? op.meaning : undefined) ??
        `local tangent to ${relation.curve} at x=${number(relation.x)}`;
  }
}

function curveSummary(op: Extract<LessonOp, { op: "curve" }>, target: AxesOp | undefined): string {
  if (!target) return `curve on ${op.axes_id}`;
  try {
    const peak = sampleVisibleCurveSegments(op, target)
      .flat()
      .reduce((highest, point) => (point[1] > highest[1] ? point : highest));
    return `curve on ${op.axes_id}; visible peak near x=${formatNumber(peak[0])}, y=${formatNumber(peak[1])}`;
  } catch {
    return `curve on ${op.axes_id}`;
  }
}
