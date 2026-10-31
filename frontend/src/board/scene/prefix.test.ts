import { describe, expect, it } from "vitest";
import type { BoardGeometry } from "../geometry";
import { RoughSvgBoardRenderer } from "../renderer";
import { fixtureCorpus, retainedCorpus } from "./testCorpus";

const corpus = [...fixtureCorpus, ...retainedCorpus].filter(([, lesson]) => lesson.steps.length > 1);

/** Everything a viewer can see of an element. */
function visible(geometry: BoardGeometry) {
  return {
    id: geometry.id,
    box: geometry.box,
    paths: geometry.paths.map(({ d, stroke, strokeWidth, fill, revealGroup, revealWeight }) =>
      ({ d, stroke, strokeWidth, fill, revealGroup, revealWeight })),
    labels: geometry.labels,
    summary: geometry.manifestSummary,
  };
}

describe("scene pipeline is prefix-stable while steps stream in", () => {
  it("covers the fixtures and multi-step retained boards", () => {
    expect(corpus.length).toBeGreaterThan(60);
  });

  for (const [name, lesson] of corpus) {
    it(`never changes committed ink or labels in ${name}`, () => {
      const full = new RoughSvgBoardRenderer(undefined, "scene").prepareLesson(lesson).build.geometries.map(visible);
      // A fresh renderer per prefix (no cache) and one streaming renderer (cache reused).
      const streaming = new RoughSvgBoardRenderer(undefined, "scene");
      for (let prefix = 1; prefix < lesson.steps.length; prefix += 1) {
        const partial = { ...lesson, steps: lesson.steps.slice(0, prefix) };
        const fresh = new RoughSvgBoardRenderer(undefined, "scene").prepareLesson(partial).build.geometries.map(visible);
        const streamed = streaming.prepareLesson(partial).build.geometries.map(visible);
        expect(fresh).toEqual(full.slice(0, fresh.length));
        expect(streamed).toEqual(fresh);
      }
    });
  }
});
