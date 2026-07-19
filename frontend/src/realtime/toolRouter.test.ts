import { describe, expect, it, vi } from "vitest";
import { routeToolCall } from "./toolRouter";

describe("routeToolCall", () => {
  it("routes the bounded debug echo tool", () => {
    expect(
      routeToolCall({
        callId: "call_1",
        name: "debug_echo",
        argumentsJson: '{"message":"protocol alive"}',
      }),
    ).toEqual({ ok: true, echo: "protocol alive" });
  });

  it.each([
    "not json",
    "{}",
    '{"message":""}',
    '{"message":"ok","extra":true}',
    JSON.stringify({ message: "x".repeat(201) }),
  ])("soft-fails invalid arguments: %s", (argumentsJson) => {
    expect(
      routeToolCall({ callId: "call_1", name: "debug_echo", argumentsJson }),
    ).toEqual({ ok: false, reason: "invalid_arguments" });
  });

  it("soft-fails unknown tools", () => {
    expect(
      routeToolCall({ callId: "call_1", name: "delete_everything", argumentsJson: "{}" }),
    ).toEqual({ ok: false, reason: "unknown_tool" });
  });

  it("starts a bounded lesson request without waiting for generation", () => {
    const teach = vi.fn().mockReturnValue({ requestId: "request-1" });
    expect(
      routeToolCall(
        {
          callId: "call_teach",
          name: "teach",
          argumentsJson: '{"topic":"Chain rule","student_context":"knows derivatives"}',
        },
        { teach },
      ),
    ).toEqual({ ok: true, status: "started", request_id: "request-1" });
    expect(teach).toHaveBeenCalledWith("Chain rule", "knows derivatives");
  });

  it("soft-fails teach when its handler is absent or busy", () => {
    const call = {
      callId: "call_teach",
      name: "teach",
      argumentsJson: '{"topic":"Chain rule","student_context":""}',
    };
    expect(routeToolCall(call)).toEqual({ ok: false, reason: "handler_unavailable" });
    expect(
      routeToolCall(call, {
        teach: () => {
          throw new Error("busy");
        },
      }),
    ).toEqual({ ok: false, reason: "lesson_busy" });
  });

  it.each(["point_at", "circle_el", "underline", "flash", "trace_path", "focus_on"] as const)(
    "routes %s to the committed-element handler",
    (name) => {
      const deixis = vi.fn().mockReturnValue({ overlayId: "overlay-1" });
      expect(
        routeToolCall(
          {
            callId: "call_deixis",
            name,
            argumentsJson: '{"element_id":"rangecurve"}',
          },
          { deixis },
        ),
      ).toEqual({ ok: true, status: "shown", overlay_id: "overlay-1" });
      expect(deixis).toHaveBeenCalledWith(name, "rangecurve");
    },
  );

  it("soft-fails missing, partial, or invalid element targets", () => {
    const validCall = {
      callId: "call_deixis",
      name: "circle_el",
      argumentsJson: '{"element_id":"future"}',
    };
    expect(routeToolCall(validCall, { deixis: () => undefined })).toEqual({
      ok: false,
      reason: "unknown_element",
    });
    expect(
      routeToolCall({ ...validCall, argumentsJson: '{"element_id":"Bad ID"}' }, {
        deixis: () => ({ overlayId: "never" }),
      }),
    ).toEqual({ ok: false, reason: "invalid_arguments" });
    expect(routeToolCall(validCall)).toEqual({
      ok: false,
      reason: "handler_unavailable",
    });
  });

  it("starts bounded annotation work without waiting for model output", () => {
    const annotate = vi.fn().mockReturnValue({ requestId: "annotation-request" });
    expect(
      routeToolCall(
        {
          callId: "call_annotate",
          name: "annotate",
          argumentsJson: '{"request":"Show why the peak occurs at 45 degrees"}',
        },
        { annotate },
      ),
    ).toEqual({
      ok: true,
      status: "annotation_started",
      request_id: "annotation-request",
    });
    expect(annotate).toHaveBeenCalledWith("Show why the peak occurs at 45 degrees");
  });

  it("routes a bounded generic Q&A mark batch", () => {
    const drawQaAnnotation = vi.fn().mockReturnValue({ ok: true, requestId: "qa-request", marks: 2 });
    expect(routeToolCall({
      callId: "call_qa_draw",
      name: "draw_qa_annotation",
      argumentsJson: JSON.stringify({ marks: [
        { kind: "circle", target_id: "ray1" },
        { kind: "text", target_id: "ray1", side: "above", content: "smaller angle" },
      ] }),
    }, { drawQaAnnotation })).toEqual({
      ok: true,
      status: "qa_annotation_shown",
      request_id: "qa-request",
      marks: 2,
    });
    expect(drawQaAnnotation).toHaveBeenCalledWith([
      { kind: "circle", target_id: "ray1" },
      { kind: "text", target_id: "ray1", side: "above", content: "smaller angle" },
    ]);
  });

  it.each([
    { marks: [] },
    { marks: [{ kind: "circle", target_id: "Bad ID" }] },
    { marks: [{ kind: "arrow", target_id: "ray1", side: "diagonal" }] },
    { marks: [{ kind: "text", target_id: "ray1", side: "above", content: "" }] },
    { marks: [
      { kind: "circle", target_id: "ray1" },
      { kind: "underline", target_id: "ray1" },
      { kind: "arrow", target_id: "ray1", side: "right" },
    ] },
  ])("rejects invalid Q&A drawing arguments: %j", (argumentsValue) => {
    expect(routeToolCall({
      callId: "call_qa_draw",
      name: "draw_qa_annotation",
      argumentsJson: JSON.stringify(argumentsValue),
    }, { drawQaAnnotation: () => ({ ok: true, requestId: "never", marks: 1 }) })).toEqual({
      ok: false,
      reason: "invalid_arguments",
    });
  });

  it("soft-fails Q&A drawing when the current application state refuses it", () => {
    const call = {
      callId: "call_qa_draw",
      name: "draw_qa_annotation",
      argumentsJson: '{"marks":[{"kind":"circle","target_id":"ray1"}]}',
    };
    expect(routeToolCall(call)).toEqual({ ok: false, reason: "handler_unavailable" });
    expect(routeToolCall(call, { drawQaAnnotation: () => ({ ok: false, reason: "not_in_qa" }) })).toEqual({
      ok: false,
      reason: "not_in_qa",
    });
    expect(routeToolCall(call, { drawQaAnnotation: () => ({ ok: false, reason: "unknown_element" }) })).toEqual({
      ok: false,
      reason: "unknown_element",
    });
  });
});

