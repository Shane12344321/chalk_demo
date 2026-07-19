import {
  createFunctionCallOutput,
  createNarrationResponse,
  createResponseAfterTool,
  createSessionRequest,
  createSessionUpdate,
  createTutorContextUpdate,
  extractFunctionCalls,
  getResponseId,
  getResponseMetadata,
  getRelatedClientEventId,
  getResponseStatus,
  getTranscriptDeltaLength,
  getResponseUsage,
  parseServerEvent,
  parseSessionCredential,
  REALTIME_CALLS_URL,
  SESSION_TOKEN_BUDGET,
  SERVER_EVENTS,
} from "./protocol";
import { routeToolCall } from "./toolRouter";
import type { BoardContextPublisher } from "./boardContext";
import { manifestHash } from "./manifestHash";
import {
  ResponseCoordinator,
  type CoordinatedResponse,
  type ResponsePurpose,
} from "./responseCoordinator";
import {
  createLocalTraceEntry,
  eventToTraceEntry,
  sanitizeTraceIdentifier,
} from "./trace";
import type {
  ChalkRuntimeMode,
  ConnectionStatus,
  InterruptionMarker,
  NarrationContext,
  PerceivedAudioStop,
  RealtimeClientCallbacks,
  RealtimeSemanticEvent,
  RealtimeSnapshot,
  ResponseDiagnostic,
  ResponseDiagnosticStage,
  ServerEvent,
  SessionCredential,
  TokenUsageSummary,
  TraceEntry,
} from "./types";
import {
  createRemoteAudioActivityMonitor,
  type AudioActivityEvidence,
  type RemoteAudioActivityMonitor,
  type RemoteAudioActivityMonitorFactory,
} from "./remoteAudioActivity";

const MAX_TRACE_ENTRIES = 500;
const MAX_INTERRUPTION_MARKERS = 50;
const MAX_SEEN_CALL_IDS = 256;
const SESSION_READY_TIMEOUT_MS = 15_000;
const RESPONSE_CREATED_TIMEOUT_MS = 8_000;
const RESPONSE_SETTLEMENT_TIMEOUT_MS = 20_000;
// Narration ink is gated on observed audible playback. When consecutive
// responses share one continuous WebRTC output buffer, the per-response
// `output_audio_buffer.started` event can be missed entirely; without a
// fallback the lesson then abandons a fully generated step at 0% ink.
const NARRATION_AUDIO_START_FALLBACK_MS = 4_000;
const ICE_GATHER_TIMEOUT_MS = 5_000;

const EMPTY_TOKEN_USAGE: TokenUsageSummary = {
  total_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
};

export interface RealtimeClientOptions {
  apiBaseUrl: string;
  clientId: string;
  mode?: ChalkRuntimeMode;
  callbacks: RealtimeClientCallbacks;
  fetchImpl?: typeof fetch;
  now?: () => number;
  qaDirectDraw?: boolean;
  attentionChoreography?: boolean;
  remoteAudioActivity?: boolean;
  audioActivityMonitorFactory?: RemoteAudioActivityMonitorFactory;
}

export class RealtimeClient implements BoardContextPublisher {
  private readonly apiBaseUrl: string;
  private readonly clientId: string;
  private readonly mode: ChalkRuntimeMode;
  private readonly callbacks: RealtimeClientCallbacks;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly qaDirectDraw: boolean;
  private readonly attentionChoreography: boolean;
  private readonly remoteAudioActivityEnabled: boolean;
  private readonly audioActivityMonitorFactory: RemoteAudioActivityMonitorFactory;
  private startedAt: number;

  private status: ConnectionStatus = "disconnected";
  private sessionCredential?: SessionCredential;
  private observedSessionModel?: string;
  private observedSessionVoice?: string;
  private observedSyncMode?: SessionCredential["sync_mode"];
  private activeResponseId?: string;
  private playbackResponseId?: string;
  private microphoneEnabled = false;
  private lastError?: string;
  private toolRoundTrips = 0;
  private readonly responseCoordinator = new ResponseCoordinator();
  private trace: TraceEntry[] = [];
  private interruptions: InterruptionMarker[] = [];
  private responseDiagnostics: ResponseDiagnostic[] = [];
  private seenCallIds = new Set<string>();
  private seenUsageResponseIds = new Set<string>();
  private interruptedResponseIds = new Map<string, string>();
  private tokenUsage: TokenUsageSummary = { ...EMPTY_TOKEN_USAGE };
  private boardContext?: string;
  private interactionGuidance?: string;
  private contextUpdateTail: Promise<void> = Promise.resolve();
  private contextAckResolve?: () => void;
  private contextAckReject?: (error: Error) => void;
  private contextAckTimeout?: number;
  private contextAckStartedAt?: number;
  private contextAckManifestHash?: string;
  private contextPublications: Array<{ manifest_hash: string; latency_ms: number }> = [];
  private lastAcknowledgedManifestHash?: string;
  private readonly responseCreateTimeouts = new Map<string, number>();
  private readonly responseSettlementTimeouts = new Map<string, number>();
  private readonly narrationAudioStartFallbacks = new Map<string, number>();
  private automaticResponseCreationTimeout?: {
    timeout: number;
    purpose: "student_qa" | "checkpoint_feedback";
    context: NarrationContext;
  };

  private peer?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private microphoneStream?: MediaStream;
  private remoteAudio?: HTMLAudioElement;
  private remoteAudioActivityMonitor?: RemoteAudioActivityMonitor;
  private remoteAudioActivityEvidence?: AudioActivityEvidence;
  private requestAbort?: AbortController;
  private attempt = 0;
  private sessionCreated = false;
  private sessionUpdated = false;
  private dataChannelOpen = false;
  private sessionUpdateSent = false;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;

  constructor(options: RealtimeClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.clientId = options.clientId;
    this.mode = options.mode ?? "demo";
    this.callbacks = options.callbacks;
    // Some browsers require native fetch to retain the Window receiver. Store
    // a bound function so invoking it through this client cannot change `this`.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => performance.now());
    this.qaDirectDraw = options.qaDirectDraw ?? false;
    this.attentionChoreography = options.attentionChoreography ?? false;
    this.remoteAudioActivityEnabled = options.remoteAudioActivity ?? false;
    this.audioActivityMonitorFactory =
      options.audioActivityMonitorFactory ?? createRemoteAudioActivityMonitor;
    this.startedAt = this.now();
    this.emitSnapshot();
  }

