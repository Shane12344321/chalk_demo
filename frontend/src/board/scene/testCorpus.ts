/** Shared lesson corpus and geometry comparison for scene-pipeline tests (test-only). */
import { expect } from "vitest";
import constructionFixture from "../../../../shared/fixtures/construction-parity.json";
import { decodeLessonNdjson } from "../../lessonStream";
import { decodeLesson, type NormalizedLesson } from "../decode";
import type { BoardGeometry, BoardLabel, BoardPath } from "../geometry";
import type { LayoutBox } from "../layout";

const cached = import.meta.glob("../../../../demo/cached_lessons/*.lesson.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const golden = import.meta.glob("../../../../tests/golden/*.lesson.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const retained = import.meta.glob("../../../../artifacts/evidence/**/*.ndjson", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const name = (path: string) => path.replace(/^(\.\.\/)+/u, "");

export const fixtureCorpus: Array<[string, NormalizedLesson]> = [
  ...Object.entries(cached).map(([path, source]): [string, NormalizedLesson] => [name(path), decodeLesson(source).lesson!]),
  ...Object.entries(golden).map(([path, source]): [string, NormalizedLesson] => [name(path), decodeLesson(source).lesson!]),
];

export interface ConstructionCase {
  id: string;
  setup: string | null;
  candidate: { ops: Array<{ id: string }> } & Record<string, unknown>;
  expected: { browser: string; code?: string };
}
export const constructionCases = constructionFixture.cases as unknown as ConstructionCase[];
const constructionSetups = constructionFixture.setups as Record<string, unknown[]>;
export const constructionLesson = (testCase: ConstructionCase) =>
  decodeLesson({
    schema_version: "1.4",
    title: testCase.id,
    steps: [...(testCase.setup ? constructionSetups[testCase.setup] : []), testCase.candidate],
  }).lesson!;

/** Every diagram primitive, stroke style, arrow, fill, text size, and standalone op kind. */
export const everyPrimitiveLesson = decodeLesson({
  schema_version: "1.4",
  title: "Every primitive",
  steps: [
    {
      id: "s1",
      script: "Draw every primitive kind.",
      ops: [{
        op: "diagram",
        id: "kit",
        region: "left",
        tension: 0.4,
        primitives: [
          { kind: "line", points: [[0.1, 0.1], [0.3, 0.2], [0.2, 0.35]], stroke: "solid", arrow: true, label: "a" },
          { kind: "line", points: [[0.4, 0.1], [0.6, 0.15]], stroke: "dashed", label: "b" },
          { kind: "smooth", points: [[0.1, 0.5], [0.2, 0.4], [0.35, 0.55], [0.45, 0.45]], stroke: "solid", arrow: true },
          { kind: "smooth", points: [[0.55, 0.5], [0.65, 0.4], [0.8, 0.55]], stroke: "dashed", label: "c" },
          { kind: "rect", from: [0.7, 0.1], to: [0.9, 0.3], stroke: "solid", fill: true, label: "box" },
          { kind: "rect", from: [0.62, 0.32], to: [0.5, 0.22], stroke: "dashed" },
          { kind: "ellipse", center: [0.2, 0.75], radius: [0.1, 0.06], stroke: "solid", fill: true, label: "e" },
          { kind: "ellipse", center: [0.45, 0.75], radius: [0.08, 0.08], stroke: "dashed" },
          { kind: "arc", center: [0.75, 0.75], radius: [0.1, 0.1], start_deg: -30, end_deg: 200, stroke: "solid", arrow: true, label: "spin" },
          { kind: "arc", center: [0.75, 0.75], radius: [0.05, 0.08], start_deg: 90, end_deg: 10, stroke: "dashed" },
          { kind: "text", at: [0.1, 0.95], content: "left", size: "small" },
          { kind: "text", at: [0.5, 0.95], content: "middle", align: "center", size: "large" },
          { kind: "text", at: [0.9, 0.95], content: "right", align: "right" },
          { kind: "point", at: [0.5, 0.6], label: "P" },
        ],
      }],
      checkpoint: null,
    },
    {
      id: "s2",
      script: "Add the standalone marks.",
      ops: [
        { op: "line", id: "rail", region: "right", from: [0.1, 0.8], to: [0.9, 0.7], stroke: "dashed", label: "rail" },
        { op: "arrow", id: "push", canvas_id: "rail", from: [0.2, 0.3], to: [0.6, 0.5], stroke: "dashed", label: "F" },
        { op: "angle_arc", id: "tilt", canvas_id: "rail", center: [0.1, 0.8], radius: 0.2, start_deg: -20, end_deg: 0, stroke: "dashed", label: "θ" },
        { op: "point", id: "pin", canvas_id: "kit", at: [0.3, 0.3], label: "Q" },
      ],
      checkpoint: null,
    },
  ],
}).lesson!;

export const retainedCorpus: Array<[string, NormalizedLesson]> = Object.entries(retained).flatMap(
  ([path, text]): Array<[string, NormalizedLesson]> => {
    try {
      const lesson = decodeLessonNdjson(text).lesson;
      return lesson.steps.length > 0 ? [[name(path), lesson]] : [];
    } catch {
      return [];
    }
  },
);

/** Largest absolute difference between two geometry lists; throws on any structural mismatch. */
export function geometryDeviation(
  legacy: readonly BoardGeometry[],
  scene: readonly BoardGeometry[],
): { box: number; ink: number; label: number } {
  const deviation = { box: 0, ink: 0, label: 0 };
  expect(scene.map((geometry) => geometry.id)).toEqual(legacy.map((geometry) => geometry.id));
  legacy.forEach((left, index) => {
    const right = scene[index];
    const where = left.id;
    expect([right.kind, right.stepIndex, right.opIndex, right.manifestSummary], where)
      .toEqual([left.kind, left.stepIndex, left.opIndex, left.manifestSummary]);
    expect([right.text, right.equationHtml, right.equationFontSize], where)
      .toEqual([left.text, left.equationHtml, left.equationFontSize]);
    deviation.box = Math.max(deviation.box, boxDeviation(left.box, right.box));
    expect(Boolean(right.canvasBox), where).toBe(Boolean(left.canvasBox));
    if (left.canvasBox) deviation.box = Math.max(deviation.box, boxDeviation(left.canvasBox, right.canvasBox!));
    expect(right.paths.length, `${where} path count`).toBe(left.paths.length);
    left.paths.forEach((path, pathIndex) => {
      deviation.ink = Math.max(deviation.ink, pathDeviation(path, right.paths[pathIndex], `${where}#${pathIndex}`));
    });
    expect(right.labels.length, `${where} label count`).toBe(left.labels.length);
    left.labels.forEach((label, labelIndex) => {
      deviation.label = Math.max(deviation.label, labelDeviation(label, right.labels[labelIndex], where));
    });
    expect((right.manifestParts ?? []).map(({ id, kind, summary, revealGroup }) => [id, kind, summary, revealGroup]), where)
      .toEqual((left.manifestParts ?? []).map(({ id, kind, summary, revealGroup }) => [id, kind, summary, revealGroup]));
    (left.manifestParts ?? []).forEach((part, partIndex) => {
      deviation.box = Math.max(deviation.box, boxDeviation(part.box, right.manifestParts![partIndex].box));
    });
    expect((right.inkBounds ?? []).length, where).toBe((left.inkBounds ?? []).length);
    (left.inkBounds ?? []).forEach((box, boxIndex) => {
      deviation.box = Math.max(deviation.box, boxDeviation(box, right.inkBounds![boxIndex]));
    });
  });
  return deviation;
}

function boxDeviation(left: LayoutBox, right: LayoutBox): number {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
}

function pathDeviation(left: BoardPath, right: BoardPath, where: string): number {
  expect([right.stroke, right.strokeWidth, right.fill, right.revealGroup], where)
    .toEqual([left.stroke, left.strokeWidth, left.fill, left.revealGroup]);
  expect(right.revealWeight === undefined, where).toBe(left.revealWeight === undefined);
  const weight = Math.abs((left.revealWeight ?? 0) - (right.revealWeight ?? 0)) / Math.max(1, left.revealWeight ?? 1);
  const leftTokens = left.d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gu) ?? [];
  const rightTokens = right.d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gu) ?? [];
  expect(rightTokens.length, `${where} d tokens`).toBe(leftTokens.length);
  let worst = weight;
  leftTokens.forEach((token, index) => {
    if (/[A-Za-z]/u.test(token)) expect(rightTokens[index], where).toBe(token);
    else worst = Math.max(worst, Math.abs(Number(token) - Number(rightTokens[index])));
  });
  return worst;
}

function labelDeviation(left: BoardLabel, right: BoardLabel, where: string): number {
  const fields = (label: BoardLabel) =>
    [label.text, label.anchor, label.fontSize, label.autoPlace, label.mobility, label.revealGroup];
  expect(fields(right), where).toEqual(fields(left));
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

