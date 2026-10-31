// Score a drawing-suite run directory without network access.
// Usage: npx vite-node scripts/suite-score.mjs <run-dir> [--usage-log <backend.log>] [--json <out.json>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLessonNdjson } from "../src/lessonStream/index.ts";
import { RoughSvgBoardRenderer } from "../src/board/renderer.ts";
import { featureCoverage, sceneFeatures } from "../src/board/scene/features.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const runDir = resolve(args[0]);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const suite = JSON.parse(readFileSync(join(projectRoot, "tests/eval/drawing-suite-v1.json"), "utf8"));
const generation = new Map(
  readFileSync(join(runDir, "generation.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((row) => [row.key, row]),
);
const usage = new Map();
const usageLog = option("--usage-log");
if (usageLog) {
  for (const line of readFileSync(usageLog, "utf8").split("\n")) {
    const match = /lesson_generation_usage request_id=(\S+) model=\S+ input_tokens=(\d+) cached_input_tokens=(\d+) output_tokens=(\d+) reasoning_tokens=(\d+)/u.exec(line);
    if (!match) continue;
    const [, id, input, cached, output, reasoning] = match;
    const total = usage.get(id) ?? { calls: 0, input: 0, cached: 0, output: 0, reasoning: 0 };
    usage.set(id, {
      calls: total.calls + 1,
      input: total.input + Number(input),
      cached: total.cached + Number(cached),
      output: total.output + Number(output),
      reasoning: total.reasoning + Number(reasoning),
    });
  }
}

const topics = suite.topics.map((topic) => {
  const row = generation.get(topic.id);
  const path = join(runDir, `${topic.id}.ndjson`);
  const base = { id: topic.id, category: topic.category, generation: row ?? null, usage: row ? usage.get(row.request_id) ?? null : null };
  if (!row || !existsSync(path)) return { ...base, rendered: false, coverage: 0, missing: topic.requires };
  const lesson = decodeLessonNdjson(readFileSync(path, "utf8")).lesson;
  if (lesson.steps.length === 0) return { ...base, rendered: false, coverage: 0, missing: topic.requires };
  const prepared = new RoughSvgBoardRenderer(undefined, "scene").prepareLesson(lesson);
  const features = sceneFeatures(prepared.scene);
  const { score, missing } = featureCoverage(features, topic.requires);
  return {
    ...base,
    rendered: true,
    coverage: score,
    missing,
    features,
    rendererWarnings: prepared.build.warnings.length,
    layoutIssues: prepared.layoutIssues.length,
    ops: lesson.steps.flatMap((step) => step.ops).length,
  };
});

const mean = (values) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summarize = (rows) => ({
  topics: rows.length,
  completed: rows.filter((row) => row.generation?.terminal === "lesson.done").length,
  featureCoverage: mean(rows.map((row) => row.coverage)),
  fullyCovered: rows.filter((row) => row.coverage === 1).length,
  medianFirstStepS: median(rows.flatMap((row) => (row.generation?.first_s == null ? [] : [row.generation.first_s]))),
  medianTotalS: median(rows.flatMap((row) => (row.generation?.total_s == null ? [] : [row.generation.total_s]))),
  repairs: rows.reduce((sum, row) => sum + (row.generation?.repairs ?? 0), 0),
  droppedSteps: rows.reduce((sum, row) => sum + (row.generation?.dropped ?? 0), 0),
  rendererDroppedOps: rows.reduce((sum, row) => sum + (row.rendererWarnings ?? 0), 0),
  outputTokens: rows.reduce((sum, row) => sum + (row.usage?.output ?? 0), 0),
  inputTokens: rows.reduce((sum, row) => sum + (row.usage?.input ?? 0), 0),
  cachedInputTokens: rows.reduce((sum, row) => sum + (row.usage?.cached ?? 0), 0),
  modelCalls: rows.reduce((sum, row) => sum + (row.usage?.calls ?? 0), 0),
});

const report = {
  schema: "chalk.drawing-suite-score.v1",
  run: JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")),
  overall: summarize(topics),
  byCategory: Object.fromEntries(
    suite.categories.map((category) => [category, summarize(topics.filter((row) => row.category === category))]),
  ),
  topics,
};
const jsonOut = option("--json");
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ overall: report.overall, byCategory: report.byCategory }, null, 2)}\n`);
for (const row of topics) {
  process.stdout.write(`${row.id.padEnd(22)} ${(row.coverage * 100).toFixed(0).padStart(3)}%  missing: ${row.missing.join(", ") || "-"}\n`);
}
