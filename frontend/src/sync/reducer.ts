export type LessonPhase =
  | "IDLE"
  | "GENERATING"
  | "TEACHING"
  | "FROZEN"
  | "QA"
  | "CHECKPOINT_ASKING"
  | "CHECKPOINT_LISTENING"
  | "CHECKPOINT_FEEDBACK"
  | "DONE";

export interface FixedSyncState {
  phase: LessonPhase;
  requestId: string;
  stepIds: string[];
  checkpointStepIds: string[];
  completedCheckpointStepIds: string[];
  checkpointPromptFailures: number;
  currentStepIndex: number;
  currentStepProgress: number;
  cycle: number;
  animationStarted: boolean;
  animationDone: boolean;
  transcriptProgress: number;
  narrationDone: boolean;
  audioStopped: boolean;
  drainElapsed: boolean;
  ignoredEvents: number;
  completedRuns: number;
  sourceComplete: boolean;
}

interface CorrelatedEvent {
  requestId: string;
  stepId: string;
  cycle: number;
}

export type FixedSyncEvent =
  | { type: "NEW_TOPIC"; requestId: string }
  | {
      type: "LOAD";
      requestId: string;
      stepIds: string[];
      checkpointStepIds: string[];
      sourceComplete: boolean;
    }
  | {
      type: "APPEND_STEPS";
      requestId: string;
      stepIds: string[];
      checkpointStepIds: string[];
    }
  | { type: "SOURCE_DONE"; requestId: string }
  | { type: "START"; requestId: string }
  | ({ type: "NARRATION_ACTIVITY" } & CorrelatedEvent)
  | ({ type: "NARRATION_PROGRESS"; progress: number } & CorrelatedEvent)
  | ({ type: "TICK"; progress: number } & CorrelatedEvent)
  | ({ type: "NARRATION_DONE" } & CorrelatedEvent)
  | ({ type: "AUDIO_STOPPED" } & CorrelatedEvent)
  | ({ type: "DRAIN_ELAPSED" } & CorrelatedEvent)
  | ({ type: "STUDENT_SPEECH_STARTED" } & CorrelatedEvent)
  | ({ type: "INTERRUPTION_COMMITTED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_PROMPT_ACTIVITY" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_PROMPT_DONE" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_PROMPT_AUDIO_STOPPED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_PROMPT_DRAIN_ELAPSED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_STUDENT_SPEECH_STARTED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_FEEDBACK_ACTIVITY" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_FEEDBACK_DONE" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_FEEDBACK_AUDIO_STOPPED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_FEEDBACK_DRAIN_ELAPSED" } & CorrelatedEvent)
  | ({ type: "CHECKPOINT_FAILED" } & CorrelatedEvent)
  | ({ type: "RESUME" } & CorrelatedEvent)
  | { type: "RESET"; requestId: string }
  | { type: "NARRATION_RETRY"; requestId: string };

export const EMPTY_SYNC_STATE: FixedSyncState = {
  phase: "IDLE",
  requestId: "",
  stepIds: [],
  checkpointStepIds: [],
  completedCheckpointStepIds: [],
  checkpointPromptFailures: 0,
  currentStepIndex: 0,
  currentStepProgress: 0,
  cycle: 0,
  animationStarted: false,
  animationDone: false,
  transcriptProgress: 0,
  narrationDone: false,
  audioStopped: false,
  drainElapsed: false,
  ignoredEvents: 0,
  completedRuns: 0,
  sourceComplete: true,
};

