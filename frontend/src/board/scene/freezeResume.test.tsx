import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import projectileLesson from "../../../../demo/cached_lessons/projectile-range.lesson.json";
import unitCircleLesson from "../../../../demo/cached_lessons/unit-circle-sine.lesson.json";
import {
  EMPTY_SYNC_STATE,
  fixedSyncReducer,
  type FixedSyncEvent,
  type FixedSyncState,
} from "../../sync/reducer";
import { Board, BoardInk } from "../Board";
import { RoughSvgBoardRenderer, type PreparedBoard } from "../renderer";
import { decodeLesson, type NormalizedLesson } from "../decode";
import type { BoardGeometry } from "../geometry";
import { staggerProgress } from "./motion";
import { SceneGeometryStore } from "./render";
import type { Scene } from "./types";

/**
 * Gate: freezing at progress p and resuming renders the same frames as an
 * uninterrupted run. The run is driven by the real sync reducer (student
 * speech freezes, QA, resume) and painted by the real board components.
 */

type Correlated = Exclude<FixedSyncEvent["type"], "LOAD" | "START" | "RESET" | "LESSON_SOURCE_COMPLETE">;

function send(state: FixedSyncState, type: Correlated, progress?: number): FixedSyncState {
  return fixedSyncReducer(state, {
    type,
    ...(progress === undefined ? {} : { progress }),
    requestId: state.requestId,
    stepId: state.stepIds[state.currentStepIndex],
    cycle: state.cycle,
  } as FixedSyncEvent);
}

