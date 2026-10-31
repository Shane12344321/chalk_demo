import type { DiagramPrimitive, FigureMark, LessonOp } from "./lesson.generated";
import { staggerProgress } from "./scene/motion";

const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 4;
const MIN_PACED_RATE = 0.5;
const MAX_PACED_RATE = 3;
const PACED_GAIN = 2;

export function opWeight(op: LessonOp): number {
  switch (op.op) {
    case "sketch":
      return clampWeight(1 + normalizedSketchLength(op.strokes) * 1.2);
    case "axes":
      return 2;
    case "curve":
      return 2.5;
    case "text":
      return clampWeight(0.6 + op.content.length / 40);
    case "equation":
      return clampWeight(0.8 + visibleLatexLength(op.latex) / 30);
    case "line":
      return op.stroke === "dashed" ? 1.2 : 0.9;
    case "arrow":
      return op.stroke === "dashed" ? 1.5 : 1.2;
    case "point":
      return 0.6;
    case "angle_arc":
      return 1;
    case "diagram":
      return clampWeight(
        0.6 + op.primitives.reduce((sum, primitive) => sum + diagramPrimitiveWeight(primitive), 0),
      );
    case "figure":
      return clampWeight(
        ("frame" in op && (op.frame.axes ?? "none") !== "none" ? 1.2 : 0.4) +
          op.marks.reduce((sum, mark) => sum + figureMarkWeight(mark), 0),
      );
  }
}

/** Drawing time of one figure mark, in the same units as op weights. */
function figureMarkWeight(mark: FigureMark): number {
  switch (mark.kind) {
    case "point":
      return 0.25;
    case "segment":
    case "tangent":
    case "perpendicular":
    case "measure":
      return 0.5;
    case "polyline":
      return 0.35 + mark.points.length * 0.08;
    case "circle":
    case "arc":
    case "angle":
      return 0.6;
    case "fn":
    case "param":
    case "polar":
      return 1.2;
    case "shade":
      return 0.5;
    case "text":
      return 0.3 + mark.text.length / 24;
    case "group":
      return mark.marks.reduce((sum, child) => sum + figureMarkWeight(child), 0) *
        Math.min(4, mark.repeat ?? 1) * 0.6;
  }
}

function diagramPrimitiveWeight(primitive: DiagramPrimitive): number {
  switch (primitive.kind) {
    case "line":
    case "smooth":
      return 0.35 + normalizedPointLength(primitive.points) * 0.7 + (primitive.arrow ? 0.2 : 0);
    case "rect":
    case "ellipse":
      return 0.7;
    case "arc":
      return 0.5 + Math.min(1, Math.abs(primitive.end_deg - primitive.start_deg) / 360);
    case "point":
      return 0.25;
    case "text":
      return 0.3 + primitive.content.length / 24;
  }
}

function normalizedPointLength(points: readonly (readonly number[])[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return length;
}

export function opProgress(
  ops: readonly LessonOp[],
  opIndex: number,
  stepProgress: number,
): number {
  // A step's ops run in turn, each taking its weight's share of the narration.
  return staggerProgress(ops.map(opWeight), opIndex, stepProgress);
}

export function estimateNarrationDuration(script: string): number {
  const words = script.trim().split(/\s+/u).filter(Boolean).length;
  return Math.min(12_000, Math.max(3_000, words * 400));
}

export function pacedAnimationRate(
  generatedTranscriptProgress: number,
  drawnProgress: number,
): number {
  const error = clamp(generatedTranscriptProgress) - clamp(drawnProgress);
  return Math.min(
    MAX_PACED_RATE,
    Math.max(MIN_PACED_RATE, 1 + error * PACED_GAIN),
  );
}

function normalizedSketchLength(strokes: readonly (readonly (readonly number[])[])[]): number {
  let length = 0;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      length += Math.hypot(
        stroke[index][0] - stroke[index - 1][0],
        stroke[index][1] - stroke[index - 1][1],
      );
    }
  }
  return length;
}

function visibleLatexLength(latex: string): number {
  return latex
    .replace(/\\[a-zA-Z]+/g, "x")
    .replace(/[{}\\_^|]/g, "")
    .length;
}

function clampWeight(value: number): number {
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, value));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
