import { describe, expect, it } from "vitest";
import { eventToTraceEntry, serializeRedactedTrace } from "./trace";
import type { InterruptionMarker, TraceEntry } from "./types";

describe("redacted trace", () => {
  it("retains IDs and status but never event content", () => {
    const entry = eventToTraceEntry(
      {
        type: "response.output_audio_transcript.delta",
        event_id: "evt_1",
        response_id: "resp_1",
        delta: "student private words",
        audio: "base64-secret",
        arguments: '{"message":"private"}',
        client_secret: "never-copy-me",
      },
      "server",
      1,
      12.34,
    );
    const exported = serializeRedactedTrace([entry], [], {
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      browser: "test-browser",
      visibleManifestHash: "1234abcd",
      lastAcknowledgedManifestHash: "1234abcd",
      contextPublications: [{ manifest_hash: "1234abcd", latency_ms: 12.34 }],
    });

    expect(entry).toEqual({
      sequence: 1,
      at_ms: 12.3,
      direction: "server",
      type: "response.output_audio_transcript.delta",
      event_id: "evt_1",
      response_id: "resp_1",
    });
    expect(exported).not.toContain("student private words");
    expect(exported).not.toContain("base64-secret");
    expect(exported).not.toContain("never-copy-me");
    expect(exported).not.toContain("private\"");
    expect(exported).toContain('"type": "server_vad"');
    expect(exported).toContain('"model": "gpt-realtime-2.1-mini"');
    expect(exported).toContain('"max_output_tokens": 1024');
    expect(exported).toContain('"hashes_match": true');
    expect(exported).toContain('"latency_ms": 12.3');
  });

  it("retains numeric usage while excluding response content", () => {
    const entry = eventToTraceEntry(
      {
        type: "response.done",
        response: {
          id: "resp_1",
          status: "completed",
          output: [{ transcript: "private answer" }],
          usage: {
            total_tokens: 100,
            input_tokens: 80,
            output_tokens: 20,
            input_token_details: { cached_tokens: 40, audio_tokens: 25 },
            output_token_details: { audio_tokens: 18 },
          },
        },
      },
      "server",
      1,
      10,
    );
    const exported = serializeRedactedTrace([entry], [], {
      tokenBudget: 20_000,
      tokenUsage: {
        total_tokens: 100,
        input_tokens: 80,
        output_tokens: 20,
        cached_input_tokens: 40,
        input_audio_tokens: 25,
        output_audio_tokens: 18,
      },
    });

    expect(entry).toMatchObject({
      total_tokens: 100,
      cached_input_tokens: 40,
      output_audio_tokens: 18,
    });
    expect(exported).toContain('"session_token_budget": 20000');
    expect(exported).toContain('"total_tokens": 100');
    expect(exported).not.toContain("private answer");
  });

  it("bounds and re-sanitizes adversarial caller-provided export data", () => {
    const rawIdentifier = `resp_${"private raw/id ".repeat(30)}`;
    const trace = Array.from({ length: 700 }, (_, index) => ({
      sequence: index,
      at_ms: Number.POSITIVE_INFINITY,
      direction: "server",
      type: index === 699 ? "response.done" : rawIdentifier,
      response_id: rawIdentifier,
      secret: "must-never-survive",
    })) as unknown as TraceEntry[];
    const interruptions = Array.from({ length: 80 }, (_, index) => ({
      id: rawIdentifier,
      at_ms: -100,
      response_id: rawIdentifier,
      local_handler_stop_latency_ms: Number.POSITIVE_INFINITY,
      perceived_audio_stop: "student-private-note",
      settlement: "invented",
      stale_output_events: 999_999,
      extra: "must-never-survive",
      index,
    })) as unknown as InterruptionMarker[];

    const parsed = JSON.parse(
      serializeRedactedTrace(trace, interruptions),
    ) as {
      trace: TraceEntry[];
      interruptions: InterruptionMarker[];
    };
    const exported = JSON.stringify(parsed);

    expect(parsed.trace).toHaveLength(500);
    expect(parsed.interruptions).toHaveLength(50);
    expect(parsed.interruptions[0]).toMatchObject({
      id: "marker_1",
      at_ms: 0,
      local_handler_stop_latency_ms: 0,
      perceived_audio_stop: "not-recorded",
      settlement: "failure",
      stale_output_events: 10_000,
    });
    expect(exported).not.toContain("private raw/id");
    expect(exported).not.toContain("must-never-survive");
    expect(exported).not.toContain("student-private-note");
  });
});
