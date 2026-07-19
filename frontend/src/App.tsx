import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import projectileLessonSource from "../../demo/cached_lessons/projectile-range.lesson.json";
import derivativeLessonSource from "../../demo/cached_lessons/derivative-slope.lesson.json";
import unitCircleLessonSource from "../../demo/cached_lessons/unit-circle-sine.lesson.json";
import { AnnotationClient, type AnnotationOp } from "./annotations";
import { buildQaAnnotationProgram } from "./annotations/qaAnnotation";
import { BoardSurface as Board } from "./board/BoardSurface";
import { useAttentionChoreography } from "./board/attentionChoreography";
import { boardRenderContextForPlan } from "./board/compositionPlan";
import { decodeLesson } from "./board/decode";
import { RoughSvgBoardRenderer, type BoardRenderContext } from "./board/renderer";
import { buildResolvedBoardScene } from "./board/resolvedScene";
import { withRecoveryFindings } from "./board/resolvedScene";
import {
  RecoveryLedger,
  recoveryEvidenceFromRenderer,
} from "./board/failureRecovery";
import {
  createBrowserMeasurementRuntime,
  PrecommitMeasurementCache,
} from "./board/precommitMeasurement";
import { premeasureLessonRoots } from "./board/premeasureLesson";
import { buildBoardManifest, toAnnotationVisibleElements } from "./board/manifest";
import type { VisibleBoardState } from "./board/manifest";
import type { DeixisKind, DeixisOverlay } from "./board/overlays";
import { isLessonProgram } from "./board/schema";
import type { NormalizedLesson } from "./board/decode";
import { pickCachedLessonKey } from "./lessonFallback";
import { isSpaceToSpeakEvent } from "./voiceShortcut";
import {
  decodeLessonNdjson,
  LessonStreamClient,
  type LessonStreamProgress,
} from "./lessonStream";
import { LessonContinuationClient } from "./lessonStream/continuation";
import {
  getOrCreateClientId,
  manifestHash,
  RealtimeClient,
  resolveLocalApiBaseUrl,
  serializeRedactedTrace,
} from "./realtime";
import type {
  PerceivedAudioStop,
  RealtimeSemanticEvent,
  RealtimeSnapshot,
  ResponseDiagnostic,
  TraceEntry,
} from "./realtime";
import { SESSION_TOKEN_BUDGET } from "./realtime/protocol";
import { ScratchClient } from "./scratch/client";
import { ScratchWindow } from "./scratch/ScratchWindow";
import type { NormalizedLesson as ScratchLesson } from "./board/decode";
import type { QaAnnotationMark } from "./realtime/toolRouter";
import { useFixedLessonSync } from "./sync/useFixedLessonSync";

const API_BASE_URL = resolveLocalApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const CHALK_MODE =
  import.meta.env.VITE_CHALK_MODE === "diagnostics" ? "diagnostics" : "demo";
const LESSON_GENERATION_MODE = import.meta.env.VITE_LESSON_GENERATION === "resolved-stepwise"
  ? "resolved_stepwise"
  : "one_shot";
const QA_DIRECT_DRAW = import.meta.env.VITE_QA_DIRECT_DRAW === "on";
const ATTENTION_CHOREOGRAPHY = import.meta.env.VITE_ATTENTION_CHOREOGRAPHY === "on";
const REMOTE_AUDIO_ACTIVITY = import.meta.env.VITE_REMOTE_AUDIO_ACTIVITY === "on";

const INITIAL_SNAPSHOT: RealtimeSnapshot = {
  status: "disconnected",
  responsePending: false,
  responseInFlight: false,
  audioPlaybackActive: false,
  microphoneEnabled: false,
  trace: [],
  interruptions: [],
  responseDiagnostics: [],
  consecutiveSuccessfulInterruptions: 0,
  toolRoundTrips: 0,
  tokenUsage: {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    input_audio_tokens: 0,
    output_audio_tokens: 0,
  },
  tokenBudget: SESSION_TOKEN_BUDGET,
  contextPublications: [],
};

const VOICE_LIFECYCLE_TRACE = new Set([
  "response.create",
  "response.created",
  "response.cancel",
  "response.done",
  "output_audio_buffer.started",
  "output_audio_buffer.stopped",
  "output_audio_buffer.cleared",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "conversation.item.truncated",
  "session.token_budget_reached",
  "narration.audio_start_assumed",
  "error",
]);
const VOICE_FAILURE_TRACE =
  /timeout|failed|rejected|error|possible_stale|token_budget|deactivated/u;

function isVoiceLifecycleTrace(type: string): boolean {
  return (
    VOICE_LIFECYCLE_TRACE.has(type) ||
    type.startsWith("interruption.") ||
    type.startsWith("handler_state.") ||
    VOICE_FAILURE_TRACE.test(type)
  );
}

function checkedCachedLesson(source: unknown, name: string): NormalizedLesson {
  const result = decodeLesson(source);
  if (!isLessonProgram(source) || !result.lesson || result.warnings.length > 0) {
    throw new Error(`The checked-in ${name} lesson did not pass its shared contract.`);
  }
  return result.lesson;
}

const PROJECTILE_LESSON = checkedCachedLesson(projectileLessonSource, "projectile");
const CACHED_LESSONS = {
  projectile: PROJECTILE_LESSON,
  derivative: checkedCachedLesson(derivativeLessonSource, "derivative"),
  "unit-circle": checkedCachedLesson(unitCircleLessonSource, "unit-circle"),
} as const;
type CachedLessonKey = keyof typeof CACHED_LESSONS;
const EMPTY_PROJECTILE_MANIFEST = buildBoardManifest(PROJECTILE_LESSON.title, []);
const EMPTY_VISIBLE_BOARD: VisibleBoardState = {
  version: 0,
  manifest: EMPTY_PROJECTILE_MANIFEST,
  elements: [],
  fingerprint: JSON.stringify([EMPTY_PROJECTILE_MANIFEST, []]),
};

interface M3GenerationTiming {
  requestId: string;
  requestedAtMs: number;
  firstValidStepAtMs?: number;
  firstVisibleInkAtMs?: number;
  boardModel?: string;
  boardReasoningEffort?: string;
  boardPromptSha256?: string;
  repairPromptSha256?: string;
  acceptedSteps?: number;
  repairs?: number;
  droppedSteps?: number;
  sanitizedSteps?: number;
  sanitizedFields?: number;
  partial?: boolean;
}

