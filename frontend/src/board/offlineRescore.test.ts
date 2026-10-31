import { describe, expect, it } from "vitest";
import derivativeLesson from "../../../demo/cached_lessons/derivative-slope.lesson.json";
import projectileLesson from "../../../demo/cached_lessons/projectile-range.lesson.json";
import unitCircleLesson from "../../../demo/cached_lessons/unit-circle-sine.lesson.json";
import { rescoreRetainedFixtures, rescoreRetainedNdjson } from "./offlineRescore";

const golden = import.meta.glob("../../../tests/golden/*.lesson.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const retainedNdjson = import.meta.glob(
  "../../../artifacts/evidence/m3-luna-v2-batch-20260717-0635/raw/*.ndjson",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const fixtures = [
  { topicId: "cached-projectile", source: projectileLesson },
  { topicId: "cached-derivative", source: derivativeLesson },
  { topicId: "cached-unit-circle", source: unitCircleLesson },
  ...Object.entries(golden).map(([path, source]) => ({
    topicId: path.split("/").at(-1)!.replace(".lesson.json", ""),
    source,
  })),
];

describe("offline drawing rescore", () => {
  it("re-scores all cached and golden fixtures through production truth without network", () => {
    const first = rescoreRetainedFixtures(fixtures);
    const repeated = rescoreRetainedFixtures(fixtures);

    expect(first).toEqual(repeated);
    expect(first.resolverPolicyRevision).toBe("resolver-density-constructions-tangent-v3");
    expect(first.topics).toHaveLength(13);
    expect(first.topics.every((topic) => topic.rendererCrash === false)).toBe(true);
    expect(first.topics.every((topic) => topic.browserDroppedSteps === 0)).toBe(true);
    expect(first.topics.every((topic) => topic.rendererDroppedOps === 0)).toBe(true);
    expect(first.topics.every((topic) => topic.sourceKind === "lesson_fixture")).toBe(true);
    expect(first.topics.every((topic) => /^[a-f0-9]{8}$/u.test(topic.fixtureFingerprint)))
      .toBe(true);
  });

  it("replays every retained validated stream through stream and renderer truth", () => {
    const captures = Object.entries(retainedNdjson).map(([path, source]) => ({
      topicId: path.split("/").at(-1)!.replace(".ndjson", ""),
      source,
    }));
    const first = rescoreRetainedNdjson(captures);
    const repeated = rescoreRetainedNdjson([...captures].reverse());

    expect(first.resolverPolicyRevision).toBe("resolver-density-constructions-tangent-v3");
    expect(first.topics).toHaveLength(10);
    expect([...first.topics].sort((left, right) => left.topicId.localeCompare(right.topicId)))
      .toEqual(
        [...repeated.topics].sort((left, right) => left.topicId.localeCompare(right.topicId)),
      );
    expect(first.topics.every((topic) => topic.sourceKind === "validated_ndjson")).toBe(true);
    expect(first.topics.every((topic) => topic.rendererCrash === false)).toBe(true);
    expect(first.topics.every((topic) => topic.browserDroppedSteps === 0)).toBe(true);
    expect(first.topics.every((topic) => topic.rendererDroppedOps === 0)).toBe(true);
    expect(first.topics.every((topic) => topic.acceptedSteps > 0)).toBe(true);
    expect(first.topics.some((topic) =>
      topic.findings.some((finding) => finding.code === "region_crowded")
    )).toBe(true);
    expect(first.topics.every((topic) => [
      topic.serverRepairs,
      topic.serverDroppedSteps,
      topic.sanitizedSteps,
      topic.sanitizedFields,
    ].every((count) => Number.isInteger(count) && count >= 0))).toBe(true);
  });

  it("proves the offline finding vector is live rather than vacuously empty", () => {
    const collision = {
      schema_version: "1.3",
      title: "Intentional lint fixture",
      steps: [{
        id: "s1",
        script: "Two labels deliberately collide so the evidence harness must notice.",
        ops: [{
          op: "diagram",
          id: "figure",
          region: "full",
          // More long labels at one spot than any nearby placement can separate.
          primitives: Array.from({ length: 16 }, (_, index) => ({
            kind: "text", at: [0.5, 0.5], content: `crowded label number ${index}`, align: "center",
          })),
        }],
        checkpoint: null,
      }],
    };
    const result = rescoreRetainedFixtures([{ topicId: "positive-lint", source: collision }]);

    expect(result.topics[0].findings).toContainEqual(
      expect.objectContaining({ code: "label_overlap", evidence: "estimated" }),
    );
  });

  it("fails closed on invalid or duplicate retained input", () => {
    expect(() => rescoreRetainedFixtures([
      { topicId: "same", source: projectileLesson },
      { topicId: "same", source: derivativeLesson },
    ])).toThrow("unique");
    expect(() => rescoreRetainedFixtures([
      { topicId: "invalid", source: { schema_version: "1.0" } },
    ])).toThrow("failed production decoding");
    expect(() => rescoreRetainedNdjson([
      { topicId: "invalid", source: "not-json" },
    ])).toThrow("failed production stream decoding");
  });
});