function start(stepIds: string[]): FixedSyncState {
  const loaded = fixedSyncReducer(EMPTY_SYNC_STATE, {
    type: "LOAD",
    requestId: "freeze-resume",
    stepIds,
    checkpointStepIds: [],
    sourceComplete: true,
  });
  return fixedSyncReducer(loaded, { type: "START", requestId: "freeze-resume" });
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Tick schedule per step: increasing progress values ending at 1. */
function schedule(steps: number, next: () => number): number[][] {
  return Array.from({ length: steps }, () => {
    const ticks: number[] = [];
    let progress = 0;
    while (progress < 1) {
      progress = Math.min(1, progress + 0.02 + next() * 0.12);
      ticks.push(progress);
    }
    return ticks;
  });
}

/**
 * Run the lesson clock through the reducer and paint after every event.
 * With `freeze`, student speech arrives after that tick: ticks keep coming
 * while frozen (and are ignored), then QA, then resume.
 */
function run(
  stepIds: string[],
  ticks: number[][],
  paint: (state: FixedSyncState) => string,
  freeze?: { step: number; tick: number },
): { frames: string[]; frozenFrames: string[]; frozenAt?: string; final: FixedSyncState } {
  let state = send(start(stepIds), "NARRATION_ACTIVITY");
  const frames: string[] = [paint(state)];
  const frozenFrames: string[] = [];
  let frozenAt: string | undefined;
  ticks.forEach((stepTicks, stepIndex) => {
    stepTicks.forEach((progress, tickIndex) => {
      state = send(state, "TICK", progress);
      frames.push(paint(state));
      if (freeze && freeze.step === stepIndex && freeze.tick === tickIndex) {
        frozenAt = frames.at(-1);
        state = send(state, "STUDENT_SPEECH_STARTED");
        expect(state.phase).toBe("FROZEN");
        for (const ignored of [progress + 0.05, progress + 0.3, 1]) {
          state = send(state, "TICK", ignored);
          frozenFrames.push(paint(state));
        }
        state = send(state, "INTERRUPTION_COMMITTED");
        frozenFrames.push(paint(state));
        state = send(state, "RESUME");
        expect(state.phase).toBe("TEACHING");
        frozenFrames.push(paint(state));
        state = send(state, "NARRATION_ACTIVITY");
      }
    });
    state = send(state, "NARRATION_DONE");
    state = send(state, "AUDIO_STOPPED");
    state = send(state, "DRAIN_ELAPSED");
    state = send(state, "NARRATION_ACTIVITY");
    frames.push(paint(state));
  });
  return { frames: dedupe(frames), frozenFrames, frozenAt, final: state };
}

function dedupe(frames: readonly string[]): string[] {
  return frames.filter((frame, index) => index === 0 || frame !== frames[index - 1]);
}

function boardPainter(lesson: NormalizedLesson) {
  const view = render(
    <Board lesson={lesson} currentStepIndex={0} currentStepProgress={0} phase="IDLE" scenePipeline="scene" />,
  );
  const paint = (state: FixedSyncState) => {
    view.rerender(
      <Board
        lesson={lesson}
        currentStepIndex={state.currentStepIndex}
        currentStepProgress={state.currentStepProgress}
        phase={state.phase}
        scenePipeline="scene"
      />,
    );
    return view.container.querySelector("svg.chalkboard")!.innerHTML;
  };
  return { paint, unmount: view.unmount };
}

describe("freeze at p, then resume, renders the same frames as an uninterrupted run", () => {
  for (const [name, source] of [["projectile", projectileLesson], ["unit circle", unitCircleLesson]] as const) {
    it(`holds for the cached ${name} lesson on the scene pipeline`, () => {
      const lesson = decodeLesson(source).lesson!;
      const stepIds = lesson.steps.map((step) => step.id);
      const next = random(name.length * 97);
      for (let trial = 0; trial < 3; trial += 1) {
        const ticks = schedule(lesson.steps.length, next);
        const step = Math.floor(next() * lesson.steps.length);
        const freeze = { step, tick: Math.floor(next() * (ticks[step].length - 1)) };
        const plain = boardPainter(lesson);
        const uninterrupted = run(stepIds, ticks, plain.paint);
        plain.unmount();
        const interruptedBoard = boardPainter(lesson);
        const interrupted = run(stepIds, ticks, interruptedBoard.paint, freeze);
        interruptedBoard.unmount();
        expect(uninterrupted.final.phase).toBe("DONE");
        expect(interrupted.final.phase).toBe("DONE");
        expect(uninterrupted.frames.length).toBeGreaterThan(ticks.flat().length / 2);
        expect(interrupted.frozenAt).toBeDefined();
        expect(interrupted.frames).toEqual(uninterrupted.frames);
        expect(interrupted.frozenFrames.every((frame) => frame === interrupted.frozenAt)).toBe(true);
      }
    });
  }

  it("holds for create, fade, indicate, and transform motions", () => {
    const frame = { id: "f", box: { x: 200, y: 200, width: 400, height: 400 }, window: { x: [0, 1], y: [0, 1] }, axes: "none", grid: false, equalScale: true } as const;
    const element = (id: string, opIndex: number, extra: Partial<Scene["elements"][number]>) => ({
      id,
      kind: "diagram" as const,
      stepIndex: 0,
      opIndex,
      box: frame.box,
      sizing: "ink" as const,
      frame: "f",
      marks: [],
      summary: id,
      ...extra,
    });
    const scene: Scene = {
      frames: [frame],
      elements: [
        element("square", 0, {
          motion: { kind: "create", rate: "smooth", lag: 0.5 },
          marks: [
            { kind: "path", id: "sq", points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], closed: true, group: 0 },
            { kind: "point", id: "c", at: [0.5, 0.5], label: { text: "O" }, group: 1 },
          ],
        }),
        element("glow", 1, { motion: { kind: "fade_in" }, marks: [{ kind: "circle", id: "ring", center: [0.5, 0.5], r: 0.1 }] }),
        element("pulse", 2, { motion: { kind: "indicate" }, marks: [{ kind: "point", id: "pt", at: [0.3, 0.7] }] }),
        element("round", 3, {
          motion: { kind: "transform", from: "square" },
          marks: [{ kind: "circle", id: "disc", center: [0.5, 0.5], r: 0.3 }],
        }),
      ],
    };
    const { geometries, warnings } = new SceneGeometryStore().build(scene);
    expect(warnings).toEqual([]);
    expect(geometries.at(-1)!.morph).toBeDefined();
    const weights = geometries.map(() => 1);
    const progressOf = (state: FixedSyncState) => (geometry: BoardGeometry) =>
      state.currentStepIndex > 0 ? 1 : staggerProgress(weights, geometry.opIndex, state.currentStepProgress);
    const painter = () => {
      const view = render(<svg><BoardInk geometries={geometries} progressOf={() => 0} /></svg>);
      return {
        paint: (state: FixedSyncState) => {
          view.rerender(<svg><BoardInk geometries={geometries} progressOf={progressOf(state)} /></svg>);
          return view.container.innerHTML;
        },
        unmount: view.unmount,
      };
    };
    const next = random(5);
    for (let trial = 0; trial < 5; trial += 1) {
      const ticks = schedule(1, next);
      const freeze = { step: 0, tick: Math.floor(next() * (ticks[0].length - 1)) };
      const plain = painter();
      const uninterrupted = run(["s1"], ticks, plain.paint);
      plain.unmount();
      const second = painter();
      const interrupted = run(["s1"], ticks, second.paint, freeze);
      second.unmount();
      expect(uninterrupted.frames.length).toBeGreaterThan(ticks[0].length / 2);
      expect(interrupted.frozenAt).toBeDefined();
      expect(interrupted.frames).toEqual(uninterrupted.frames);
      expect(interrupted.frozenFrames.every((frame) => frame === interrupted.frozenAt)).toBe(true);
    }
    // Mid-morph the source is hidden and one morph stroke is drawn; at 1 the target's own strokes show.
    const at = (stepProgress: number) => {
      const view = render(
        <svg><BoardInk geometries={geometries} progressOf={(geometry) => staggerProgress(weights, geometry.opIndex, stepProgress)} /></svg>,
      );
      const html = view.container;
      const result = {
        square: Boolean(html.querySelector('[data-element-id="square"]')),
        morph: html.querySelectorAll('[data-motion="transform"] path').length,
        round: html.querySelector('[data-element-id="round"]')?.querySelectorAll("path").length ?? 0,
      };
      view.unmount();
      return result;
    };
    expect(at(0.7)).toEqual({ square: true, morph: 0, round: 0 });
    expect(at(0.875)).toMatchObject({ square: false, morph: 1 });
    expect(at(1)).toEqual({ square: false, morph: 0, round: geometries.at(-1)!.paths.length });
  });

  it("publishes a transform's source until the morph commits", () => {
    const frame = { id: "f", box: { x: 200, y: 200, width: 400, height: 400 }, window: { x: [0, 1], y: [0, 1] }, axes: "none", grid: false, equalScale: true } as const;
    const scene: Scene = {
      frames: [frame],
      elements: ["src", "dst"].map((id, opIndex) => ({
        id,
        kind: "point" as const,
        stepIndex: 0,
        opIndex,
        box: frame.box,
        sizing: "ink" as const,
        frame: "f",
        marks: [{ kind: "point" as const, id: `${id}-dot`, at: [0.2 + opIndex * 0.5, 0.5] as const }],
        summary: id,
        ...(opIndex === 1 ? { motion: { kind: "transform" as const, from: "src" } } : {}),
      })),
    };
    const lesson = decodeLesson({
      schema_version: "1.4",
      title: "Morph",
      steps: [{
        id: "s1",
        script: "Move the point.",
        ops: [
          { op: "point", id: "src", region: "A1", at: [0.2, 0.5] },
          { op: "point", id: "dst", region: "A1", at: [0.7, 0.5] },
        ],
        checkpoint: null,
      }],
    }).lesson!;
    const prepared: PreparedBoard = { lesson, build: new SceneGeometryStore().build(scene), layoutIssues: [] };
    const renderer = new RoughSvgBoardRenderer(undefined, "scene");
    const ids = (progress: number) => renderer.visibleSnapshot(prepared, 0, progress).elements.map(({ id }) => id);
    expect(ids(0.4)).toEqual([]);
    expect(ids(0.75)).toEqual(["src"]);
    expect(ids(1)).toEqual(["dst"]);
  });
});