function App() {
  const isDiagnostics = CHALK_MODE === "diagnostics";
  const clientIdRef = useRef<string>();
  if (!clientIdRef.current) clientIdRef.current = getOrCreateClientId();
  const cachedRequestIdRef = useRef<string>();
  if (!cachedRequestIdRef.current) cachedRequestIdRef.current = crypto.randomUUID();
  const clientRef = useRef<RealtimeClient>();
  const lessonStreamRef = useRef<LessonStreamClient>();
  if (!lessonStreamRef.current) {
    lessonStreamRef.current = new LessonStreamClient(API_BASE_URL, clientIdRef.current);
  }
  const lessonContinuationRef = useRef<LessonContinuationClient>();
  if (!lessonContinuationRef.current) {
    lessonContinuationRef.current = new LessonContinuationClient(
      API_BASE_URL,
      clientIdRef.current,
    );
  }
  const measurementCacheRef = useRef<PrecommitMeasurementCache>();
  if (!measurementCacheRef.current) {
    measurementCacheRef.current = new PrecommitMeasurementCache(
      createBrowserMeasurementRuntime(),
    );
  }
  const resolvedRendererRef = useRef<RoughSvgBoardRenderer>();
  if (!resolvedRendererRef.current) {
    resolvedRendererRef.current = new RoughSvgBoardRenderer(measurementCacheRef.current);
  }
  const annotationClientRef = useRef<AnnotationClient>();
  if (!annotationClientRef.current) {
    annotationClientRef.current = new AnnotationClient(API_BASE_URL, clientIdRef.current);
  }
  const scratchClientRef = useRef<ScratchClient>();
  if (!scratchClientRef.current) {
    scratchClientRef.current = new ScratchClient(API_BASE_URL, clientIdRef.current!);
  }
  const semanticHandlerRef = useRef<(event: RealtimeSemanticEvent) => void>();
  const qaAnnotationHandlerRef = useRef<
    (marks: readonly QaAnnotationMark[]) =>
      | { ok: true; requestId: string; marks: number }
      | { ok: false; reason: "not_in_qa" | "unknown_element" | "invalid_arguments" }
  >();
  const generationTimingRef = useRef<M3GenerationTiming>();
  const teachHandlerRef = useRef<
    (topic: string, studentContext: string) => { requestId: string }
  >();
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [boardManifest, setBoardManifest] = useState(EMPTY_PROJECTILE_MANIFEST);
  const [visibleBoardVersion, setVisibleBoardVersion] = useState(0);
  const visibleBoardRef = useRef(EMPTY_VISIBLE_BOARD);
  const [deixisOverlays, setDeixisOverlays] = useState<DeixisOverlay[]>([]);
  const [annotationOps, setAnnotationOps] = useState<AnnotationOp[]>([]);
  const overlayTimeoutsRef = useRef(new Map<string, number>());
  const [topic, setTopic] = useState("Derivative as slope at a point");
  const [cachedLessonKey, setCachedLessonKey] = useState<CachedLessonKey>("projectile");
  const [activeLesson, setActiveLesson] = useState<{
    lesson: NormalizedLesson;
    requestId: string;
    complete: boolean;
    source: "cached" | "live" | "review";
    renderContext?: BoardRenderContext;
  }>({
    lesson: PROJECTILE_LESSON,
    requestId: cachedRequestIdRef.current,
    complete: true,
    source: "cached",
  });
  const [generation, setGeneration] = useState<{
    status: "idle" | "generating" | "ready" | "fallback";
    message?: string;
    warnings: number;
    repairs: number;
    droppedSteps: number;
    browserDroppedSteps: number;
    sanitizedSteps: number;
    sanitizedFields: number;
  }>({
    status: "idle",
    warnings: 0,
    repairs: 0,
    droppedSteps: 0,
    browserDroppedSteps: 0,
    sanitizedSteps: 0,
    sanitizedFields: 0,
  });
  const activeGenerationTokenRef = useRef<string>();
  const [autoStartRequestId, setAutoStartRequestId] = useState<string>();
  const [contextError, setContextError] = useState<string>();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [m3CopyState, setM3CopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [generationTiming, setGenerationTiming] = useState<M3GenerationTiming>();
  const [reviewStepIndex, setReviewStepIndex] = useState(0);
  const [engineFeed, setEngineFeed] = useState<
    { id: number; atMs: number; kind: string; message: string }[]
  >([]);
  const engineFeedSequenceRef = useRef(0);
  const engineStepCountRef = useRef<{ requestId?: string; count: number }>({ count: 0 });
  const logEngine = useCallback((kind: string, message: string) => {
    setEngineFeed((current) => [
      ...current.slice(-249),
      {
        id: (engineFeedSequenceRef.current += 1),
        atMs: performance.now(),
        kind,
        message,
      },
    ]);
  }, []);
  const lastTraceSequenceRef = useRef(0);
  useEffect(() => {
    const fresh = snapshot.trace.filter(
      (entry) => entry.sequence > lastTraceSequenceRef.current,
    );
    if (fresh.length === 0) return;
    lastTraceSequenceRef.current = fresh[fresh.length - 1].sequence;
    for (const entry of fresh) {
      if (!isVoiceLifecycleTrace(entry.type)) continue;
      const failure =
        VOICE_FAILURE_TRACE.test(entry.type) ||
        entry.status === "failure" ||
        entry.status === "incomplete" ||
        entry.status === "cancelled" ||
        entry.status === "failed";
      const parts = [
        entry.direction === "client" ? `→ ${entry.type}` : `← ${entry.type}`,
        entry.response_id ? `resp …${entry.response_id.slice(-6)}` : undefined,
        entry.status ? `status ${entry.status}` : undefined,
        entry.code ? `code ${entry.code}` : undefined,
      ].filter((part): part is string => Boolean(part));
      logEngine(failure ? "voice✗" : "voice", parts.join(" · "));
    }
  }, [snapshot.trace, logEngine]);
  const realtimeResponseBusy =
    snapshot.responseInFlight ||
    Boolean(snapshot.activeResponseId) ||
    snapshot.audioPlaybackActive;
  const lessonSync = useFixedLessonSync({
    lesson: activeLesson.lesson,
    lessonRequestId: activeLesson.requestId,
    lessonComplete: activeLesson.complete,
    clientRef,
    connectionStatus: snapshot.status,
    responseIdle: !realtimeResponseBusy,
    syncMode: snapshot.syncMode ?? "fixed",
  });
  semanticHandlerRef.current = lessonSync.onSemanticEvent;
  const lastSyncPhaseRef = useRef<string>();
  useEffect(() => {
    const previous = lastSyncPhaseRef.current;
    const next = lessonSync.state.phase;
    if (previous === next) return;
    lastSyncPhaseRef.current = next;
    if (previous === undefined) return;
    logEngine(
      "sync",
      `${previous} → ${next} · step ${lessonSync.state.currentStepIndex + 1}` +
        ` · ${Math.round(lessonSync.state.currentStepProgress * 100)}% drawn`,
    );
  }, [
    lessonSync.state.phase,
    lessonSync.state.currentStepIndex,
    lessonSync.state.currentStepProgress,
    logEngine,
  ]);

  const {
    overlays: attentionOverlays,
    enqueue: enqueueAttention,
    cancel: cancelAttention,
  } = useAttentionChoreography({
    requestId: activeLesson.requestId,
    manifestVersion: visibleBoardVersion,
    phase: lessonSync.state.phase,
    visibleElementIds: visibleBoardRef.current.elements.map((element) => element.id),
    interruptionEpoch: snapshot.interruptions.length,
  });

  const clearDeixisOverlays = useCallback(() => {
    for (const timeout of overlayTimeoutsRef.current.values()) {
      window.clearTimeout(timeout);
    }
    overlayTimeoutsRef.current.clear();
    setDeixisOverlays([]);
    cancelAttention();
  }, [cancelAttention]);

  const handleVisibleStateChange = useCallback((state: VisibleBoardState) => {
    visibleBoardRef.current = state;
    setVisibleBoardVersion(state.version);
    setBoardManifest(state.manifest);
  }, []);

  const showDeixis = useCallback(
    (kind: DeixisKind, elementId: string): { overlayId: string } | undefined => {
      if (ATTENTION_CHOREOGRAPHY) {
        const result = enqueueAttention(kind, elementId);
        return result.ok ? { overlayId: result.overlayId } : undefined;
      }
      // The two Phase-5-only actions are never exposed while the experiment is
      // off, but reject them defensively if an old/stale tool call arrives.
      if (kind === "trace_path" || kind === "focus_on") return undefined;
      if (!visibleBoardRef.current.elements.some((element) => element.id === elementId)) {
        return undefined;
      }
      const overlayId = `overlay_${crypto.randomUUID()}`;
      setDeixisOverlays((current) => [
        ...current.slice(-7),
        { id: overlayId, kind, targetId: elementId },
      ]);
      const timeout = window.setTimeout(() => {
        setDeixisOverlays((current) => current.filter((item) => item.id !== overlayId));
        overlayTimeoutsRef.current.delete(overlayId);
      }, 2_200);
      overlayTimeoutsRef.current.set(overlayId, timeout);
      return { overlayId };
    },
    [enqueueAttention],
  );

  const clearAnnotations = useCallback(() => {
    annotationClientRef.current?.cancel();
    setAnnotationOps([]);
  }, []);

  const requestAnnotation = useCallback((question: string) => {
    const visible = visibleBoardRef.current;
    if (visible.elements.length === 0) return undefined;
    const requestId = crypto.randomUUID();
    logEngine(
      "annot→",
      `POST /annotate · manifest v${visible.version} · ${visible.elements.length} visible elements · ` +
        `question "${question.slice(0, 80)}"`,
    );
    void annotationClientRef.current
      ?.start({
        requestId,
        manifestVersion: visible.version,
        question,
        boardManifest: visible.manifest,
        visibleElements: toAnnotationVisibleElements(visible.elements),
      })
      .then((result) => {
        if (visibleBoardRef.current.version !== result.program.manifest_version) {
          logEngine("annot✗", "annotation result discarded: manifest version changed");
          return;
        }
        logEngine(
          "annot←",
          `${result.program.ops.length} overlay op(s) [${result.program.ops
            .map((op) => op.op)
            .join(", ")}]`,
        );
        setAnnotationOps([...result.program.ops]);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        logEngine("annot✗", "annotation request failed; continuing without overlay ink");
        setContextError(
          "Explanatory ink was unavailable; Chalk can continue with the visible board.",
        );
      });
    return { requestId };
  }, [logEngine]);

  const [scratchCard, setScratchCard] = useState<ScratchLesson>();
  const requestScratchCard = useCallback(
    (description: string) => {
      const requestId = crypto.randomUUID();
      logEngine(
        "scratch→",
        `POST /scratch req ${requestId.slice(0, 8)} · "${description.slice(0, 80)}"`,
      );
      void scratchClientRef.current
        ?.start({ requestId, description })
        .then((result) => {
          logEngine(
            "scratch←",
            `card "${result.lesson.title}" · ops [${result.lesson.steps[0].ops
              .map((op) => op.op)
              .join(", ")}] · ${result.repairs} repairs`,
          );
          setScratchCard(result.lesson);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          logEngine("scratch✗", "scratch card failed; Chalk continues without it");
        });
      return { requestId };
    },
    [logEngine],
  );

  qaAnnotationHandlerRef.current = (marks) => {
    const built = buildQaAnnotationProgram(
      marks,
      lessonSync.state.phase,
      visibleBoardRef.current,
    );
    if (!built.ok) {
      return {
        ok: false,
        reason:
          built.reason === "not_in_qa"
            ? "not_in_qa"
            : built.reason === "unknown_element" || built.reason === "empty_board"
              ? "unknown_element"
              : "invalid_arguments",
      };
    }
    setAnnotationOps(built.program.ops);
    return {
      ok: true,
      requestId: built.program.request_id,
      marks: built.program.ops.length,
    };
  };

  useEffect(() => {
    const client = new RealtimeClient({
      apiBaseUrl: API_BASE_URL,
      clientId: clientIdRef.current!,
      mode: CHALK_MODE,
      callbacks: {
        onSnapshot: setSnapshot,
        onSemanticEvent: (event) => semanticHandlerRef.current?.(event),
        onTeachRequested: (requestedTopic, studentContext) => {
          const handler = teachHandlerRef.current;
          if (!handler) throw new Error("Lesson generation is not ready.");
          return handler(requestedTopic, studentContext);
        },
        onDeixisRequested: showDeixis,
        onAnnotateRequested: requestAnnotation,
        onDrawScratchRequested: requestScratchCard,
        ...(QA_DIRECT_DRAW
          ? {
              onDrawQaAnnotationRequested: (marks: readonly QaAnnotationMark[]) =>
                qaAnnotationHandlerRef.current?.(marks) ?? {
                  ok: false as const,
                  reason: "not_in_qa" as const,
                },
            }
          : {}),
      },
      qaDirectDraw: QA_DIRECT_DRAW,
      attentionChoreography: ATTENTION_CHOREOGRAPHY,
      remoteAudioActivity: REMOTE_AUDIO_ACTIVITY,
    });
    clientRef.current = client;
    void client.setBoardContext(EMPTY_PROJECTILE_MANIFEST);
    return () => {
      clientRef.current = undefined;
      lessonStreamRef.current?.cancel();
      lessonContinuationRef.current?.cancel();
      clearDeixisOverlays();
      clearAnnotations();
      scratchClientRef.current?.cancel();
      void client.disconnect();
    };
  }, [clearAnnotations, clearDeixisOverlays, requestAnnotation, requestScratchCard, showDeixis]);

  useEffect(() => {
    clearDeixisOverlays();
    clearAnnotations();
  }, [activeLesson.requestId, clearAnnotations, clearDeixisOverlays]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    void client
      .setBoardContext(boardManifest)
      .then(() => setContextError(undefined))
      .catch(() =>
        setContextError(
          "The latest board grounding update failed; Chalk may use the previous visible state.",
        ),
      );
  }, [boardManifest, snapshot.status]);

  const isBusy = !["disconnected", "connected", "error"].includes(
    snapshot.status,
  );
  const canConnect = snapshot.status === "disconnected" || snapshot.status === "error";
  const canDisconnect =
    snapshot.status !== "disconnected" && snapshot.status !== "disconnecting";
  const recentTrace = useMemo(() => snapshot.trace.slice(-30).reverse(), [snapshot.trace]);
  const activeCheckpoint =
    activeLesson.lesson.steps[lessonSync.state.currentStepIndex]?.checkpoint;
  const visibleManifestHash = manifestHash(boardManifest);
  const isOfflineCachedPreview =
    activeLesson.source === "cached" &&
    snapshot.status === "disconnected" &&
    lessonSync.state.phase === "IDLE";

  useEffect(() => {
    if (
      !autoStartRequestId ||
      autoStartRequestId !== activeLesson.requestId ||
      lessonSync.state.requestId !== activeLesson.requestId ||
      lessonSync.state.phase !== "IDLE" ||
      snapshot.status !== "connected" ||
      realtimeResponseBusy
    ) {
      return;
    }
    const emptyManifest = buildBoardManifest(activeLesson.lesson.title, []);
    void clientRef.current
      ?.setBoardContext(emptyManifest)
      .then(() => {
        const currentSnapshot = clientRef.current?.getSnapshot();
        if (
          !currentSnapshot ||
          currentSnapshot.responseInFlight ||
          currentSnapshot.activeResponseId ||
          currentSnapshot.audioPlaybackActive
        ) {
          return;
        }
        setContextError(undefined);
        setAutoStartRequestId(undefined);
        lessonSync.start();
      })
      .catch(() => {
        setContextError(
          "Chalk could not reset its board grounding. Disconnect and reconnect before retrying.",
        );
      });
  }, [
    activeLesson,
    autoStartRequestId,
    lessonSync,
    realtimeResponseBusy,
    snapshot.status,
  ]);

  const connect = () => {
    setCopyState("idle");
    void clientRef.current?.connect().catch(() => {
      // The client publishes a redacted, user-facing error in its snapshot.
    });
  };

  const disconnect = () => {
    clearDeixisOverlays();
    clearAnnotations();
    void clientRef.current?.disconnect();
  };

  const toggleMicrophone = () => {
    try {
      clientRef.current?.setMicrophoneEnabled(!snapshot.microphoneEnabled);
    } catch {
      // Connection errors are already represented by the client snapshot.
    }
  };

  const activateVoiceOrb = () => {
    if (canConnect) {
      connect();
      return;
    }
    if (snapshot.status === "connected") {
      toggleMicrophone();
    }
  };

  useEffect(() => {
    const startSpeakingFromSpace = (event: KeyboardEvent) => {
      if (
        snapshot.status !== "connected" ||
        snapshot.microphoneEnabled ||
        !isSpaceToSpeakEvent(event)
      ) {
        return;
      }
      event.preventDefault();
      try {
        clientRef.current?.setMicrophoneEnabled(true);
      } catch {
        // Connection errors are already represented by the client snapshot.
      }
    };
    window.addEventListener("keydown", startSpeakingFromSpace);
    return () => window.removeEventListener("keydown", startSpeakingFromSpace);
  }, [snapshot.microphoneEnabled, snapshot.status]);

  const startLesson = () => {
    const client = clientRef.current;
    if (!client) return;
    clearAnnotations();
    logEngine("manifest→", `publishing empty board grounding for "${activeLesson.lesson.title}"`);
    void client
      .setBoardContext(buildBoardManifest(activeLesson.lesson.title, []))
      .then(() => {
        logEngine("manifest✓", "board grounding acknowledged (session.updated)");
        setContextError(undefined);
        lessonSync.start();
      })
      .catch(() =>
        setContextError(
          "Chalk could not reset its board grounding. Disconnect and reconnect before retrying.",
        ),
      );
  };

  const resumeLesson = () => {
    clearDeixisOverlays();
    clearAnnotations();
    lessonSync.resume();
  };

  const generateLesson = (requestedTopic: string, studentContext = ""): string => {
    const normalizedTopic = requestedTopic.trim();
    if (!normalizedTopic) throw new Error("Enter a math or physics topic first.");
    if (activeGenerationTokenRef.current) {
      throw new Error("A lesson is already being generated.");
    }
    clearDeixisOverlays();
    clearAnnotations();
    scratchClientRef.current?.cancel();
    setScratchCard(undefined);
    lessonContinuationRef.current?.cancel();
    measurementCacheRef.current!.beginLesson();
    const requestId = crypto.randomUUID();
    if (lessonSync.state.phase === "QA") {
      lessonStreamRef.current?.cancel();
      lessonSync.abort(requestId);
    }
    activeGenerationTokenRef.current = requestId;
    engineStepCountRef.current = { requestId, count: 0 };
    logEngine(
      "lesson→",
      `POST /lesson req ${requestId.slice(0, 8)} · topic "${normalizedTopic}"` +
        (studentContext ? ` · context "${studentContext.slice(0, 80)}"` : "") +
        ` · mode ${LESSON_GENERATION_MODE} · empty board state`,
    );
    const timing = { requestId, requestedAtMs: performance.now() };
    generationTimingRef.current = timing;
    setGenerationTiming(timing);
    setM3CopyState("idle");
    setGeneration({
      status: "generating",
      warnings: 0,
      repairs: 0,
      droppedSteps: 0,
      browserDroppedSteps: 0,
      sanitizedSteps: 0,
      sanitizedFields: 0,
    });
    setAutoStartRequestId(requestId);
    void lessonStreamRef.current
      ?.start(
        {
          requestId,
          topic: normalizedTopic,
          studentContext,
          // A fresh lesson erases the board, so the previous manifest would
          // only invite anchors to elements that no longer exist.
          boardState: "",
          generationMode: LESSON_GENERATION_MODE,
        },
        (progress: LessonStreamProgress) => {
          if (progress.steps.length === 0) return;
          if (
            engineStepCountRef.current.requestId === progress.requestId &&
            progress.steps.length > engineStepCountRef.current.count
          ) {
            for (const step of progress.steps.slice(engineStepCountRef.current.count)) {
              logEngine(
                "step←",
                `accepted "${step.id}" · ops [${step.ops.map((op) => op.op).join(", ")}]` +
                  (step.checkpoint ? " · checkpoint" : ""),
              );
            }
            engineStepCountRef.current.count = progress.steps.length;
          }
          premeasureLessonRoots(measurementCacheRef.current!, progress.steps);
          const progressRenderContext = boardRenderContextForPlan(progress.plan);
          const currentTiming = generationTimingRef.current;
          if (
            currentTiming?.requestId === progress.requestId &&
            currentTiming.firstValidStepAtMs === undefined
          ) {
            const updatedTiming = {
              ...currentTiming,
              firstValidStepAtMs: performance.now(),
              ...(progress.boardModel ? { boardModel: progress.boardModel } : {}),
              ...(progress.boardReasoningEffort
                ? { boardReasoningEffort: progress.boardReasoningEffort }
                : {}),
              ...(progress.boardPromptSha256
                ? { boardPromptSha256: progress.boardPromptSha256 }
                : {}),
              ...(progress.repairPromptSha256
                ? { repairPromptSha256: progress.repairPromptSha256 }
                : {}),
            };
            generationTimingRef.current = updatedTiming;
            setGenerationTiming(updatedTiming);
          }
          setActiveLesson({
            lesson: {
              schemaVersion: "1.4",
              title: progress.title,
              steps: progress.steps,
            },
            requestId: progress.requestId,
            complete: progress.complete,
            source: "live",
            ...(progressRenderContext ? { renderContext: progressRenderContext } : {}),
          });
          setGeneration((current) => ({
            ...current,
            status: progress.complete ? "ready" : "generating",
            warnings: progress.warnings,
            browserDroppedSteps: progress.browserDroppedSteps,
            sanitizedSteps: progress.sanitizedSteps,
            sanitizedFields: progress.sanitizedFields,
          }));
        },
      )
      .then(async (result) => {
        const currentTiming = generationTimingRef.current;
        if (currentTiming?.requestId === result.requestId) {
          const updatedTiming = {
            ...currentTiming,
            ...(result.boardModel ? { boardModel: result.boardModel } : {}),
            ...(result.boardReasoningEffort
              ? { boardReasoningEffort: result.boardReasoningEffort }
              : {}),
            ...(result.boardPromptSha256
              ? { boardPromptSha256: result.boardPromptSha256 }
              : {}),
            ...(result.repairPromptSha256
              ? { repairPromptSha256: result.repairPromptSha256 }
              : {}),
            acceptedSteps: result.steps.length,
            repairs: result.repairs,
            droppedSteps: result.droppedSteps,
            sanitizedSteps: result.sanitizedSteps,
            sanitizedFields: result.sanitizedFields,
            partial: result.partial,
          };
          generationTimingRef.current = updatedTiming;
          setGenerationTiming(updatedTiming);
        }
        logEngine(
          "lesson✓",
          `opening call done · ${result.steps.length} accepted · ${result.repairs} repairs · ` +
            `${result.droppedSteps} dropped · ${result.browserDroppedSteps} browser-dropped` +
            (result.boardModel ? ` · ${result.boardModel}/${result.boardReasoningEffort ?? "?"}` : "") +
            (result.boardPromptSha256 ? ` · prompt ${result.boardPromptSha256.slice(0, 8)}` : "") +
            (result.partial ? " · PARTIAL" : "") +
            (result.continuationAvailable ? " · continuation available" : ""),
        );
        let resolvedLesson = result.lesson;
        const renderContext = boardRenderContextForPlan(result.plan);
        let repairs = result.repairs;
        let continuationReceipt = result.continuationReceipt;
        let receiptPrefix = result.receiptPrefix;
        let continuationEndedEarly = false;
        const recoveryLedger = new RecoveryLedger(result.requestId, result.recoveryEvidence);
        if (result.continuationAvailable && result.plan && continuationReceipt) {
          while (
            (
              resolvedLesson.steps.length < result.plan.progression.length ||
              recoveryLedger.pendingIds().length > 0
            ) &&
            resolvedLesson.steps.length < 8 &&
            activeGenerationTokenRef.current === result.requestId
          ) {
            const prefixVersion = resolvedLesson.steps.length;
            const prepared = resolvedRendererRef.current!.prepareLesson(
              resolvedLesson,
              renderContext,
            );
            recoveryLedger.add(
              result.requestId,
              recoveryEvidenceFromRenderer(result.requestId, resolvedLesson, prepared),
            );
            const baseScene = buildResolvedBoardScene(
              result.requestId,
              prefixVersion,
              prepared,
              Math.min(lessonSync.state.currentStepIndex, prefixVersion),
            );
            const scene = withRecoveryFindings(
              baseScene,
              recoveryLedger.findings(baseScene.elements),
            );
            const attemptedRecoveryIds = scene.recovery_findings
              ?.filter((finding) => finding.status === "pending")
              .map((finding) => finding.finding_id) ?? [];
            try {
              logEngine(
                "cont→",
                `POST /lesson/continue · prefix v${prefixVersion} · scene ${scene.elements.length} elements` +
                  (attemptedRecoveryIds.length > 0
                    ? ` · retrying ${attemptedRecoveryIds.length} recovery finding(s)`
                    : ""),
              );
              const continuation = await lessonContinuationRef.current!.next({
                requestId: result.requestId,
                topic: normalizedTopic,
                studentContext,
                acceptedPrefix: resolvedLesson.steps,
                receiptPrefix,
                plan: result.plan,
                resolvedScene: scene,
                repairsUsed: repairs,
                continuationReceipt,
              });
              if (activeGenerationTokenRef.current !== result.requestId) return;
              repairs = continuation.repairs;
              logEngine(
                "cont←",
                continuation.done
                  ? `continuation done · reason ${continuation.reason}`
                  : continuation.browserDropped
                    ? "continuation step rejected by browser validation"
                    : `accepted "${continuation.step.id}" · ops [${continuation.step.ops
                        .map((op) => op.op)
                        .join(", ")}] · ${continuation.repairs} total repairs`,
              );
              if (continuation.done) {
                recoveryLedger.settle(
                  result.requestId,
                  attemptedRecoveryIds,
                  "abandoned",
                );
                continuationEndedEarly = continuation.reason !== "plan_complete";
                break;
              }
              continuationReceipt = continuation.continuationReceipt;
              receiptPrefix = [...resolvedLesson.steps, continuation.receiptStep];
              const decoderFailureIds = continuation.recoveryEvidence.map(
                (finding) => finding.findingId,
              );
              recoveryLedger.add(result.requestId, continuation.recoveryEvidence);
              if (continuation.browserDropped) {
                recoveryLedger.settle(
                  result.requestId,
                  attemptedRecoveryIds,
                  "abandoned",
                );
                if (attemptedRecoveryIds.length > 0) {
                  recoveryLedger.settle(
                    result.requestId,
                    decoderFailureIds,
                    "abandoned",
                  );
                  continuationEndedEarly = true;
                  break;
                }
                continue;
              }
              const nextLesson: NormalizedLesson = {
                ...resolvedLesson,
                schemaVersion: "1.4",
                steps: [...resolvedLesson.steps, continuation.step],
              };
              premeasureLessonRoots(measurementCacheRef.current!, [continuation.step]);
              const nextPrepared = resolvedRendererRef.current!.prepareLesson(
                nextLesson,
                renderContext,
              );
              const newOpIds = new Set(continuation.step.ops.map((op) => op.id));
              const newFailures = recoveryEvidenceFromRenderer(
                result.requestId,
                nextLesson,
                nextPrepared,
              ).filter((finding) =>
                finding.affectedElementIds.some((id) => newOpIds.has(id)),
              );
              const recoveryFailed =
                continuation.recoveryEvidence.length > 0 || newFailures.length > 0;
              recoveryLedger.settle(
                result.requestId,
                attemptedRecoveryIds,
                recoveryFailed ? "abandoned" : "recovered",
              );
              recoveryLedger.add(result.requestId, newFailures);
              if (attemptedRecoveryIds.length > 0 && recoveryFailed) {
                recoveryLedger.settle(
                  result.requestId,
                  [
                    ...decoderFailureIds,
                    ...newFailures.map((finding) => finding.findingId),
                  ],
                  "abandoned",
                );
              }
              resolvedLesson = nextLesson;
              setActiveLesson({
                lesson: resolvedLesson,
                requestId: result.requestId,
                complete: false,
                source: "live",
                ...(renderContext ? { renderContext } : {}),
              });
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") return;
              logEngine(
                "cont✗",
                `continuation failed (${error instanceof Error ? error.name : "error"}); finishing with accepted prefix`,
              );
              recoveryLedger.settle(
                result.requestId,
                attemptedRecoveryIds,
                "abandoned",
              );
              continuationEndedEarly = true;
              break;
            }
          }
          if (recoveryLedger.pendingIds().length > 0) {
            recoveryLedger.abandonAll(result.requestId);
            continuationEndedEarly = true;
          }
        } else if (result.continuationAvailable) {
          continuationEndedEarly = true;
        }
        if (activeGenerationTokenRef.current !== result.requestId) return;
        setActiveLesson({
          lesson: resolvedLesson,
          requestId: result.requestId,
          complete: true,
          source: "live",
          ...(renderContext ? { renderContext } : {}),
        });
        setGeneration({
          status: "ready",
          ...(result.partial || continuationEndedEarly
            ? { message: "Generation ended early; Chalk is continuing with the accepted validated steps." }
            : {}),
          warnings: result.warnings,
          repairs,
          droppedSteps: result.droppedSteps,
          browserDroppedSteps: result.browserDroppedSteps,
          sanitizedSteps: result.sanitizedSteps,
          sanitizedFields: result.sanitizedFields,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (activeGenerationTokenRef.current !== requestId) return;
        measurementCacheRef.current!.beginLesson();
        const fallbackRequestId = crypto.randomUUID();
        const fallbackLesson = CACHED_LESSONS[pickCachedLessonKey(normalizedTopic)];
        logEngine(
          "lesson✗",
          `live generation failed (${error instanceof Error ? error.message.slice(0, 100) : "unknown"}) · ` +
            `cached fallback "${fallbackLesson.title}"`,
        );
        setActiveLesson({
          lesson: fallbackLesson,
          requestId: fallbackRequestId,
          complete: true,
          source: "cached",
        });
        setAutoStartRequestId(fallbackRequestId);
        setGeneration({
          status: "fallback",
          message: `Live generation was unavailable, so Chalk loaded the cached lesson “${fallbackLesson.title}”.`,
          warnings: 0,
          repairs: 0,
          droppedSteps: 0,
          browserDroppedSteps: 0,
          sanitizedSteps: 0,
          sanitizedFields: 0,
        });
      })
      .finally(() => {
        if (activeGenerationTokenRef.current === requestId) {
          activeGenerationTokenRef.current = undefined;
        }
      });
    return requestId;
  };

  const useCachedLesson = () => {
    lessonStreamRef.current?.cancel();
    lessonContinuationRef.current?.cancel();
    measurementCacheRef.current!.beginLesson();
    const requestId = crypto.randomUUID();
    setActiveLesson({
      lesson: CACHED_LESSONS[cachedLessonKey],
      requestId,
      complete: true,
      source: "cached",
    });
    setGeneration({
      status: "idle",
      warnings: 0,
      repairs: 0,
      droppedSteps: 0,
      browserDroppedSteps: 0,
      sanitizedSteps: 0,
      sanitizedFields: 0,
    });
    generationTimingRef.current = undefined;
    setGenerationTiming(undefined);
    setM3CopyState("idle");
    setAutoStartRequestId(requestId);
  };

  const reviewCapturedLesson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = decodeLessonNdjson(await file.text());
      lessonStreamRef.current?.cancel();
      measurementCacheRef.current!.beginLesson();
      generationTimingRef.current = undefined;
      setGenerationTiming(undefined);
      setActiveLesson({
        lesson: result.lesson,
        requestId: result.requestId,
        complete: true,
        source: "review",
      });
      setReviewStepIndex(result.lesson.steps.length - 1);
      setAutoStartRequestId(undefined);
      setGeneration({
        status: "ready",
        message: "Captured validated lesson loaded locally for layout review; no API call was made.",
        warnings: result.warnings,
        repairs: result.repairs,
        droppedSteps: result.droppedSteps,
        browserDroppedSteps: result.browserDroppedSteps,
        sanitizedSteps: result.sanitizedSteps,
        sanitizedFields: result.sanitizedFields,
      });
    } catch {
      setGeneration((current) => ({
        ...current,
        message: "The captured lesson failed local stream or lesson validation.",
      }));
    }
  };

  teachHandlerRef.current = (requestedTopic, studentContext) => {
    if (
      snapshot.status !== "connected" ||
      activeGenerationTokenRef.current !== undefined ||
      !["IDLE", "DONE", "QA"].includes(lessonSync.state.phase)
    ) {
      throw new Error("A lesson is already active.");
    }
    return { requestId: generateLesson(requestedTopic, studentContext) };
  };

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(
        serializeRedactedTrace(snapshot.trace, snapshot.interruptions, {
          model: snapshot.sessionModel,
          voice: snapshot.sessionVoice,
          browser: navigator.userAgent,
          tokenUsage: snapshot.tokenUsage,
          tokenBudget: snapshot.tokenBudget,
          contextPublications: snapshot.contextPublications,
          visibleManifestHash,
          lastAcknowledgedManifestHash: snapshot.lastAcknowledgedManifestHash,
        }),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const recordFirstVisibleInk = useCallback(
    (measurementId: string, observedAtMs: number) => {
      const currentTiming = generationTimingRef.current;
      if (
        currentTiming?.requestId !== measurementId ||
        currentTiming.firstVisibleInkAtMs !== undefined
      ) {
        return;
      }
      const updatedTiming = { ...currentTiming, firstVisibleInkAtMs: observedAtMs };
      generationTimingRef.current = updatedTiming;
      setGenerationTiming(updatedTiming);
    },
    [],
  );

  const copyM3Timing = async () => {
    if (!generationTiming) return;
    const firstStepMs = elapsed(
      generationTiming.requestedAtMs,
      generationTiming.firstValidStepAtMs,
    );
    const firstVisibleMs = elapsed(
      generationTiming.requestedAtMs,
      generationTiming.firstVisibleInkAtMs,
    );
    const stepToInkMs = elapsed(
      generationTiming.firstValidStepAtMs,
      generationTiming.firstVisibleInkAtMs,
    );
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            schema: "chalk.m3-browser-timing.v1",
            generated_at: new Date().toISOString(),
            request_id_suffix: generationTiming.requestId.slice(-8),
            board_model: generationTiming.boardModel ?? null,
            board_reasoning_effort: generationTiming.boardReasoningEffort ?? null,
            board_prompt_sha256: generationTiming.boardPromptSha256 ?? null,
            repair_prompt_sha256: generationTiming.repairPromptSha256 ?? null,
            request_to_first_valid_step_ms: firstStepMs,
            first_valid_step_to_first_visible_ink_ms: stepToInkMs,
            request_to_first_visible_ink_ms: firstVisibleMs,
            accepted_steps: generationTiming.acceptedSteps ?? null,
            repairs: generationTiming.repairs ?? null,
            dropped_steps: generationTiming.droppedSteps ?? null,
            sanitized_steps: generationTiming.sanitizedSteps ?? null,
            sanitized_fields: generationTiming.sanitizedFields ?? null,
            partial: generationTiming.partial ?? null,
          },
          null,
          2,
        ),
      );
      setM3CopyState("copied");
    } catch {
      setM3CopyState("failed");
    }
  };

  const setPerceivedStop = (markerId: string, value: PerceivedAudioStop) => {
    clientRef.current?.updatePerceivedAudioStop(markerId, value);
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">
            {isDiagnostics ? "Diagnostics · deterministic board" : "Live visual tutoring"}
          </p>
          <h1>CHALK</h1>
          <p className="tagline">Live voice tutoring on an intelligent whiteboard.</p>
        </div>
        <StatusPill status={snapshot.status} />
      </header>

      <div className="teaching-console">
      <section className="lesson-stage" aria-labelledby="lesson-title">
        <form
          className="topic-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              generateLesson(topic);
            } catch (error) {
              setGeneration({
                status: "fallback",
                message: error instanceof Error ? error.message : "Enter a valid topic.",
                warnings: 0,
                repairs: 0,
                droppedSteps: 0,
                browserDroppedSteps: 0,
                sanitizedSteps: 0,
                sanitizedFields: 0,
              });
            }
          }}
        >
          <label htmlFor="lesson-topic">Ask Chalk to teach</label>
          <div>
            <input
              id="lesson-topic"
              value={topic}
              maxLength={80}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="A math or physics topic"
            />
            <button
              className="primary"
              type="submit"
              disabled={
                snapshot.status !== "connected" ||
                generation.status === "generating" ||
                !["IDLE", "DONE"].includes(lessonSync.state.phase) ||
                realtimeResponseBusy
              }
            >
              {generation.status === "generating" ? "Preparing…" : "Create lesson"}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={useCachedLesson}
            >
              Use demo lesson
            </button>
            <select
              aria-label="Cached lesson"
              value={cachedLessonKey}
              onChange={(event) => setCachedLessonKey(event.target.value as CachedLessonKey)}
            >
              <option value="projectile">Projectile range</option>
              <option value="derivative">Derivative as slope</option>
              <option value="unit-circle">Unit circle to sine</option>
            </select>
          </div>
          {generation.message ? <p role="status">{generation.message}</p> : null}
        </form>
        <div className="lesson-heading">
          <div>
            <p className="eyebrow">
              {isDiagnostics
                ? `${activeLesson.source} lesson · ${activeLesson.complete ? "complete" : "streaming"}`
                : activeLesson.source === "live"
                  ? "Live generated lesson"
                  : "Demo lesson"}
            </p>
            <h2 id="lesson-title">{activeLesson.lesson.title}</h2>
          </div>
          <div className="lesson-actions">
            <button
              className="primary"
              type="button"
              onClick={startLesson}
              disabled={
                snapshot.status !== "connected" ||
                realtimeResponseBusy ||
                !["IDLE", "DONE"].includes(lessonSync.state.phase)
              }
            >
              {lessonSync.state.phase === "DONE" ? "Replay lesson" : "Start lesson"}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={resumeLesson}
              disabled={
                lessonSync.state.phase !== "QA" ||
                snapshot.status !== "connected" ||
                realtimeResponseBusy
              }
            >
              Resume frozen step
            </button>
          </div>
        </div>
        <Board
          lesson={activeLesson.lesson}
          currentStepIndex={
            activeLesson.source === "review"
              ? reviewStepIndex
              : isOfflineCachedPreview
                ? activeLesson.lesson.steps.length - 1
              : lessonSync.state.currentStepIndex
          }
          currentStepProgress={
            activeLesson.source === "review" || isOfflineCachedPreview
              ? 1
              : lessonSync.state.currentStepProgress
          }
          phase={
            activeLesson.source === "review"
              ? "REVIEW"
              : isOfflineCachedPreview
                ? "STATIC PREVIEW"
                : lessonSync.state.phase
          }
          onVisibleStateChange={handleVisibleStateChange}
          overlays={ATTENTION_CHOREOGRAPHY ? attentionOverlays : deixisOverlays}
          annotations={annotationOps}
          measurementId={activeLesson.source === "live" ? activeLesson.requestId : undefined}
          measurementCache={measurementCacheRef.current}
          onFirstVisibleInk={recordFirstVisibleInk}
          showDiagnostics={isDiagnostics}
          renderContext={activeLesson.renderContext}
        />
        {isDiagnostics && activeLesson.source === "review" ? (
          <div className="review-controls" aria-label="Captured lesson review controls">
            <button
              className="secondary"
              type="button"
              onClick={() => setReviewStepIndex((index) => Math.max(0, index - 1))}
              disabled={reviewStepIndex === 0}
            >
              Previous step
            </button>
            <span>
              Showing through step {reviewStepIndex + 1} / {activeLesson.lesson.steps.length}
            </span>
            <button
              className="secondary"
              type="button"
              onClick={() =>
                setReviewStepIndex((index) =>
                  Math.min(activeLesson.lesson.steps.length - 1, index + 1),
                )
              }
              disabled={reviewStepIndex >= activeLesson.lesson.steps.length - 1}
            >
              Next step
            </button>
          </div>
        ) : null}
        {contextError ? <p className="error" role="alert">{contextError}</p> : null}
        {isDiagnostics && activeLesson.source === "live" ? (
          <div className="stream-note">
            <span>
              {activeLesson.lesson.steps.length} accepted step{activeLesson.lesson.steps.length === 1 ? "" : "s"}
              {activeLesson.complete ? " · stream complete" : " · more steps may arrive"}
              {generation.repairs ? ` · ${generation.repairs} repairs` : ""}
              {generation.droppedSteps ? ` · ${generation.droppedSteps} dropped` : ""}
              {generation.browserDroppedSteps
                ? ` · ${generation.browserDroppedSteps} browser-dropped`
                : ""}
              {generation.sanitizedSteps
                ? ` · ${generation.sanitizedSteps} sanitized (${generation.sanitizedFields} fields)`
                : ""}
              {generationTiming?.firstValidStepAtMs
                ? ` · first step ${elapsed(generationTiming.requestedAtMs, generationTiming.firstValidStepAtMs)} ms`
                : ""}
              {generationTiming?.firstVisibleInkAtMs
                ? ` · first ink ${elapsed(generationTiming.requestedAtMs, generationTiming.firstVisibleInkAtMs)} ms`
                : ""}
            </span>
            <button
              className="trace-copy"
              type="button"
              onClick={() => void copyM3Timing()}
              disabled={!generationTiming?.firstVisibleInkAtMs || !activeLesson.complete}
            >
              {m3CopyState === "copied"
                ? "Timing copied"
                : m3CopyState === "failed"
                  ? "Copy failed"
                  : "Copy M3 timing"}
            </button>
          </div>
        ) : null}
        {isDiagnostics && activeLesson.source !== "review" ? (
          <div className="sync-strip" aria-label="Fixed synchronization status">
            <span><strong>{lessonSync.state.phase}</strong> fixed sync</span>
            <div className="sync-track" aria-hidden="true">
              <span style={{ width: `${lessonSync.state.currentStepProgress * 100}%` }} />
            </div>
            <span>{Math.round(lessonSync.state.currentStepProgress * 100)}% current step</span>
            <span><strong>{lessonSync.state.completedRuns} / 3</strong> completed runs</span>
            <span>
              grounding {snapshot.lastAcknowledgedManifestHash === visibleManifestHash ? "acknowledged" : "pending"}
            </span>
            {lessonSync.state.ignoredEvents > 0 ? <span>{lessonSync.state.ignoredEvents} stale/invalid events ignored</span> : null}
          </div>
        ) : null}
        {engineFeed.length > 0 ? (
          <details className="engine-feed" open={isDiagnostics}>
            <summary>
              Board engine feed · {engineFeed.length} event{engineFeed.length === 1 ? "" : "s"}
            </summary>
            <div className="engine-feed-toolbar">
              <button
                className="secondary"
                type="button"
                onClick={() => setEngineFeed([])}
              >
                Clear feed
              </button>
            </div>
            <ol className="engine-feed-rows">
              {[...engineFeed].reverse().map((event) => (
                <li key={event.id}>
                  <span className="engine-feed-time">
                    +{((event.atMs - engineFeed[0].atMs) / 1000).toFixed(1)}s
                  </span>
                  <span className={`engine-feed-kind ${event.kind.endsWith("✗") ? "engine-feed-fail" : ""}`}>
                    {event.kind}
                  </span>
                  <span className="engine-feed-message">{event.message}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {activeLesson.source === "review" ? (
          <p className="lesson-hint">
            Local review mode shows all accepted geometry through the selected step. Capture the board and record the human layout verdict in the evaluation summary.
          </p>
        ) : snapshot.status !== "connected" ? (
          null
        ) : lessonSync.state.phase === "TEACHING" ? (
          <p className="lesson-hint lesson-hint-live">Interrupt while a stroke is moving. The ink should remain exactly where it stopped.</p>
        ) : lessonSync.state.phase === "QA" ? (
          <p className="lesson-hint lesson-hint-frozen">Ink frozen. Ask your question, then use “Resume frozen step” when ready.</p>
        ) : lessonSync.state.phase === "CHECKPOINT_ASKING" ? (
          <p className="lesson-hint lesson-hint-live">
            Chalk has a quick check before moving on.
          </p>
        ) : lessonSync.state.phase === "CHECKPOINT_LISTENING" ? (
          <p className="lesson-hint lesson-hint-live">
            Your turn: {activeCheckpoint?.question}
          </p>
        ) : lessonSync.state.phase === "CHECKPOINT_FEEDBACK" ? (
          <p className="lesson-hint lesson-hint-live">
            Chalk is responding to your answer.
          </p>
        ) : lessonSync.state.phase === "GENERATING" ? (
          <p className="lesson-hint lesson-hint-live">Chalk is validating the next board step.</p>
        ) : null}
      </section>

      <section className="voice-stage" aria-labelledby="voice-title">
        <button
          className={`orb-control ${
            lessonSync.state.phase === "CHECKPOINT_ASKING" ||
            lessonSync.state.phase === "CHECKPOINT_LISTENING"
              ? "orb-control-asking"
              : ""
          }`}
          type="button"
          onClick={activateVoiceOrb}
          disabled={isBusy || snapshot.status === "disconnecting"}
          aria-label={
            snapshot.status !== "connected"
              ? "Connect to Chalk"
              : snapshot.microphoneEnabled
                ? "Stop listening"
                : "Talk to Chalk"
          }
          aria-pressed={snapshot.status === "connected" && snapshot.microphoneEnabled}
        >
          <span
            className={`orb ${snapshot.audioPlaybackActive ? "orb-speaking" : ""} ${snapshot.microphoneEnabled ? "orb-listening" : ""}`}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="voice-copy">
          <h2 id="voice-title">
            {snapshot.status === "connected"
              ? snapshot.audioPlaybackActive
                ? "Chalk is speaking"
                : snapshot.microphoneEnabled
                  ? "Listening to you"
                  : "Microphone paused"
              : "Voice is offline"}
          </h2>
          <p>
            {snapshot.status === "connected"
              ? snapshot.microphoneEnabled
                ? "Speak now. The microphone pauses automatically when your turn ends."
                : "Click the orb or press Space when you want to answer or interrupt Chalk."
              : "Click the orb to connect."}
          </p>
          <div className="button-row">
            {canDisconnect ? (
              <button className="voice-disconnect" type="button" onClick={disconnect}>
                Disconnect
              </button>
            ) : null}
          </div>
          {snapshot.lastError ? (
            <p className="error" role="alert">{snapshot.lastError}</p>
          ) : null}
        </div>
      </section>
      </div>

      {isDiagnostics ? (
        <>
          <section className="panel evaluation-import" aria-labelledby="evaluation-import-title">
            <div>
              <p className="eyebrow">M3 evidence review</p>
              <h2 id="evaluation-import-title">Review captured lesson without regenerating</h2>
            </div>
            <label>
              Captured `.ndjson` file
              <input
                type="file"
                accept=".ndjson,application/x-ndjson"
                onChange={(event) => {
                  void reviewCapturedLesson(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </section>
          <section className="metrics" aria-label="Realtime diagnostics">
        <Metric
          label="Settled interruption streak"
          value={`${snapshot.consecutiveSuccessfulInterruptions} / 5`}
          detail="Counts settled cancellations with no post-freeze output metadata, not raw speech-start events."
          pass={snapshot.consecutiveSuccessfulInterruptions >= 5}
        />
        <Metric
          label="Dummy tool round trips"
          value={String(snapshot.toolRoundTrips)}
          detail='Say: “Use debug echo and echo hello.”'
          pass={snapshot.toolRoundTrips > 0}
        />
        <Metric
          label="Session"
          value={snapshot.sessionModel ?? "Not connected"}
          detail={
            snapshot.sessionVoice
              ? `Voice: ${snapshot.sessionVoice} · sync: ${snapshot.syncMode ?? "unknown"}`
              : "Voice and sync mode set by the backend"
          }
          pass={snapshot.status === "connected"}
        />
        <Metric
          label="Session token budget"
          value={`${snapshot.tokenUsage.total_tokens.toLocaleString()} / ${snapshot.tokenBudget.toLocaleString()}`}
          detail={`${snapshot.tokenUsage.input_tokens.toLocaleString()} input · ${snapshot.tokenUsage.output_tokens.toLocaleString()} output · auto-disconnect at limit`}
          pass={snapshot.tokenUsage.total_tokens < snapshot.tokenBudget}
        />
          </section>

          <section className="evidence-grid">
        <article className="panel interruptions-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Manual + measured evidence</p>
              <h2>Interruptions</h2>
            </div>
            <span className="count">{snapshot.interruptions.length}</span>
          </div>
          <p className="panel-note">
            Handler-state stop latency measures only the synchronous local state mutation at event receipt. It is not rendered-animation or audible-stop latency; perceived audio stop is recorded separately.
          </p>
          {snapshot.interruptions.length === 0 ? (
            <EmptyState>Interrupt an active response to create the first marker.</EmptyState>
          ) : (
            <ol className="interruption-list">
              {[...snapshot.interruptions].reverse().map((marker, reverseIndex) => (
                <li key={marker.id}>
                  <div className="marker-title">
                    <strong>Run {snapshot.interruptions.length - reverseIndex}</strong>
                    <span className={`settlement settlement-${marker.settlement}`}>{marker.settlement}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Handler-state stop</dt>
                      <dd>{marker.local_handler_stop_latency_ms.toFixed(1)} ms</dd>
                    </div>
                    <div>
                      <dt>Possible stale output events</dt>
                      <dd>{marker.stale_output_events}</dd>
                    </div>
                  </dl>
                  <label>
                    Perceived audio stop
                    <select
                      value={marker.perceived_audio_stop}
                      onChange={(event) =>
                        setPerceivedStop(marker.id, event.target.value as PerceivedAudioStop)
                      }
                    >
                      <option value="not-recorded">Not recorded</option>
                      <option value="immediate">Immediate</option>
                      <option value="short-tail">Short audible tail</option>
                      <option value="long-tail">Long audible tail</option>
                    </select>
                  </label>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="panel trace-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Metadata only</p>
              <h2>Redacted event trace</h2>
            </div>
            <button className="trace-copy" type="button" onClick={copyTrace} disabled={snapshot.trace.length === 0}>
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy trace"}
            </button>
          </div>
          <p className="panel-note">
            Transcript text, audio, tool arguments, authorization values, and client secrets are never retained here.
          </p>
          {recentTrace.length === 0 ? (
            <EmptyState>Connection events will appear here without their content.</EmptyState>
          ) : (
            <div className="trace-list" role="log" aria-live="polite">
              {recentTrace.map((entry) => (
                <TraceRow key={`${entry.sequence}-${entry.type}`} entry={entry} />
              ))}
            </div>
          )}
        </article>

        <article className="panel response-diagnostics-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Response state machine</p>
              <h2>Voice response ledger</h2>
            </div>
            <span className="count">{snapshot.responseDiagnostics.length}</span>
          </div>
          <p className="panel-note">
            This shows where a response stopped: registered, created, audio started,
            generation finished, playback stopped, or terminal failure. IDs and timing
            only—no transcript or audio is retained.
          </p>
          {snapshot.responseDiagnostics.length === 0 ? (
            <EmptyState>Start a response to capture its lifecycle.</EmptyState>
          ) : (
            <ol className="response-ledger" role="log" aria-live="polite">
              {[...snapshot.responseDiagnostics].reverse().map((response) => (
                <ResponseDiagnosticRow key={response.key} response={response} />
              ))}
            </ol>
          )}
        </article>
          </section>
        </>
      ) : null}
      {scratchCard ? (
        <ScratchWindow lesson={scratchCard} onClose={() => setScratchCard(undefined)} />
      ) : null}
    </main>
  );
}

function StatusPill({ status }: { status: RealtimeSnapshot["status"] }) {
  return (
    <div className={`status-pill status-${status}`} aria-live="polite">
      <span aria-hidden="true" />
      {status.replaceAll("-", " ")}
    </div>
  );
}

function ResponseDiagnosticRow({ response }: { response: ResponseDiagnostic }) {
  const createdToAudio = duration(response.created_at_ms, response.audio_started_at_ms);
  const audioToGeneration = duration(response.audio_started_at_ms, response.generation_done_at_ms);
  const generationToStop = duration(response.generation_done_at_ms, response.playback_stopped_at_ms);
  const registeredToCreated = duration(response.registered_at_ms, response.created_at_ms);
  const diagnosis = response.failure_code
    ? response.failure_code
    : response.stage === "registered"
      ? "waiting for response.created"
      : response.stage === "created"
        ? "created, but no audio activity yet"
        : response.stage === "audio_started"
          ? "audio active; waiting for generation/playback settlement"
          : response.stage === "generation_done"
            ? "generation ended; waiting for output audio stop"
            : response.stage === "playback_stopped"
              ? "playback stopped; waiting for terminal cleanup"
              : response.stage;
  return (
    <li className={`response-ledger-row response-stage-${response.stage}`}>
      <div className="marker-title">
        <strong>{response.purpose}</strong>
        <span className="settlement">{response.stage}</span>
      </div>
      <p className="response-diagnosis">{diagnosis}</p>
      <dl>
        <div><dt>Response</dt><dd>{response.response_id ?? "not created"}</dd></div>
        <div><dt>Registered → created</dt><dd>{formatDuration(registeredToCreated)}</dd></div>
        <div><dt>Created → audio</dt><dd>{formatDuration(createdToAudio)}</dd></div>
        <div><dt>Audio → generation done</dt><dd>{formatDuration(audioToGeneration)}</dd></div>
        <div><dt>Generation → playback stop</dt><dd>{formatDuration(generationToStop)}</dd></div>
      </dl>
      {response.request_id && response.step_id ? (
        <small>step {response.step_id} · cycle {response.cycle ?? "?"}</small>
      ) : null}
    </li>
  );
}

function duration(start?: number, end?: number): number | undefined {
  if (start === undefined || end === undefined) return undefined;
  return Math.max(0, end - start);
}

function formatDuration(value?: number): string {
  return value === undefined ? "—" : `${value.toFixed(0)} ms`;
}

function Metric({
  label,
  value,
  detail,
  pass,
}: {
  label: string;
  value: string;
  detail: string;
  pass: boolean;
}) {
  return (
    <article className={`metric ${pass ? "metric-pass" : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  const usage =
    entry.total_tokens === undefined
      ? undefined
      : `${entry.total_tokens.toLocaleString()} tokens`;
  const metadata = [entry.status, entry.response_id, entry.call_id, entry.code, usage]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="trace-row">
      <time>{entry.at_ms.toFixed(1)} ms</time>
      <span className={`direction direction-${entry.direction}`}>{entry.direction}</span>
      <code>{entry.type}</code>
      {metadata ? <small>{metadata}</small> : null}
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="empty-state">{children}</p>;
}

function elapsed(start: number | undefined, end: number | undefined): number | null {
  if (start === undefined || end === undefined || end < start) return null;
  return Math.round((end - start) * 10) / 10;
}

export default App;
