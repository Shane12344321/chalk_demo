import { describe, expect, it, vi } from "vitest";
import {
  decodeLessonNdjson,
  LessonStreamClient,
  LessonStreamError,
  NdjsonParser,
  streamLesson,
  type LessonStreamProgress,
} from "./client";

const REQUEST_ID = "783c6081-75a4-4ed2-8be7-4e0f32680a2b";
const STALE_ID = "4c3f750d-0062-4c9e-82f7-0487a5b7f01c";
const CLIENT_ID = "2f2db996-2dcc-4fc8-aa7f-206c7e7a9300";

const step = {
  id: "s1",
  script: "A short valid explanation.",
  ops: [{ op: "text", id: "label", region: "A1", content: "Slope" }],
  checkpoint: null,
};

function envelope(value: unknown): string {
  return JSON.stringify(value);
}

function streamResponse(
  lines: string[],
  chunkSize = Number.POSITIVE_INFINITY,
  headers: Record<string, string> = {},
): Response {
  const bytes = new TextEncoder().encode(lines.join("\n"));
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(bytes.length, offset + chunkSize);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson", ...headers },
    },
  );
}

function request() {
  return {
    requestId: REQUEST_ID,
    clientId: CLIENT_ID,
    topic: "Derivative",
  };
}

describe("lesson NDJSON streaming", () => {
  it("handles arbitrary byte chunks and a final line without a newline", async () => {
    const progress: LessonStreamProgress[] = [];
    const lines = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      "",
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ];

    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(streamResponse(lines, 1)),
      onProgress: (value) => progress.push(value),
    });

    expect(result.lesson.title).toBe("Derivative");
    expect(result.lesson.steps).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(progress.some((value) => value.steps.length === 1 && !value.complete)).toBe(true);
  });

  it("routes only schema-valid experimental ink deltas across arbitrary chunks", async () => {
    const inkDeltas: unknown[] = [];
    const lines = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({
        type: "lesson.ink_delta",
        request_id: REQUEST_ID,
        step_id: "s1",
        op_id: "pen1",
        stroke_index: 0,
        sequence: 0,
        points: [[0.1, 0.2], [0.2, 0.3]],
        complete: false,
      }),
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ];
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(streamResponse(lines, 1)),
      onInkDelta: (delta) => inkDeltas.push(delta),
    });

    expect(result.lesson.steps).toHaveLength(1);
    expect(inkDeltas).toHaveLength(1);
    expect(inkDeltas[0]).toMatchObject({ op_id: "pen1", sequence: 0 });
  });

  it("retains a bounded plan and marks an opening buffer as continuable", async () => {
    const plan = {
      kind: "lesson_plan",
      visual_structure: "A left-to-right slope argument",
      progression: ["define slope", "draw curve", "add tangent"],
      checkpoint_step: 2,
    };
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: { ...request(), generationMode: "resolved_stepwise" },
      fetchImpl: vi.fn().mockResolvedValue(streamResponse([
        envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
        envelope({ type: "lesson.plan", request_id: REQUEST_ID, plan }),
        envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
        envelope({
          type: "lesson.done",
          request_id: REQUEST_ID,
          accepted_steps: 1,
          repairs: 0,
          dropped_steps: 0,
          continuation_available: true,
          continuation_receipt: `v1.${"a".repeat(60)}.${"b".repeat(43)}`,
        }),
      ])),
    });
    expect(result.complete).toBe(false);
    expect(result.continuationAvailable).toBe(true);
    expect(result.continuationReceipt).toMatch(/^v1\./u);
    expect(result.plan).toEqual(plan);
  });

  it("decodes one captured validated stream without a network request", () => {
    const captured = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ].join("\n");

    expect(decodeLessonNdjson(captured)).toMatchObject({
      requestId: REQUEST_ID,
      complete: true,
      lesson: { title: "Derivative" },
    });
    const mixed = captured.replace(
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({ type: "lesson.step", request_id: STALE_ID, step }),
    );
    expect(() => decodeLessonNdjson(mixed)).toThrowError(/mixes request IDs/u);
  });

  it("tracks sanitization separately and verifies optional completion totals", async () => {
    const lines = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({
        type: "lesson.warning",
        request_id: REQUEST_ID,
        code: "step_sanitized",
        step_hint: "s1",
        corrections: ["trimmed_outer_whitespace", "clamped_normalized_point", "dropped_extra_checkpoint"],
        correction_count: 3,
      }),
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
        sanitized_steps: 1,
        sanitized_fields: 3,
      }),
    ];
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(streamResponse(lines)),
    });
    expect(result).toMatchObject({ sanitizedSteps: 1, sanitizedFields: 3, warnings: 1 });

    const mismatched = lines.map((line) =>
      line.includes('"sanitized_fields":3') ? line.replace('"sanitized_fields":3', '"sanitized_fields":2') : line,
    );
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(streamResponse(mismatched)),
      }),
    ).rejects.toMatchObject({ code: "invalid_sequence" });
  });

  it("retains only bounded model and prompt-hash response metadata", async () => {
    const hash = "a".repeat(64);
    const lines = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ];
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse(lines, Number.POSITIVE_INFINITY, {
          "X-Chalk-Board-Model": "gpt-5.6-luna",
          "X-Chalk-Board-Reasoning-Effort": "none",
          "X-Chalk-Board-Prompt-SHA256": hash,
          "X-Chalk-Repair-Prompt-SHA256": "not-a-hash",
        }),
      ),
    });

    expect(result.boardModel).toBe("gpt-5.6-luna");
    expect(result.boardReasoningEffort).toBe("none");
    expect(result.boardPromptSha256).toBe(hash);
    expect(result.repairPromptSha256).toBeUndefined();
  });

  it("ignores stale request IDs but rejects a mismatched completion count", async () => {
    const lines = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({ type: "lesson.step", request_id: STALE_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ];

    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(streamResponse(lines)),
      }),
    ).rejects.toMatchObject({ code: "invalid_sequence" });
  });

  it("drops a browser-rejected step without discarding the accepted prefix", async () => {
    const invalidStep = {
      id: "s2",
      script: "This step references axes that never rendered.",
      ops: [{ op: "curve", id: "curve1", axes_id: "missing", expr: "x" }],
      checkpoint: null,
    };
    const dependentStep = {
      id: "s3",
      script: "This step anchors to the dropped element.",
      ops: [
        {
          op: "text",
          id: "orphan",
          anchor: { el: "curve1", side: "below" },
          content: "orphaned",
        },
      ],
      checkpoint: null,
    };
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse([
          envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step: invalidStep }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step: dependentStep }),
          envelope({
            type: "lesson.done",
            request_id: REQUEST_ID,
            accepted_steps: 3,
            repairs: 0,
            dropped_steps: 0,
          }),
        ]),
      ),
    });

    expect(result.lesson.steps.map((value) => value.id)).toEqual(["s1"]);
    expect(result.browserDroppedSteps).toBe(2);
    expect(result.warnings).toBeGreaterThanOrEqual(2);
    expect(result.complete).toBe(true);
    expect(result.receiptPrefix.map((value) => value.id)).toEqual(["s1", "s2", "s3"]);
    expect(result.recoveryEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "browser_unknown_reference",
        intent: "curve",
        affectedElementIds: ["curve1"],
        affectedOpIndexes: [0],
        sourceStepId: "s2",
      }),
      expect.objectContaining({
        code: "browser_unknown_reference",
        intent: "text",
        affectedElementIds: ["orphan"],
        affectedOpIndexes: [0],
        sourceStepId: "s3",
      }),
    ]));
  });

  it("falls back only when no streamed step survives browser validation", async () => {
    const invalidStep = {
      ...step,
      ops: [{ op: "curve", id: "curve1", axes_id: "missing", expr: "x" }],
    };
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          streamResponse([
            envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
            envelope({ type: "lesson.step", request_id: REQUEST_ID, step: invalidStep }),
            envelope({
              type: "lesson.done",
              request_id: REQUEST_ID,
              accepted_steps: 1,
              repairs: 0,
              dropped_steps: 0,
            }),
          ]),
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_lesson" });
  });

  it("keeps surviving ops when only one op in a step fails browser validation", async () => {
    const partiallyValidStep = {
      id: "s2",
      script: "One op is fine and one references missing axes.",
      ops: [
        { op: "text", id: "keepme", region: "B1", content: "Kept" },
        { op: "curve", id: "badcurve", axes_id: "missing", expr: "x" },
      ],
      checkpoint: null,
    };
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse([
          envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step: partiallyValidStep }),
          envelope({
            type: "lesson.done",
            request_id: REQUEST_ID,
            accepted_steps: 2,
            repairs: 0,
            dropped_steps: 0,
          }),
        ]),
      ),
    });

    expect(result.lesson.steps).toHaveLength(2);
    expect(result.lesson.steps[1].ops.map((op) => op.id)).toEqual(["keepme"]);
    expect(result.browserDroppedSteps).toBe(0);
    expect(result.warnings).toBe(1);
    expect(result.recoveryEvidence).toEqual([
      expect.objectContaining({
        code: "browser_unknown_reference",
        affectedElementIds: ["badcurve"],
        affectedOpIndexes: [1],
        sourceStepId: "s2",
      }),
    ]);
  });

  it("rejects a truncated final envelope and a stream without lesson.done", async () => {
    const truncated = [
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      '{"type":"lesson.step"',
    ];
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(streamResponse(truncated)),
      }),
    ).rejects.toMatchObject({ code: "invalid_envelope" });

    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          streamResponse([
            envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
            envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          ]),
        ),
      }),
    ).rejects.toMatchObject({ code: "truncated_stream" });
  });

  it("retains accepted steps when generation fails after useful output", async () => {
    const progress: LessonStreamProgress[] = [];
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse([
          envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          envelope({
            type: "lesson.error",
            request_id: REQUEST_ID,
            code: "generation_timeout",
            fallback_available: true,
          }),
        ]),
      ),
      onProgress: (value) => progress.push(value),
    });

    expect(result).toMatchObject({
      partial: true,
      errorCode: "generation_timeout",
      complete: true,
    });
    expect(result.lesson.steps).toHaveLength(1);
    expect(progress.at(-1)).toMatchObject({ complete: true, steps: [step] });
  });

  it("retains only the shared allowlisted upstream reason on partial results", async () => {
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse([
          envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          envelope({
            type: "lesson.error",
            request_id: REQUEST_ID,
            code: "upstream_incomplete",
            upstream_reason: "max_output_tokens",
            failure_origin: "repair",
            repair_attempts: 2,
            fallback_available: true,
          }),
        ]),
      ),
    });

    expect(result).toMatchObject({
      partial: true,
      errorCode: "upstream_incomplete",
      upstreamReason: "max_output_tokens",
      failureOrigin: "repair",
      repairs: 2,
      complete: true,
    });
  });

  it("rejects upstream reasons outside the shared allowlist", async () => {
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          streamResponse([
            envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
            envelope({
              type: "lesson.error",
              request_id: REQUEST_ID,
              code: "upstream_error",
              upstream_reason: "private-unbounded-reason",
              fallback_available: true,
            }),
          ]),
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_envelope" });
  });

  it("surfaces a terminal generation error when no valid step exists", async () => {
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          streamResponse([
            envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
            envelope({
              type: "lesson.error",
              request_id: REQUEST_ID,
              code: "no_valid_steps",
              fallback_available: true,
            }),
          ]),
        ),
      }),
    ).rejects.toMatchObject({ code: "server_error" });
  });

  it("retains an allowlisted reason on a zero-step server error", async () => {
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          streamResponse([
            envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
            envelope({
              type: "lesson.error",
              request_id: REQUEST_ID,
              code: "upstream_failed",
              upstream_reason: "authentication",
              failure_origin: "repair",
              repair_attempts: 1,
              fallback_available: true,
            }),
          ]),
        ),
      }),
    ).rejects.toMatchObject({
      code: "server_error",
      upstreamReason: "authentication",
      failureOrigin: "repair",
      repairAttempts: 1,
    });
  });

  it("keeps historical upstream errors without new attribution fields readable", async () => {
    const result = await streamLesson({
      apiBaseUrl: "http://127.0.0.1:8000",
      request: request(),
      fetchImpl: vi.fn().mockResolvedValue(
        streamResponse([
          envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
          envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
          envelope({
            type: "lesson.error",
            request_id: REQUEST_ID,
            code: "upstream_rejected",
            fallback_available: true,
          }),
        ]),
      ),
    });

    expect(result).toMatchObject({ partial: true, errorCode: "upstream_rejected", repairs: 0 });
    expect(result.upstreamReason).toBeUndefined();
    expect(result.failureOrigin).toBeUndefined();
  });

  it("rejects a successful response with an unexpected media type", async () => {
    await expect(
      streamLesson({
        apiBaseUrl: "http://127.0.0.1:8000",
        request: request(),
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("not ndjson", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "http_error" });
  });

  it("aborts the previous active request and suppresses its later progress", async () => {
    const signals: AbortSignal[] = [];
    const firstProgress = vi.fn();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        if (signals.length === 2) {
          resolve(
            streamResponse([
              envelope({ type: "lesson.started", request_id: STALE_ID, title: "Integral" }),
              envelope({ type: "lesson.step", request_id: STALE_ID, step }),
              envelope({
                type: "lesson.done",
                request_id: STALE_ID,
                accepted_steps: 1,
                repairs: 0,
                dropped_steps: 0,
              }),
            ]),
          );
        }
      });
    });
    const client = new LessonStreamClient("http://127.0.0.1:8000", CLIENT_ID, fetchImpl);
    const first = client.start(
      { requestId: REQUEST_ID, topic: "Derivative" },
      firstProgress,
    );
    const second = client.start({ requestId: STALE_ID, topic: "Integral" });

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ requestId: STALE_ID });
    expect(signals[0].aborted).toBe(true);
    expect(firstProgress).not.toHaveBeenCalled();
  });

  it("rejects a stale final result when the transport ignores abort", async () => {
    let resolveFirst!: (response: Response) => void;
    let call = 0;
    const firstProgress = vi.fn();
    const fetchImpl = vi.fn(() => {
      call += 1;
      if (call === 2) {
        return Promise.resolve(streamResponse([
          envelope({ type: "lesson.started", request_id: STALE_ID, title: "Integral" }),
          envelope({ type: "lesson.step", request_id: STALE_ID, step }),
          envelope({
            type: "lesson.done",
            request_id: STALE_ID,
            accepted_steps: 1,
            repairs: 0,
            dropped_steps: 0,
          }),
        ]));
      }
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const client = new LessonStreamClient("http://127.0.0.1:8000", CLIENT_ID, fetchImpl);
    const stale = client.start(
      { requestId: REQUEST_ID, topic: "Derivative" },
      firstProgress,
    );
    await expect(client.start({ requestId: STALE_ID, topic: "Integral" })).resolves.toMatchObject({
      requestId: STALE_ID,
    });
    resolveFirst(streamResponse([
      envelope({ type: "lesson.started", request_id: REQUEST_ID, title: "Derivative" }),
      envelope({ type: "lesson.step", request_id: REQUEST_ID, step }),
      envelope({
        type: "lesson.done",
        request_id: REQUEST_ID,
        accepted_steps: 1,
        repairs: 0,
        dropped_steps: 0,
      }),
    ]));
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(firstProgress).not.toHaveBeenCalled();
  });

  it("rejects a late failure after cancellation so callers cannot install fallback", async () => {
    let rejectLate!: (error: Error) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      rejectLate = reject;
    }));
    const client = new LessonStreamClient("http://127.0.0.1:8000", CLIENT_ID, fetchImpl);
    const pending = client.start({ requestId: REQUEST_ID, topic: "Derivative" });
    client.cancel();
    rejectLate(new Error("late transport failure"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds individual envelope size", () => {
    const parser = new NdjsonParser();
    expect(() => parser.feed(new TextEncoder().encode("x".repeat(25 * 1024)))).toThrow(
      LessonStreamError,
    );
  });
});