export function fixedSyncReducer(
  state: FixedSyncState,
  event: FixedSyncEvent,
): FixedSyncState {
  if (event.type === "NEW_TOPIC") {
    return {
      ...EMPTY_SYNC_STATE,
      phase: "GENERATING",
      requestId: event.requestId,
      sourceComplete: false,
    };
  }
  if (event.type === "LOAD") {
    if (event.stepIds.length === 0) return ignored(state);
    const knownSteps = new Set(event.stepIds);
    return {
      ...EMPTY_SYNC_STATE,
      requestId: event.requestId,
      stepIds: [...event.stepIds],
      checkpointStepIds: [...new Set(event.checkpointStepIds)].filter((id) =>
        knownSteps.has(id),
      ),
      sourceComplete: event.sourceComplete,
    };
  }
  if (event.type === "APPEND_STEPS") {
    if (
      event.requestId !== state.requestId ||
      event.stepIds.length < state.stepIds.length ||
      new Set(event.stepIds).size !== event.stepIds.length ||
      !state.stepIds.every((id, index) => event.stepIds[index] === id)
    ) {
      return ignored(state);
    }
    const knownSteps = new Set(event.stepIds);
    const appended = {
      ...state,
      stepIds: [...event.stepIds],
      checkpointStepIds: [...new Set(event.checkpointStepIds)].filter((id) =>
        knownSteps.has(id),
      ),
    };
    if (
      state.phase === "GENERATING" &&
      state.currentStepIndex + 1 < event.stepIds.length
    ) {
      return teachingState(appended, state.currentStepIndex + 1, state.cycle + 1, 0);
    }
    return appended;
  }
  if (event.type === "SOURCE_DONE") {
    if (event.requestId !== state.requestId) return ignored(state);
    const completed = { ...state, sourceComplete: true };
    if (state.phase !== "GENERATING") return completed;
    if (state.currentStepIndex + 1 < state.stepIds.length) {
      return teachingState(completed, state.currentStepIndex + 1, state.cycle + 1, 0);
    }
    return finishLesson(completed);
  }
  if (event.type === "NARRATION_RETRY") {
    // Identity-only change: re-runs the narration effect after a refused
    // request without touching lesson progress.
    return event.requestId === state.requestId && state.phase === "TEACHING"
      ? { ...state }
      : ignored(state);
  }
  if (event.type === "RESET") {
    return event.requestId === state.requestId
      ? {
          ...EMPTY_SYNC_STATE,
          requestId: state.requestId,
          stepIds: state.stepIds,
          checkpointStepIds: state.checkpointStepIds,
          sourceComplete: state.sourceComplete,
        }
      : ignored(state);
  }
  if (event.type === "START") {
    if (event.requestId !== state.requestId || !["IDLE", "DONE"].includes(state.phase)) {
      return ignored(state);
    }
    return teachingState(
      { ...state, completedCheckpointStepIds: [] },
      0,
      state.cycle + 1,
      0,
    );
  }
  if (isStale(state, event)) return ignored(state);

  switch (event.type) {
    case "NARRATION_ACTIVITY":
      return state.phase === "TEACHING" ? { ...state, animationStarted: true } : ignored(state);
    case "NARRATION_PROGRESS":
      return state.phase === "TEACHING"
        ? {
            ...state,
            transcriptProgress: clamp(
              Math.max(state.transcriptProgress, event.progress),
            ),
          }
        : ignored(state);
    case "TICK": {
      if (state.phase !== "TEACHING" || !state.animationStarted) return ignored(state);
      const progress = clamp(Math.max(state.currentStepProgress, event.progress));
      return settleTeaching({
        ...state,
        currentStepProgress: progress,
        animationDone: progress >= 1,
      });
    }
    case "NARRATION_DONE":
      return state.phase === "TEACHING"
        ? settleTeaching({ ...state, narrationDone: true })
        : ignored(state);
    case "AUDIO_STOPPED":
      return state.phase === "TEACHING"
        ? settleTeaching({ ...state, animationStarted: true, audioStopped: true })
        : ignored(state);
    case "DRAIN_ELAPSED":
      return state.phase === "TEACHING" && state.audioStopped
        ? settleTeaching({ ...state, drainElapsed: true })
        : ignored(state);
    case "STUDENT_SPEECH_STARTED":
      return state.phase === "TEACHING" ? { ...state, phase: "FROZEN" } : ignored(state);
    case "INTERRUPTION_COMMITTED":
      return state.phase === "FROZEN" ? { ...state, phase: "QA" } : ignored(state);
    case "CHECKPOINT_PROMPT_ACTIVITY":
      return state.phase === "CHECKPOINT_ASKING" ? state : ignored(state);
    case "CHECKPOINT_PROMPT_DONE":
      return state.phase === "CHECKPOINT_ASKING"
        ? settleCheckpointPrompt({ ...state, narrationDone: true })
        : ignored(state);
    case "CHECKPOINT_PROMPT_AUDIO_STOPPED":
      return state.phase === "CHECKPOINT_ASKING"
        ? settleCheckpointPrompt({ ...state, audioStopped: true })
        : ignored(state);
    case "CHECKPOINT_PROMPT_DRAIN_ELAPSED":
      return state.phase === "CHECKPOINT_ASKING" && state.audioStopped
        ? settleCheckpointPrompt({ ...state, drainElapsed: true })
        : ignored(state);
    case "CHECKPOINT_STUDENT_SPEECH_STARTED":
      return ["CHECKPOINT_ASKING", "CHECKPOINT_LISTENING"].includes(state.phase)
        ? checkpointFeedbackState(state)
        : ignored(state);
    case "CHECKPOINT_FEEDBACK_ACTIVITY":
      return state.phase === "CHECKPOINT_FEEDBACK" ? state : ignored(state);
    case "CHECKPOINT_FEEDBACK_DONE":
      return state.phase === "CHECKPOINT_FEEDBACK"
        ? settleCheckpointFeedback({ ...state, narrationDone: true })
        : ignored(state);
    case "CHECKPOINT_FEEDBACK_AUDIO_STOPPED":
      return state.phase === "CHECKPOINT_FEEDBACK"
        ? settleCheckpointFeedback({ ...state, audioStopped: true })
        : ignored(state);
    case "CHECKPOINT_FEEDBACK_DRAIN_ELAPSED":
      return state.phase === "CHECKPOINT_FEEDBACK" && state.audioStopped
        ? settleCheckpointFeedback({ ...state, drainElapsed: true })
        : ignored(state);
    case "CHECKPOINT_FAILED":
      if (state.phase === "CHECKPOINT_ASKING") {
        return state.checkpointPromptFailures < 1
          ? checkpointAskingState(
              {
                ...state,
                cycle: state.cycle + 1,
                checkpointPromptFailures: state.checkpointPromptFailures + 1,
              },
              state.checkpointPromptFailures + 1,
            )
          : advanceAfterCheckpoint(state);
      }
      return ["CHECKPOINT_LISTENING", "CHECKPOINT_FEEDBACK"].includes(state.phase)
        ? advanceAfterCheckpoint(state)
        : ignored(state);
    case "RESUME":
      return state.phase === "QA"
        ? teachingState(
            state,
            state.currentStepIndex,
            state.cycle + 1,
            state.currentStepProgress,
          )
        : ignored(state);
    default:
      return ignored(state);
  }
}

