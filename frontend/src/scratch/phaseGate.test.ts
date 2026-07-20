import { describe, expect, it } from "vitest";
import type { LessonPhase } from "../sync/reducer";
import { scratchAllowedInPhase } from "./phaseGate";

describe("scratchAllowedInPhase", () => {
  it.each<LessonPhase>(["IDLE", "FROZEN", "QA", "DONE"])(
    "allows a card during the conversational %s phase",
    (phase) => {
      expect(scratchAllowedInPhase(phase)).toBe(true);
    },
  );

  it.each<LessonPhase>([
    "GENERATING",
    "TEACHING",
    "CHECKPOINT_ASKING",
    "CHECKPOINT_LISTENING",
    "CHECKPOINT_FEEDBACK",
  ])("blocks a card while the lesson owns the stage in %s", (phase) => {
    expect(scratchAllowedInPhase(phase)).toBe(false);
  });
});
