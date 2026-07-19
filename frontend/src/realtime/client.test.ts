import { describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import { manifestHash } from "./manifestHash";
import { SESSION_TOKEN_BUDGET, SERVER_EVENTS } from "./protocol";
import { ResponseCoordinator } from "./responseCoordinator";
import type {
  InterruptionMarker,
  RealtimeClientCallbacks,
  RealtimeSemanticEvent,
  RealtimeSnapshot,
  ServerEvent,
  SessionCredential,
  TokenUsageSummary,
} from "./types";

interface ClientHarness {
  attempt: number;
  status: RealtimeSnapshot["status"];
  startedAt: number;
  activeResponseId?: string;
  playbackResponseId?: string;
  dataChannel?: RTCDataChannel;
  peer?: RTCPeerConnection;
  microphoneStream?: MediaStream;
  remoteAudio?: HTMLAudioElement;
  sessionCredential?: SessionCredential;
  observedSessionModel?: string;
  observedSessionVoice?: string;
  toolRoundTrips: number;
  responseCoordinator: ResponseCoordinator;
  interruptions: InterruptionMarker[];
  seenCallIds: Set<string>;
  seenUsageResponseIds: Set<string>;
  tokenUsage: TokenUsageSummary;
  fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  handleServerEvent(event: ServerEvent): void;
  installDataChannelHandlers(dataChannel: RTCDataChannel, attempt: number): void;
  installPeerHandlers(peer: RTCPeerConnection, attempt: number): void;
  resetForConnectionAttempt(): void;
  waitUntilSessionUpdated(attempt: number): Promise<void>;
}

type FakeListener = (event: { data?: unknown; streams?: MediaStream[]; track?: MediaStreamTrack }) => void;

class FakeDataChannel {
  readyState = "open";
  readonly send = vi.fn();
  readonly close = vi.fn();
  private listeners = new Map<string, FakeListener[]>();

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakePeer {
  connectionState: RTCPeerConnectionState = "new";
  readonly close = vi.fn();
  private listeners = new Map<string, FakeListener[]>();

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(
    type: string,
    event: { data?: unknown; streams?: MediaStream[]; track?: MediaStreamTrack } = {},
  ): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class HandshakePeer extends FakePeer {
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: RTCSessionDescription | null = null;
  readonly dataChannel = new FakeDataChannel();
  readonly addTrack = vi.fn();

  createDataChannel(): RTCDataChannel {
    return this.dataChannel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(description: RTCLocalSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }

  async setRemoteDescription(): Promise<void> {
    this.dataChannel.emit("open");
    this.dataChannel.emit("message", {
      data: JSON.stringify({ type: SERVER_EVENTS.SESSION_CREATED }),
    });
  }

  removeEventListener(): void {
    // ICE is already complete in this deterministic harness.
  }
}

function fakeTrack() {
  return {
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function fakeStream(track: MediaStreamTrack) {
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function fakeAudio() {
  return {
    pause: vi.fn(),
    srcObject: {} as MediaStream,
  } as unknown as HTMLAudioElement;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  send: (data: string) => void = vi.fn(),
  onSemanticEvent?: (event: RealtimeSemanticEvent) => void,
  onTeachRequested?: (topic: string, studentContext: string) => { requestId: string },
  onDeixisRequested?: RealtimeClientCallbacks["onDeixisRequested"],
  onAnnotateRequested?: RealtimeClientCallbacks["onAnnotateRequested"],
  onDrawQaAnnotationRequested?: RealtimeClientCallbacks["onDrawQaAnnotationRequested"],
) {
  let latest: RealtimeSnapshot | undefined;
  const client = new RealtimeClient({
    apiBaseUrl: "http://127.0.0.1:8000",
    clientId: "00000000-0000-4000-8000-000000000001",
    callbacks: {
      onSnapshot: (snapshot) => (latest = snapshot),
      onSemanticEvent,
      onTeachRequested,
      onDeixisRequested,
      onAnnotateRequested,
      onDrawQaAnnotationRequested,
    },
    now: (() => {
      let now = 0;
      return () => ++now;
    })(),
  });
  const harness = client as unknown as ClientHarness;
  harness.dataChannel = { readyState: "open", send } as unknown as RTCDataChannel;
  return { client, harness, send, latest: () => latest! };
}

function responseDone(
  responseId: string,
  status: string,
  output: unknown[] = [],
  usage?: Record<string, unknown>,
): ServerEvent {
  return {
    type: SERVER_EVENTS.RESPONSE_DONE,
    response: { id: responseId, status, output, usage },
  };
}

describe("RealtimeClient event coordination", () => {
  it("correlates lesson narration activity, completion, and playback stop", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const send = vi.fn();
    const { client, harness } = createHarness(send, (event) => semanticEvents.push(event));
    harness.status = "connected";
    const context = { requestId: "req-1", stepId: "s1", cycle: 1 };

    client.requestNarration("A short deterministic lesson line.", context);
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      type: "response.create",
      response: { output_modalities: ["audio"] },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_lesson",
        metadata: {
          chalk_kind: "lesson_narration",
          chalk_request_id: "req-1",
          chalk_step_id: "s1",
          chalk_cycle: "1",
        },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_lesson",
    });
    harness.handleServerEvent(responseDone("resp_lesson", "completed"));
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_lesson",
    });

    expect(semanticEvents).toEqual([
      { type: "narration.activity", context },
      { type: "narration.generation_done", context },
      { type: "narration.playback_stopped", context },
    ]);
    expect(harness.responseCoordinator.hasPurpose("lesson_narration")).toBe(false);
  });

  it("retains narration correlation when playback stops before generation completes", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const { client, harness } = createHarness(vi.fn(), (event) => semanticEvents.push(event));
    harness.status = "connected";
    const context = { requestId: "req-1", stepId: "s1", cycle: 1 };
    client.requestNarration("A short deterministic lesson line.", context);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_lesson",
        metadata: {
          chalk_kind: "lesson_narration",
          chalk_request_id: "req-1",
          chalk_step_id: "s1",
          chalk_cycle: "1",
        },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_lesson",
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_lesson",
    });
    expect(harness.responseCoordinator.get("resp_lesson")).toMatchObject({
      playbackStopped: true,
      generationDone: false,
    });
    harness.handleServerEvent(responseDone("resp_lesson", "completed"));
    expect(semanticEvents).toEqual([
      { type: "narration.activity", context },
      { type: "narration.playback_stopped", context },
      { type: "narration.generation_done", context },
    ]);
    expect(harness.responseCoordinator.hasPurpose("lesson_narration")).toBe(false);
  });

  it("does not bind lesson narration to an unrelated response.created event", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const { client, harness } = createHarness(vi.fn(), (event) => semanticEvents.push(event));
    harness.status = "connected";
    client.requestNarration("A short deterministic lesson line.", {
      requestId: "req-1",
      stepId: "s1",
      cycle: 1,
    });

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_vad", metadata: { chalk_kind: "conversation" } },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_vad",
    });

    expect(harness.responseCoordinator.get("resp_vad")).toBeUndefined();
    expect(semanticEvents).toEqual([]);
  });

  it("releases rejected narration and emits a correlated failure", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const send = vi.fn();
    const { client, harness } = createHarness(send, (event) => semanticEvents.push(event));
    harness.status = "connected";
    const context = { requestId: "req-1", stepId: "s1", cycle: 1 };
    client.requestNarration("A short deterministic lesson line.", context);
    const clientEventId = JSON.parse(String(send.mock.calls[0][0])).event_id as string;

    harness.handleServerEvent({
      type: SERVER_EVENTS.ERROR,
      error: { event_id: clientEventId, type: "invalid_request_error" },
    });

    expect(harness.responseCoordinator.hasPurpose("lesson_narration")).toBe(false);
    expect(semanticEvents).toEqual([{ type: "narration.failed", context }]);
    expect(() => client.requestNarration("Retry safely.", { ...context, cycle: 2 })).not.toThrow();
  });

  it("waits for actual output playback before signaling narration activity", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const { client, harness } = createHarness(vi.fn(), (event) => semanticEvents.push(event));
    harness.status = "connected";
    const context = {
      requestId: "req-1",
      stepId: "s1",
      cycle: 1,
    };
    client.requestNarration("A short deterministic lesson line.", context);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_lesson",
        metadata: {
          chalk_kind: "lesson_narration",
          chalk_request_id: "req-1",
          chalk_step_id: "s1",
          chalk_cycle: "1",
        },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      response_id: "resp_lesson",
      delta: "Generated before playout.",
    });
    expect(semanticEvents).toEqual([
      {
        type: "narration.transcript_progress",
        context,
        generatedCharacters: "Generated before playout.".length,
      },
    ]);
    expect(semanticEvents.some((event) => event.type === "narration.activity")).toBe(false);

    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_lesson",
    });
    expect(semanticEvents.at(-1)).toEqual({ type: "narration.activity", context });
  });

  it("assumes narration playback after a bounded wait when the started event is missed", () => {
    vi.useFakeTimers();
    try {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness, latest } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      harness.status = "connected";
      const context = { requestId: "req-1", stepId: "s1", cycle: 1 };
      client.requestNarration("A short deterministic lesson line.", context);
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: {
          id: "resp_lesson",
          metadata: {
            chalk_kind: "lesson_narration",
            chalk_request_id: "req-1",
            chalk_step_id: "s1",
            chalk_cycle: "1",
          },
        },
      });
      harness.handleServerEvent(responseDone("resp_lesson", "completed"));
      expect(
        semanticEvents.some((event) => event.type === "narration.activity"),
      ).toBe(false);

      vi.advanceTimersByTime(4_000);
      expect(semanticEvents.some((event) => event.type === "narration.activity")).toBe(true);
      expect(
        latest().trace.some(
          (entry) =>
            entry.type === "narration.audio_start_assumed" &&
            entry.response_id === "resp_lesson",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not assume narration playback when the started event arrives in time", () => {
    vi.useFakeTimers();
    try {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness, latest } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      harness.status = "connected";
      const context = { requestId: "req-1", stepId: "s1", cycle: 1 };
      client.requestNarration("A short deterministic lesson line.", context);
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: {
          id: "resp_lesson",
          metadata: {
            chalk_kind: "lesson_narration",
            chalk_request_id: "req-1",
            chalk_step_id: "s1",
            chalk_cycle: "1",
          },
        },
      });
      harness.handleServerEvent(responseDone("resp_lesson", "completed"));
      harness.handleServerEvent({
        type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
        response_id: "resp_lesson",
      });
      vi.advanceTimersByTime(10_000);
      expect(
        semanticEvents.filter((event) => event.type === "narration.activity"),
      ).toHaveLength(1);
      expect(
        latest().trace.some((entry) => entry.type === "narration.audio_start_assumed"),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds the native fetch receiver", async () => {
    const originalFetch = globalThis.fetch;
    const receiverCheckingFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    globalThis.fetch = receiverCheckingFetch;

    try {
      const { harness } = createHarness();
      await expect(harness.fetchImpl("http://localhost/health")).resolves.toMatchObject({
        status: 204,
      });
      expect(receiverCheckingFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not lose a session.updated acknowledgement that arrives before waiting", async () => {
    const { harness } = createHarness();
    harness.handleServerEvent({ type: SERVER_EVENTS.SESSION_UPDATED });
    await expect(harness.waitUntilSessionUpdated(0)).resolves.toBeUndefined();
  });

  it("publishes visible-board context serially and waits for acknowledgement", async () => {
    const send = vi.fn();
    const { client, harness } = createHarness(send);
    harness.status = "connected";

    const first = client.setBoardContext("Board: title. Visible: curve at center.");
    const second = client.setInteractionGuidance("Answer the active checkpoint briefly.");
    await flushMicrotasks();
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      type: "session.update",
      session: {
        instructions: expect.stringContaining("curve at center"),
      },
    });

    harness.handleServerEvent({ type: SERVER_EVENTS.SESSION_UPDATED });
    await first;
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[1][0]))).toMatchObject({
      type: "session.update",
      session: {
        instructions: expect.stringContaining("Answer the active checkpoint briefly"),
      },
    });
    harness.handleServerEvent({ type: SERVER_EVENTS.SESSION_UPDATED });
    await second;
    expect(client.getSnapshot().contextPublications).toHaveLength(2);
    expect(client.getSnapshot().lastAcknowledgedManifestHash).toBe(
      manifestHash("Board: title. Visible: curve at center."),
    );
    expect(client.getSnapshot().contextPublications.every((item) => item.latency_ms >= 0)).toBe(
      true,
    );
  });

  it("refreshes the latest visible-board instructions when student speech begins", async () => {
    const send = vi.fn();
    const { client, harness } = createHarness(send);
    harness.status = "connected";
    const publication = client.setBoardContext(
      "Lesson: optics. Visible board: ray from lower-left to center.",
    );
    await flushMicrotasks();
    harness.handleServerEvent({ type: SERVER_EVENTS.SESSION_UPDATED });
    await publication;
    send.mockClear();

    harness.handleServerEvent({ type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      type: "session.update",
      session: {
        instructions: expect.stringContaining("ray from lower-left to center"),
      },
    });
    harness.handleServerEvent({ type: SERVER_EVENTS.SESSION_UPDATED });
    await flushMicrotasks();
  });

  it("tracks checkpoint prompt and automatic feedback as separate responses", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const { client, harness } = createHarness(vi.fn(), (event) =>
      semanticEvents.push(event),
    );
    harness.status = "connected";
    const context = { requestId: "req-1", stepId: "s2", cycle: 2 };

    client.requestCheckpointPrompt("Where does the curve peak?", context);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_prompt",
        metadata: {
          chalk_kind: "checkpoint_prompt",
          chalk_request_id: "req-1",
          chalk_step_id: "s2",
          chalk_cycle: "2",
        },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_prompt",
    });
    harness.handleServerEvent(responseDone("resp_prompt", "completed"));
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_prompt",
    });

    client.expectAutomaticResponse("checkpoint_feedback", context);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_feedback" },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_feedback",
    });
    harness.handleServerEvent(responseDone("resp_feedback", "completed"));
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_feedback",
    });

    expect(semanticEvents.map((event) => event.type)).toEqual([
      "checkpoint.prompt_activity",
      "checkpoint.prompt_generation_done",
      "checkpoint.prompt_playback_stopped",
      "checkpoint.feedback_activity",
      "checkpoint.feedback_generation_done",
      "checkpoint.feedback_playback_stopped",
    ]);
  });

  it.each(["cancelled", "incomplete"])(
    "fails an unprompted %s checkpoint instead of treating it as complete",
    (status) => {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      harness.status = "connected";
      const context = { requestId: "req-1", stepId: "s2", cycle: 2 };

      client.requestCheckpointPrompt("Where does the curve peak?", context);
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: {
          id: "resp_prompt",
          metadata: {
            chalk_kind: "checkpoint_prompt",
            chalk_request_id: "req-1",
            chalk_step_id: "s2",
            chalk_cycle: "2",
          },
        },
      });
      harness.handleServerEvent(responseDone("resp_prompt", status));

      expect(semanticEvents).toEqual([
        { type: "checkpoint.prompt_failed", context },
      ]);
      expect(harness.responseCoordinator.hasPurpose("checkpoint_prompt")).toBe(false);
    },
  );

  it.each(["cancelled", "incomplete"])(
    "fails %s checkpoint feedback instead of leaving the lesson waiting",
    (status) => {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      const context = { requestId: "req-1", stepId: "s2", cycle: 2 };
      client.expectAutomaticResponse("checkpoint_feedback", context);
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: { id: "resp_feedback" },
      });
      harness.handleServerEvent(responseDone("resp_feedback", status));

      expect(semanticEvents).toEqual([
        { type: "checkpoint.feedback_failed", context },
      ]);
      expect(harness.responseCoordinator.hasPurpose("checkpoint_feedback")).toBe(false);
    },
  );

  it("fails checkpoint feedback whose response lifecycle never settles", () => {
    vi.useFakeTimers();
    try {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      const context = { requestId: "req-1", stepId: "s2", cycle: 2 };
      client.expectAutomaticResponse("checkpoint_feedback", context);
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: { id: "resp_feedback" },
      });

      vi.advanceTimersByTime(20_100);

      expect(semanticEvents).toContainEqual({
        type: "checkpoint.feedback_failed",
        context,
      });
      expect(harness.responseCoordinator.hasPurpose("checkpoint_feedback")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails checkpoint feedback that never receives response.created", () => {
    vi.useFakeTimers();
    try {
      const semanticEvents: RealtimeSemanticEvent[] = [];
      const { client, harness, latest } = createHarness(vi.fn(), (event) =>
        semanticEvents.push(event),
      );
      const context = { requestId: "req-1", stepId: "s2", cycle: 2 };
      client.expectAutomaticResponse("checkpoint_feedback", context);
      expect(latest().responsePending).toBe(true);

      vi.advanceTimersByTime(8_100);

      expect(semanticEvents).toContainEqual({
        type: "checkpoint.feedback_failed",
        context,
      });
      expect(latest().responsePending).toBe(false);
      expect(
        latest().trace.some(
          (entry) => entry.type === "response.automatic_create_timeout",
        ),
      ).toBe(true);
      expect(harness.responseCoordinator.hasPurpose("checkpoint_feedback")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a checkpoint prompt cancelled by an early student answer", () => {
    const semanticEvents: RealtimeSemanticEvent[] = [];
    const { client, harness } = createHarness(vi.fn(), (event) =>
      semanticEvents.push(event),
    );
    harness.status = "connected";
    const context = { requestId: "req-1", stepId: "s2", cycle: 2 };

    client.requestCheckpointPrompt("Where does the curve peak?", context);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_prompt",
        metadata: {
          chalk_kind: "checkpoint_prompt",
          chalk_request_id: "req-1",
          chalk_step_id: "s2",
          chalk_cycle: "2",
        },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_prompt",
    });
    harness.handleServerEvent({ type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED });
    harness.handleServerEvent(responseDone("resp_prompt", "cancelled"));

    expect(semanticEvents.map((event) => event.type)).not.toContain(
      "checkpoint.prompt_failed",
    );
    expect(semanticEvents.map((event) => event.type)).toContain("student.speech_started");
  });

  it("stops a late microphone stream when disconnect supersedes getUserMedia", async () => {
    let resolveMicrophone!: (stream: MediaStream) => void;
    const microphonePromise = new Promise<MediaStream>((resolve) => {
      resolveMicrophone = resolve;
    });
    const getUserMedia = vi.fn(() => microphonePromise);
    const originalMediaDevices = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { request_id: string };
      return new Response(
        JSON.stringify({
          request_id: request.request_id,
          client_secret: "ephemeral",
          model: "gpt-realtime-2.1-mini",
          voice: "marin",
          sync_mode: "paced",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const client = new RealtimeClient({
      apiBaseUrl: "http://127.0.0.1:8000",
      clientId: "00000000-0000-4000-8000-000000000001",
      callbacks: { onSnapshot: () => undefined },
      fetchImpl,
    });
    const track = fakeTrack();

    try {
      const connecting = client.connect();
      for (let index = 0; index < 10 && getUserMedia.mock.calls.length === 0; index += 1) {
        await flushMicrotasks();
      }
      expect(getUserMedia).toHaveBeenCalledOnce();
      await client.disconnect();
      resolveMicrophone(fakeStream(track));
      await connecting;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(client.getSnapshot().status).toBe("disconnected");
    } finally {
      if (originalMediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
      } else {
        Reflect.deleteProperty(navigator, "mediaDevices");
      }
    }
  });

  it("keeps captured audio disabled after session acknowledgement until the user speaks", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const peer = new HandshakePeer();
    const enabledObservations: boolean[] = [];
    peer.addTrack.mockImplementation((addedTrack: MediaStreamTrack) => {
      enabledObservations.push(addedTrack.enabled);
    });
    peer.dataChannel.send.mockImplementation((data: string) => {
      const event = JSON.parse(data) as { type: string };
      if (event.type === "session.update") {
        enabledObservations.push(track.enabled);
        peer.dataChannel.emit("message", {
          data: JSON.stringify({ type: SERVER_EVENTS.SESSION_UPDATED }),
        });
      }
    });
    const originalMediaDevices = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn(() => peer),
    );
    vi.stubGlobal("Audio", vi.fn(() => fakeAudio()));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/session")) {
        const request = JSON.parse(String(init?.body)) as { request_id: string };
        return new Response(
          JSON.stringify({
            request_id: request.request_id,
            client_secret: "ephemeral",
            model: "gpt-realtime-2.1-mini",
            voice: "marin",
            sync_mode: "paced",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("answer-sdp", { status: 200 });
    }) as typeof fetch;
    const client = new RealtimeClient({
      apiBaseUrl: "http://127.0.0.1:8000",
      clientId: "00000000-0000-4000-8000-000000000001",
      callbacks: { onSnapshot: () => undefined },
      fetchImpl,
    });

    try {
      await client.connect();
      expect(enabledObservations).toEqual([false, false]);
      expect(track.enabled).toBe(false);
      expect(client.getSnapshot()).toMatchObject({
        status: "connected",
        microphoneEnabled: false,
        sessionModel: "gpt-realtime-2.1-mini",
        sessionVoice: "marin",
        syncMode: "paced",
      });
      await client.disconnect();
      expect(track.stop).toHaveBeenCalledOnce();
      expect(client.getSnapshot()).toMatchObject({
        status: "disconnected",
        sessionModel: "gpt-realtime-2.1-mini",
        sessionVoice: "marin",
        syncMode: "paced",
      });
    } finally {
      vi.unstubAllGlobals();
      if (originalMediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
      } else {
        Reflect.deleteProperty(navigator, "mediaDevices");
      }
    }
  });

  it("opens the microphone explicitly and auto-mutes at the VAD turn boundary", () => {
    const { client, harness, latest } = createHarness();
    const track = fakeTrack();
    track.enabled = false;
    harness.status = "connected";
    harness.microphoneStream = fakeStream(track);

    client.setMicrophoneEnabled(true);
    expect(track.enabled).toBe(true);
    expect(latest().microphoneEnabled).toBe(true);

    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STOPPED,
    });
    expect(track.enabled).toBe(false);
    expect(latest().microphoneEnabled).toBe(false);
    expect(latest().trace.at(-1)?.type).toBe("microphone.input_disabled");
  });

  it("cleans every resource and clears session state on data-channel close", async () => {
    const { client, harness, latest } = createHarness();
    const track = fakeTrack();
    const dataChannel = new FakeDataChannel();
    const peer = new FakePeer();
    const audio = fakeAudio();
    harness.status = "connected";
    harness.activeResponseId = "resp_1";
    harness.sessionCredential = {
      request_id: "req_1",
      client_secret: "ephemeral",
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      sync_mode: "paced",
    };
    harness.observedSessionModel = "gpt-realtime-2.1-mini";
    harness.observedSessionVoice = "marin";
    harness.microphoneStream = fakeStream(track);
    harness.dataChannel = dataChannel as unknown as RTCDataChannel;
    harness.peer = peer as unknown as RTCPeerConnection;
    harness.remoteAudio = audio;
    harness.installDataChannelHandlers(dataChannel as unknown as RTCDataChannel, 0);

    dataChannel.emit("close");
    await flushMicrotasks();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(dataChannel.close).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(latest()).toMatchObject({
      status: "error",
      sessionModel: undefined,
      activeResponseId: undefined,
    });
    await client.disconnect();
    expect(latest().status).toBe("disconnected");
  });

  it("routes peer failure through terminal cleanup", async () => {
    const { harness, latest } = createHarness();
    const track = fakeTrack();
    const peer = new FakePeer();
    const dataChannel = new FakeDataChannel();
    const audio = fakeAudio();
    harness.status = "connected";
    harness.activeResponseId = "resp_1";
    harness.sessionCredential = {
      request_id: "req_1",
      client_secret: "ephemeral",
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      sync_mode: "paced",
    };
    harness.observedSessionModel = "gpt-realtime-2.1-mini";
    harness.observedSessionVoice = "marin";
    harness.microphoneStream = fakeStream(track);
    harness.peer = peer as unknown as RTCPeerConnection;
    harness.dataChannel = dataChannel as unknown as RTCDataChannel;
    harness.installPeerHandlers(peer as unknown as RTCPeerConnection, 0);
    harness.remoteAudio = audio;

    peer.connectionState = "failed";
    peer.emit("connectionstatechange");
    await flushMicrotasks();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(dataChannel.close).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(latest()).toMatchObject({
      status: "error",
      sessionModel: undefined,
      activeResponseId: undefined,
    });
  });

  it("attaches the opt-in remote-audio activity monitor and retains only closed evidence", async () => {
    let latest: RealtimeSnapshot | undefined;
    let transition: ((event: { active: boolean; observedAtMs: number; rms: number }) => void) | undefined;
    const stop = vi.fn();
    const monitorFactory = vi.fn((_stream, onTransition) => {
      transition = onTransition;
      return {
        snapshot: () => ({
          active: false,
          transitions: 0,
          samples: 12,
          maxSampleCostMs: 0.08,
        }),
        stop,
      };
    });
    const client = new RealtimeClient({
      apiBaseUrl: "http://127.0.0.1:8000",
      clientId: "00000000-0000-4000-8000-000000000001",
      callbacks: { onSnapshot: (snapshot) => (latest = snapshot) },
      remoteAudioActivity: true,
      audioActivityMonitorFactory: monitorFactory,
    });
    const harness = client as unknown as ClientHarness;
    harness.status = "connected";
    const peer = new FakePeer();
    const stream = fakeStream(fakeTrack());
    const audio = { ...fakeAudio(), play: vi.fn().mockResolvedValue(undefined) };
    const OriginalAudio = globalThis.Audio;
    vi.stubGlobal("Audio", vi.fn(() => audio));
    try {
      harness.installPeerHandlers(peer as unknown as RTCPeerConnection, harness.attempt);
      peer.emit("track", { streams: [stream], track: stream.getTracks()[0] });
      expect(monitorFactory).toHaveBeenCalledWith(stream, expect.any(Function));
      expect(latest?.remoteAudioActivity).toEqual({
        active: false,
        transitions: 0,
        samples: 12,
        maxSampleCostMs: 0.08,
      });
      transition?.({ active: true, observedAtMs: 100, rms: 0.025 });
      expect(latest?.remoteAudioActivity?.active).toBe(true);
      expect(latest?.trace.at(-1)).toMatchObject({ type: "audio_activity.started" });
      expect(JSON.stringify(latest)).not.toContain("0.025");
      await client.disconnect();
      expect(stop).toHaveBeenCalledOnce();
      expect(latest?.remoteAudioActivity).toBeUndefined();
    } finally {
      vi.stubGlobal("Audio", OriginalAudio);
    }
  });

  it("counts speech start only after response audio playback begins", () => {
    const { harness, latest } = createHarness();
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    expect(latest().interruptions).toHaveLength(0);

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_1" },
    });
    expect(latest().audioPlaybackActive).toBe(false);
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    expect(latest().interruptions).toHaveLength(0);

    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_1",
    });
    expect(latest().audioPlaybackActive).toBe(true);
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    expect(latest().audioPlaybackActive).toBe(false);
    expect(latest().interruptions).toHaveLength(1);
    expect(latest().interruptions[0].settlement).toBe("pending");
  });

  it("settles a cancelled, stale-free interruption as success", () => {
    const { harness, latest } = createHarness();
    harness.activeResponseId = "resp_1";
    harness.playbackResponseId = "resp_1";
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent(responseDone("resp_1", "cancelled"));
    expect(latest().interruptions[0].settlement).toBe("success");
    expect(latest().consecutiveSuccessfulInterruptions).toBe(1);
  });

  it("tracks playback after response.done and settles a server-cleared barge-in", () => {
    const { harness, latest } = createHarness();
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_1" },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_1",
    });
    harness.handleServerEvent(responseDone("resp_1", "completed"));

    expect(latest().activeResponseId).toBe("resp_1");
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED,
      response_id: "resp_1",
    });

    expect(latest().activeResponseId).toBeUndefined();
    expect(latest().interruptions[0]).toMatchObject({
      settlement: "success",
      stale_output_events: 0,
    });
    expect(latest().consecutiveSuccessfulInterruptions).toBe(1);
  });

  it("waits for buffer clear when response.done completes after speech starts", () => {
    const { harness, latest } = createHarness();
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_1" },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_1",
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent(responseDone("resp_1", "completed"));

    expect(latest().interruptions[0].settlement).toBe("pending");
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED,
    });
    expect(latest().interruptions[0].settlement).toBe("success");
  });

  it("fails a pending interruption if playback stops without a clear", () => {
    const { harness, latest } = createHarness();
    harness.activeResponseId = "resp_1";
    harness.playbackResponseId = "resp_1";
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_1",
    });

    expect(latest().interruptions[0].settlement).toBe("failure");
  });

  it("invalidates a cleared interruption if stale output metadata arrives later", () => {
    const { harness, latest } = createHarness();
    harness.activeResponseId = "resp_1";
    harness.playbackResponseId = "resp_1";
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED,
      response_id: "resp_1",
    });
    expect(latest().interruptions[0].settlement).toBe("success");

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_DELTA,
      response_id: "resp_1",
      delta: "not retained",
    });

    expect(latest().interruptions[0]).toMatchObject({
      settlement: "failure",
      stale_output_events: 1,
    });
  });

  it.each([
    SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_DELTA,
    SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
  ])("fails a cancellation with stale post-freeze output metadata: %s", (type) => {
    const { harness, latest } = createHarness();
    harness.activeResponseId = "resp_1";
    harness.playbackResponseId = "resp_1";
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent({ type, response_id: "resp_1", delta: "not retained" });
    harness.handleServerEvent(responseDone("resp_1", "cancelled"));
    expect(latest().interruptions[0]).toMatchObject({
      settlement: "failure",
      stale_output_events: 1,
    });
    expect(latest().consecutiveSuccessfulInterruptions).toBe(0);
    expect(JSON.stringify(latest().trace)).not.toContain("not retained");
  });

  it("deduplicates tool calls and counts only successful debug_echo results", () => {
    const { harness, latest, send } = createHarness();
    const validCall = {
      type: "function_call",
      call_id: "call_1",
      name: "debug_echo",
      arguments: '{"message":"hello"}',
    };
    const unknownCall = {
      type: "function_call",
      call_id: "call_2",
      name: "unknown",
      arguments: "{}",
    };
    harness.handleServerEvent(responseDone("resp_1", "completed", [validCall, unknownCall]));
    harness.handleServerEvent(responseDone("resp_1", "completed", [validCall]));

    expect(latest().toolRoundTrips).toBe(0);
    expect(send).toHaveBeenCalledTimes(3); // two outputs + response.create, then deduped no-op
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_followup", metadata: { chalk_kind: "diagnostic_tool" } },
    });
    expect(latest().toolRoundTrips).toBe(0);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      response_id: "resp_unrelated",
      delta: "ignored content",
    });
    expect(latest().toolRoundTrips).toBe(0);
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      response_id: "resp_followup",
      delta: "confirmation content is not retained",
    });
    expect(latest().toolRoundTrips).toBe(1);
    expect(JSON.stringify(latest().trace)).not.toContain("confirmation content");
  });

  it("returns teach status immediately and requests bounded filler speech", () => {
    const teach = vi.fn().mockReturnValue({ requestId: "request-live" });
    const send = vi.fn();
    const { harness, latest } = createHarness(send, undefined, teach);

    harness.handleServerEvent(
      responseDone("resp_tool", "completed", [
        {
          type: "function_call",
          call_id: "call_teach",
          name: "teach",
          arguments: '{"topic":"Chain rule","student_context":"knows derivatives"}',
        },
      ]),
    );

    expect(teach).toHaveBeenCalledWith("Chain rule", "knows derivatives");
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        output: JSON.stringify({
          ok: true,
          status: "started",
          request_id: "request-live",
        }),
      },
    });
    expect(JSON.parse(String(send.mock.calls[1][0]))).toMatchObject({
      type: "response.create",
      response: {
        metadata: { chalk_kind: "tool_continuation" },
        instructions: expect.stringContaining("one short"),
      },
    });
    expect(latest().responsePending).toBe(true);

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_filler",
        metadata: { chalk_kind: "tool_continuation" },
      },
    });
    expect(latest()).toMatchObject({
      activeResponseId: "resp_filler",
      responsePending: false,
    });
  });

  it("clears a filler response that never receives response.created", () => {
    vi.useFakeTimers();
    try {
      const teach = vi.fn().mockReturnValue({ requestId: "request-live" });
      const { harness, latest } = createHarness(vi.fn(), undefined, teach);
      harness.handleServerEvent(
        responseDone("resp_tool", "completed", [
          {
            type: "function_call",
            call_id: "call_teach",
            name: "teach",
            arguments: '{"topic":"Chain rule","student_context":""}',
          },
        ]),
      );
      expect(latest().responsePending).toBe(true);

      vi.advanceTimersByTime(8_100);

      expect(latest().responsePending).toBe(false);
      expect(latest().trace.some((entry) => entry.type === "response.create_timeout")).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a created filler response that never settles", () => {
    vi.useFakeTimers();
    try {
      const teach = vi.fn().mockReturnValue({ requestId: "request-live" });
      const { harness, latest } = createHarness(vi.fn(), undefined, teach);
      harness.handleServerEvent(
        responseDone("resp_tool", "completed", [
          {
            type: "function_call",
            call_id: "call_teach",
            name: "teach",
            arguments: '{"topic":"Chain rule","student_context":""}',
          },
        ]),
      );
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: {
          id: "resp_filler",
          metadata: { chalk_kind: "tool_continuation" },
        },
      });
      expect(latest().activeResponseId).toBe("resp_filler");

      vi.advanceTimersByTime(20_100);

      expect(latest().activeResponseId).toBeUndefined();
      expect(
        latest().trace.some((entry) => entry.type === "response.settlement_timeout"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a stopped filler busy until response.done releases its coordinator record", () => {
    const teach = vi.fn().mockReturnValue({ requestId: "request-live" });
    const { client, harness, latest } = createHarness(vi.fn(), undefined, teach);
    harness.status = "connected";
    harness.handleServerEvent(
      responseDone("resp_tool", "completed", [
        {
          type: "function_call",
          call_id: "call_teach",
          name: "teach",
          arguments: '{"topic":"Chain rule","student_context":""}',
        },
      ]),
    );
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: {
        id: "resp_filler",
        metadata: { chalk_kind: "tool_continuation" },
      },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_filler",
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp_filler",
    });

    expect(latest()).toMatchObject({
      activeResponseId: undefined,
      responsePending: false,
      responseInFlight: true,
      audioPlaybackActive: false,
    });
    expect(() =>
      client.requestNarration("Begin the actual lesson.", {
        requestId: "request-live",
        stepId: "s1",
        cycle: 1,
      }),
    ).toThrow("Wait for the active response");

    harness.handleServerEvent(responseDone("resp_filler", "completed"));
    expect(latest().responseInFlight).toBe(false);
    expect(() =>
      client.requestNarration("Begin the actual lesson.", {
        requestId: "request-live",
        stepId: "s1",
        cycle: 1,
      }),
    ).not.toThrow();
  });

  it("refuses lesson narration while a filler response is still pending", () => {
    const { client, harness } = createHarness();
    harness.status = "connected";
    harness.responseCoordinator.registerManual({
      purpose: "tool_continuation",
      clientEventId: "evt-filler",
    });

    expect(() =>
      client.requestNarration("Begin the actual lesson.", {
        requestId: "req-1",
        stepId: "s1",
        cycle: 1,
      }),
    ).toThrow("Wait for the active response");
  });

  it("executes local deixis and continues the same answer without exposing internals", () => {
    const show = vi.fn().mockReturnValue({ overlayId: "overlay-1" });
    const send = vi.fn();
    const { harness } = createHarness(send, undefined, undefined, show);

    harness.handleServerEvent(
      responseDone("resp_tool", "completed", [
        {
          type: "function_call",
          call_id: "call_point",
          name: "point_at",
          arguments: '{"element_id":"rangecurve"}',
        },
      ]),
    );

    expect(show).toHaveBeenCalledWith("point_at", "rangecurve");
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      type: "conversation.item.create",
      item: {
        output: JSON.stringify({
          ok: true,
          status: "shown",
          overlay_id: "overlay-1",
        }),
      },
    });
    expect(JSON.parse(String(send.mock.calls[1][0]))).toMatchObject({
      type: "response.create",
      response: {
        metadata: { chalk_kind: "tool_continuation" },
        instructions: expect.stringContaining("highlighted board element"),
      },
    });
  });

  it("starts annotation independently and returns a prompt continuation immediately", () => {
    const annotate = vi.fn().mockReturnValue({ requestId: "annotation-request" });
    const send = vi.fn();
    const { harness } = createHarness(send, undefined, undefined, undefined, annotate);

    harness.handleServerEvent(
      responseDone("resp_tool", "completed", [
        {
          type: "function_call",
          call_id: "call_annotate",
          name: "annotate",
          arguments: '{"request":"Explain the highlighted peak"}',
        },
      ]),
    );

    expect(annotate).toHaveBeenCalledWith("Explain the highlighted peak");
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      item: {
        output: JSON.stringify({
          ok: true,
          status: "annotation_started",
          request_id: "annotation-request",
        }),
      },
    });
    expect(JSON.parse(String(send.mock.calls[1][0]))).toMatchObject({
      response: {
        metadata: { chalk_kind: "tool_continuation" },
        instructions: expect.stringContaining("optional explanatory ink"),
      },
    });
  });

  it("renders a validated Q&A annotation locally and continues the spoken answer", () => {
    const draw = vi.fn().mockReturnValue({ ok: true, requestId: "qa-request", marks: 1 });
    const send = vi.fn();
    const { harness } = createHarness(
      send,
      undefined,
      undefined,
      undefined,
      undefined,
      draw,
    );

    harness.handleServerEvent(responseDone("resp_tool", "completed", [{
      type: "function_call",
      call_id: "call_qa_draw",
      name: "draw_qa_annotation",
      arguments: '{"marks":[{"kind":"circle","target_id":"ray1"}]}',
    }]));

    expect(draw).toHaveBeenCalledWith([{ kind: "circle", target_id: "ray1" }]);
    expect(JSON.parse(String(send.mock.calls[0][0]))).toMatchObject({
      item: { output: JSON.stringify({
        ok: true,
        status: "qa_annotation_shown",
        request_id: "qa-request",
        marks: 1,
      }) },
    });
    expect(JSON.parse(String(send.mock.calls[1][0]))).toMatchObject({
      response: {
        metadata: { chalk_kind: "tool_continuation" },
        instructions: expect.stringContaining("highlighted board element"),
      },
    });
  });

  it("contains data-channel send failures instead of creating an unhandled rejection", () => {
    const { harness, latest } = createHarness(() => {
      throw new Error("closed");
    });
    expect(() =>
      harness.handleServerEvent(
        responseDone("resp_1", "completed", [
          {
            type: "function_call",
            call_id: "call_1",
            name: "debug_echo",
            arguments: '{"message":"hello"}',
          },
        ]),
      ),
    ).not.toThrow();
    expect(latest().toolRoundTrips).toBe(0);
    expect(latest().trace.some((entry) => entry.type === "tool.output_failed")).toBe(true);
  });

  it.each(["cancelled", "incomplete"])(
    "does not execute function calls from a %s response",
    (status) => {
      const { harness, latest, send } = createHarness();
      harness.handleServerEvent(
        responseDone("resp_1", status, [
          {
            type: "function_call",
            call_id: "call_1",
            name: "debug_echo",
            arguments: '{"message":"must not run"}',
          },
        ]),
      );
      expect(send).not.toHaveBeenCalled();
      expect(latest().toolRoundTrips).toBe(0);
    },
  );

  it("does not confirm a tool round trip when the follow-up emits no output", () => {
    const { harness, latest } = createHarness();
    harness.handleServerEvent(
      responseDone("resp_tool", "completed", [
        {
          type: "function_call",
          call_id: "call_1",
          name: "debug_echo",
          arguments: '{"message":"hello"}',
        },
      ]),
    );
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_followup", metadata: { chalk_kind: "diagnostic_tool" } },
    });
    harness.handleServerEvent(responseDone("resp_followup", "completed"));
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      response_id: "resp_followup",
      delta: "too late",
    });
    expect(latest().toolRoundTrips).toBe(0);
    expect(
      latest().trace.some((entry) => entry.type === "tool.round_trip_unconfirmed"),
    ).toBe(true);
  });

  it("requires five settled successes and resets the streak on a stale sixth run", () => {
    const { harness, latest } = createHarness();
    for (let run = 1; run <= 5; run += 1) {
      const responseId = `resp_${run}`;
      harness.handleServerEvent({
        type: SERVER_EVENTS.RESPONSE_CREATED,
        response: { id: responseId },
      });
      harness.handleServerEvent({
        type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
        response_id: responseId,
      });
      harness.handleServerEvent(responseDone(responseId, "completed"));
      harness.handleServerEvent({
        type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
      });
      harness.handleServerEvent({
        type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED,
        response_id: responseId,
      });
    }
    expect(latest().consecutiveSuccessfulInterruptions).toBe(5);

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_pending" },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_pending",
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    expect(latest().consecutiveSuccessfulInterruptions).toBe(0);
    harness.handleServerEvent(responseDone("resp_pending", "cancelled"));
    expect(latest().consecutiveSuccessfulInterruptions).toBe(6);

    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_CREATED,
      response: { id: "resp_6" },
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp_6",
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent({
      type: SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      response_id: "resp_6",
      delta: "must-not-be-recorded",
    });
    harness.handleServerEvent(responseDone("resp_6", "cancelled"));

    expect(latest().consecutiveSuccessfulInterruptions).toBe(0);
    expect(JSON.stringify(latest().trace)).not.toContain("must-not-be-recorded");
  });

  it("accumulates billed response usage once and enforces the session ceiling", async () => {
    const { harness, latest } = createHarness();
    const dataChannel = new FakeDataChannel();
    harness.status = "connected";
    harness.dataChannel = dataChannel as unknown as RTCDataChannel;
    const usage = {
      total_tokens: SESSION_TOKEN_BUDGET,
      input_tokens: 18_000,
      output_tokens: 2_000,
      input_token_details: { cached_tokens: 12_000, audio_tokens: 500 },
      output_token_details: { audio_tokens: 1_900 },
    };

    harness.handleServerEvent(responseDone("resp_budget", "completed", [], usage));
    harness.handleServerEvent(responseDone("resp_budget", "completed", [], usage));
    await flushMicrotasks();

    expect(latest().tokenUsage).toEqual({
      total_tokens: SESSION_TOKEN_BUDGET,
      input_tokens: 18_000,
      output_tokens: 2_000,
      cached_input_tokens: 12_000,
      input_audio_tokens: 500,
      output_audio_tokens: 1_900,
    });
    expect(latest()).toMatchObject({
      status: "disconnected",
      tokenBudget: SESSION_TOKEN_BUDGET,
    });
    expect(latest().lastError).toMatch(/token budget reached/i);
    expect(dataChannel.close).toHaveBeenCalledOnce();
  });

  it("resets session evidence and timing for a new connection attempt", () => {
    const { client, harness } = createHarness();
    harness.startedAt = -1_000;
    harness.activeResponseId = "resp_old";
    harness.sessionCredential = {
      request_id: "req_old",
      client_secret: "ephemeral",
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      sync_mode: "paced",
    };
    harness.observedSessionModel = "gpt-realtime-2.1-mini";
    harness.observedSessionVoice = "marin";
    harness.toolRoundTrips = 4;
    harness.responseCoordinator.registerManual({
      purpose: "diagnostic_tool",
      clientEventId: "evt_tool",
      successfulEchoes: 1,
    });
    harness.interruptions = [
      {
        id: "marker_1",
        at_ms: 10,
        response_id: "resp_old",
        local_handler_stop_latency_ms: 0.2,
        perceived_audio_stop: "immediate",
        settlement: "success",
        stale_output_events: 0,
      },
    ];
    harness.seenCallIds.add("call_old");
    harness.seenUsageResponseIds.add("resp_old");
    harness.tokenUsage = {
      total_tokens: 100,
      input_tokens: 80,
      output_tokens: 20,
      cached_input_tokens: 40,
      input_audio_tokens: 30,
      output_audio_tokens: 10,
    };

    harness.resetForConnectionAttempt();
    const snapshot = client.getSnapshot();
    expect(snapshot).toMatchObject({
      sessionModel: undefined,
      activeResponseId: undefined,
      interruptions: [],
      toolRoundTrips: 0,
      consecutiveSuccessfulInterruptions: 0,
      trace: [],
      tokenUsage: {
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        input_audio_tokens: 0,
        output_audio_tokens: 0,
      },
    });
    expect(harness.responseCoordinator.hasPurpose("diagnostic_tool")).toBe(false);
    expect(harness.seenCallIds.size).toBe(0);
    expect(harness.seenUsageResponseIds.size).toBe(0);
    expect(harness.startedAt).toBeGreaterThan(-1_000);
  });

  it("bounds interruption markers and sanitizes exported response IDs", () => {
    const { harness, latest } = createHarness();
    for (let run = 0; run < 55; run += 1) {
      const responseId = `resp_${run}`;
      harness.activeResponseId = responseId;
      harness.playbackResponseId = responseId;
      harness.handleServerEvent({
        type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
      });
      harness.handleServerEvent(responseDone(responseId, "cancelled"));
    }
    expect(latest().interruptions).toHaveLength(50);

    const adversarialId = `resp_${"private/raw id ".repeat(30)}`;
    harness.activeResponseId = adversarialId;
    harness.playbackResponseId = adversarialId;
    harness.handleServerEvent({
      type: SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED,
    });
    harness.handleServerEvent(responseDone(adversarialId, "cancelled"));
    expect(latest().interruptions.at(-1)?.response_id).toBeUndefined();
    expect(JSON.stringify(latest().interruptions)).not.toContain("private/raw id");
  });

  it("bounds remembered function-call IDs", () => {
    const { harness } = createHarness();
    for (let run = 0; run < 300; run += 1) {
      harness.handleServerEvent(
        responseDone(`resp_${run}`, "completed", [
          {
            type: "function_call",
            call_id: `call_${run}`,
            name: "unknown",
            arguments: "{}",
          },
        ]),
      );
    }
    expect(harness.seenCallIds.size).toBe(256);
  });
});
