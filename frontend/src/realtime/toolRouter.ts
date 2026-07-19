import type { FunctionCall } from "./types";
import type { DeixisKind } from "../board/overlays";

export type QaAnnotationMark =
  | { kind: "circle" | "underline"; target_id: string }
  | { kind: "arrow"; target_id: string; side: "above" | "below" | "left" | "right" }
  | { kind: "text"; target_id: string; side: "above" | "below" | "left" | "right"; content: string }
  | { kind: "equation"; target_id: string; side: "above" | "below" | "left" | "right"; latex: string };

export type ToolResult =
  | { ok: true; echo: string }
  | { ok: true; status: "started"; request_id: string }
  | { ok: true; status: "shown"; overlay_id: string }
  | { ok: true; status: "annotation_started"; request_id: string }
  | { ok: true; status: "scratch_started"; request_id: string }
  | { ok: true; status: "qa_annotation_shown"; request_id: string; marks: number }
  | {
      ok: false;
      reason:
        | "unknown_tool"
        | "invalid_arguments"
        | "handler_unavailable"
        | "lesson_busy"
        | "not_in_qa"
        | "unknown_element";
    };

export interface ToolHandlers {
  teach?: (topic: string, studentContext: string) => { requestId: string };
  deixis?: (kind: DeixisKind, elementId: string) => { overlayId: string } | undefined;
  annotate?: (request: string) => { requestId: string } | undefined;
  drawScratch?: (description: string) => { requestId: string } | undefined;
  drawQaAnnotation?: (
    marks: readonly QaAnnotationMark[],
  ) =>
    | { ok: true; requestId: string; marks: number }
    | { ok: false; reason: "not_in_qa" | "unknown_element" | "invalid_arguments" };
}

export function routeToolCall(call: FunctionCall, handlers: ToolHandlers = {}): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.argumentsJson);
  } catch {
    return { ok: false, reason: "invalid_arguments" };
  }

  if (call.name === "debug_echo") {
    if (!isDebugEchoArguments(parsed)) {
      return { ok: false, reason: "invalid_arguments" };
    }
    return { ok: true, echo: parsed.message };
  }
  if (call.name === "teach") {
    if (!isTeachArguments(parsed)) return { ok: false, reason: "invalid_arguments" };
    if (!handlers.teach) return { ok: false, reason: "handler_unavailable" };
    try {
      const started = handlers.teach(parsed.topic, parsed.student_context);
      return { ok: true, status: "started", request_id: started.requestId };
    } catch {
      return { ok: false, reason: "lesson_busy" };
    }
  }
  if (isDeixisKind(call.name)) {
    if (!isDeixisArguments(parsed)) return { ok: false, reason: "invalid_arguments" };
    if (!handlers.deixis) return { ok: false, reason: "handler_unavailable" };
    const shown = handlers.deixis(call.name, parsed.element_id);
    return shown
      ? { ok: true, status: "shown", overlay_id: shown.overlayId }
      : { ok: false, reason: "unknown_element" };
  }
  if (call.name === "annotate") {
    if (!isAnnotateArguments(parsed)) return { ok: false, reason: "invalid_arguments" };
    if (!handlers.annotate) return { ok: false, reason: "handler_unavailable" };
    const started = handlers.annotate(parsed.request);
    return started
      ? { ok: true, status: "annotation_started", request_id: started.requestId }
      : { ok: false, reason: "unknown_element" };
  }
  if (call.name === "draw_scratch") {
    if (!isDrawScratchArguments(parsed)) return { ok: false, reason: "invalid_arguments" };
    if (!handlers.drawScratch) return { ok: false, reason: "handler_unavailable" };
    const started = handlers.drawScratch(parsed.description);
    return started
      ? { ok: true, status: "scratch_started", request_id: started.requestId }
      : { ok: false, reason: "lesson_busy" };
  }
  if (call.name === "draw_qa_annotation") {
    const marks = qaAnnotationMarks(parsed);
    if (!marks) return { ok: false, reason: "invalid_arguments" };
    if (!handlers.drawQaAnnotation) return { ok: false, reason: "handler_unavailable" };
    const shown = handlers.drawQaAnnotation(marks);
    return shown.ok
      ? {
          ok: true,
          status: "qa_annotation_shown",
          request_id: shown.requestId,
          marks: shown.marks,
        }
      : { ok: false, reason: shown.reason };
  }
  return { ok: false, reason: "unknown_tool" };
}

function qaAnnotationMarks(value: unknown): QaAnnotationMark[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record.marks)) return undefined;
  if (record.marks.length < 1 || record.marks.length > 2) return undefined;
  const marks: QaAnnotationMark[] = [];
  for (const candidate of record.marks) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return undefined;
    }
    const mark = candidate as Record<string, unknown>;
    if (!validElementId(mark.target_id)) return undefined;
    if (mark.kind === "circle" || mark.kind === "underline") {
      if (Object.keys(mark).length !== 2) return undefined;
      marks.push({ kind: mark.kind, target_id: mark.target_id });
      continue;
    }
    if (!validSide(mark.side)) return undefined;
    if (mark.kind === "arrow" && Object.keys(mark).length === 3) {
      marks.push({ kind: "arrow", target_id: mark.target_id, side: mark.side });
      continue;
    }
    if (
      mark.kind === "text" &&
      Object.keys(mark).length === 4 &&
      typeof mark.content === "string" &&
      mark.content.trim().length >= 1 &&
      mark.content.length <= 100
    ) {
      marks.push({ kind: "text", target_id: mark.target_id, side: mark.side, content: mark.content });
      continue;
    }
    if (
      mark.kind === "equation" &&
      Object.keys(mark).length === 4 &&
      typeof mark.latex === "string" &&
      mark.latex.trim().length >= 1 &&
      mark.latex.length <= 160
    ) {
      marks.push({ kind: "equation", target_id: mark.target_id, side: mark.side, latex: mark.latex });
      continue;
    }
    return undefined;
  }
  return marks;
}

function validElementId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,15}$/.test(value);
}

function validSide(value: unknown): value is "above" | "below" | "left" | "right" {
  return value === "above" || value === "below" || value === "left" || value === "right";
}

function isDrawScratchArguments(value: unknown): value is { description: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.description === "string" &&
    record.description.trim().length >= 3 &&
    record.description.length <= 200
  );
}

function isAnnotateArguments(value: unknown): value is { request: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.request === "string" &&
    record.request.trim().length >= 2 &&
    record.request.length <= 400
  );
}

function isDeixisKind(value: string): value is DeixisKind {
  return ["point_at", "circle_el", "underline", "flash", "trace_path", "focus_on"].includes(value);
}

function isDeixisArguments(value: unknown): value is { element_id: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    validElementId(record.element_id)
  );
}

function isTeachArguments(
  value: unknown,
): value is { topic: string; student_context: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record.topic === "string" &&
    record.topic.trim().length >= 2 &&
    record.topic.length <= 80 &&
    typeof record.student_context === "string" &&
    record.student_context.length <= 500
  );
}

function isDebugEchoArguments(value: unknown): value is { message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.message === "string" &&
    record.message.trim().length > 0 &&
    record.message.length <= 200
  );
}