  async connect(): Promise<void> {
    if (this.status !== "disconnected" && this.status !== "error") {
      return;
    }

    await this.cleanupResources();
    const attempt = ++this.attempt;
    this.resetForConnectionAttempt();

    try {
      this.setStatus("minting-session");
      const request = createSessionRequest(this.clientId);
      const abortController = new AbortController();
      this.requestAbort = abortController;
      const response = await this.fetchImpl(`${this.apiBaseUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abortController.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Session service failed with HTTP ${response.status}.`);
      }
      const credential = parseSessionCredential(await response.json(), request.request_id);
      this.assertCurrentAttempt(attempt);
      this.sessionCredential = credential;
      this.observedSessionModel = credential.model;
      this.observedSessionVoice = credential.voice;
      this.observedSyncMode = credential.sync_mode;

      this.setStatus("requesting-microphone");
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (attempt !== this.attempt) {
        stopMediaStream(microphoneStream);
        throw new DOMException("Connection attempt superseded.", "AbortError");
      }
      for (const track of microphoneStream.getAudioTracks()) {
        track.enabled = false;
      }
      this.microphoneStream = microphoneStream;

      this.setStatus("negotiating-webrtc");
      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.installPeerHandlers(peer, attempt);
      for (const track of microphoneStream.getAudioTracks()) {
        peer.addTrack(track, microphoneStream);
      }

      const dataChannel = peer.createDataChannel("oai-events");
      this.dataChannel = dataChannel;
      this.installDataChannelHandlers(dataChannel, attempt);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, ICE_GATHER_TIMEOUT_MS);
      this.assertCurrentAttempt(attempt);

