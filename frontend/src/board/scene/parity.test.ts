import { describe, expect, it } from "vitest";
import { decodeLesson, type NormalizedLesson } from "../decode";
import { layoutSteps, type LaidOutOp } from "../layout";
import {
  alignedConstructionLesson,
  compositeDiagramLesson,
  physicsDiagramLesson,
} from "../physicsTestFixture";
import { RoughSvgBoardRenderer } from "../renderer";
import { compileLegacy } from "./compileLegacy";
import { SceneGeometryStore } from "./render";
import {
  constructionCases,
  constructionLesson,
  everyPrimitiveLesson,
  fixtureCorpus,
  geometryDeviation,
  retainedCorpus,
} from "./testCorpus";

function prepareBoth(lesson: NormalizedLesson) {
  const legacy = new RoughSvgBoardRenderer(undefined, "legacy").prepareLesson(lesson);
  const scene = new RoughSvgBoardRenderer(undefined, "scene").prepareLesson(lesson);
  return { legacy, scene };
}

describe("scene pipeline parity with the legacy op renderer", () => {
  it("covers the 3 cached lessons, 10 golden fixtures, and retained evidence boards", () => {
    expect(fixtureCorpus).toHaveLength(13);
    expect(retainedCorpus.length).toBeGreaterThanOrEqual(50);
  });

  const synthetic: Array<[string, NormalizedLesson]> = [
    ["every primitive", everyPrimitiveLesson],
    ["physics diagram", decodeLesson(physicsDiagramLesson()).lesson!],
    ["composite diagram", decodeLesson(compositeDiagramLesson()).lesson!],
    ["aligned construction", decodeLesson(alignedConstructionLesson()).lesson!],
    ...constructionCases
      .filter((testCase) => testCase.expected.browser === "point" || testCase.expected.browser === "line")
      .map((testCase): [string, NormalizedLesson] => [`construction ${testCase.id}`, constructionLesson(testCase)]),
  ];

  it("exercises every primitive with no skipped op", () => {
    expect(everyPrimitiveLesson.steps.flatMap((step) => step.ops)).toHaveLength(5);
    const { scene } = prepareBoth(everyPrimitiveLesson);
    expect(scene.build.warnings).toEqual([]);
    expect(scene.build.geometries.find((geometry) => geometry.id === "kit")!.manifestParts).toHaveLength(14);
  });

  for (const [path, lesson] of [...fixtureCorpus, ...synthetic, ...retainedCorpus]) {
    it(`draws the same board for ${path}`, () => {
      const { legacy, scene } = prepareBoth(lesson);
      expect(scene.build.warnings.map(({ id }) => id)).toEqual(legacy.build.warnings.map(({ id }) => id));
      const deviation = geometryDeviation(legacy.build.geometries, scene.build.geometries);
      // Gate: root boxes within 1 px. Observed differences are float rounding only.
      expect(deviation.box).toBeLessThan(1);
      expect(deviation.ink).toBeLessThan(1e-6);
      expect(deviation.label).toBeLessThan(1e-6);
      expect(scene.layoutIssues).toEqual(legacy.layoutIssues);
    });
  }

  // Layout drops these before any geometry exists; forcing them through the
  // scene path shows point references fail with the same closed codes.
  for (const testCase of constructionCases.filter((item) => item.expected.browser === "drop_resolve")) {
    it(`rejects ${testCase.id} through point references with ${testCase.expected.code}`, () => {
      const lesson = constructionLesson(testCase);
      const setupSteps = lesson.steps.slice(0, -1);
      const laidOut = layoutSteps(setupSteps);
      const candidateStep = lesson.steps.at(-1)!;
      const forced: LaidOutOp[] = candidateStep.ops.map((op, opIndex) => ({
        op,
        box: { x: 0, y: 0, width: 1, height: 1 },
        stepIndex: setupSteps.length,
        opIndex,
      }));
      const { warnings } = new SceneGeometryStore().build(compileLegacy([...laidOut, ...forced]));
      const constructionId = forced.find(({ op }) => "construct" in op)!.op.id;
      expect(warnings).toContainEqual({ id: constructionId, detail: `scene:${testCase.expected.code}` });
    });
  }

  it("keeps rough seeds stable: re-preparing reuses identical strokes", () => {
    for (const [, lesson] of fixtureCorpus) {
      const renderer = new RoughSvgBoardRenderer(undefined, "scene");
      const first = renderer.prepareLesson(lesson).build.geometries;
      const fresh = new RoughSvgBoardRenderer(undefined, "scene").prepareLesson(lesson).build.geometries;
      const again = renderer.prepareLesson(lesson).build.geometries;
      expect(fresh.map((geometry) => geometry.paths.map((path) => path.d)))
        .toEqual(first.map((geometry) => geometry.paths.map((path) => path.d)));
      again.forEach((geometry, index) => expect(geometry.paths).toBe(first[index].paths));
    }
  });
});
