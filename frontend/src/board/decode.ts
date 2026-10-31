import { createFigureState, validateFigureOp, type FigureState } from "./figureValidation";
import { sampleVisibleCurveSegments } from "./scene/sample";
import { renderSafeLatex } from "./latex";
import type {
  Checkpoint,
  GeometryPointReference,
  LayoutRelation,
  LessonOp,
} from "./lesson.generated";
import {
  ELEMENT_ID_PATTERN,
  LESSON_SCRIPT_MAX_LENGTH,
  isLessonOp,
  isLayoutRelation,
  layoutRelationSchemaErrors,
  lessonOpSchemaErrors,
} from "./schema";
import { sanitizeStep } from "./sanitize";

export interface NormalizedStep {
  id: string;
  script: string;
  ops: LessonOp[];
  layout?: LayoutRelation[];
  checkpoint: Checkpoint | null;
}

export type SchemaVersion = "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5";
const SCHEMA_VERSIONS: readonly string[] = ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5"];

export interface NormalizedLesson {
  schemaVersion: SchemaVersion;
  title: string;
  steps: NormalizedStep[];
}

export interface LessonWarning {
  code:
    | "invalid_lesson"
    | "invalid_step"
    | "invalid_op"
    | "duplicate_id"
    | "unknown_reference"
    | "invalid_expression"
    | "invalid_equation"
    | "invalid_axes"
    | "sanitized_step";
  stepId?: string;
  opId?: string;
  detail: string;
}

export interface DecodeResult {
  lesson?: NormalizedLesson;
  warnings: LessonWarning[];
}

export interface DecodeContext {
  acceptedIds: Map<string, LessonOp>;
  acceptedStepIds: Set<string>;
  /** Schema-1.5 figure frames and the mark IDs they define. */
  figures: FigureState;
}

export interface DecodeStepResult {
  step?: NormalizedStep;
  warnings: LessonWarning[];
}

export function createDecodeContext(): DecodeContext {
  return { acceptedIds: new Map(), acceptedStepIds: new Set(), figures: createFigureState() };
}

export function decodeStep(rawStep: unknown, context: DecodeContext): DecodeStepResult {
  const warnings: LessonWarning[] = [];
  const sanitization = sanitizeStep(rawStep);
  rawStep = sanitization.value;
  if (sanitization.correctionCount > 0) {
    warnings.push(
      warning(
        "sanitized_step",
        `Applied ${sanitization.correctionCount} safe correction(s): ${sanitization.corrections.join(", ")}.`,
        isRecord(rawStep) && typeof rawStep.id === "string" ? rawStep.id : undefined,
      ),
    );
  }
  if (!isRecord(rawStep)) {
    warnings.push(warning("invalid_step", "Step must be an object."));
    return { warnings };
  }
  const stepId = typeof rawStep.id === "string" ? rawStep.id : undefined;
  if (
    !stepId ||
    !ELEMENT_ID_PATTERN.test(stepId) ||
    context.acceptedStepIds.has(stepId) ||
    typeof rawStep.script !== "string" ||
    rawStep.script.length > LESSON_SCRIPT_MAX_LENGTH ||
    countWords(rawStep.script) > 30 ||
    countWords(rawStep.script) === 0 ||
    !Array.isArray(rawStep.ops) ||
    rawStep.ops.length === 0 ||
    rawStep.ops.length > 4 ||
    !isCheckpoint(rawStep.checkpoint)
  ) {
    warnings.push(
      warning("invalid_step", "Step shape, ID, script, or op budget is invalid.", stepId),
    );
    return { warnings };
  }

  const ops: LessonOp[] = [];
  const acceptedBeforeStepTypes = new Map(context.acceptedIds);
  const acceptedBeforeStep = new Set(context.acceptedIds.keys());
  for (const rawOp of rawStep.ops) {
    if (!isLessonOp(rawOp)) {
      warnings.push(
        warning(
          "invalid_op",
          lessonOpSchemaErrors().join("; ") || "Operation does not match the shared schema.",
          stepId,
          opIdOf(rawOp),
        ),
      );
      continue;
    }
    const issue = context.figures.marks.has(rawOp.id)
      ? { code: "duplicate_id" as const, detail: `Element ID ${rawOp.id} is already a figure mark.` }
      : validateSemanticOp(rawOp, context.acceptedIds, acceptedBeforeStepTypes);
    if (issue) {
      warnings.push(warning(issue.code, issue.detail, stepId, rawOp.id));
      continue;
    }
    if (rawOp.op === "figure") {
      const figure = validateFigureOp(rawOp, context.figures, new Set(context.acceptedIds.keys()));
      if ("code" in figure) {
        warnings.push(warning(figure.code, figure.detail, stepId, rawOp.id));
        continue;
      }
      context.figures.roots.set(rawOp.id, figure.root);
      if ("frame" in rawOp) context.figures.windows.set(rawOp.id, figure.window);
      for (const [id, info] of figure.marks) context.figures.marks.set(id, info);
    }
    context.acceptedIds.set(rawOp.id, rawOp);
    ops.push(rawOp);
  }

  if (ops.length === 0) {
    warnings.push(warning("invalid_step", "No valid operations remain in this step.", stepId));
    return { warnings };
  }
  const layout = decodeLayoutRelations(
    rawStep.layout,
    ops,
    acceptedBeforeStep,
    warnings,
    stepId,
  );
  context.acceptedStepIds.add(stepId);
  return {
    step: {
      id: stepId,
      script: rawStep.script,
      ops,
      ...(layout.length > 0 ? { layout } : {}),
      checkpoint: rawStep.checkpoint,
    },
    warnings,
  };
}

