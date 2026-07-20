import type { LessonPhase } from "../sync/reducer";

/**
 * A scratch card may only be drawn in a conversational window. While the
 * board is generating, teaching, or running a checkpoint, a card popping over
 * moving ink would compete with the lesson instead of supporting it, so the
 * tool reports not_in_qa and the tutor answers with voice or pointing instead.
 */
const SCRATCH_PHASES: ReadonlySet<LessonPhase> = new Set([
  "IDLE",
  "FROZEN",
  "QA",
  "DONE",
]);

export function scratchAllowedInPhase(phase: LessonPhase): boolean {
  return SCRATCH_PHASES.has(phase);
}
