// Differential fuzz, browser half: add the browser verdict to each case from
// `backend/app/figure_fuzz.py`, render every accepted case, and report
// disagreements, render-time skips, and crashes. Offline; never run in CI.
// Usage: npx vite-node scripts/figure-fuzz.mjs <cases.json> [--json <report.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { decodeLesson } from "../src/board/decode.ts";
import { RoughSvgBoardRenderer } from "../src/board/renderer.ts";

const args = process.argv.slice(2);
const cases = JSON.parse(readFileSync(args[0], "utf8"));
const jsonIndex = args.indexOf("--json");
// Pinned in shared/fixtures/curve-parity.json ("backend-exponent-safety-cap").
const KNOWN_BACKEND_STRICTER = ["expression exponent exceeds the rendering budget"];

const report = {
  compared: 0,
  agree: 0,
  knownAsymmetry: 0,
  backendAcceptsBrowserRejects: [],
  backendRejectsBrowserAccepts: [],
  renderSkips: {},
  renderSkipExamples: [],
  crashes: [],
};

for (const testCase of cases) {
  if (testCase.python === "setup_rejected") continue;
  report.compared += 1;
  let decoded;
  try {
    decoded = decodeLesson({ schema_version: "1.5", title: testCase.id, steps: testCase.steps });
  } catch (error) {
    report.crashes.push({ id: testCase.id, stage: "decode", error: String(error).slice(0, 200) });
    continue;
  }
  const accepted = new Set(decoded.lesson?.steps.flatMap((step) => step.ops.map((op) => op.id)) ?? []);
  const browser = !accepted.has("fig")
    ? "setup_rejected"
    : decoded.warnings.length === 0 && accepted.has("more") ? "accept" : "reject";
  if (browser === testCase.python) {
    report.agree += 1;
  } else if (
    testCase.python === "reject" &&
    browser === "accept" &&
    testCase.issues.some((issue) => KNOWN_BACKEND_STRICTER.some((known) => issue.includes(known)))
  ) {
    report.knownAsymmetry += 1;
  } else if (testCase.python === "accept") {
    report.backendAcceptsBrowserRejects.push({ id: testCase.id, browser, warnings: decoded.warnings.slice(0, 2) });
  } else {
    report.backendRejectsBrowserAccepts.push({ id: testCase.id, browser, issues: testCase.issues });
  }
  if (browser !== "accept") continue;
  try {
    const { warnings } = new RoughSvgBoardRenderer().prepareLesson(decoded.lesson).build;
    for (const { detail } of warnings) report.renderSkips[detail] = (report.renderSkips[detail] ?? 0) + 1;
    if (warnings.length > 0 && report.renderSkipExamples.length < 20) {
      report.renderSkipExamples.push({ id: testCase.id, warnings: warnings.slice(0, 3) });
    }
  } catch (error) {
    report.crashes.push({ id: testCase.id, stage: "render", error: String(error).slice(0, 200) });
  }
}

if (jsonIndex >= 0) writeFileSync(args[jsonIndex + 1], `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({
  compared: report.compared,
  agree: report.agree,
  knownAsymmetry: report.knownAsymmetry,
  backendAcceptsBrowserRejects: report.backendAcceptsBrowserRejects.length,
  backendRejectsBrowserAccepts: report.backendRejectsBrowserAccepts.length,
  renderSkips: report.renderSkips,
  crashes: report.crashes.length,
}));
process.exitCode =
  report.backendAcceptsBrowserRejects.length + report.backendRejectsBrowserAccepts.length + report.crashes.length > 0 ? 1 : 0;
