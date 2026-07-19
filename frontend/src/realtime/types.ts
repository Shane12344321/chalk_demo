export type ConnectionStatus =
  | "disconnected"
  | "minting-session"
  | "requesting-microphone"
  | "negotiating-webrtc"
  | "configuring-session"
  | "connected"
  | "disconnecting"
  | "error";

export type ChalkRuntimeMode = "demo" | "diagnostics";
export type SyncMode = "fixed" | "paced";

export interface SessionRequest {
  request_id: string;
  client_id: string;
}

export interface SessionCredential {
  request_id: string;
  client_secret: string;
  expires_at?: number;
  model: string;
  voice: string;
  sync_mode: SyncMode;
}

export interface FunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface TeachStartResult {
  requestId: string;
}

export interface ServerEvent {
  type: string;
  event_id?: string;
  [key: string]: unknown;
}

export type TraceDirection = "client" | "server" | "local";

export interface TraceEntry {
  sequence: number;
  at_ms: number;
  direction: TraceDirection;
  type: string;
  event_id?: string;
  session_id?: string;
  response_id?: string;
  item_id?: string;
  call_id?: string;
  status?: string;
  code?: string;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
}

export interface TokenUsageSummary {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
}

export type PerceivedAudioStop =
  | "not-recorded"
  | "immediate"
  | "short-tail"
  | "long-tail";

export interface InterruptionMarker {
  id: string;
  at_ms: number;
  response_id?: string;
  local_handler_stop_latency_ms: number;
  perceived_audio_stop: PerceivedAudioStop;
  settlement: "pending" | "success" | "failure";
  settled_after_ms?: number;
  stale_output_events: number;
}

export type ResponseDiagnosticStage =
  | "registered"
  | "created"
  | "audio_started"
  | "generation_done"
  | "playback_stopped"
  | "settled"
  | "failed"
  | "timed_out";

/** Content-free response ledger used to explain voice stalls in diagnostics mode. */
export interface ResponseDiagnostic {
  key: string;
  purpose: string;
  request_id?: string;
  step_id?: string;
  cycle?: number;
  response_id?: string;
  registered_at_ms: number;
  created_at_ms?: number;
  audio_started_at_ms?: number;
  generation_done_at_ms?: number;
  playback_stopped_at_ms?: number;
  terminal_at_ms?: number;
  stage: ResponseDiagnosticStage;
  failure_code?: string;
}

export interface RealtimeSnapshot {
  status: ConnectionStatus;
  sessionModel?: string;
  sessionVoice?: string;
  syncMode?: SyncMode;
  activeResponseId?: string;
  responsePending: boolean;
  responseInFlight: boolean;
  audioPlaybackActive: boolean;
  microphoneEnabled: boolean;
  lastError?: string;
  trace: TraceEntry[];
  interruptions: InterruptionMarker[];
  responseDiagnostics: ResponseDiagnostic[];
  consecutiveSuccessfulInterruptions: number;
  toolRoundTrips: number;
  tokenUsage: TokenUsageSummary;
  tokenBudget: number;
  contextPublications: ContextPublicationMetric[];
  lastAcknowledgedManifestHash?: string;
  remoteAudioActivity?: import("./remoteAudioActivity").AudioActivityEvidence;
}

export interface ContextPublicationMetric {
  manifest_hash: string;
  latency_ms: number;
}

export interface RealtimeClientCallbacks {
  onSnapshot: (snapshot: RealtimeSnapshot) => void;
  onSemanticEvent?: (event: RealtimeSemanticEvent) => void;
  onTeachRequested?: (topic: string, studentContext: string) => TeachStartResult;
  onDeixisRequested?: (
    kind: "point_at" | "circle_el" | "underline" | "flash" | "trace_path" | "focus_on",
    elementId: string,
  ) => { overlayId: string } | undefined;
  onAnnotateRequested?: (request: string) => { requestId: string } | undefined;
  onDrawScratchRequested?: (description: string) => { requestId: string } | undefined;
  onDrawQaAnnotationRequested?: (
    marks: readonly import("./toolRouter").QaAnnotationMark[],
  ) =>
    | { ok: true; requestId: string; marks: number }
    | { ok: false; reason: "not_in_qa" | "unknown_element" | "invalid_arguments" };
}

export interface NarrationContext {
  requestId: string;
  stepId: string;
  cycle: number;
}

export type RealtimeSemanticEvent =
  | { type: "student.speech_started" }
  | { type: "narration.activity"; context: NarrationContext }
  | {
      type: "narration.transcript_progress";
      context: NarrationContext;
      generatedCharacters: number;
    }
  | { type: "narration.generation_done"; context: NarrationContext }
  | { type: "narration.playback_stopped"; context: NarrationContext }
  | { type: "narration.failed"; context: NarrationContext }
  | { type: "checkpoint.prompt_activity"; context: NarrationContext }
  | { type: "checkpoint.prompt_generation_done"; context: NarrationContext }
  | { type: "checkpoint.prompt_playback_stopped"; context: NarrationContext }
  | { type: "checkpoint.prompt_failed"; context: NarrationContext }
  | { type: "checkpoint.feedback_activity"; context: NarrationContext }
  | { type: "checkpoint.feedback_generation_done"; context: NarrationContext }
  | { type: "checkpoint.feedback_playback_stopped"; context: NarrationContext }
  | { type: "checkpoint.feedback_failed"; context: NarrationContext };

export interface TraceExportContext {
  model?: string;
  voice?: string;
  browser?: string;
  tokenUsage?: TokenUsageSummary;
  tokenBudget?: number;
  contextPublications?: ContextPublicationMetric[];
  visibleManifestHash?: string;
  lastAcknowledgedManifestHash?: string;
}