describe("draw_scratch routing", () => {
  it("routes a valid scratch request to the handler", () => {
    const drawScratch = vi.fn().mockReturnValue({ requestId: "req_1" });
    expect(
      routeToolCall(
        {
          callId: "call_1",
          name: "draw_scratch",
          argumentsJson: '{"description":"a labeled right triangle"}',
        },
        { drawScratch },
      ),
    ).toEqual({ ok: true, status: "scratch_started", request_id: "req_1" });
    expect(drawScratch).toHaveBeenCalledWith("a labeled right triangle");
  });

  it.each([
    "{}",
    '{"description":"ab"}',
    JSON.stringify({ description: "x".repeat(201) }),
    '{"description":"valid enough","extra":true}',
  ])("soft-fails invalid scratch arguments: %s", (argumentsJson) => {
    expect(
      routeToolCall(
        { callId: "call_1", name: "draw_scratch", argumentsJson },
        { drawScratch: vi.fn() },
      ),
    ).toEqual({ ok: false, reason: "invalid_arguments" });
  });

  it("soft-fails when no handler is wired", () => {
    expect(
      routeToolCall({
        callId: "call_1",
        name: "draw_scratch",
        argumentsJson: '{"description":"a labeled right triangle"}',
      }),
    ).toEqual({ ok: false, reason: "handler_unavailable" });
  });

  it("reports lesson_busy when the handler declines", () => {
    expect(
      routeToolCall(
        {
          callId: "call_1",
          name: "draw_scratch",
          argumentsJson: '{"description":"a labeled right triangle"}',
        },
        { drawScratch: () => undefined },
      ),
    ).toEqual({ ok: false, reason: "lesson_busy" });
  });
});
