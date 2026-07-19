import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_EVENTS,
  createFunctionCallOutput,
  createNarrationResponse,
  createResponseAfterTool,
  createSessionRequest,
  createSessionUpdate,
  createTutorContextUpdate,
  extractFunctionCalls,
  getResponseUsage,
  parseServerEvent,
  parseSessionCredential,
  SERVER_EVENTS,
} from "./protocol";

describe("Realtime protocol builders", () => {
  it("creates a bounded audio-only exact narration request", () => {
    expect(createNarrationResponse("Range peaks at forty-five degrees.", "evt_1", { chalk_kind: "lesson_narration" })).toEqual({
      type: CLIENT_EVENTS.RESPONSE_CREATE,
      event_id: "evt_1",
      response: {
        output_modalities: ["audio"],
        instructions: "SAY EXACTLY: Range peaks at forty-five degrees.",
        metadata: { chalk_kind: "lesson_narration" },
      },
    });
    expect(() => createNarrationResponse("x".repeat(241), "evt_1", {})).toThrow(/budget/i);
  });

  it("builds the demo session with teach and local deixis but without diagnostic tools", () => {
    const event = createSessionUpdate("gpt-realtime-2.1-mini", "marin");

    expect(event).toMatchObject({
      type: CLIENT_EVENTS.SESSION_UPDATE,
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1-mini",
        output_modalities: ["audio"],
        max_output_tokens: 1_024,
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: "marin" },
        },
        tool_choice: "auto",
        truncation: {
          type: "retention_ratio",
          retention_ratio: 0.8,
          token_limits: { post_instructions: 4_000 },
        },
      },
    });
    expect(event.session.instructions).toContain("conducting a live whiteboard lesson");
    expect(event.session.tools.map((tool) => tool.name)).toEqual([
      "teach",
      "point_at",
      "circle_el",
      "underline",
      "flash",
      "draw_scratch",
      "annotate",
    ]);
    expect(event.session.instructions).not.toContain("debug echo");
  });

  it("retains debug echo only in diagnostics mode", () => {
    const event = createSessionUpdate(
      "gpt-realtime-2.1-mini",
      "marin",
      "diagnostics",
    );
    expect(event.session.tools.map((tool) => tool.name)).toEqual([
      "teach",
      "point_at",
      "circle_el",
      "underline",
      "flash",
      "draw_scratch",
      "annotate",
      "debug_echo",
    ]);
    expect(event.session.instructions).toContain("Diagnostics mode is active");
  });

  it("adds direct Q&A drawing only behind its runtime flag", () => {
    const event = createSessionUpdate(
      "gpt-realtime-2.1-mini",
      "marin",
      "demo",
      undefined,
      undefined,
      true,
    );
    expect(event.session.tools.map((tool) => tool.name)).toContain("draw_qa_annotation");
    expect(event.session.instructions).toContain("at most two small target-relative");
  });

  it("adds temporary trace and focus tools only behind the choreography flag", () => {
    const enabled = createSessionUpdate(
      "gpt-realtime-2.1-mini",
      "marin",
      "demo",
      undefined,
      undefined,
      false,
      true,
    );
    expect(enabled.session.tools.map((tool) => tool.name)).toEqual([
      "teach",
      "point_at",
      "circle_el",
      "underline",
      "flash",
      "trace_path",
      "focus_on",
      "draw_scratch",
      "annotate",
    ]);
    expect(enabled.session.instructions).toContain("add no permanent ink");

    const contextUpdate = createTutorContextUpdate(
      "demo",
      "Lesson: optics. Visible board: ray1.",
      undefined,
      false,
      true,
    );
    expect(contextUpdate.session.tools.map((tool) => tool.name)).toContain("trace_path");
    expect(contextUpdate.session.tools.map((tool) => tool.name)).toContain("focus_on");
  });

  it("builds a bounded phase update from base prompt plus visible context", () => {
    const event = createTutorContextUpdate(
      "demo",
      "Lesson: projectile range. Visible board: rangeaxes, rangecurve.",
      "Evaluate the next answer against 45 degrees.",
    );
    expect(event).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        tool_choice: "auto",
      },
    });
    expect(event.session.instructions).toContain("VISIBLE BOARD");
    expect(event.session.instructions).toContain("rangeaxes");
    expect(event.session.instructions).toContain("CURRENT INTERACTION");
  });

  it("requires the normalized session contract and matching request ID", () => {
    const normalized = {
      request_id: "req-1",
      client_secret: "ephemeral-secret",
      expires_at: 123,
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      sync_mode: "paced",
    };
    expect(parseSessionCredential(normalized, "req-1")).toEqual(normalized);
    expect(() => parseSessionCredential(normalized, "req-stale")).toThrow(
      /stale or mismatched/i,
    );
    expect(() =>
      parseSessionCredential({ value: "raw-upstream-token" }, "req-1"),
    ).toThrow(/invalid request_id/i);
    expect(() =>
      parseSessionCredential({ ...normalized, sync_mode: "sequential" }, "req-1"),
    ).toThrow(/invalid sync_mode/i);
  });

  it("creates a fresh request ID per session mint", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    expect(createSessionRequest("client").request_id).not.toBe(
      createSessionRequest("client").request_id,
    );
    randomUUID.mockRestore();
  });

  it("decodes complete tool calls from response.done only", () => {
    const event = parseServerEvent(
      JSON.stringify({
        type: SERVER_EVENTS.RESPONSE_DONE,
        response: {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "debug_echo",
              arguments: '{"message":"hello"}',
            },
          ],
        },
      }),
    );
    expect(event && extractFunctionCalls(event)).toEqual([
      {
        callId: "call_1",
        name: "debug_echo",
        argumentsJson: '{"message":"hello"}',
      },
    ]);
    expect(extractFunctionCalls({ type: "response.created" })).toEqual([]);
  });

  it("rejects oversized function-call identifiers before routing", () => {
    expect(
      extractFunctionCalls({
        type: SERVER_EVENTS.RESPONSE_DONE,
        response: {
          output: [
            {
              type: "function_call",
              call_id: "x".repeat(257),
              name: "debug_echo",
              arguments: '{"message":"hello"}',
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("builds the documented function output followed by response.create", () => {
    expect(createFunctionCallOutput("call_1", { ok: true })).toEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"ok":true}',
      },
    });
    expect(createResponseAfterTool()).toEqual({
      type: "response.create",
      response: { output_modalities: ["audio"], max_output_tokens: 120 },
    });
  });

  it("rejects malformed or oversized server events", () => {
    expect(parseServerEvent("{")) .toBeNull();
    expect(parseServerEvent(JSON.stringify({ no_type: true }))).toBeNull();
    expect(parseServerEvent("x".repeat(256_001))).toBeNull();
  });

  it("extracts only bounded numeric response usage", () => {
    expect(
      getResponseUsage({
        type: SERVER_EVENTS.RESPONSE_DONE,
        response: {
          usage: {
            total_tokens: 125,
            input_tokens: 100,
            output_tokens: 25,
            input_token_details: { cached_tokens: 60, audio_tokens: 30 },
            output_token_details: { audio_tokens: 20 },
          },
        },
      }),
    ).toEqual({
      total_tokens: 125,
      input_tokens: 100,
      output_tokens: 25,
      cached_input_tokens: 60,
      input_audio_tokens: 30,
      output_audio_tokens: 20,
    });
    expect(
      getResponseUsage({
        type: SERVER_EVENTS.RESPONSE_DONE,
        response: {
          usage: { total_tokens: "125", input_tokens: 100, output_tokens: 25 },
        },
      }),
    ).toBeUndefined();
  });
});
