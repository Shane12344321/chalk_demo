import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  estimateNarrationDuration,
  pacedAnimationRate,
} from "../board/animation";
import type { NormalizedLesson } from "../board/decode";
import type {
  ConnectionStatus,
  RealtimeClient,
  RealtimeSemanticEvent,
  SyncMode,
} from "../realtime";
import {
  EMPTY_SYNC_STATE,
  fixedSyncReducer,
  type FixedSyncEvent,
  type FixedSyncState,
} from "./reducer";

const AUDIO_DRAIN_GUARD_MS = 260;
const AUDIO_STOP_FINISH_MS = 400;

interface UseFixedLessonSyncOptions {
  lesson: NormalizedLesson;
  lessonRequestId?: string;
  lessonComplete?: boolean;
  clientRef: React.MutableRefObject<RealtimeClient | undefined>;
  connectionStatus: ConnectionStatus;
  responseIdle: boolean;
  syncMode?: SyncMode;
}

export function useFixedLessonSync({
  lesson,
  lessonRequestId,
  lessonComplete = true,
  clientRef,
  connectionStatus,
  responseIdle,
  syncMode = "fixed",
}: UseFixedLessonSyncOptions) {
  const fallbackRequestIdRef = useRef<string>();
  if (!fallbackRequestIdRef.current) fallbackRequestIdRef.current = crypto.randomUUID();
  const requestId = lessonRequestId ?? fallbackRequestIdRef.current;
  const [state, dispatch] = useReducer(fixedSyncReducer, EMPTY_SYNC_STATE);
  const stateRef = useRef(state);
  const narrationKeyRef = useRef<string>();
  const checkpointKeyRef = useRef<string>();
  const wasConnectedRef = useRef(false);
  const loadedRequestIdRef = useRef<string>();
  const loadedStepIdsRef = useRef<string[]>([]);
  stateRef.current = state;

  useEffect(() => {
    const stepIds = lesson.steps.map((step) => step.id);
    const checkpointStepIds = lesson.steps
      .filter((step) => step.checkpoint !== null)
      .map((step) => step.id);
    if (loadedRequestIdRef.current !== requestId) {
      narrationKeyRef.current = undefined;
      checkpointKeyRef.current = undefined;
      loadedRequestIdRef.current = requestId;
      loadedStepIdsRef.current = stepIds;
      dispatch({
        type: "LOAD",
        requestId,
        stepIds,
        checkpointStepIds,
        sourceComplete: lessonComplete,
      });
      return;
    }
    if (
      stepIds.length !== loadedStepIdsRef.current.length ||
      stepIds.some((id, index) => loadedStepIdsRef.current[index] !== id)
    ) {
      loadedStepIdsRef.current = stepIds;
      dispatch({ type: "APPEND_STEPS", requestId, stepIds, checkpointStepIds });
    }
    if (lessonComplete) dispatch({ type: "SOURCE_DONE", requestId });
  }, [lesson.steps, lessonComplete, requestId]);

  useEffect(() => {
    if (connectionStatus === "connected") {
      wasConnectedRef.current = true;
      return;
    }
    if (
      wasConnectedRef.current &&
      [
        "TEACHING",
        "FROZEN",
        "QA",
        "CHECKPOINT_ASKING",
        "CHECKPOINT_LISTENING",
        "CHECKPOINT_FEEDBACK",
      ].includes(state.phase)
    ) {
      narrationKeyRef.current = undefined;
      checkpointKeyRef.current = undefined;
      dispatch({ type: "RESET", requestId });
    }
  }, [connectionStatus, requestId, state.phase]);

  useEffect(() => {
    if (state.phase !== "TEACHING") return;
    if (connectionStatus !== "connected" || !responseIdle) return;
    const step = lesson.steps[state.currentStepIndex];
    if (!step) return;
    const key = `${state.requestId}:${step.id}:${state.cycle}`;
    if (narrationKeyRef.current === key) return;
    narrationKeyRef.current = key;
    let cancelled = false;
    const context = correlationFor(state);
    void (async () => {
      try {
        await clientRef.current?.setInteractionGuidance(undefined);
        if (cancelled || stateRef.current.phase !== "TEACHING") return;
        clientRef.current?.requestNarration(step.script, context);
      } catch {
        narrationKeyRef.current = undefined;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientRef, connectionStatus, lesson.steps, responseIdle, state]);

  useEffect(() => {
    if (state.phase !== "CHECKPOINT_ASKING") return;
    if (connectionStatus !== "connected" || !responseIdle) return;
    const step = lesson.steps[state.currentStepIndex];
    const checkpoint = step?.checkpoint;
    if (!step || !checkpoint) return;
    const key = `${state.requestId}:checkpoint:${step.id}:${state.cycle}`;
    if (checkpointKeyRef.current === key) return;
    checkpointKeyRef.current = key;
    let cancelled = false;
    const context = correlationFor(state);
    void (async () => {
      try {
        await clientRef.current?.setInteractionGuidance(undefined);
        if (cancelled || stateRef.current.phase !== "CHECKPOINT_ASKING") return;
        clientRef.current?.requestCheckpointPrompt(checkpoint.question, context);
      } catch {
        checkpointKeyRef.current = undefined;
        dispatch({ type: "CHECKPOINT_FAILED", ...context });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientRef, connectionStatus, lesson.steps, responseIdle, state]);

  useEffect(() => {
    const initial = stateRef.current;
    if (
      initial.phase !== "TEACHING" ||
      !initial.animationStarted ||
      initial.animationDone
    ) {
      return;
    }
    const step = lesson.steps[initial.currentStepIndex];
    if (!step) return;
    const duration = estimateNarrationDuration(step.script);
    const correlation = correlationFor(initial);
    let lastFrameAt = performance.now();
    let finishStartedAt: number | undefined;
    let finishStartProgress = 0;
    let frame = 0;
    const tick = (now: number) => {
      const current = stateRef.current;
      if (
        current.phase !== "TEACHING" ||
        current.requestId !== correlation.requestId ||
        current.stepIds[current.currentStepIndex] !== correlation.stepId ||
        current.cycle !== correlation.cycle ||
        current.animationDone
      ) {
        return;
      }

      let progress: number;
      if (current.audioStopped) {
        if (finishStartedAt === undefined) {
          finishStartedAt = now;
          finishStartProgress = current.currentStepProgress;
        }
        const finishFraction = (now - finishStartedAt) / AUDIO_STOP_FINISH_MS;
        progress =
          finishStartProgress +
          Math.min(1, finishFraction) * (1 - finishStartProgress);
      } else {
        const elapsed = Math.max(0, now - lastFrameAt);
        const rate =
          syncMode === "paced"
            ? pacedAnimationRate(
                Math.min(0.95, current.transcriptProgress),
                current.currentStepProgress,
              )
            : 1;
        progress = current.currentStepProgress + (elapsed / duration) * rate;
      }
      lastFrameAt = now;
      dispatch(correlatedTick(correlation, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    lesson.steps,
    state.animationDone,
    state.animationStarted,
    state.currentStepIndex,
    state.cycle,
    state.phase,
    state.requestId,
    syncMode,
  ]);

  const onSemanticEvent = useCallback((event: RealtimeSemanticEvent) => {
    if (event.type === "student.speech_started") {
      const current = stateRef.current;
      const stepId = current.stepIds[current.currentStepIndex];
      if (!stepId) return;
      const correlation = {
        requestId: current.requestId,
        stepId,
        cycle: current.cycle,
      };
      if (current.phase === "TEACHING") {
        try {
          clientRef.current?.expectAutomaticResponse("student_qa", correlation);
        } catch {
          return;
        }
        dispatch({ type: "STUDENT_SPEECH_STARTED", ...correlation });
        queueMicrotask(() =>
          dispatch({ type: "INTERRUPTION_COMMITTED", ...correlation }),
        );
      } else if (
        current.phase === "CHECKPOINT_ASKING" ||
        current.phase === "CHECKPOINT_LISTENING"
      ) {
        try {
          clientRef.current?.expectAutomaticResponse(
            "checkpoint_feedback",
            correlation,
          );
          dispatch({
            type: "CHECKPOINT_STUDENT_SPEECH_STARTED",
            ...correlation,
          });
        } catch {
          dispatch({ type: "CHECKPOINT_FAILED", ...correlation });
        }
      }
      return;
    }

    const correlation = event.context;
    if (event.type === "narration.activity") {
      dispatch({ type: "NARRATION_ACTIVITY", ...correlation });
    } else if (event.type === "narration.transcript_progress") {
      const step = lesson.steps[stateRef.current.currentStepIndex];
      const scriptCharacters = step?.script.length ?? 0;
      if (scriptCharacters > 0) {
        dispatch({
          type: "NARRATION_PROGRESS",
          progress: event.generatedCharacters / scriptCharacters,
          ...correlation,
        });
      }
    } else if (event.type === "narration.generation_done") {
      dispatch({ type: "NARRATION_DONE", ...correlation });
    } else if (event.type === "narration.playback_stopped") {
      dispatch({ type: "AUDIO_STOPPED", ...correlation });
      window.setTimeout(() => {
        dispatch({ type: "DRAIN_ELAPSED", ...correlation });
      }, AUDIO_DRAIN_GUARD_MS);
    } else if (event.type === "narration.failed") {
      narrationKeyRef.current = undefined;
      // Only the narration the lesson is actively teaching may reset it. A
      // stale narration failed by the settlement watchdog while the student
      // is frozen in QA must not wipe the lesson out from under them; Resume
      // re-requests narration for the frozen step anyway.
      const current = stateRef.current;
      if (
        current.phase === "TEACHING" &&
        correlation.requestId === current.requestId &&
        correlation.cycle === current.cycle &&
        correlation.stepId === current.stepIds[current.currentStepIndex]
      ) {
        dispatch({ type: "RESET", requestId: correlation.requestId });
      }
    } else if (event.type === "checkpoint.prompt_activity") {
      dispatch({ type: "CHECKPOINT_PROMPT_ACTIVITY", ...correlation });
      const current = stateRef.current;
      const step = lesson.steps[current.currentStepIndex];
      const checkpoint = step?.checkpoint;
      if (
        checkpoint &&
        current.phase === "CHECKPOINT_ASKING" &&
        correlation.requestId === current.requestId &&
        correlation.stepId === step.id &&
        correlation.cycle === current.cycle
      ) {
        void clientRef.current
          ?.setInteractionGuidance(
            checkpointGuidance(checkpoint.question, checkpoint.expected_gist),
          )
          .catch(() => undefined);
      }
    } else if (event.type === "checkpoint.prompt_generation_done") {
      dispatch({ type: "CHECKPOINT_PROMPT_DONE", ...correlation });
    } else if (event.type === "checkpoint.prompt_playback_stopped") {
      dispatch({ type: "CHECKPOINT_PROMPT_AUDIO_STOPPED", ...correlation });
      window.setTimeout(() => {
        dispatch({ type: "CHECKPOINT_PROMPT_DRAIN_ELAPSED", ...correlation });
      }, AUDIO_DRAIN_GUARD_MS);
    } else if (event.type === "checkpoint.prompt_failed") {
      checkpointKeyRef.current = undefined;
      dispatch({ type: "CHECKPOINT_FAILED", ...correlation });
    } else if (event.type === "checkpoint.feedback_activity") {
      dispatch({ type: "CHECKPOINT_FEEDBACK_ACTIVITY", ...correlation });
    } else if (event.type === "checkpoint.feedback_generation_done") {
      dispatch({ type: "CHECKPOINT_FEEDBACK_DONE", ...correlation });
    } else if (event.type === "checkpoint.feedback_playback_stopped") {
      dispatch({ type: "CHECKPOINT_FEEDBACK_AUDIO_STOPPED", ...correlation });
      window.setTimeout(() => {
        dispatch({ type: "CHECKPOINT_FEEDBACK_DRAIN_ELAPSED", ...correlation });
      }, AUDIO_DRAIN_GUARD_MS);
    } else if (event.type === "checkpoint.feedback_failed") {
      dispatch({ type: "CHECKPOINT_FAILED", ...correlation });
    }
  }, [clientRef, lesson.steps]);

  const start = useCallback(() => {
    dispatch({ type: "START", requestId });
  }, [requestId]);

  const resume = useCallback(() => {
    const current = stateRef.current;
    const stepId = current.stepIds[current.currentStepIndex];
    if (!stepId) return;
    clientRef.current?.cancelExpectedAutomaticResponse("student_qa", {
      requestId: current.requestId,
      stepId,
      cycle: current.cycle,
    });
    dispatch({
      type: "RESUME",
      requestId: current.requestId,
      stepId,
      cycle: current.cycle,
    });
  }, [clientRef]);

  // A new topic during Q&A creates its request boundary immediately so every
  // late event from the interrupted lesson becomes stale before generation.
  const abort = useCallback((nextRequestId: string) => {
    const current = stateRef.current;
    const stepId = current.stepIds[current.currentStepIndex];
    if (stepId) {
      clientRef.current?.cancelExpectedAutomaticResponse("student_qa", {
        requestId: current.requestId,
        stepId,
        cycle: current.cycle,
      });
    }
    narrationKeyRef.current = undefined;
    checkpointKeyRef.current = undefined;
    dispatch({ type: "NEW_TOPIC", requestId: nextRequestId });
  }, [clientRef]);

  return { state, start, resume, abort, onSemanticEvent };
}

function correlatedTick(
  correlation: Pick<FixedSyncState, "requestId" | "cycle"> & { stepId: string },
  progress: number,
): Extract<FixedSyncEvent, { type: "TICK" }> {
  return {
    type: "TICK",
    progress,
    ...correlation,
  };
}

function correlationFor(state: FixedSyncState) {
  return {
    requestId: state.requestId,
    stepId: state.stepIds[state.currentStepIndex] ?? "",
    cycle: state.cycle,
  };
}

function checkpointGuidance(question: string, expectedGist: string): string {
  return `The student is answering the checkpoint question "${question}". Expected gist: "${expectedGist}". Respond in one brief sentence: acknowledge a correct answer or gently correct an incorrect one. Do not ask another question or mention Resume.`;
}