export function decodeLesson(value: unknown): DecodeResult {
  const warnings: LessonWarning[] = [];
  if (
    !isRecord(value) ||
    !SCHEMA_VERSIONS.includes(String(value.schema_version))
  ) {
    return { warnings: [warning("invalid_lesson", "Unsupported or missing schema version.")] };
  }
  if (
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 80 ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > 8
  ) {
    return { warnings: [warning("invalid_lesson", "Lesson header or step budget is invalid.")] };
  }

  const context = createDecodeContext();
  const steps: NormalizedStep[] = [];
  for (const rawStep of value.steps) {
    const result = decodeStep(rawStep, context);
    warnings.push(...result.warnings);
    if (result.step) steps.push(result.step);
  }

  if (steps.length === 0) {
    warnings.push(warning("invalid_lesson", "No valid lesson steps remain."));
    return { warnings };
  }
  return {
    lesson: {
      schemaVersion: value.schema_version as SchemaVersion,
      title: value.title,
      steps,
    },
    warnings,
  };
}

function decodeLayoutRelations(
  value: unknown,
  ops: readonly LessonOp[],
  acceptedBeforeStep: ReadonlySet<string>,
  warnings: LessonWarning[],
  stepId: string,
): LayoutRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    warnings.push(warning("invalid_step", "Layout relation budget is invalid.", stepId));
    return [];
  }
  const opOrder = new Map(ops.map((op, index) => [op.id, index]));
  const movableIds = new Set(
    ops
      .filter((op) => op.op !== "curve" && !("canvas_id" in op) && !("construct" in op))
      .map((op) => op.id),
  );
  const relations: LayoutRelation[] = [];
  for (const candidate of value) {
    if (!isLayoutRelation(candidate)) {
      warnings.push(warning(
        "invalid_step",
        layoutRelationSchemaErrors().join("; ") || "Layout relation is invalid.",
        stepId,
      ));
      continue;
    }
    const ids = candidate.kind === "place" ? [candidate.id] : candidate.ids;
    if (ids.some((id) => !opOrder.has(id) || !movableIds.has(id))) {
      warnings.push(warning(
        "unknown_reference",
        "Layout relations may move only independent operations accepted in the current step.",
        stepId,
      ));
      continue;
    }
    if (candidate.kind === "place") {
      const movingIndex = opOrder.get(candidate.id)!;
      const referenceIndex = opOrder.get(candidate.relative_to);
      if (
        !acceptedBeforeStep.has(candidate.relative_to) &&
        (referenceIndex === undefined || referenceIndex >= movingIndex)
      ) {
        warnings.push(warning(
          "unknown_reference",
          "A place relation must target an earlier accepted element.",
          stepId,
        ));
        continue;
      }
    }
    relations.push(candidate);
  }
  return relations;
}