      const localSdp = peer.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("The browser did not produce a WebRTC offer.");
      }

      const sdpResponse = await this.fetchImpl(REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.client_secret}`,
          "Content-Type": "application/sdp",
        },
        body: localSdp,
        signal: abortController.signal,
      });
      if (!sdpResponse.ok) {
        throw new Error(`Realtime handshake failed with HTTP ${sdpResponse.status}.`);
      }

      const answerSdp = await sdpResponse.text();
      this.assertCurrentAttempt(attempt);
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await this.waitUntilSessionUpdated(attempt);
      this.assertCurrentAttempt(attempt);
      this.setStatus("connected");
    } catch (error) {
      if (attempt !== this.attempt) {
        return;
      }
      const failureAttempt = ++this.attempt;
      await this.cleanupResources();
      if (failureAttempt !== this.attempt) return;
      this.sessionCredential = undefined;
      this.observedSessionModel = undefined;
      this.observedSessionVoice = undefined;
      this.activeResponseId = undefined;
      const message = userFacingError(error);
      this.lastError = message;
      this.addLocalTrace("connection.failed", { code: errorCode(error) });
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status === "disconnected") {
      return;
    }
    ++this.attempt;
    this.setStatus("disconnecting");
    await this.cleanupResources();
    this.sessionCredential = undefined;
    this.activeResponseId = undefined;
    this.setStatus("disconnected");
  }

  updatePerceivedAudioStop(markerId: string, value: PerceivedAudioStop): void {
    this.interruptions = this.interruptions.map((marker) =>
      marker.id === markerId ? { ...marker, perceived_audio_stop: value } : marker,
    );
    this.emitSnapshot();
  }

  setMicrophoneEnabled(enabled: boolean): void {
    if (enabled && (this.status !== "connected" || !this.microphoneStream)) {
      throw new Error("Connect the Realtime session before speaking.");
    }
    if (enabled === this.microphoneEnabled) return;
    for (const track of this.microphoneStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
    this.microphoneEnabled = enabled;
    this.addLocalTrace(
      enabled ? "microphone.input_enabled" : "microphone.input_disabled",
    );
  }

  setBoardContext(manifest: string): Promise<void> {
    if (manifest.length === 0 || manifest.length > 1_000) {
      return Promise.reject(new Error("Visible-board context is outside its budget."));
    }
    if (manifest === this.boardContext) return this.contextUpdateTail;
    this.boardContext = manifest;
    return this.queueTutorContextUpdate();
  }

  setInteractionGuidance(guidance?: string): Promise<void> {
    if (guidance && guidance.length > 500) {
      return Promise.reject(new Error("Interaction guidance is outside its budget."));
    }
    if (guidance === this.interactionGuidance) return this.contextUpdateTail;
    this.interactionGuidance = guidance;
    return this.queueTutorContextUpdate();
  }

  requestNarration(script: string, context: NarrationContext): void {
    this.requestScriptedResponse(script, "lesson_narration", context);
  }

  requestCheckpointPrompt(script: string, context: NarrationContext): void {
    this.requestScriptedResponse(script, "checkpoint_prompt", context);
  }

  expectAutomaticResponse(
    purpose: "student_qa" | "checkpoint_feedback",
    context: NarrationContext,
  ): void {
    this.responseCoordinator.armAutomatic({ purpose, context });
    this.recordResponseDiagnostic(`auto:${purpose}:${context.requestId}:${context.stepId}:${context.cycle}`, purpose, context);
    this.trackAutomaticResponseCreation(purpose, context);
    this.emitSnapshot();
  }

  cancelExpectedAutomaticResponse(
    purpose: "student_qa" | "checkpoint_feedback",
    context: NarrationContext,
  ): void {
    if (this.responseCoordinator.cancelAutomatic(purpose, context)) {
      this.clearAutomaticResponseCreationTimeout();
      this.emitSnapshot();
    }
  }

  private requestScriptedResponse(
    script: string,
    purpose: "lesson_narration" | "checkpoint_prompt",
    context: NarrationContext,
  ): void {
    if (this.status !== "connected") {
      throw new Error("Connect the Realtime session before starting scripted audio.");
    }
    if (this.responseCoordinator.hasPurpose(purpose)) {
      this.emitSnapshot();
      throw new Error(`A ${purpose} response is already active.`);
    }
    if (
      this.activeResponseId ||
      this.playbackResponseId ||
      this.responseCoordinator.hasInFlight()
    ) {
      this.emitSnapshot();
      throw new Error("Wait for the active response to finish before scripted audio.");
    }
    const clientEventId = `evt_${purpose}_${crypto.randomUUID()}`;
    this.responseCoordinator.registerManual({
      purpose,
      context,
      clientEventId,
    });
    this.recordResponseDiagnostic(clientEventId, purpose, context);
    try {
      this.sendEvent(
        createNarrationResponse(script, clientEventId, {
          chalk_kind: purpose,
          chalk_request_id: context.requestId,
          chalk_step_id: context.stepId,
          chalk_cycle: String(context.cycle),
        }),
      );
      this.trackResponseCreation(clientEventId);
      this.emitSnapshot();
    } catch (error) {
      this.responseCoordinator.failByClientEventId(clientEventId);
      this.emitSnapshot();
      throw error;
    }
  }

  getSnapshot(): RealtimeSnapshot {
    return {
      status: this.status,
      sessionModel: this.observedSessionModel,
      sessionVoice: this.observedSessionVoice,
      syncMode: this.observedSyncMode,
      activeResponseId: this.activeResponseId,
      responsePending: this.responseCoordinator.hasPending(),
      responseInFlight: this.responseCoordinator.hasInFlight(),
      audioPlaybackActive:
        this.activeResponseId !== undefined &&
        this.activeResponseId === this.playbackResponseId,
      microphoneEnabled: this.microphoneEnabled,
      lastError: this.lastError,
      trace: this.trace.map((entry) => ({ ...entry })),
      interruptions: this.interruptions.map((marker) => ({ ...marker })),
      responseDiagnostics: this.responseDiagnostics.map((item) => ({ ...item })),
      consecutiveSuccessfulInterruptions: countConsecutiveSuccesses(
        this.interruptions,
      ),
      toolRoundTrips: this.toolRoundTrips,
      tokenUsage: { ...this.tokenUsage },
      tokenBudget: SESSION_TOKEN_BUDGET,
      contextPublications: this.contextPublications.map((item) => ({ ...item })),
      lastAcknowledgedManifestHash: this.lastAcknowledgedManifestHash,
      ...(this.remoteAudioActivityEvidence
        ? { remoteAudioActivity: { ...this.remoteAudioActivityEvidence } }
        : {}),
    };
  }

  private installPeerHandlers(peer: RTCPeerConnection, attempt: number): void {
    const remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    this.remoteAudio = remoteAudio;

    peer.addEventListener("track", (event) => {
      if (attempt !== this.attempt) return;
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      remoteAudio.srcObject = remoteStream;
      if (this.remoteAudioActivityEnabled) {
        this.remoteAudioActivityMonitor?.stop();
        try {
          const monitor = this.audioActivityMonitorFactory(remoteStream, (transition) => {
            if (attempt !== this.attempt) return;
            const observed = this.remoteAudioActivityMonitor?.snapshot();
            this.remoteAudioActivityEvidence = observed
              ? { ...observed, active: transition.active }
              : {
                  active: transition.active,
                  transitions: 1,
                  samples: 0,
                  maxSampleCostMs: 0,
                };
            this.addLocalTrace(
              transition.active ? "audio_activity.started" : "audio_activity.stopped",
            );
            this.emitSnapshot();
          });
          this.remoteAudioActivityMonitor = monitor;
          this.remoteAudioActivityEvidence = monitor.snapshot();
          this.addLocalTrace("audio_activity.attached");
        } catch {
          this.remoteAudioActivityMonitor = undefined;
          this.remoteAudioActivityEvidence = undefined;
          this.addLocalTrace("audio_activity.unavailable", { code: "web_audio" });
        }
      }
      void remoteAudio.play().catch(() => {
        this.addLocalTrace("audio.playback_blocked", { code: "autoplay" });
      });
    });

    peer.addEventListener("connectionstatechange", () => {
      if (attempt !== this.attempt) return;
      this.addLocalTrace("webrtc.connection_state", {
        status: peer.connectionState,
      });
      if (peer.connectionState === "failed") {
        void this.transitionToTerminalError(
          attempt,
          "The WebRTC connection failed. Disconnect and retry.",
          "peer_failed",
        );
      }
    });
  }

  private installDataChannelHandlers(
    dataChannel: RTCDataChannel,
    attempt: number,
  ): void {
    dataChannel.addEventListener("open", () => {
      if (attempt !== this.attempt) return;
      this.dataChannelOpen = true;
      this.addLocalTrace("data_channel.open");
      this.maybeConfigureSession();
    });

    dataChannel.addEventListener("close", () => {
      if (attempt !== this.attempt) return;
      this.dataChannelOpen = false;
      this.addLocalTrace("data_channel.closed");
      void this.transitionToTerminalError(
        attempt,
        "The Realtime data channel closed. Disconnect and retry.",
        "data_channel_closed",
      );
    });

    dataChannel.addEventListener("message", (message) => {
      if (attempt !== this.attempt) return;
      const event = parseServerEvent(message.data);
      if (!event) {
        this.addLocalTrace("server_event.rejected", { code: "invalid_json" });
        return;
      }
      this.handleServerEvent(event);
    });
  }

  private handleServerEvent(event: ServerEvent): void {
    this.addServerTrace(event);

    if (event.type === SERVER_EVENTS.SESSION_CREATED) {
      this.sessionCreated = true;
      this.maybeConfigureSession();
      return;
    }

    if (event.type === SERVER_EVENTS.SESSION_UPDATED) {
      if (this.contextAckResolve) {
        const resolve = this.contextAckResolve;
        this.finishContextPublication();
        this.clearContextAcknowledgement();
        this.emitSnapshot();
        resolve();
        return;
      }
      this.finishContextPublication();
      this.sessionUpdated = true;
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }

    if (event.type === SERVER_EVENTS.RESPONSE_CREATED) {
      this.activeResponseId = getResponseId(event);
      const metadata = getResponseMetadata(event);
      if (this.activeResponseId) {
        const coordinated = this.responseCoordinator.bindCreated(
          this.activeResponseId,
          metadata,
        );
        if (coordinated?.clientEventId) {
          this.clearResponseCreationTimeout(coordinated.clientEventId);
        }
        if (coordinated && !coordinated.clientEventId) {
          this.clearAutomaticResponseCreationTimeout();
        }
        if (coordinated) this.trackResponseSettlement(this.activeResponseId);
        if (coordinated) this.updateResponseDiagnostic(coordinated, "created", this.activeResponseId);
      }
      this.emitSnapshot();
      return;
    }

    if (event.type === SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STARTED) {
      const responseId = getResponseId(event);
      if (responseId) {
        this.clearNarrationAudioStartFallback(responseId);
        this.setMicrophoneEnabled(false);
        this.playbackResponseId = responseId;
        this.activeResponseId = responseId;
        this.emitResponseLifecycle(responseId, "activity");
        this.emitSnapshot();
      }
      return;
    }

    if (
      event.type === SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED ||
      event.type === SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED
    ) {
      const responseId = getResponseId(event) ?? this.playbackResponseId;
      if (responseId) this.clearNarrationAudioStartFallback(responseId);
      this.emitResponseLifecycle(responseId, "playback_stopped");
      if (event.type === SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_CLEARED && responseId) {
        this.settleInterruption(responseId, "cleared");
      } else if (
        event.type === SERVER_EVENTS.OUTPUT_AUDIO_BUFFER_STOPPED &&
        responseId
      ) {
        this.settleInterruption(responseId, "stopped");
      }
      if (responseId && responseId === this.activeResponseId) {
        this.activeResponseId = undefined;
      }
      if (!responseId || responseId === this.playbackResponseId) {
        this.playbackResponseId = undefined;
      }
      this.emitSnapshot();
      return;
    }

    if (event.type === SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STARTED) {
      // Refresh the already-rendered semantic snapshot at question time. The
      // update is queued ahead of later interaction-guidance changes and will
      // usually acknowledge while the student is still speaking.
      void this.queueTutorContextUpdate().catch(() => {
        this.addLocalTrace("question_context.failed", { code: "context_update" });
      });
      this.emitSemanticEvent({ type: "student.speech_started" });
      this.markInterruption();
      return;
    }

    if (event.type === SERVER_EVENTS.INPUT_AUDIO_BUFFER_SPEECH_STOPPED) {
      this.setMicrophoneEnabled(false);
      return;
    }

    if (event.type === SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_DELTA) {
      const responseId = getResponseId(event);
      this.markPossibleStaleOutput(responseId);
      this.confirmToolRoundTripFromOutput(responseId);
      return;
    }

    if (event.type === SERVER_EVENTS.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA) {
      const responseId = getResponseId(event);
      this.markPossibleStaleOutput(responseId);
      this.confirmToolRoundTripFromOutput(responseId);
      const characters = getTranscriptDeltaLength(event);
      if (!responseId || characters === undefined) return;
      const response = this.responseCoordinator.addTranscriptCharacters(
        responseId,
        characters,
      );
      if (response?.purpose === "lesson_narration" && response.context) {
        this.emitSemanticEvent({
          type: "narration.transcript_progress",
          context: { ...response.context },
          generatedCharacters: response.transcriptCharacters,
        });
      }
      return;
    }

    if (event.type === SERVER_EVENTS.RESPONSE_DONE) {
      const responseId = getResponseId(event);
      const responseStatus = getResponseStatus(event);
      const coordinated = this.responseCoordinator.get(responseId);
      const checkpointResponseFailed =
        responseId !== undefined &&
        responseStatus !== "completed" &&
        (coordinated?.purpose === "checkpoint_prompt" ||
          coordinated?.purpose === "checkpoint_feedback") &&
        !this.interruptedResponseIds.has(responseId);
      if (checkpointResponseFailed && responseId) {
        const failed = this.responseCoordinator.failByResponseId(responseId);
        this.clearResponseSettlementTimeout(responseId);
        if (failed) this.emitFailedResponse(failed);
      } else {
        this.emitResponseLifecycle(responseId, "generation_done");
        if (
          responseId &&
          responseStatus === "completed" &&
          coordinated?.purpose === "lesson_narration" &&
          !coordinated.activitySeen &&
          responseId !== this.playbackResponseId
        ) {
          this.scheduleNarrationAudioStartFallback(responseId);
        }
      }
      if (
        responseId &&
        responseStatus !== "completed" &&
        responseId !== this.playbackResponseId
      ) {
        if (!checkpointResponseFailed) {
          this.emitResponseLifecycle(responseId, "playback_stopped");
        }
      }
      if (
        responseId &&
        responseId === this.activeResponseId &&
        responseId !== this.playbackResponseId
      ) {
        this.activeResponseId = undefined;
      }
      if (responseId) {
        const completedWhilePlaybackTracked =
          responseStatus === "completed" &&
          responseId === this.playbackResponseId;
        if (!completedWhilePlaybackTracked) {
          this.settleInterruption(responseId, responseStatus);
        }
        this.failDiagnosticToolWithoutOutput(responseId);
      }
      const tokenBudgetReached = this.recordTokenUsage(event);
      if (tokenBudgetReached) {
        this.lastError = `Session token budget reached (${SESSION_TOKEN_BUDGET.toLocaleString()}). Reconnect to start a fresh session.`;
        this.addLocalTrace("session.token_budget_reached", {
          status: "disconnected",
        });
        void this.disconnect();
        return;
      }
      if (responseStatus === "completed") {
        this.handleFunctionCalls(event);
      }
      this.emitSnapshot();
      return;
    }

    if (event.type === SERVER_EVENTS.ERROR) {
      this.lastError = "The Realtime service reported an error. See the redacted trace code.";
      const relatedClientEventId = getRelatedClientEventId(event);
      if (relatedClientEventId) {
        this.clearResponseCreationTimeout(relatedClientEventId);
        const failed = this.responseCoordinator.failByClientEventId(relatedClientEventId);
        if (failed) this.emitFailedResponse(failed);
      }
      this.emitSnapshot();
    }
  }

  private maybeConfigureSession(): void {
    if (
      !this.dataChannelOpen ||
      !this.sessionCreated ||
      this.sessionUpdateSent ||
      !this.sessionCredential
    ) {
      return;
    }

    this.sessionUpdateSent = true;
    this.setStatus("configuring-session");
    this.startContextPublication();
    this.sendEvent(
      createSessionUpdate(
        this.sessionCredential.model,
        this.sessionCredential.voice,
        this.mode,
        this.boardContext,
        this.interactionGuidance,
        this.qaDirectDraw,
        this.attentionChoreography,
      ),
    );
  }

  private queueTutorContextUpdate(): Promise<void> {
    const attempt = this.attempt;
    const update = this.contextUpdateTail
      .catch(() => undefined)
      .then(async () => {
        if (attempt !== this.attempt || this.status !== "connected") return;
        await this.sendTutorContextUpdate(attempt);
      });
    this.contextUpdateTail = update;
    return update;
  }

  private sendTutorContextUpdate(attempt: number): Promise<void> {
    if (this.contextAckResolve) {
      return Promise.reject(new Error("A tutor-context update is already awaiting acknowledgement."));
    }
    return new Promise((resolve, reject) => {
      this.contextAckResolve = resolve;
      this.contextAckReject = reject;
      try {
        this.startContextPublication();
        this.sendEvent(
          createTutorContextUpdate(
            this.mode,
            this.boardContext,
            this.interactionGuidance,
            this.qaDirectDraw,
            this.attentionChoreography,
          ),
        );
      } catch (error) {
        this.clearContextAcknowledgement();
        reject(error instanceof Error ? error : new Error("Tutor-context update failed."));
        return;
      }
      this.contextAckTimeout = window.setTimeout(() => {
        if (attempt !== this.attempt || !this.contextAckReject) return;
        const rejectPending = this.contextAckReject;
        this.clearContextAcknowledgement();
        rejectPending(new Error("Timed out waiting for tutor-context acknowledgement."));
      }, SESSION_READY_TIMEOUT_MS);
    });
  }

  private clearContextAcknowledgement(): void {
    if (this.contextAckTimeout !== undefined) {
      window.clearTimeout(this.contextAckTimeout);
    }
    this.contextAckTimeout = undefined;
    this.contextAckResolve = undefined;
    this.contextAckReject = undefined;
    this.contextAckStartedAt = undefined;
    this.contextAckManifestHash = undefined;
  }

  private startContextPublication(): void {
    this.contextAckStartedAt = this.now();
    this.contextAckManifestHash = manifestHash(this.boardContext ?? "");
  }

  private finishContextPublication(): void {
    if (this.contextAckStartedAt === undefined || !this.contextAckManifestHash) return;
    const metric = {
      manifest_hash: this.contextAckManifestHash,
      latency_ms: round(Math.max(0, this.now() - this.contextAckStartedAt)),
    };
    this.contextPublications = [...this.contextPublications, metric].slice(-32);
    this.lastAcknowledgedManifestHash = metric.manifest_hash;
    this.contextAckStartedAt = undefined;
    this.contextAckManifestHash = undefined;
  }

  private emitResponseLifecycle(
    responseId: string | undefined,
    stage: "activity" | "generation_done" | "playback_stopped",
  ): void {
    if (!responseId) return;
    const response = this.responseCoordinator.get(responseId);
    if (!response) return;
    if (stage === "activity" && response.activitySeen) return;
    if (stage === "generation_done" && response.generationDone) return;
    if (stage === "playback_stopped" && response.playbackStopped) return;

    if (stage === "activity") this.responseCoordinator.markActivity(responseId);
    if (stage === "generation_done") this.responseCoordinator.markGenerationDone(responseId);
    if (stage === "playback_stopped") this.responseCoordinator.markPlaybackStopped(responseId);
    const stageMap: Record<typeof stage, ResponseDiagnosticStage> = {
      activity: "audio_started",
      generation_done: "generation_done",
      playback_stopped: "playback_stopped",
    };
    this.updateResponseDiagnostic(response, stageMap[stage], responseId);
    if (response.context) {
      this.emitPurposeEvent(response.purpose, stage, response.context);
    }
    this.responseCoordinator.releaseIfSettled(responseId);
    if (!this.responseCoordinator.get(responseId)) {
      this.clearResponseSettlementTimeout(responseId);
      this.updateResponseDiagnostic(response, "settled", responseId);
    }
  }

  private emitPurposeEvent(
    purpose: ResponsePurpose,
    stage: "activity" | "generation_done" | "playback_stopped",
    context: NarrationContext,
  ): void {
    if (purpose === "lesson_narration") {
      const type = {
        activity: "narration.activity",
        generation_done: "narration.generation_done",
        playback_stopped: "narration.playback_stopped",
      } as const;
      this.emitSemanticEvent({ type: type[stage], context: { ...context } });
      return;
    }
    if (purpose === "checkpoint_prompt") {
      const type = {
        activity: "checkpoint.prompt_activity",
        generation_done: "checkpoint.prompt_generation_done",
        playback_stopped: "checkpoint.prompt_playback_stopped",
      } as const;
      this.emitSemanticEvent({ type: type[stage], context: { ...context } });
      return;
    }
    if (purpose === "checkpoint_feedback") {
      const type = {
        activity: "checkpoint.feedback_activity",
        generation_done: "checkpoint.feedback_generation_done",
        playback_stopped: "checkpoint.feedback_playback_stopped",
      } as const;
      this.emitSemanticEvent({ type: type[stage], context: { ...context } });
    }
  }

  private emitFailedResponse(response: CoordinatedResponse): void {
    this.updateResponseDiagnostic(response, "failed", response.responseId, "response_failed");
    if (!response.context) return;
    if (response.purpose === "lesson_narration") {
      this.emitSemanticEvent({ type: "narration.failed", context: response.context });
    } else if (response.purpose === "checkpoint_prompt") {
      this.emitSemanticEvent({ type: "checkpoint.prompt_failed", context: response.context });
    } else if (response.purpose === "checkpoint_feedback") {
      this.emitSemanticEvent({ type: "checkpoint.feedback_failed", context: response.context });
    }
  }

  private emitSemanticEvent(event: RealtimeSemanticEvent): void {
    try {
      this.callbacks.onSemanticEvent?.(event);
    } catch {
      // Consumer callbacks are isolated from protocol bookkeeping. The trace
      // remains content-free and the connection stays usable.
      this.addLocalTrace("semantic_callback.failed", { code: "callback_error" });
    }
  }

  private markInterruption(): void {
    if (
      !this.activeResponseId ||
      this.activeResponseId !== this.playbackResponseId
    ) {
      return;
    }

    const detectedAt = this.now();
    const responseId = this.activeResponseId;
    this.activeResponseId = undefined;
    const handlerStoppedAt = this.now();
    const marker: InterruptionMarker = {
      id: crypto.randomUUID(),
      at_ms: round(detectedAt - this.startedAt),
      response_id: sanitizeTraceIdentifier(responseId),
      local_handler_stop_latency_ms: round(
        Math.max(0, handlerStoppedAt - detectedAt),
      ),
      perceived_audio_stop: "not-recorded",
      settlement: "pending",
      stale_output_events: 0,
    };
    this.interruptions = [...this.interruptions, marker].slice(
      -MAX_INTERRUPTION_MARKERS,
    );
    this.interruptedResponseIds.set(responseId, marker.id);
    const retainedMarkerIds = new Set(this.interruptions.map((item) => item.id));
    for (const [rawResponseId, markerId] of this.interruptedResponseIds) {
      if (!retainedMarkerIds.has(markerId)) {
        this.interruptedResponseIds.delete(rawResponseId);
      }
    }
    this.addLocalTrace("handler_state.response_deactivated", {
      response_id: responseId,
    });
    this.emitSnapshot();
  }

  private recordResponseDiagnostic(
    key: string,
    purpose: ResponsePurpose,
    context?: NarrationContext,
  ): void {
    if (this.responseDiagnostics.some((item) => item.key === key)) return;
    this.responseDiagnostics = [
      ...this.responseDiagnostics,
      {
        key,
        purpose,
        ...(context
          ? { request_id: context.requestId, step_id: context.stepId, cycle: context.cycle }
          : {}),
        registered_at_ms: round(this.now() - this.startedAt),
        stage: "registered",
      },
    ].slice(-32);
  }

  private updateResponseDiagnostic(
    response: CoordinatedResponse,
    stage: ResponseDiagnosticStage,
    responseId?: string,
    failureCode?: string,
  ): void {
    const matching = this.responseDiagnostics.find((item) =>
      (response.clientEventId && item.key === response.clientEventId) ||
      (response.responseId && item.response_id === response.responseId) ||
      (item.purpose === response.purpose &&
        item.request_id === response.context?.requestId &&
        item.step_id === response.context?.stepId &&
        item.cycle === response.context?.cycle &&
        item.stage === "registered"),
    );
    const key = matching?.key ?? response.clientEventId ?? response.responseId ?? response.purpose;
    const existing = matching;
    if (!existing) {
      this.recordResponseDiagnostic(key, response.purpose, response.context);
    }
    const atMs = round(this.now() - this.startedAt);
    this.responseDiagnostics = this.responseDiagnostics.map((item) => {
      if (item.key !== key) return item;
      const next: ResponseDiagnostic = {
        ...item,
        ...(responseId ? { response_id: sanitizeTraceIdentifier(responseId) } : {}),
        stage,
        ...(failureCode ? { failure_code: failureCode } : {}),
      };
      if (stage === "created") next.created_at_ms ??= atMs;
      if (stage === "audio_started") next.audio_started_at_ms ??= atMs;
      if (stage === "generation_done") next.generation_done_at_ms ??= atMs;
      if (stage === "playback_stopped") next.playback_stopped_at_ms ??= atMs;
      if (stage === "settled" || stage === "failed" || stage === "timed_out") next.terminal_at_ms ??= atMs;
      return next;
    });
  }

  private markPossibleStaleOutput(responseId: string | undefined): void {
    if (!responseId) return;
    const markerId = this.interruptedResponseIds.get(responseId);
    if (!markerId) return;
    this.interruptions = this.interruptions.map((marker) =>
      marker.id === markerId
        ? {
            ...marker,
            settlement: "failure",
            stale_output_events: marker.stale_output_events + 1,
          }
        : marker,
    );
    this.addLocalTrace("interruption.possible_stale_output", {
      response_id: responseId,
    });
    this.emitSnapshot();
  }

  private settleInterruption(responseId: string, status: string | undefined): void {
    const markerId = this.interruptedResponseIds.get(responseId);
    if (!markerId) return;
    const pendingMarker = this.interruptions.find(
      (marker) => marker.id === markerId && marker.settlement === "pending",
    );
    if (!pendingMarker) return;
    const now = this.now();
    this.interruptions = this.interruptions.map((marker) => {
      if (marker.id !== markerId || marker.settlement !== "pending") return marker;
      const settlement =
        (status === "cancelled" ||
          status === "incomplete" ||
          status === "cleared") &&
        marker.stale_output_events === 0
          ? "success"
          : "failure";
      return {
        ...marker,
        settlement,
        settled_after_ms: round(Math.max(0, now - this.startedAt - marker.at_ms)),
      };
    });
    // Keep the response-to-marker association until the bounded marker itself
    // is pruned. A late delta after a buffer-clear acknowledgement must still
    // invalidate an apparent success.
    this.addLocalTrace("interruption.settled", {
      response_id: responseId,
      status: this.interruptions.find((marker) => marker.id === markerId)?.settlement,
    });
  }

  private handleFunctionCalls(event: ServerEvent): void {
    const calls = extractFunctionCalls(event).filter((call) => {
      return this.rememberCallId(call.callId);
    });
    if (calls.length === 0) return;

    let successfulEchoes = 0;
    let lessonStarted = false;
    let localActionShown = false;
    let annotationStarted = false;
    const clientEventId = `evt_tool_continuation_${crypto.randomUUID()}`;
    try {
      for (const call of calls) {
        const result = routeToolCall(call, {
          teach: this.callbacks.onTeachRequested,
          deixis: this.callbacks.onDeixisRequested,
          annotate: this.callbacks.onAnnotateRequested,
          drawScratch: this.callbacks.onDrawScratchRequested,
          drawQaAnnotation: this.callbacks.onDrawQaAnnotationRequested,
        });
        this.sendEvent(createFunctionCallOutput(call.callId, result));
        this.addLocalTrace("tool.output_sent", {
          call_id: call.callId,
          status: result.ok ? "ok" : result.reason,
        });
        if (result.ok && "echo" in result) successfulEchoes += 1;
        if (result.ok && "status" in result) {
          if (result.status === "started") lessonStarted = true;
          if (result.status === "shown") localActionShown = true;
          if (result.status === "annotation_started") annotationStarted = true;
          if (result.status === "scratch_started") annotationStarted = true;
          if (result.status === "qa_annotation_shown") localActionShown = true;
        }
      }
      const purpose =
        lessonStarted || localActionShown || annotationStarted
          ? "tool_continuation"
          : "diagnostic_tool";
      this.responseCoordinator.registerManual({
        purpose,
        clientEventId,
        successfulEchoes,
      });
      this.sendEvent(
        createResponseAfterTool(
          clientEventId,
          { chalk_kind: purpose },
          lessonStarted
            ? "Say one short, engaging sentence that frames the requested topic while the board is prepared. Do not mention tools or loading."
            : localActionShown
              ? "Continue the answer naturally and refer to the highlighted board element without mentioning tools."
              : annotationStarted
                ? "Continue the answer briefly while optional explanatory ink is prepared. Do not mention tools or loading."
              : undefined,
        ),
      );
      this.trackResponseCreation(clientEventId);
    } catch (error) {
      this.responseCoordinator.failByClientEventId(clientEventId);
      this.addLocalTrace("tool.output_failed", { code: errorCode(error) });
      this.emitSnapshot();
      return;
    }
    this.emitSnapshot();
  }

  private confirmToolRoundTripFromOutput(responseId: string | undefined): void {
    if (!responseId) return;
    const response = this.responseCoordinator.get(responseId);
    if (response?.purpose !== "diagnostic_tool" || response.successfulEchoes === 0) return;
    this.toolRoundTrips += response.successfulEchoes;
    response.successfulEchoes = 0;
    this.addLocalTrace("tool.round_trip_confirmed", {
      response_id: responseId,
      status: "output_observed",
    });
    this.emitSnapshot();
  }

  private failDiagnosticToolWithoutOutput(responseId: string): void {
    const response = this.responseCoordinator.get(responseId);
    if (response?.purpose !== "diagnostic_tool" || response.successfulEchoes === 0) return;
    response.successfulEchoes = 0;
    this.addLocalTrace("tool.round_trip_unconfirmed", {
      response_id: responseId,
      status: "no_output",
    });
    this.emitSnapshot();
  }

  private rememberCallId(callId: string): boolean {
    if (this.seenCallIds.has(callId)) return false;
    if (this.seenCallIds.size >= MAX_SEEN_CALL_IDS) {
      const oldest = this.seenCallIds.values().next().value as string | undefined;
      if (oldest) this.seenCallIds.delete(oldest);
    }
    this.seenCallIds.add(callId);
    return true;
  }

  private trackResponseCreation(clientEventId: string): void {
    this.clearResponseCreationTimeout(clientEventId);
    const attempt = this.attempt;
    const timeout = window.setTimeout(() => {
      this.responseCreateTimeouts.delete(clientEventId);
      if (attempt !== this.attempt) return;
      const failed = this.responseCoordinator.failByClientEventId(clientEventId);
      if (!failed) return;
      this.emitFailedResponse(failed);
      this.updateResponseDiagnostic(failed, "timed_out", undefined, "response_create_timeout");
      this.addLocalTrace("response.create_timeout", { code: "timeout" });
    }, RESPONSE_CREATED_TIMEOUT_MS);
    this.responseCreateTimeouts.set(clientEventId, timeout);
  }

  private trackAutomaticResponseCreation(
    purpose: "student_qa" | "checkpoint_feedback",
    context: NarrationContext,
  ): void {
    this.clearAutomaticResponseCreationTimeout();
    const attempt = this.attempt;
    const timeout = window.setTimeout(() => {
      this.automaticResponseCreationTimeout = undefined;
      if (attempt !== this.attempt) return;
      const failed = this.responseCoordinator.failAutomatic(purpose, context);
      if (!failed) return;
      this.emitFailedResponse(failed);
      this.updateResponseDiagnostic(failed, "timed_out", undefined, "automatic_response_create_timeout");
      this.addLocalTrace("response.automatic_create_timeout", { code: "timeout" });
      this.emitSnapshot();
    }, RESPONSE_CREATED_TIMEOUT_MS);
    this.automaticResponseCreationTimeout = {
      timeout,
      purpose,
      context: { ...context },
    };
  }

  private clearAutomaticResponseCreationTimeout(): void {
    if (this.automaticResponseCreationTimeout) {
      window.clearTimeout(this.automaticResponseCreationTimeout.timeout);
      this.automaticResponseCreationTimeout = undefined;
    }
  }

  private clearResponseCreationTimeout(clientEventId: string): void {
    const timeout = this.responseCreateTimeouts.get(clientEventId);
    if (timeout !== undefined) window.clearTimeout(timeout);
    this.responseCreateTimeouts.delete(clientEventId);
  }

  private clearResponseCreationTimeouts(): void {
    for (const timeout of this.responseCreateTimeouts.values()) {
      window.clearTimeout(timeout);
    }
    this.responseCreateTimeouts.clear();
  }

  private trackResponseSettlement(responseId: string): void {
    this.clearResponseSettlementTimeout(responseId);
    const attempt = this.attempt;
    const timeout = window.setTimeout(() => {
      this.responseSettlementTimeouts.delete(responseId);
      if (attempt !== this.attempt) return;
      const failed = this.responseCoordinator.failByResponseId(responseId);
      if (!failed) return;
      if (this.activeResponseId === responseId) this.activeResponseId = undefined;
      if (this.playbackResponseId === responseId) this.playbackResponseId = undefined;
      this.emitFailedResponse(failed);
      this.updateResponseDiagnostic(failed, "timed_out", responseId, "response_settlement_timeout");
      this.addLocalTrace("response.settlement_timeout", {
        response_id: responseId,
        code: "timeout",
      });
    }, RESPONSE_SETTLEMENT_TIMEOUT_MS);
    this.responseSettlementTimeouts.set(responseId, timeout);
  }

  private clearResponseSettlementTimeout(responseId: string): void {
    const timeout = this.responseSettlementTimeouts.get(responseId);
    if (timeout !== undefined) window.clearTimeout(timeout);
    this.responseSettlementTimeouts.delete(responseId);
  }

  private scheduleNarrationAudioStartFallback(responseId: string): void {
    this.clearNarrationAudioStartFallback(responseId);
    const attempt = this.attempt;
    const timeout = window.setTimeout(() => {
      this.narrationAudioStartFallbacks.delete(responseId);
      if (attempt !== this.attempt) return;
      const response = this.responseCoordinator.get(responseId);
      if (!response || response.activitySeen || response.playbackStopped) return;
      if (this.interruptedResponseIds.has(responseId)) return;
      this.addLocalTrace("narration.audio_start_assumed", {
        response_id: responseId,
        code: "fallback",
      });
      this.setMicrophoneEnabled(false);
      this.playbackResponseId = responseId;
      this.activeResponseId = responseId;
      this.emitResponseLifecycle(responseId, "activity");
      this.emitSnapshot();
    }, NARRATION_AUDIO_START_FALLBACK_MS);
    this.narrationAudioStartFallbacks.set(responseId, timeout);
  }

  private clearNarrationAudioStartFallback(responseId: string): void {
    const timeout = this.narrationAudioStartFallbacks.get(responseId);
    if (timeout !== undefined) window.clearTimeout(timeout);
    this.narrationAudioStartFallbacks.delete(responseId);
  }

  private clearNarrationAudioStartFallbacks(): void {
    for (const timeout of this.narrationAudioStartFallbacks.values()) {
      window.clearTimeout(timeout);
    }
    this.narrationAudioStartFallbacks.clear();
  }

  private clearResponseSettlementTimeouts(): void {
    for (const timeout of this.responseSettlementTimeouts.values()) {
      window.clearTimeout(timeout);
    }
    this.responseSettlementTimeouts.clear();
  }

  private recordTokenUsage(event: ServerEvent): boolean {
    const responseId = getResponseId(event);
    const usage = getResponseUsage(event);
    if (!responseId || !usage || this.seenUsageResponseIds.has(responseId)) {
      return false;
    }
    rememberBounded(this.seenUsageResponseIds, responseId, MAX_SEEN_CALL_IDS);
    this.tokenUsage = {
      total_tokens: this.tokenUsage.total_tokens + usage.total_tokens,
      input_tokens: this.tokenUsage.input_tokens + usage.input_tokens,
      output_tokens: this.tokenUsage.output_tokens + usage.output_tokens,
      cached_input_tokens:
        this.tokenUsage.cached_input_tokens + usage.cached_input_tokens,
      input_audio_tokens:
        this.tokenUsage.input_audio_tokens + usage.input_audio_tokens,
      output_audio_tokens:
        this.tokenUsage.output_audio_tokens + usage.output_audio_tokens,
    };
    return this.tokenUsage.total_tokens >= SESSION_TOKEN_BUDGET;
  }

  private sendEvent(event: { type: string; [key: string]: unknown }): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("The Realtime data channel is not open.");
    }
    this.dataChannel.send(JSON.stringify(event));
    this.trace = appendBounded(
      this.trace,
      eventToTraceEntry(
        event,
        "client",
        this.nextSequence(),
        this.now() - this.startedAt,
      ),
    );
    this.emitSnapshot();
  }

  private addServerTrace(event: ServerEvent): void {
    this.trace = appendBounded(
      this.trace,
      eventToTraceEntry(
        event,
        "server",
        this.nextSequence(),
        this.now() - this.startedAt,
      ),
    );
    this.emitSnapshot();
  }

  private addLocalTrace(
    type: string,
    metadata: Pick<TraceEntry, "response_id" | "call_id" | "status" | "code"> = {},
  ): void {
    this.trace = appendBounded(
      this.trace,
      createLocalTraceEntry(
        type,
        this.nextSequence(),
        this.now() - this.startedAt,
        metadata,
      ),
    );
    this.emitSnapshot();
  }

  private nextSequence(): number {
    return (this.trace.at(-1)?.sequence ?? 0) + 1;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
  }

  private waitUntilSessionUpdated(attempt: number): Promise<void> {
    if (this.sessionUpdated) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      window.setTimeout(() => {
        if (attempt === this.attempt && this.readyResolve) {
          this.readyResolve = undefined;
          this.readyReject = undefined;
          reject(new Error("Timed out waiting for session.updated."));
        }
      }, SESSION_READY_TIMEOUT_MS);
    });
  }

  private assertCurrentAttempt(attempt: number): void {
    if (attempt !== this.attempt) {
      throw new DOMException("Connection attempt superseded.", "AbortError");
    }
  }

  private resetForConnectionAttempt(): void {
    this.startedAt = this.now();
    this.sessionCredential = undefined;
    this.observedSessionModel = undefined;
    this.observedSessionVoice = undefined;
    this.observedSyncMode = undefined;
    this.activeResponseId = undefined;
    this.playbackResponseId = undefined;
    this.microphoneEnabled = false;
    this.lastError = undefined;
    this.toolRoundTrips = 0;
    this.responseCoordinator.reset();
    this.clearResponseCreationTimeouts();
    this.clearAutomaticResponseCreationTimeout();
    this.clearResponseSettlementTimeouts();
    this.clearNarrationAudioStartFallbacks();
    this.interactionGuidance = undefined;
    this.contextUpdateTail = Promise.resolve();
    this.contextPublications = [];
    this.lastAcknowledgedManifestHash = undefined;
    this.contextAckStartedAt = undefined;
    this.contextAckManifestHash = undefined;
    this.clearContextAcknowledgement();
    this.trace = [];
    this.interruptions = [];
    this.responseDiagnostics = [];
    this.seenCallIds.clear();
    this.seenUsageResponseIds.clear();
    this.interruptedResponseIds.clear();
    this.tokenUsage = { ...EMPTY_TOKEN_USAGE };
    this.sessionCreated = false;
    this.sessionUpdated = false;
    this.dataChannelOpen = false;
    this.sessionUpdateSent = false;
  }

  private async transitionToTerminalError(
    attempt: number,
    message: string,
    code: string,
  ): Promise<void> {
    if (attempt !== this.attempt) return;
    const terminalAttempt = ++this.attempt;
    await this.cleanupResources();
    if (terminalAttempt !== this.attempt) return;
    this.sessionCredential = undefined;
    this.observedSessionModel = undefined;
    this.observedSessionVoice = undefined;
    this.observedSyncMode = undefined;
    this.activeResponseId = undefined;
    this.playbackResponseId = undefined;
    this.lastError = message;
    this.addLocalTrace("connection.terminal_error", { code });
    this.setStatus("error");
  }

  private async cleanupResources(): Promise<void> {
    this.requestAbort?.abort();
    this.requestAbort = undefined;
    this.readyReject?.(new Error("Connection closed before session.updated."));
    this.readyResolve = undefined;
    this.readyReject = undefined;
    const rejectContext = this.contextAckReject;
    this.clearContextAcknowledgement();
    rejectContext?.(new Error("Connection closed before tutor-context acknowledgement."));

    this.dataChannel?.close();
    this.dataChannel = undefined;
    this.peer?.close();
    this.peer = undefined;
    if (this.microphoneStream) stopMediaStream(this.microphoneStream);
    this.microphoneStream = undefined;
    this.microphoneEnabled = false;
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
    }
    this.remoteAudio = undefined;
    this.remoteAudioActivityMonitor?.stop();
    this.remoteAudioActivityMonitor = undefined;
    this.remoteAudioActivityEvidence = undefined;
    this.dataChannelOpen = false;
    this.sessionCreated = false;
    this.sessionUpdated = false;
    this.sessionUpdateSent = false;
    this.responseCoordinator.reset();
    this.clearResponseCreationTimeouts();
    this.clearAutomaticResponseCreationTimeout();
    this.clearResponseSettlementTimeouts();
    this.clearNarrationAudioStartFallbacks();
    this.playbackResponseId = undefined;
  }
}

function waitForIceGathering(
  peer: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    peer.addEventListener("icegatheringstatechange", onChange);
    window.setTimeout(finish, timeoutMs);
  });
}

function countConsecutiveSuccesses(markers: InterruptionMarker[]): number {
  let count = 0;
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const settlement = markers[index].settlement;
    if (settlement === "pending" || settlement === "failure") break;
    count += 1;
  }
  return count;
}

function appendBounded<T>(items: T[], item: T): T[] {
  const next = [...items, item];
  return next.length > MAX_TRACE_ENTRIES
    ? next.slice(next.length - MAX_TRACE_ENTRIES)
    : next;
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function rememberBounded(
  values: Set<string>,
  value: string,
  maximum: number,
): void {
  if (values.size >= maximum) {
    const oldest = values.values().next().value as string | undefined;
    if (oldest) values.delete(oldest);
  }
  values.add(value);
}

function userFacingError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow access and retry.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Could not start the Realtime session.";
}

function errorCode(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name || "Error";
  return "unknown";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