function settleTeaching(state: FixedSyncState): FixedSyncState {
  if (
    !state.animationDone ||
    !state.narrationDone ||
    !state.audioStopped ||
    !state.drainElapsed
  ) {
    return state;
  }
  const currentStepId = state.stepIds[state.currentStepIndex];
  if (
    state.checkpointStepIds.includes(currentStepId) &&
    !state.completedCheckpointStepIds.includes(currentStepId)
  ) {
    return checkpointAskingState(state);
  }
  return advanceStep(state);
}

function settleCheckpointPrompt(state: FixedSyncState): FixedSyncState {
  if (!state.narrationDone || !state.audioStopped || !state.drainElapsed) return state;
  return {
    ...state,
    phase: "CHECKPOINT_LISTENING",
    narrationDone: false,
    audioStopped: false,
    drainElapsed: false,
  };
}

function settleCheckpointFeedback(state: FixedSyncState): FixedSyncState {
  if (!state.narrationDone || !state.audioStopped || !state.drainElapsed) return state;
  return advanceAfterCheckpoint(state);
}

function advanceAfterCheckpoint(state: FixedSyncState): FixedSyncState {
  const currentStepId = state.stepIds[state.currentStepIndex];
  return advanceStep({
    ...state,
    completedCheckpointStepIds: [...state.completedCheckpointStepIds, currentStepId],
  });
}

function advanceStep(state: FixedSyncState): FixedSyncState {
  const nextIndex = state.currentStepIndex + 1;
  if (nextIndex >= state.stepIds.length) {
    return state.sourceComplete
      ? finishLesson(state)
      : {
          ...state,
          phase: "GENERATING",
          currentStepProgress: 1,
          animationStarted: false,
          animationDone: true,
          narrationDone: false,
          audioStopped: false,
          drainElapsed: false,
        };
  }
  return teachingState(state, nextIndex, state.cycle + 1, 0);
}

function finishLesson(state: FixedSyncState): FixedSyncState {
  return {
    ...state,
    phase: "DONE",
    currentStepProgress: 1,
    completedRuns: state.completedRuns + 1,
  };
}

function checkpointAskingState(
  state: FixedSyncState,
  checkpointPromptFailures = 0,
): FixedSyncState {
  return {
    ...state,
    phase: "CHECKPOINT_ASKING",
    animationStarted: false,
    animationDone: true,
    narrationDone: false,
    audioStopped: false,
    drainElapsed: false,
    checkpointPromptFailures,
  };
}

function checkpointFeedbackState(state: FixedSyncState): FixedSyncState {
  return {
    ...state,
    phase: "CHECKPOINT_FEEDBACK",
    narrationDone: false,
    audioStopped: false,
    drainElapsed: false,
  };
}

function teachingState(
  state: FixedSyncState,
  stepIndex: number,
  cycle: number,
  progress: number,
): FixedSyncState {
  return {
    ...state,
    phase: "TEACHING",
    currentStepIndex: stepIndex,
    currentStepProgress: progress,
    cycle,
    animationStarted: false,
    animationDone: progress >= 1,
    transcriptProgress: 0,
    checkpointPromptFailures: 0,
    narrationDone: false,
    audioStopped: false,
    drainElapsed: false,
  };
}

function isStale(state: FixedSyncState, event: CorrelatedEvent): boolean {
  return (
    event.requestId !== state.requestId ||
    event.stepId !== state.stepIds[state.currentStepIndex] ||
    event.cycle !== state.cycle
  );
}

function ignored(state: FixedSyncState): FixedSyncState {
  return { ...state, ignoredEvents: state.ignoredEvents + 1 };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