function validateSemanticOp(
  op: LessonOp,
  acceptedIds: ReadonlyMap<string, LessonOp>,
  acceptedBeforeStep: ReadonlyMap<string, LessonOp>,
): { code: LessonWarning["code"]; detail: string } | undefined {
  if (acceptedIds.has(op.id)) {
    return { code: "duplicate_id", detail: `Element ID ${op.id} is already accepted.` };
  }
  if ("anchor" in op && !acceptedIds.has(op.anchor.el)) {
    return { code: "unknown_reference", detail: `Anchor ${op.anchor.el} is not visible.` };
  }
  if ("canvas_id" in op) {
    const canvas = acceptedIds.get(op.canvas_id);
    if (!canvas || !isDiagramOp(canvas)) {
      return {
        code: "unknown_reference",
        detail: `Diagram canvas ${op.canvas_id} is not accepted.`,
      };
    }
  }
  if (
    (op.op === "line" || op.op === "arrow") &&
    "from" in op &&
    pointsEqual(op.from, op.to)
  ) {
    return { code: "invalid_op", detail: "Line endpoints must differ." };
  }
  if ("construct" in op) {
    const constructionIssue = validateConstructionReferences(op, acceptedBeforeStep);
    if (constructionIssue) return constructionIssue;
  }
  if (op.op === "angle_arc" && Math.abs(op.end_deg - op.start_deg) < 1) {
    return { code: "invalid_op", detail: "Angle arc must span at least one degree." };
  }
  if (op.op === "diagram") {
    for (const [index, primitive] of op.primitives.entries()) {
      if (primitive.kind === "line" || primitive.kind === "smooth") {
        if (primitive.points.slice(1).every((point) => pointsEqual(point, primitive.points[0]))) {
          return { code: "invalid_op", detail: `Diagram primitive ${index} path has no length.` };
        }
        if (
          primitive.arrow &&
          pointsEqual(
            primitive.points[primitive.points.length - 1],
            primitive.points[primitive.points.length - 2],
          )
        ) {
          return { code: "invalid_op", detail: `Diagram primitive ${index} arrow has no terminal direction.` };
        }
      } else if (
        primitive.kind === "rect" &&
        (primitive.from[0] === primitive.to[0] || primitive.from[1] === primitive.to[1])
      ) {
        return { code: "invalid_op", detail: `Diagram primitive ${index} rectangle has no area.` };
      } else if (
        primitive.kind === "arc" &&
        Math.abs(primitive.end_deg - primitive.start_deg) < 1
      ) {
        return { code: "invalid_op", detail: `Diagram primitive ${index} arc must span at least one degree.` };
      }
    }
  }
  if (op.op === "axes" && (op.x.min >= op.x.max || op.y.min >= op.y.max)) {
    return { code: "invalid_axes", detail: "Axis minima must be lower than maxima." };
  }
  if (op.op === "curve") {
    const axes = acceptedIds.get(op.axes_id);
    if (axes?.op !== "axes") {
      return { code: "unknown_reference", detail: `Axes ${op.axes_id} is not accepted.` };
    }
    const domain = op.domain;
    if (domain && domain[0] >= domain[1]) {
      return { code: "invalid_expression", detail: "Curve domain must increase." };
    }
    try {
      if (sampleVisibleCurveSegments(op, axes).length === 0) {
        throw new Error("Curve has fewer than two contiguous visible samples.");
      }
    } catch (error) {
      return { code: "invalid_expression", detail: messageOf(error) };
    }
  }
  if (op.op === "equation") {
    try {
      renderSafeLatex(op.latex);
    } catch (error) {
      return { code: "invalid_equation", detail: messageOf(error) };
    }
  }
  return undefined;
}

function validateConstructionReferences(
  op: Extract<LessonOp, { construct: unknown }>,
  acceptedBeforeStep: ReadonlyMap<string, LessonOp>,
): { code: LessonWarning["code"]; detail: string } | undefined {
  const relation = op.construct;
  if (relation.kind === "tangent_at") {
    if (!hasAcceptedType(acceptedBeforeStep, relation.curve, ["curve"])) {
      return {
        code: "unknown_reference",
        detail: "tangent_at curve must be accepted in a prior step.",
      };
    }
    return undefined;
  }
  if (relation.kind === "perpendicular_through") {
    if (!hasAcceptedType(acceptedBeforeStep, relation.line, ["line", "arrow"])) {
      return {
        code: "unknown_reference",
        detail: "perpendicular_through line must be accepted in a prior step.",
      };
    }
    return pointReferenceIssue(relation.point, acceptedBeforeStep);
  }
  if (relation.kind === "along") {
    if (!hasAcceptedType(acceptedBeforeStep, relation.element_id, ["line", "arrow", "curve"])) {
      return {
        code: "unknown_reference",
        detail: "along target must be an accepted line or curve from a prior step.",
      };
    }
    return undefined;
  }
  if (relation.kind === "midpoint_of") {
    return pointReferenceIssue(relation.a, acceptedBeforeStep) ??
      pointReferenceIssue(relation.b, acceptedBeforeStep);
  }
  if (relation.kind === "intersection_of") {
    if (relation.a === relation.b) {
      return { code: "invalid_op", detail: "intersection_of requires distinct elements." };
    }
    for (const id of [relation.a, relation.b]) {
      if (!hasAcceptedType(acceptedBeforeStep, id, ["line", "arrow", "curve"])) {
        return {
          code: "unknown_reference",
          detail: "intersection_of inputs must be accepted lines or curves from prior steps.",
        };
      }
    }
    return undefined;
  }
  if (!hasAcceptedType(
    acceptedBeforeStep,
    relation.element_id,
    ["point", "line", "arrow", "curve"],
  )) {
    return {
      code: "unknown_reference",
      detail: "offset_from target must be accepted geometry from a prior step.",
    };
  }
  return undefined;
}

function pointReferenceIssue(
  reference: GeometryPointReference,
  acceptedBeforeStep: ReadonlyMap<string, LessonOp>,
): { code: LessonWarning["code"]; detail: string } | undefined {
  const expected: readonly LessonOp["op"][] = reference.kind === "point"
    ? ["point"]
    : ["line", "arrow"];
  if (!hasAcceptedType(acceptedBeforeStep, reference.element_id, expected)) {
    return {
      code: "unknown_reference",
      detail: `${reference.kind} reference must target accepted prior-step geometry.`,
    };
  }
  return undefined;
}

function hasAcceptedType(
  accepted: ReadonlyMap<string, LessonOp>,
  id: string,
  allowed: readonly LessonOp["op"][],
): boolean {
  const referenced = accepted.get(id);
  return referenced !== undefined && allowed.includes(referenced.op);
}

function isDiagramOp(op: LessonOp): boolean {
  return ["diagram", "line", "arrow", "point", "angle_arc"].includes(op.op);
}

function pointsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function isCheckpoint(value: unknown): value is Checkpoint | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.question === "string" &&
    value.question.length > 0 &&
    value.question.length <= 120 &&
    typeof value.expected_gist === "string" &&
    value.expected_gist.length > 0 &&
    value.expected_gist.length <= 80 &&
    Object.keys(value).every((key) => key === "question" || key === "expected_gist")
  );
}

function countWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function opIdOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function warning(
  code: LessonWarning["code"],
  detail: string,
  stepId?: string,
  opId?: string,
): LessonWarning {
  return { code, detail, ...(stepId ? { stepId } : {}), ...(opId ? { opId } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Operation validation failed.";
}
