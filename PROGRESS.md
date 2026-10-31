# CHALK progress

This file is an append-oriented evidence log. Record only checks that were actually run. Current official-documentation expectations are not evidence of live API behavior.

## 2026-10-21 — Prompt v4 is the default (owner decision)

- `BOARD_PROMPT_VERSION` now defaults to `v4` (`backend/app/config.py`, `.env.example`,
  README). `v3` stays selectable with `BOARD_PROMPT_VERSION=v3` and remains the documented
  rollback in `general-drawing.md`; `v1`/`v2` are unchanged. The v3 contract and prompt
  bytes are untouched (hash tests still pin them).
- Basis, on the fixed 40-topic suite: coverage 0.875 → 0.971, repairs 20 → 1, lessons
  completed 39 → 40, median lesson 23.2 → 14.5 s; clean gallery boards 36 for v3 against
  31–38 across three v4 runs (visible-ink check); the owner-approved AI blind judgment
  preferred v4 on 26 topics, v3 on 7, 7 split.
- Tests: the stream-header test now follows the configured default; a new test pins the v4
  default and that `BOARD_PROMPT_VERSION=v3` still sends the v3 prompt (with the legacy
  ops) and hashes it.
- A local `.env` that sets `BOARD_PROMPT_VERSION=v3` still overrides the new default.
- Verification: backend 407 tests, Ruff; frontend 1177 tests in 75 files, ESLint, `tsc -b`,
  production build; `git diff --check`.

## 2026-10-21 — Gallery measures visible ink only; text-mark placement was not the cause

- The owner asked to let model-placed `text` marks move clear of ink before deciding the v4
  default. Diagnosis on all 120 v4 boards first: of the overlaps the label solver can see,
  every one is ink from a later step crossing an earlier label, and only one involves a
  `text` mark (wave-standing "fixed", 2026-10-19). Freeing text marks would not change the
  numbers, so they keep `nudge` mobility.
- What did inflate v4's findings was the gallery check itself
  (`frontend/src/gallery/boardQuality.ts`): it counted the invisible reveal-timing path
  drawn under every figure `text` mark as ink, and a translucent shading (`DIAGRAM_FILL`,
  alpha 0.12) as solid over its whole bounding box, so a label written inside a shaded
  region scored a 100% overlap. It now counts only visible ink: invisible paths are
  skipped, and a tint (alpha ≤ 0.35) is footprint but not an obstacle for text. SVG paint
  defaults are respected (no `fill` attribute fills black). New DOM test.
- Clean boards, same NDJSON and renderer (`artifacts/evidence/gallery-remeasure-20261021.json`):
  v3 36 → 36; v4 (10-19) 32 → 35; v4 (10-21 a) 31 → 38; v4 (10-21 b) 27 → 31. v4 averages
  34.7 against v3's 36, inside its own run-to-run spread. Left: later-step crossings, and
  one equation clipped by 10 px (trig-amplitude, run b).
- Verification: frontend 1177 tests in 75 files, ESLint, `tsc -b`, production build;
  `git diff --check`.

## 2026-10-21 — Checkpoint-limits re-run and AI blind judgment (owner-approved)

- Second owner-approved v4 batch with the checkpoint fix loaded (40 topics, same settings).
  Retained in `artifacts/evidence/suite40-v4r3-sol-20261021/`.

  | 40 topics | v3 (10-19) | v4 (10-19) | v4 (10-21 a) | v4 (10-21 b) |
  |---|---|---|---|---|
  | Lessons completed | 39 | 40 | 40 | 40 |
  | Required-feature coverage | 0.875 | 0.958 | 0.971 | 0.971 |
  | Repairs / dropped steps | 20 / 2 | 32 / 1 | 12 / 0 | 1 / 0 |
  | Logged model calls; output tokens | 55; 37.7K | 72; 42.4K | 52; 37.5K | 41; 34.4K |
  | Median first step / total | 14.4 s / 23.2 s | 8.6 s / 18.9 s | 8.9 s / 17.3 s | 7.7 s / 14.5 s |
  | Lessons with a checkpoint | – | 22 | 28 | 40 |
  | Gallery clean boards (current renderer) | 36 | 32 | 31 | 27 |

  The one remaining repair is `latex_command`; no checkpoint had to be dropped locally, so
  stating the limits in the contract was enough. Gallery cleanliness varies widely between
  runs of the same code (31 vs 27); several of b's findings are model-placed text inside
  shaded regions and labels crossed by later steps.
- The owner replaced the human blind page with an AI judge. 16 fresh Claude Sonnet
  subagents (medium effort), 5 pairs each, saw only the topic, a five-point rubric
  (correctness, idea visible in the drawing, legibility, completeness, layout) and two
  1600×900 renders: v3 boards from 2026-10-19 vs v4 boards from batch b, both drawn with the
  current renderer. Every topic was judged twice with sides swapped. Result: v4 better on
  26 topics, v3 on 7, 7 split between orders; 59 of 80 judgments chose v4; 33 of 40 topics
  got the same verdict in both orders; board 1 won 51% of picks (no position bias).
  `artifacts/evidence/judge-v3-vs-v4r3-20261021/judgment.json` holds the key, verdicts and
  reasons. v3 won the symmetry boards (hexagon, star, butterfly), radians, similar
  triangles, and the number-line pair; the judges cite v4's stray marks, doubled lines, a
  wrong side label, and missing tick numbers.
- Promotion rule (`general-drawing.md`): the blind sample prefers v4 and coverage, repairs,
  completion and speed improve, but gallery clean boards do not hold (27–32 vs 36). Defaults
  unchanged: `BOARD_PROMPT_VERSION=v3`.

## 2026-10-21 — Owner-approved v4 re-run after the board-intelligence round

- Batch: 40 topics, gpt-6.1-sol, reasoning low, one-shot, concurrency 2, prompt v4
  (`827f043a…`), code as in the entry below. Retained in
  `artifacts/evidence/suite40-v4r2-sol-20261021/` with `score.json` and `quality.json`.

  | 40 topics, prompt v4 | 2026-10-19 | 2026-10-21 |
  |---|---|---|
  | Lessons completed | 40 | 40 |
  | Required-feature coverage (current detector) | 0.958 | 0.971 |
  | Topics fully covered | 36 | 38 |
  | Repairs / dropped steps | 32 / 1 | 12 / 0 |
  | Logged model calls; output tokens | 72; 42.4K | 52; 37.5K |
  | Input tokens (cached) | 262K (243K) | 222K (210K) |
  | Median first step / total | 8.6 s / 18.9 s | 8.9 s / 17.3 s |
  | Gallery clean boards (current renderer) | 32 | 31 |
  | Gallery overlaps / off-board | 9 / 0 | 9 / 0 |
  | Label boxes crossed by later-step ink (probe) | 29 | 21 |

- Repair causes logged this run: `checkpoint` 11, `latex_command` 1 (2026-10-19: `latex` 11,
  `checkpoint` 11). No extra checkpoint was dropped, so these 11 were not the one-per-lesson
  budget: the checkpoint object itself broke the schema. Both contracts showed
  `checkpoint:null|checkpoint` without defining it, so the model never saw the 120/80
  character limits, and 11 of the 12 repaired lessons ended with no checkpoint at all.
- Fix after the batch (not yet measured live): the v4 contract spells out
  `checkpoint:null|{question:string[1..120],expected_gist:string[1..80]}` (3,674 of 3,700
  chars), the v4 prompt states the limits, and a checkpoint that still breaks its schema is
  dropped and recorded (`dropped_invalid_checkpoint`, added to the stream schema) instead of
  costing a repair call, which is what the repairs produced anyway. v3 is unchanged.
- New vocabulary in use: one `shade … except` (prob-complement now shows its region), 7
  unlabelled or 90° angle marks (square corners where right); hand-drawn three-point marker
  polylines 6 → 1.
- Coverage misses left: wave-lens (lens drawn as a line, not round; this run also missed
  `line:3`), shape-spiral (quarter arcs do not count as a `curve`).
- Verification: backend 406 tests, Ruff; frontend 1096 tests (the new boards join the
  evidence-driven parity tests), ESLint, `tsc -b`, production build; `git diff --check`.

## 2026-10-21 — Board intelligence round: adversarial review fixes (no model calls)

- Adversarial review of all 80 suite boards (v3 and v4 contact sheets), the label solver,
  and both figure validators. Fixes:
  - Titles never break mid-word while a smaller size fits ("Pythagorea / n"); a line may end
    after an inner dash only when that saves a line or a stranded last word
    ("The 68–95–" / "99.7 rule").
  - Axis tick values that would collide with the zero tick are dropped; legacy axes draw
    through the scene `renderFrame`.
  - Label solver: fixed labels place first; labels avoid the ink of every op in the same
    step (a step commits atomically, so still prefix-stable); labels are clamped onto the
    board; text stacked on text costs more than a stroke crossing it; when nothing near is
    clear, one wider search takes only a clean spot. Label boxes use the measured monospace
    advance (0.6 em, was 0.58), which fixes the one off-board label.
  - Labels render in a top layer (`data-board-layer="labels"`, `data-label-for`) with a
    board-coloured halo, so a stroke from a later step passes behind a label instead of
    over it. The gallery and the measured lint attribute layer labels to their element.
  - Figure labels (`scene/outward.ts`): a point on a closed outline is named outside it; a
    point inside one (a centre, a centroid) on the side away from the ink around it; in
    frameless figures other point and side labels face away from the window's centre.
    Plots keep upper-right point labels; legacy frames are unchanged (parity holds).
  - Figure angle marks that look right (within 1° on screen) and are unlabelled or "90°"
    draw the square corner; a named angle (θ) keeps its arc.
- Probe on the same NDJSON (label boxes crossed by another element's ink): every remaining
  crossing comes from a later step (same-step crossings 0 in both suites); v4 36 → 29,
  v3 24 → 24. Prefix stability forbids moving committed labels, so these are left to the
  halo.
- Schema 1.5 addition: `shade inside` takes `except` (1–4 earlier closed shapes left
  clear): a Venn complement, "neither", or "A but not B". Rendered as a masked fill, so
  overlapping holes and holes that stick out are correct; the region label goes to the
  roomiest point of the shaded part. Mirrored in both validators; `figure-parity.json`
  +6 cases (24). Prompt v4 mentions `except` and square right angles (contract 3,631 of
  3,700 chars).
- Cheaper repairs: a second checkpoint is dropped and recorded (`dropped_extra_checkpoint`,
  added to the stream schema) instead of costing a repair call; this was 11 of the 22
  categorized v4 repairs. The LaTeX lint allowlist gains about 150 commands verified to
  render under the browser's exact KaTeX options, plus an environment check (cases,
  aligned, gathered, matrix family, array); `latex-parity.json` +14 cases (41). Repair logs
  split LaTeX causes (`latex_command`, `latex_environment`, `latex_braces`, …), still
  closed categories only. How many of the 11 LaTeX repairs this removes needs a live run.
- Detector (`scene/features.ts`): closed shapes add their edges to the cycle graph (a
  rectangle split into squares counts its squares), segments between named points and
  midpoints are followed, and a small L resting in a corner counts as an angle marker.
  Re-scored with the same detector for both: coverage v3 0.812 → 0.875 (28 → 30 fully
  covered), v4 0.938 → 0.958 (35 → 36). v3 had been under-counted more.
- Differential fuzz: `backend/app/figure_fuzz.py` writes seeded cases with the backend
  verdict; `frontend/scripts/figure-fuzz.mjs` adds the browser verdict and renders every
  accepted case. Seeds 1–3 × 6,000: 17,838 compared, no disagreement beyond the pinned
  exponent-cap asymmetry (6 cases), no crashes. Renderer-only skips (a `hit` of marks that
  do not cross, constructions running off the board, tangents at a curve's visible edge)
  never occurred live: 0 renderer warnings in 80 boards, 0 of 464 literal points outside
  their windows.
- Gallery, same 80 boards re-rendered offline (`quality-20261021.json` and
  `score-20261021.json` beside each run): v3 34 → 36 clean (overlaps 7 → 5); v4 31 → 32
  clean (overlaps 9 → 9, off-board 1 → 0). Every v4 overlap left is later-step ink over an
  earlier label.
- Verification: frontend 1016 tests in 75 files, ESLint, `tsc -b`, production build;
  backend 402 tests, Ruff check and format (new files).
- Defaults unchanged: `BOARD_PROMPT_VERSION=v3`, `VITE_CHALK_SCENE=legacy`.
- Next smallest tasks: one owner-approved v4 re-run to measure repairs, `except`, and square
  corners on fresh boards; reject tangents at a curve's visible edge in both validators;
  owner blind judgment.

## 2026-10-19 — Drawing suite baseline, schema 1.5 figures, prompt v4 (owner-approved live batches)

- Fixed evaluation suite `tests/eval/drawing-suite-v1.json`: 40 topics in 8 categories,
  each with machine-checkable "must show" features (plot, curve, region, round, polygon,
  vector, angle, point, line, with counts). One calibration after the v3 pilot, recorded in
  the file: standing waves no longer requires axes.
- Tooling: `backend/app/drawing_suite.py` (owner-gated runner, `--approved-by-owner`, no
  retries, stops on rejection/outage, `--append` never re-runs a topic);
  `frontend/scripts/suite-score.mjs` (offline scorer: production decoder → scene IR →
  `scene/features.ts`, joins token usage from the backend log). The detector counts closed
  shapes built from separate strokes (cycle rank after splitting at touches/crossings) and
  hand-drawn axes, so v3 boards are not under-counted. Repair calls now log token usage, and
  invalid steps log closed issue categories only (no content).
- Schema 1.5 `figure` op (`shared/schema/lesson.schema.json`): a frame
  (`x`/`y` window, y up, `axes edge|origin|none`, grid, equal scale, axis labels) plus 1–16
  marks (point, segment/arrow, polyline/polygon, circle, arc, fn, param, polar, shade
  under/between/inside, angle by rays, tangent, perpendicular, measure, text, group with
  mirror/rotate/scale/translate and repeat). Points are coordinates or references
  (`at`, `mid`, `on x`, `on t`, `hit`, `foot`). `figure … on` adds marks to an earlier figure.
  Still 4 ops per step. Rules mirrored in `frontend/src/board/figureValidation.ts` and
  `backend/app/figure_validation.py`, pinned by `shared/fixtures/figure-parity.json`
  (18 cases, both languages); per-variable expression checks (`x`, `t`, `theta`) in both.
  Figures compile to the scene IR (`scene/compileFigure.ts`) and always take the scene
  pipeline. Figure perpendiculars from a point off the line draw to its foot; constructed
  lines in figures are clipped to the frame instead of dropped.
- Prompt v4 (`backend/app/prompts/board_engine_v4.md`, `BOARD_PROMPT_VERSION=v4`, opt-in):
  contract shows only text, equation, and figure (one coordinate convention); worked
  examples avoid suite topics and validate in both validators. v1–v3 contracts are
  byte-identical (contract hash `589b4d28…`, v3 prompt `08f6a1db…` pinned by test).
- Live batches (gpt-6.1-sol, reasoning low, one-shot, owner approved each in turn:
  v3 pilot 8, v3 remainder 32, v4 pilot 8, v4 remainder 32). Retained in
  `artifacts/evidence/suite40-v3-sol-20261019/` and `suite40-v4-sol-20261019/` with
  `score.json` and `quality.json`.

  | 40 topics | v3 | v4 |
  |---|---|---|
  | Lessons completed | 39 | 40 |
  | Required-feature coverage | 0.812 | 0.938 |
  | Topics fully covered | 28 | 35 |
  | Median first step | 14.4 s | 8.6 s |
  | Median total | 23.2 s | 18.9 s |
  | Repairs / dropped steps | 20 / 2 | 32 / 1 |
  | Gallery clean boards | 34 | 31 |
  | Gallery overlaps / off-board | 7 / 0 | 9 / 1 |
  | Mean board coverage | 0.197 | 0.239 |
  | Logged model calls; output tokens | 55; 37.7K | 72; 42.4K |

  Coverage gains by category: calculus 0.80→1.00, geometry 0.67→1.00, algebra 0.70→0.90,
  shapes 0.60→0.80, probability 0.80→0.93; one regression (tangent-radius: no angle mark).
  The v3 pilot's 4 repairs predate repair-usage logging, so v3 calls are under-logged.
  Repair causes logged for the v4 remainder: `latex` 11, `checkpoint` 11, no figure rule.
- Not better yet: v4 clean boards fell 34→31; most new findings are model-placed `text`
  marks or child labels landing on figure ink (e.g. radians: a label on the radius), plus
  one 9 px off-board. Repairs rose 20→32 (LaTeX lint and the one-checkpoint budget).
- Blind judgment page (owner-only):
  https://claude.ai/artifact/ScaE9XFBiLyscev8AjPZDK — 40 pairs, sides shuffled, votes in
  the artifact db (`votes/<viewer>`, readable only by the owner). The side key is
  `artifacts/evidence/suite40-v4-sol-20261019/blind-test-side-key.json` (do not open before
  judging). Gallery `boardQuality.ts` treats a figure's `on` children like plotted marks.
- Verification: frontend 982 tests in 74 files, ESLint, `tsc -b`, production build; backend
  376 tests, Ruff; `git diff --check`.
- Defaults unchanged: `BOARD_PROMPT_VERSION=v3`, `VITE_CHALK_SCENE=legacy`.
- Next smallest tasks: owner blind judgment (promotion rule); normalize an extra
  checkpoint to null and extend the LaTeX allowlist from the logged categories to cut
  repairs; make figure `text` marks avoid ink like free labels; then one owner-approved
  v4 re-run.

## 2026-10-19 — General drawing Phase 2: scene IR, renderer path, motion core

- New `frontend/src/board/scene/` (renderer only, no wire-schema or prompt change):
  - `types.ts`: frames (pixel box + one coordinate window `x:[a,b]×y:[c,d]`, math
    y-up; `axes edge|origin|none`, `grid`, `equalScale`) and marks (point, path
    closed/smooth/arrow, line from-to/through-slope/tangent/normal, vector, circle,
    ellipse, arc, fn, param, polar, region, angle, measure, label, group with
    transform and repeat). Rendered paths keep cubic Bézier `subpaths` beside `d`.
  - `frame.ts`: the one frame→pixel transform. `refs.ts`: point references
    (`at`, `end`, `mid`, `on t`, `on x`, `hit`, `foot`, `beside`) resolved on rendered
    ink, plus a dependency graph that orders marks and rejects unknown, forward, and
    cyclic references. `sample.ts`: fn/param/polar through the existing locked-down
    compiler, now per variable (`x|t|theta`). `marks.ts`: geometry for every kind
    with one table of seed, stroke-group, and label-anchor conventions. `expand.ts`:
    group affine transforms and repeats. `render.ts`: scene → board geometry with
    per-element caching and per-mark failure isolation. `labelSolver.ts` moved here.
  - `motion.ts`: Manim's `interpolate(alpha)` contract, rate enum (`linear`,
    `smooth`, `ease_in_out`, `there_and_back`, `rush_into`, `rush_from`), and a
    weighted `lag_ratio` stagger that now drives both op timing and stroke-group
    reveal (lag 1 reproduces the old formulas exactly, pinned by property tests).
  - `morph.ts`: grown from the `pathMorph.ts` spike. Inks are aligned once at
    preparation; frames are `d = morphAt(aligned, rate(opProgress))`; at progress 1
    the target's own seeded rough.js paths are shown, never re-roughened. The board
    paints `transform` (source hidden once the morph starts), `fade_in`, and
    `indicate`; the manifest keeps a transform's source until the morph commits.
    Only the scene IR can request these until Phase 3 adds wire ops.
  - `compileLegacy.ts`: every current op → frames and marks (text/equation notes;
    axes → plot frame with edge axes; curve → fn; diagram, sketch, standalone
    line/arrow/point/angle_arc → equal-scale frames with v flipped; constructions →
    point references; diagram text → `label` side `on`).
- Flag: `VITE_CHALK_SCENE=legacy|scene` (`boardRendererConfig.ts`, default `legacy`;
  documented in `.env.example`). The board gallery accepts `?scene=legacy|scene`.
- Duplication removed: data→pixel (3 copies plus the axes zero lines) now all go
  through the frame transform; normalized→canvas (4 copies) through
  `mapDiagramPoint`; overlap ratio (3 copies plus two test copies) through
  `layout.overlapRatio`; arc sampling and the stroke ease each once. Legacy
  `construction.ts` delegates its geometry to `scene/refs.ts` (585 → 364 lines);
  shared rough.js helpers moved from `geometry.ts` to `roughInk.ts`, op wording to
  `opDescriptions.ts`.
- Not done / divergences from the plan text: root placement still comes from
  `layout.ts` on both pipelines (layout still resolves constructions for their
  boxes, now through the shared refs rules); region fills live in `marks.ts`, not a
  separate `clip` module, and are not yet painted in a per-frame underlay; style
  `tone` applies only to function-like marks; equations stay KaTeX.
- Verification (no API calls):
  - Parity, legacy vs scene, on 3 cached lessons, 10 golden fixtures, 57 retained
    evidence boards, the physics fixtures, a synthetic every-primitive board, and the
    7 accepting construction-parity cases: identical element order, warnings, kinds,
    summaries, label fields, manifest parts, stroke styles, reveal groups, and seed
    keys; worst numeric difference 1.1e-13 px (root boxes, ink, labels); 473 of 564
    path strings byte-identical, the rest float rounding. The 11 rejecting
    construction cases, forced past layout, fail in `scene/refs.ts` with the same
    closed codes.
  - Prefix stability on the scene path: every prefix of all 70 lessons draws
    exactly the full run's first elements (fresh and streaming renderer).
  - Freeze/resume: the real `fixedSyncReducer` (speech → FROZEN with ignored ticks →
    QA → RESUME) driving the real `Board` on two cached lessons and `BoardInk` on a
    scene with create/fade/indicate/transform motions renders the same frame
    sequence as an uninterrupted run; every frozen frame equals the frame at p.
  - Board gallery (`gallery.html`, `window.__chalkGallery`): 72 lessons, 2 failed
    generations, 65 of 70 boards clean with the same five findings, on both
    pipelines; the per-lesson fingerprint (issues, element counts, coverage) hashes
    identical to the pre-change baseline captured this session.
  - Frontend 799 tests in 72 files (was 601 in 67), ESLint, `tsc -b`, production
    build, backend 354, `git diff --check`.
- Test config: Vitest's `fs.allow` now covers `artifacts/evidence/` (was one batch
  directory) so parity and prefix tests replay every retained board; dev and build
  are unchanged.
- Next smallest task: Phase 3 wire schema 1.5 compiling straight to this IR, starting
  with frames plus point/line/fn marks and the per-step budgets; then a renderer-only
  blind round with `VITE_CHALK_SCENE=scene` before flipping the default.

## 2026-10-19 — Manim study folded into the general drawing plan

- A separate read-only session studied 3b1b/manim (manimgl `fafa083a`) and
  ManimCommunity/manim (`b31c77e1`); report at `docs/research/manim-study.md`, every
  claim cited to file and line. Spot-checked here against the pinned sources: manimgl
  pipes raw frames into an ffmpeg subprocess, ManimCE encodes in-process with PyAV, and
  manimgl's window now renders with wgpu.
- Finding: Manim outputs video because `Scene.play` is an offline fixed-fps loop over
  imperative Python and LaTeX needs subprocesses; neither version can pause mid-`play`
  and resume. CHALK already has Manim's central property (every frame a pure function of
  progress); it lacks shape-to-shape motion. Recommendation: borrow Manim's model and
  names, port a ~400–700 line morph core, and use MathJax SVG glyphs for equation
  morphing behind a flag; do not adopt manim-web or Motion Canvas as runtimes.
- Plan updated (`docs/exec-plans/active/general-drawing.md`): new principle "Manim's
  model, not Manim's runtime"; Phase 2 adds Bézier subpaths on marks, `scene/motion.ts`,
  `scene/morph.ts`, and a freeze-then-resume equivalence gate; Phase 3 adds `transform`,
  `match_tex`, `move_along`, `indicate`, `fade_in` ops with takeover-ID and manifest rules
  and `VITE_CHALK_MATH=katex|mathjax`.
- The study's spike `frontend/src/board/pathMorph.ts` (103 lines, not wired in) passes
  its 7 tests and lint here.

## 2026-10-18 — General drawing plan; Phase 1 universal mechanisms

- Owner blind test (`CHALK Blind Board Test` artifact, 20 pairs rendered from retained
  NDJSON with no API calls): whole system 9/10 for after; renderer-only 0/10 for after.
  The model/prompt change carried the gain; the earlier renderer patches did not. The
  owner asked for general drawing capability instead of op-specific fixes.
- Read-only audit of `frontend/src/board/` found 11 coordinate systems, label positions
  set in 13 places with three separate search loops, duplicated mappings (data→pixel ×3,
  canvas ×4, overlap ratio ×3), fixed intrinsic sizes, layout that ignored labels and
  accepted up to 15% root overlap, and hard expressiveness caps (y=f(x) only, no marks in
  graph data coordinates, no fills, polygons, parametric/polar curves, or transforms).
- Plan: `docs/exec-plans/active/general-drawing.md` (frames + marks scene model, one
  label solver, one no-overlap guarantee, one fit rule, one measurement truth, closed
  loop, broad 40-prompt suite with blind pairwise promotion rule; schema 1.5 phased behind
  `VITE_CHALK_SCENE`).
- Phase 1 implemented (no wire or prompt change):
  - `labelSolver.ts` places every label on the board in commit order with one cost
    function over stroke-level ink (paths flattened to polylines in a grid index),
    typeset blocks, and earlier labels; mobility `fixed|nudge|free`; smaller-size
    fallback. It replaces `declutterCanvasLabels`, `resolveDiagramLabelCollisions`, and
    the straight-line nudge. Prefix-stable by construction (pinned by test).
  - `layoutLint.ts` uses the solver's ink model across all elements and bounds labels by
    the board edge. Lint tests updated to the shared collision model.
  - `layout.ts` `clearPlacement`: region, anchored, and diagram roots that still intrude
    on a committed root (>2% of the smaller box) move to the nearest clear spot, then
    shrink to 0.85/0.72/0.6 if needed.
  - Axes on plot edges with faint zero reference lines, replacing the
    axis-through-origin special case the blind test rejected.
- Board gallery (dev only, `http://localhost:5173/gallery.html`, `?dir=<path prefix>`):
  a `serve`-only Vite plugin (`frontend/devtools/lessonSource.ts`, traversal-checked)
  lists retained NDJSON under `artifacts/evidence/`, golden fixtures, and cached lessons;
  each renders with the production `Board`, and `src/gallery/boardQuality.ts` scores it
  (text/equation/label overlaps, clipped equations, off-board, text under 14px, short
  last lines, coverage) and exposes `window.__chalkGallery` for automation.
- Gallery result on the finished Phase 1 renderer, no API calls: 72 lessons, 2 failed
  generations (no board), 65 of 70 renderable boards clean; remaining findings are four
  12–22% overlaps (torque, Sol Newton, Sol vector addition, Luna unit circle) and one
  element 5px past the board edge. All 10 golden fixtures and 3 cached lessons are clean.
  The blind-test regressions are gone: the Luna standing-waves equation no longer runs
  into the wave and the derivative's y-axis is back on the plot edge. Axis titles are
  `nudge` labels so a centred `0` tick and the x title no longer collide.
- No pre-Phase-1 gallery baseline exists (the gallery postdates it), so this is the
  baseline for later phases, not a before/after claim.
- Verification: frontend 594 tests in 66 files, backend 354, ESLint, Ruff, production
  build, and `git diff --check` pass.

## 2026-10-18 — Drawing iteration on GPT-6.1 Sol: prompt v3 default plus four renderer fixes

- Owner asked to iterate on drawing quality until solid, stopping at 50% of the 5-hour
  plan window. 27 additional paid `POST /lesson` calls (28 including the earlier smoke),
  all on `gpt-6.1-sol`/`low`, no retries. Measured usage: ~4.9–5.1K input tokens (≥99%
  cached after the first call), 557–1,185 output tokens, 0–478 reasoning tokens, about
  0.7–1.5¢ per lesson. Raw validated NDJSON and per-topic generation summaries are in
  `artifacts/evidence/gpt61sol-drawing-iteration-20261018/`.
- Review method: each stream replayed in the diagnostics board at 1440×900 with a
  read-only metric pass (element bounding boxes for text/equation overlaps, equation
  ink vs box, wraps, out-of-board) plus visual inspection of diagram boards.
- Prompt v2 vs v3 on Sol, same five topics plus standing waves: v3 finished 6/6
  (first step 4.4–15.6 s, median ~5.2 s, 2 repairs); v2 finished 5/6 with one 45 s
  `generation_timeout` (first step 6.2–34.5 s, 4 repairs) and showed text-on-diagram,
  text-on-text, clipped equations, and orphaned wraps. **Default is now prompt v3.**
- Renderer fixes, all deterministic and committed-prefix safe:
  1. **Equation size feedback loop.** The length heuristic assumed ~0.9 em/char and
     precommit measurement fed each shrunken box back into it for three iterations, so
     long equations collapsed to 10 px. Equations now measure at 31 px and only the
     painter's measured fit (`FittedEquation`) shrinks them. Final equations went from
     ~10 px to 18–31 px.
  2. **Square diagram canvases.** Diagram-family roots used a 700×430 canvas, so the
     normalized [0,1]² space stretched 1.6×: circles drew as ellipses and angle arcs,
     perpendiculars, and slopes disagreed with their geometry. Canvases are now square.
  3. **Axes through zero.** The x-axis was pinned to the plot bottom even for data
     crossing zero (sine and standing waves looked shifted). Axes now pass through zero
     when the range crosses it, with a `0` tick and a `y.min` label.
  4. **Readable axis numbers.** `6.283185` now renders as `2π`; other values use simple
     π fractions or three significant figures.
  5. **Authored diagram text off straight lines.** Model-placed text crossing an
     axis-aligned line in the same diagram moves to the nearest clear spot (sideways or
     past the line's end), dropping to the 24 px diagram size only if needed.
- Prompt v3 guidance added (new hash `08f6a1db…`): every lesson draws at least one graph
  or diagram; after the opening, all but at most one step adds to or marks up the
  picture; never end with two equation-only steps; ~25 characters of diagram text span
  the canvas. Same 8 new topics before/after: diagrams or marks now appear in nearly
  every step (chain rule gained a rate-chain diagram), 8/8 complete, metrics clean on
  7/8 (one orphaned wrap). Cost: median first step rose from ~6 s to ~12 s.
- Verification: frontend 552 tests in 63 files (new `drawingQuality.test.ts` pins square
  canvases, zero-crossing axes, axis formatting, and the text nudge), backend 354, ESLint,
  Ruff, and the production build pass.
- Plain board text now wraps with balanced lines (same line count, narrowest width), so a
  short last word is no longer stranded ("Nodes: x = 0" / "and x = L").
- Final no-spend replay of all 28 retained boards through the finished renderer: every
  v3 board is clean (22/22) on text/equation overlap, equation clipping, out-of-board, and
  orphaned-wrap metrics; the smallest equation is 18 px. The only failing board is the
  retired-prompt v2 Newton lesson, whose model-authored text overlaps.
- Known remaining issues: first ink is ~5–23 s on Sol (median ~12 s with the visual-first
  guidance); a label drawn in an earlier step can still be crossed by ink added later
  (moving committed ink is forbidden); boards often leave the lower third empty.

## 2026-10-18 — Wide equations shrink to fit instead of clipping

- Root cause of the clipped `L=λ/2 ⇒ λ=2L`: equation font size comes from a LaTeX
  length heuristic (`equationFontSizeForContent`) that cannot see KaTeX spacing such as
  `\quad` or relation gaps, and nothing compared the real rendered width with the box.
  Overflow was hidden by the box's `overflow: hidden`.
- Added `FittedEquation`, used by both the board painter and annotation overlays. In a
  layout effect (before paint) it measures the union of KaTeX `.base` runs against its
  box in screen pixels and, only when ink overflows, shrinks the font proportionally
  with a 4% margin, floored at 8 px. Box geometry, layout, lints, reveal clipping, and the
  manifest are unchanged, so committed-prefix stability is unaffected. Equations that
  already fit keep the heuristic font.
- Verification: 5 new tests (fit math, overflow shrink, no-op when fitting, floor);
  frontend 548 tests in 62 files, backend 354, ESLint, Ruff, and the production build
  pass. Local diagnostics replay of the retained Standing waves stream at 1440×900:
  the equation now renders at 25.9 px with 258 px of ink in a 269 px box, fully visible.
  No API call was made.
- Still open from the smoke review: "Nodes: x = 0 and x = L" wraps mid-expression, and
  the board's lower half stays empty.

## 2026-10-18 — One owner-approved GPT-6.1 Sol lesson smoke

- Exactly one paid `POST /lesson` call, no retry: topic "Standing waves" (a topic that
  failed layout on the qualified Luna v2 batch), `gpt-6.1-sol`, `reasoning.effort: low`,
  prompt v2 (`bdcb2d54…aaa5c`). Raw validated NDJSON is retained at
  `artifacts/evidence/gpt61sol-smoke-20261018/standing-waves.ndjson`.
- Result: 4 accepted steps, 0 repairs, 0 drops, 0 sanitized. Request to first valid step
  **14.1 s**; request to `lesson.done` **32.5 s** (would have exceeded the old 30 s
  timeout). The Luna/none baseline was 1.4–2.6 s to first step, so first-ink latency is
  roughly 5–10× worse.
- Local diagnostics review (no API call) at 1440×900: content is physically correct,
  no text/ink collisions, clear separation of derivation (left) and graph (right). One
  renderer defect: the equation `L=λ/2 ⇒ λ=2L` renders 330 px of KaTeX into a 269 px
  box and is clipped to "λ = 2". Also "Nodes: x = 0 and x = L" wraps mid-expression,
  and the lower half of the board is unused.
- Token usage was not captured: uvicorn does not print `app.*` INFO logs. The backend now
  attaches an INFO handler and logs `lesson_generation_usage` counts (no content), so the
  next lesson records exact cost. Estimated cost of this call: ~1–2¢ (hard ceiling 7.4¢
  from the 7,200-token output cap).

## 2026-10-18 — Board model moved to GPT-6.1 Sol; Realtime memory widened

- Owner-selected configuration after reviewing current OpenAI docs (GPT-6 family now
  supersedes GPT-5.6): `BOARD_MODEL=gpt-6.1-sol`, `BOARD_REASONING_EFFORT=low`,
  `BOARD_PROMPT_VERSION=v2`. Voice stays on `gpt-realtime-2.1-mini`. Motivation:
  owner reported messy/wrong drawings and the tutor forgetting context.
- Settings now allow `gpt-6.1-sol`, `gpt-6-luna`, and `gpt-6-astra` alongside the
  GPT-5.6 tiers, and reject `none` for 6.1 Sol and Astra (upstream does not accept it).
  The continuation schema model enum was widened to match.
- Reasoning tokens count against `max_output_tokens`, so every board-model request
  (lesson, continuation, repair, annotation, scratch, vision smoke) adds a 4,000-token
  headroom at `low` and none at `none`. Lesson timeout default 30→45 s and
  annotation/scratch 15→25 s to absorb reasoning latency.
- Realtime memory: rolling `post_instructions` limit 4,000→16,000 tokens (model window is
  128K) and the per-connection auto-disconnect budget 50,000→300,000 tokens. The old
  budget was reached after a handful of exchanges because every response re-reads its
  context, which reset the conversation.
- The M3 evaluation harness intentionally stays pinned to `gpt-5.6-luna`/`none`; its
  tests now construct that configuration explicitly instead of relying on defaults.
- Verification: backend 353 tests, frontend 543 tests, ESLint, Ruff lint/format, and
  the production build pass. No credentialed call was made: GPT-6.1 Sol lesson quality,
  first-visible-ink latency, and per-lesson cost are unmeasured estimates (~6–10 s,
  ~$0.025/lesson). The next smallest task is one owner-approved live lesson.

## 2026-07-19 — Generic renderer-sampled tangents added after the roadmap pass

- Added schema **1.4** `tangent_at`: a line construction may target an already accepted
  curve at a data-space `x` with a bounded display length. It is intentionally not an
  analytic derivative claim. The browser uses the same finite 121-sample path it draws,
  accepts only one interior, smooth visible segment, and derives the tangent in the
  renderer's plot coordinates. Endpoints, off-board requests, discontinuities, and
  cusp-like local direction changes are closed isolated failures, leaving unrelated
  ink intact.
- The construction is generic for graph interpretation, calculus, and motion rather
  than specialized for a lesson topic. It keeps the prior-step source rule, schema
  budgets, browser/server reference parity, renderer-owned coordinates, and append-only
  layout behavior. A prefix-stability test specifically proves a later step cannot
  reposition an accepted tangent. Shared parity fixtures pin success, endpoint,
  off-board, cusp, and non-curve-source outcomes. The resolver policy revision is now
  `resolver-density-constructions-tangent-v3`, preventing this result from being mixed
  with earlier drawing evidence.
- Prompt v3, repair, and continuation instructions now describe the conservative
  qualification rule. Current prompt identities are board v3
  `8473ba97087119fd4d494366c6babf908a8b9086bce0c9859791770ddc1fd2f8`, repair
  `fd2101e6f12abce65ced2a40769f1da24c1cb19e80126762c8e7e847765eb174`, and
  continuation `d11fb1e75dc1a827888c9eb53d96aaf719f97516eb5bfc5542f895a5282ff9eb`.
  This is a new comparable configuration; no prior live evidence is treated as prompt-v3
  evidence.
- Verification: frontend **503 tests in 57 files**; backend **344 tests**; focused
  construction/parity tests (**36 frontend**, **33 backend**); frontend ESLint,
  generated-schema TypeScript, production Vite build, backend Ruff lint/format and
  compileall, offline fixture/retained-NDJSON rescore, and `git diff --check` all pass.
  The rescore preserves existing `region_crowded` findings rather than hiding them.
  No credentialed, voice, browser-model, annotation, image, or vision call was made.
- This deterministic extension does not promote a runtime experiment. One-shot remains
  the demo default, and resolved-stepwise, choreography, direct annotation overlays,
  widgets, and any model-tier or vision comparison remain gated by their separately
  owner-approved live evidence.

## 2026-07-18 — Drawing-intelligence deterministic phase boundary re-verified

- Completed the consolidated no-network gate after integrating the Phase 0–4 resolver
  work, Phase 5 attention rail, Phase 6A/6B evidence harness, and Phase 7 annotation
  whitespace fallback. The frontend suite passes **497 tests in 57 files** and the
  backend suite passes **339 tests**. Frontend ESLint, generated-schema TypeScript,
  the production Vite build, backend Ruff lint/format, Python compileall, and
  `git diff --check` pass. A targeted receipt test also proves that a continuation
  following a browser-filtered server step rotates its authenticated receipt over the
  browser-accepted projection plus the new accepted step, never the rejected raw op.
- The offline browser-owned rescore command replays all three cached lessons, all ten
  golden fixtures, and all ten retained validated NDJSON streams through the production
  decoder/resolver/renderer/lints without network access. It reports no fixture crash
  or drop and preserves closed `region_crowded` findings on the retained difficult
  streams rather than masking them as a successful rescore.
- Phase 0 is complete as deterministic evidence infrastructure: schema-1.1 records
  pin renderer, schema, resolver, prompt, and applicable live identities; can retain a
  redacted aborted attempt with its pre-dispatch spend; and reject mixed configurations.
  The one-shot/resolved-stepwise, vision-calibration, and model-tier comparisons remain
  separately owner-approved paid activities.
- Phases 1–4 are complete as deterministic resolver behavior: occupancy/candidate
  scoring and reading order, measured text/equation placement with safe fallback,
  five universal constructions, and append-only recovery/composition truth. Their
  human-quality and resolved-stepwise buffer/latency promotion gate remains unrun, so
  `VITE_LESSON_GENERATION=one-shot` remains the demo baseline.
- Phases 5–7 have only their safe deterministic portions: choreography remains off
  pending three cached human loops; the remote-audio and sentence-response paths are
  injected evaluation harnesses with no dispatcher or product pacing effect; and
  annotation whitespace remains off pending its direct-overlay live gate. Phase 6C
  beats and permanent Q&A micro-steps are correctly absent.
- Phase 8 projectile and Phase 9 board-agent work have not started because their
  explicit broader-M4/resolved-stepwise prerequisites are not yet evidenced. This is a
  deliberate roadmap gate, not a missing implementation disguised as completion.
- A diff-only secret-pattern scan found no key, bearer, or client-secret value. No
  credentialed, voice, microphone, browser-model, annotation-model, image, or vision
  call was made in this boundary.

## 2026-07-18 — Renderer-failure recovery closes the resolved-step loop

- Added a bounded browser recovery ledger for decoder drops and renderer geometry
  failures. It sends only closed failure codes, semantic op intent, source step/op
  indexes, unavailable element IDs, and a resolved zone/visible-neighbor set. Raw
  warning detail, exception text, SVG/HTML, screenshots, student content, and
  renderer records have no recovery-contract field and are rejected by schema.
- Preserved receipt authority across browser filtering by carrying the exact
  server-issued `receipt_prefix` alongside the browser-accepted prefix. FastAPI
  verifies the receipt against the former and accepts the latter only as an
  immutable ordered projection with exact recovery coverage for every omitted op
  or step. Inserted, rewritten, reordered, or unevidenced history fails before
  model dispatch. The same rule now covers later continuation responses: the
  browser retains each exact signed server step even when it accepts only sibling
  ops—or no op—and emits closed evidence for the filtered intent. The conservative
  duplicate-prefix request bound is therefore 320 KiB rather than the earlier
  incomplete 192 KiB estimate.
- A pending finding gets one bounded re-expression attempt with fresh IDs.
  Recovered and abandoned findings remain append-only tombstones, so later steps
  cannot resurrect a failed ID or create a dangling structured reference. A
  renderer/transport/validation failure settles recovery as the closed
  `recovery_abandoned` terminal and completes the already accepted lesson prefix;
  cancellation and supersession guards reject late results before state mutation
  or cached fallback.
- Resolved scenes now reserve the 30-element budget for every accepted root before
  optional composite subparts, keep root lint evidence, and discard lint IDs that
  are not actually present. This prevents rich diagrams from silently evicting
  their own accepted roots from continuation truth.
- Deterministic verification passed: 51 focused frontend recovery, scene, stream,
  continuation, stale/cancel, size, and redaction tests and 129 focused backend
  continuation/recovery/resolved-scene/API tests; the full suites pass with 473
  frontend and 311 backend tests. Full ESLint and Ruff lint/format, generated-schema
  TypeScript, the production Vite build, and `git diff --check` also pass. The
  expanded continuation prompt hash is
  `d85254f72da31ead61e941f31ad6159c6a3528b2f38f5bd6a78056484a4f6d95`.
  No credentialed, voice, board-model, continuation-model, annotation, image, or
  vision request was made. Human quality/latency promotion of resolved-stepwise
  generation remains a separate owner-approved live gate.

## 2026-07-18 — Resolved-step continuation contract authenticated and pinned

- Replaced the continuation endpoint's handwritten browser/backend agreement with
  `lesson-continuation.schema.json` plus generated TypeScript. Requests, accepted
  one-step responses, and clean terminals now share closed fields, reasons, repair
  totals, and board/repair/continuation/configuration identities. A continuable
  `lesson.done` must pair its flag with an authenticated receipt.
- The opening stream now signs an opaque HMAC receipt over request/client identity,
  the canonical accepted prefix and persistent plan, prefix version, cumulative
  repair use, and configuration identity. Every accepted continuation consumes that
  capability and returns a rotated receipt over the enlarged prefix. Prefix/plan
  tampering, repair-count downgrade, prompt/configuration drift, exact same-process
  replay, missing ordinary scene roots, and phantom ordinary scene IDs all fail
  before a model request. The process ledger stores only bounded receipt digests;
  HMAC state binding remains restart-verifiable, while exact replay memory resets on
  restart. Rotating the server-only API key invalidates outstanding receipts.
- Preserved the existing aggregate four-repair ceiling by initializing every
  continuation repair budget from the signed cumulative count and counting before
  dispatch. A repair transport timeout therefore returns the incremented total rather
  than erasing spend. The opening policy is now explicit: one or two validated steps,
  targeting two, with a one-step prefix still issuing a valid continuation receipt.
- Browser requests and responses validate the shared schema before use, rotate the
  receipt only after a decoded accepted step, reject stale/cancelled work, and end the
  accepted prefix cleanly on a closed terminal or unavailable continuation. The
  honest 3–5-step prefix plus bounded scene/plan remains below the explicit 320 KiB
  continuation request cap, including a second exact authenticated prefix for
  browser-filtered recovery. Composite virtual IDs remain a documented temporary
  reconciliation exception until the scene schema can carry explicit root identity.
- Focused deterministic verification passed: 125 backend tests across lessons,
  resolved scenes, API bounds, and prompt contracts; 24 frontend stream/continuation
  tests; focused ESLint; focused Ruff lint/format; generated-schema TypeScript build;
  production Vite build; and `git diff --check`. No credentialed, voice, lesson-model,
  continuation-model, annotation, image, or vision call was made.
- Current identities: board v3
  `a0ea53cec1c4443b6325b0d973186b3db1b8eddc4380aa6789eb23740157cb64`;
  repair `24658b3aaf17d6bd18a5de4e044c5da384b3dfc56123f9f0044f6ad839d9f34d`;
  continuation `94da5792d10f7e4c938244d936a053f8490694695e0decb04e640af2853d63a8`;
  combined configuration
  `a111e2c133a79c7d8b43182b11ffe771cac8b0687fd25495953650d81706a3dc`.

## 2026-07-18 — Drawing-intelligence Phase 0 evidence foundation

- Added `drawing-experiment-record.schema.json`, a 64 KiB, 20-topic maximum record
  for one homogeneous configuration. It binds model/reasoning, board and repair
  prompt hashes, schema version, all drawing experiment flags, predeclared
  request/model-call ceilings, decision thresholds, closed per-topic outcomes,
  renderer findings, numeric human ratings, and a promote/park/remove decision.
- Added a strict offline backend verifier that recomputes the canonical configuration
  SHA-256, topic/rating identity and order, aggregate metrics, timing consistency,
  ceilings, and decision completeness. File loading rejects duplicate JSON keys;
  the schema exposes no raw model, student, image, Base64, exception, or renderer-state
  payload field.
- Added `ExperimentBudgetGuard`; experiment runners claim requests and model calls
  before dispatch, so failed transports remain counted and a ceiling is enforced
  before network activity rather than merely audited afterward.
- Pinned the optional vision-proxy check to one offline, tie-aware Spearman calculation:
  5–20 retained topics, threshold 0.70, and at least three distinct human score levels.
  The current retained M3 binary `layout_pass` judgments are explicitly rejected as
  insufficient ordinal ratings. No image was read and no API call was made.
- Added a machine-readable flag registry and a normative lifecycle table covering
  tldraw, paced sync, partial ink plus `lesson.ink_delta`, direct Q&A drawing, and
  resolved-stepwise generation. Each has current fallback, concrete promote/park/remove
  conditions, and a review milestone. `VITE_CHALK_MODE=demo|diagnostics` is classified
  as operational rather than an experiment, and registry tests pin `.env.example`
  defaults and documentation parity.
- Focused verification passed: 12 new experiment tests; 20 combined experiment,
  retained M3 evidence, annotation-vision refusal/shape, and resolved-scene tests.
  Focused Ruff lint and formatting pass for the new implementation and tests. A
  whole-backend Ruff run was attempted and stopped on a concurrently added unrelated
  `backend/app/continuation_contract.py:244` E501; this Phase-0 slice did not edit that
  file and does not claim a whole-backend lint pass.
- Remaining Phase-0 interface gap: the verified record is ready to receive offline
  `topic_results`, but the producer that replays retained NDJSON and golden/cached
  fixtures through the production browser resolver/lints is not implemented in this
  backend slice because renderer geometry and font measurement must not be duplicated
  in Python and those frontend files are under concurrent Phase 1 work. Live one-shot
  comparisons and any ordinal human rescoring/vision calibration remain separately
  owner-approved gates.

## 2026-07-18 — Resolved-state drawing feedback loop implemented behind rollback

- Added shared, independently validated `lesson-plan` and `resolved-board-scene` contracts. The plan contains one visual structure, 3–5 progression beats, and an optional checkpoint position. The renderer scene contains at most 30 unique IDs with normalized actual bounds, concise semantic summaries, committed/buffered state, and at most 12 closed lint findings; it carries no raw SVG/tldraw records or student utterance.
- Added opt-in `resolved_stepwise` opening generation: the model must emit the plan first and then exactly two opening steps. The browser can begin the existing narration/ink path from that buffer while future steps are replenished. The qualified one-shot stream and all cached lessons remain unchanged under the default `VITE_LESSON_GENERATION=one-shot` rollback.
- Added stateless `POST /lesson/continue`. Each request replays the complete accepted prefix through the production validator to reconstruct IDs, axes, checkpoints, and budgets; verifies request/prefix identity against the resolved scene; carries cumulative repair use under the existing four-call lesson ceiling; and requests exactly one next step. Every response is either one sanitized/validated step or a closed clean-terminal reason. Missing, invalid, stale, timed-out, or unavailable continuation therefore finishes the accepted prefix instead of displaying a spinner or stalling narration.
- FastAPI remains the only board-model client. The browser owns only timing, accepted-prefix state, and deterministic renderer truth. Continuations use independent `store:false` Responses requests and do not require server-side lesson storage or upstream conversation persistence.
- Added optional authored `meaning` only for diagram primitives and bare sketch/line operations whose deterministic summary would otherwise be generic. Existing descriptive labels remain sufficient; meaning is not mandatory boilerplate. Renderer manifest summaries preserve it for subsequent drawing steps and voice grounding.
- Deterministic evidence: focused resolved-scene parity, opening-buffer, prefix-replay, one-step continuation, invalid-prefix, cancellation/terminal, and browser validation tests pass. The full gate passes 330 frontend tests across 39 files and 236 backend tests. No credentialed, voice, board-model, continuation-model, annotation, image, or vision request was made.
- Prompt identities after schema expansion: board v3 `22e8fad59b1ec436ffc2228e6fdc60ff308fb2bd3bbcf133567e7e76116fd503`; repair `24658b3aaf17d6bd18a5de4e044c5da384b3dfc56123f9f0044f6ad839d9f34d`; continuation `85eb9cae57d8499ef081c6b5cd2126edb231e055c2ad0aedc1a61231e850f5e1`.
- Remaining gate: run a separately approved small live comparison of one-shot versus resolved-stepwise on the same difficult topic, measuring first-visible-ink, continuation completion before buffer exhaustion, total calls/repairs, layout findings, narrative coherence, and human drawing quality. Until it passes, one-shot remains the default.

## 2026-07-18 — tldraw technique adaptation, safely gated

- Added a renderer-neutral `BoardRenderer` boundary around CHALK's existing layout, geometry, reveal, manifest, and lint truth, plus exact reversible `BoardPatch` transactions. The rough.js/SVG board remains the default and cached lesson files remain untouched.
- Added schema-1.2 generic `place`, `align`, `stack`, and `distribute` relations. Only roots introduced in the current step move; axes curves, shared-canvas children, and anchored dependants follow their root, while committed prior-step ink remains immutable. Backend and browser reject unsafe/unknown/forward relations without sacrificing otherwise valid ops.
- Classified deterministic lints by estimated/measured/semantic evidence, added actual SVG `getBBox()` overlap/bounds measurement, stable connected finding groups, and a one-attempt `VisualRepairGate`. No visual-repair endpoint or model call is enabled; estimated findings cannot authorize spend.
- Pinned `tldraw` 5.2.5 behind the exact `VITE_BOARD_RENDERER=tldraw` flag and a lazy import. Locked custom shapes reuse CHALK's already validated geometry and reveal scheduler, preserving mid-stroke progress rather than giving the editor control of animation. The licence remains backend-only and is projected only from a no-store localhost endpoint. A browser comparison exposed that locked shapes initially rejected progress updates; transactions now use `ignoreShapeLock`, and both default and experimental boards rendered seven expected cached-projectile elements after the correction.
- Added board-only tldraw capture that exports only fully committed CHALK shapes over the 1600×900 crop, excluding app chrome, controls, the orb, and provisional ink. Added a structured-authoritative question builder that accepts only bounded PNG/JPEG/WebP data URLs under the exact experiment mode and emits image-free diagnostics. It is not connected to Realtime or the product request path; the existing owner-gated two-call annotation vision smoke was not run.
- Reserved a bounded `lesson.ink_delta` envelope and added an append-only request-local provisional store. It requires a separately accepted op header and enforces monotonic per-stroke sequence, finite normalized points, total budgets, stale rejection, immutable prefixes, and cancellation/discard cleanup. The backend emits no delta and the default renderer consumes none; a future producer requires a measured latency win.
- Deterministic evidence: 323 frontend tests across 37 files and 231 backend tests passed. Frontend ESLint, TypeScript, Ruff lint/format, the production build, Python compileall, and `git diff --check` passed. The default application chunk is 1,081.57 kB (323.27 kB gzip); the lazy tldraw experiment adds a 1,676.75 kB (505.44 kB gzip) JavaScript chunk and 77.53 kB (14.38 kB gzip) CSS, which is too material to accept without the documented visual/performance comparison. `npm audit --omit=dev` could not reach the registry in the restricted environment, so no fresh audit result is claimed. No credentialed, microphone, lesson-model, annotation, screenshot-vision, or other paid call was made.
- Current expanded prompt hashes: board v3 `d08d567be2edb1d9ac50acba3192f0211bb3e9f2cd78544daba914ac0507420e`; repair `22c74a5debd1c3b982f8d01826f4cdae18080edd7a0f6fadfaaf52460e6940fd`.
- Remaining evidence gates: blind retained visual comparison for both renderers; exact freeze/resume and frame-time rehearsal on the tldraw flag; native binding/typography value assessment; separately approved two-call structured-versus-image smoke; and a separately designed partial-ink producer/latency experiment. Until those pass, tldraw, vision grounding, one-pass repair, and partial ink are experiments—not demo defaults.

## 2026-07-18 — Generic spatial drawing and question grounding

- Rejected and removed the topic-specific long-division renderer before it entered the completed path. There is no `long_division` schema operation, validator, helper, prompt rule, generated type, or retained fixture.
- Extended the reusable composite `diagram` canvas with bounded positioned text, closed alignment/size choices, and deterministic reveal timing. The same structure supports aligned arithmetic, derivations, tables, geometry, mechanics, and annotated diagrams without adding a renderer per topic.
- Added deterministic collision candidates against both other labels and exact renderer-owned ink bounds, plus canvas clamping, for incidental primitive labels while preserving deliberately authored text coordinates. Smooth curves, shapes, arrows, labels, and writing now accumulate within one coherent local coordinate system.
- Made completed composite subparts independently groundable through stable renderer-owned IDs, exact bounds, and semantic direction/position summaries. Future and partially revealed groups remain absent. Detected student speech queues a fresh renderer-state `session.update` before the tutor answers.
- Deterministic evidence: 295 frontend tests across 28 files and 227 backend tests passed; focused drawing/manifest/Realtime checks passed; frontend ESLint, TypeScript, Vite production build, Ruff lint/format, and `git diff --check` passed. Cached lessons were not edited. No credentialed, microphone, image, or vision call was made.
- Read-only localhost smoke after the backend restart: the app reloaded with the cached board SVG present, the voice loop disconnected, and no permission prompt or external request initiated.
- Expanded prompt hashes: board v3 `c810a19d14e558841eb28dc6dfa6b4cf6bb16793b48ab810da5478b378294e69`; repair `051174aaddd4bab028939ed7246a8401b5c9c188edaf265f0f2f3e5d1df31ec3`. A fresh live generated-topic run and voice-question rehearsal remain required before claiming model-level quality or end-to-end grounding.

## 2026-07-18 — Blank-board framing-response race fixed

- Traced the intermittent “one sentence, then no drawing” failure to a split busy definition: the UI treated stopped playback as idle while the response coordinator still retained the framing response until `response.done`. The first lesson narration was rejected during that hidden settlement interval, and its retry effect had no later dependency transition to wake it.
- Added public `responseInFlight`, derived from the coordinator's pending plus bound-response inventory, and made lesson auto-start, narration scheduling, and lesson controls use that authoritative busy boundary alongside uncoordinated active/playback IDs.
- Added a regression that sends `output_audio_buffer.stopped` before `response.done`, proves narration remains blocked during settlement, then proves it becomes requestable immediately after the coordinator releases the response.
- Deterministic verification: 290 frontend tests across 28 files, ESLint, TypeScript, and the Vite production build passed. No microphone session or credentialed API call was used; one live end-to-end rehearsal remains appropriate before recording.

## 2026-07-18 — Liquid-glass board-first workspace overhaul

- Replaced the nested prototype-card composition with a restrained application header, one lesson command bar, an unwrapped near-full-width board workspace, and simplified lesson actions. The desktop shell now scales to 1680px while retaining responsive breakpoints.
- Introduced a cohesive liquid-glass visual system with atmospheric color fields, translucent refraction layers, one-pixel specular highlights, glass-aware control states, a precision board bezel, and restrained depth shadows. The board itself remains opaque and high-contrast so the visual treatment never competes with instructional ink.
- Replaced the separate Connect microphone and Speak controls with one accessible orb inside a compact, glass-backed voice dock fixed at the bottom center. Its action is state-aware: connect while offline, start listening while connected, and stop listening while active. Space-to-speak and the explicit Disconnect escape hatch remain available.
- Added clear hover, keyboard-focus, speaking, and listening treatments without changing the Realtime state machine, drawing engine, or microphone safety boundaries.
- Verification: frontend ESLint and production build passed; a read-only local browser check at 1280x720 measured a 1230x692 board, 58px orb, and 238x78 centered voice dock. No microphone permission or live API call was initiated.

## 2026-07-18 — Composite drawing intelligence implemented

- Added one bounded `diagram` operation with up to sixteen semantic line, through-point smooth, rectangle, ellipse, arc, and point primitives on a shared normalized y-down canvas. Existing standalone physics marks and all three cached schema-1.0 lesson files remain unchanged.
- Kept geometry renderer-owned: the browser derives cubic paths, exact cubic/arc extrema, stable rough.js ink, arrowhead tangents, conservative visible bounds, content-weighted animation, and primitive-by-primitive reveal. Arbitrary SVG, CSS, markup, and rough.js options remain outside the wire contract.
- Added matching backend/browser semantic rejection for zero-length paths, terminal arrows without direction, zero-area rectangles, and sub-degree arcs. The shared sanitizer parity fixture now covers nested composite labels and placement points. Prompt v3 and repair guidance prefer one coherent diagram when the concept needs several related marks; the schema-generated contract remains bounded at 3,233 characters.
- Deterministic evidence: 289 frontend tests across 28 files and 227 backend tests passed; frontend ESLint, TypeScript, Vite production build, Ruff lint/format, Python compileall, and `git diff --check` passed. The root `make test` frontend half passed, while its backend `uv` launcher could not access the sandboxed home cache; the same locked backend suite passed directly through `backend/.venv`.
- Expanded prompt hashes: board v3 `b936b57dd44f7c74b95406b27638455534eefae523d26d2e24769c5ccfb9128f`; repair `200fe1cc30c964e6ff8cb94f111f365b9fa90b975e9296d0d86778e0ce36dcaf`. No credentialed or vision call was made. Prompt-v3 live qualification and the separately owner-gated screenshot A/B remain pending.

## 2026-07-15 — M1 scaffold and Realtime vertical slice

Status: **complete**. M1 passed deterministic checks, live voice, dummy-tool continuation, layered cost controls, metadata-only privacy auditing, and five consecutive playback-backed interruptions with a separate positive owner perception report.

### Scope and decisions

- Runtime scope is explicit localhost only: frontend `http://localhost:5173`, backend `http://127.0.0.1:8000`, and CORS restricted to the exact frontend origin.
- `uv` provisions an isolated Python 3.12 backend environment; the installed system Python is not used as evidence of compatibility.
- The development Realtime model defaults to `gpt-realtime-2.1-mini`, and the voice defaults to `marin`. `cedar` remains an audition choice; `gpt-realtime-2.1` is reserved for recording after the development path passes.
- The standard API key is server-only. Browser configuration may expose the non-secret API base URL but never the key.
- The browser persists a random client UUID; the backend hashes `SAFETY_IDENTIFIER_SALT + ":" + UUID` with SHA-256 and sends only that digest as `OpenAI-Safety-Identifier`. The development salt is non-secret domain separation, not authentication.
- Live API checks are opt-in, credentialed, nondeterministic checks and do not belong in default automated test runs.
- Credentialed checks use a minimal live budget: `gpt-realtime-2.1-mini`, short synthetic prompts and responses, no automatic retries or loops, and immediate disconnect after the required evidence. Larger-model, extended-session, and batch-evaluation runs require explicit owner approval.
- Realtime cost controls are layered: 256 maximum output tokens per response, a 4,000-token post-instruction rolling context with 0.8 retention, no input transcription, cumulative numeric usage from `response.done`, and automatic disconnect at 20,000 billed session tokens. Reconnecting starts a new client-side budget, so this is not an account-wide spending limit.
- Root setup intentionally does not claim that board generation, synchronized ink, or other M2+ behavior exists.

### Work completed

- Added `.gitignore` rules for credentials, dependency caches, build output, raw diagnostics, and local recordings.
- Added `.env.example` with server-only key placement and centralized model, voice, origin, and future feature defaults.
- Added root setup, run, test, lint, and build documentation plus Make targets.
- Added an explicit dummy-tool procedure, five-interruption checklist, redaction rules, and prototype limitations.
- Added a strict FastAPI health/session service with a 4 KiB pre-parse request cap, canonical UUIDv4 contract, exact upstream routing, hashed safety identifier, allowlisted public configuration, and safe correlated errors.
- Added a browser WebRTC adapter with microphone gating until `session.updated`, terminal cleanup, reconnect isolation, server VAD, a validated `debug_echo` tool, bounded metadata-only traces, and separate measured/perceived interruption evidence.
- Added deterministic coverage for delayed microphone races, failed connections, cancelled tool calls, tool-output continuation, stale response events, trace sanitization, and loopback-only API routing.
- Added playback-buffer lifecycle tracking so an audible response remains interruptible after generation completes, plus safe token accounting, a visible budget, per-response/context caps, and budget-triggered disconnect.
- Audited reusable open-source options. OpenAI's TypeScript Agents SDK is the preferred greenfield choice, but replacing the already tested M1 adapter before its live gate would add migration risk without removing CHALK's custom evidence work.

### Validation evidence

Append exact commands and results below; do not convert planned checks into passes.

| Date/time (Asia/Kolkata) | Check | Command/procedure | Result | Notes/evidence |
|---|---|---|---|---|
| 2026-07-15T21:22:45+0530 | Root setup syntax | Source `.env.example`; dry-run `install`, `dev-backend`, `dev-frontend`, `test`, `lint`, and `build` Make targets; scan for trailing whitespace | Pass | Dotenv values parsed as expected, all targets parsed, and no trailing whitespace was found; this was a dry run, not runtime validation |
| 2026-07-15T21:22:45+0530 | Local tool availability | `uv --version`, `npm --version`, `node --version`, `make --version` | Pass | uv 0.11.25, npm 11.12.1, Node v25.9.0, GNU Make 3.81; application compatibility is validated separately |
| 2026-07-15T21:22:45+0530 | Live credential prerequisite | Presence-only checks; no value printed | Not configured | Root `.env` absent and `OPENAI_API_KEY` unset, so no live API check was attempted |
| 2026-07-15T21:26:13+0530 | Backend unit tests | `uv run --project backend pytest` | Pass | 17 passed in 0.28s on uv-provisioned Python 3.12.13; one upstream Starlette `httpx` deprecation warning remains |
| 2026-07-15T21:26:13+0530 | Backend lint and format check | `uv run --project backend ruff check backend`; `uv run --project backend ruff format --check backend` | Pass | All checks passed; 7 files already formatted |
| 2026-07-15T21:26:13+0530 | Backend syntax build | `uv run --project backend python -m compileall -q backend/app backend/tests` | Pass | Command exited 0 with no output |
| 2026-07-15T21:27:50+0530 | Documented backend start and health | `make dev-backend`; `curl --fail http://127.0.0.1:8000/health` | Pass | Uvicorn bound to 127.0.0.1:8000; health returned `configured=false`, the mini model, and `marin`, with no secret value |
| 2026-07-15T21:27:50+0530 | Missing-key session failure | POST synthetic opaque IDs to `/session` with no key configured | Pass | Returned redacted HTTP 503 `openai_not_configured`; this is not a live OpenAI call |
| 2026-07-15 | Fresh dependency install | `make install` | Pass | `npm ci` installed the checked-in frontend lock with 0 audit findings; uv provisioned the locked Python 3.12 backend environment |
| 2026-07-15 | Local browser/no-key smoke | Start both documented services, open the Vite UI, inspect console, request `/session`, exercise CORS and body-cap failures | Pass | UI rendered without console errors; health was safe; missing key returned correlated 503; allowed CORS preflight returned 200; 5,000-byte request returned safe 413. This did not exercise OpenAI or microphone capture |
| 2026-07-15T22:11:11+0530 | Final root deterministic tests | `make test` | Pass | 57 frontend tests passed in 6 files; 38 backend tests passed on Python 3.12.13; one upstream Starlette TestClient deprecation warning remains |
| 2026-07-15T22:11+0530 | Final root lint and build | `make lint`; `make build` | Pass | ESLint, Ruff lint/format, TypeScript, Vite production build, and Python compileall passed; Vite built 34 modules |
| 2026-07-15T22:13:26+0530 | Credential prerequisite recheck | Presence-only root `.env` and environment checks; no value printed | Not configured | Root `.env` remains absent and `OPENAI_API_KEY` remains unset |
| 2026-07-15T22:13:26+0530 | Dependency/bundle/log scan | `npm --prefix frontend audit --omit=dev`; scan `frontend/dist` for key/test-secret patterns; scan application source for console calls | Pass | npm reported 0 vulnerabilities; scans found no matching values or console calls |
| 2026-07-15T22:16:03+0530 | Requirement-level deterministic completion audit | Reconcile every M1 work item and exit condition against current source, tests, documentation, runtime smokes, and missing live evidence; rerun `make test`, `make lint`, `make build`, `git diff --check`, bundle secret scan, and credential presence checks | Deterministic pass; live gate pending | 57 frontend and 38 backend tests passed; lint/build/diff/secret scans passed. Root `.env` is absent and `OPENAI_API_KEY` is unset, so WebRTC audio, dummy-tool continuation, and five human interruption trials remain unproven |
| 2026-07-15T22:20:38+0530 | Live client-secret and WebRTC smoke | Add the provided key only to ignored root `.env`; start `make dev-backend` and `make dev-frontend`; connect from the Codex in-app browser; inspect metadata-only UI and backend access output | Partial pass | `.env` is ignored; `/health` reported configured=true, `gpt-realtime-2.1-mini`, and `marin`; `/session` returned 201; UI reached connected after session acknowledgement; assistant audio response metadata completed without a browser error. No credential value was printed or retained as evidence |
| 2026-07-15T22:39:08+0530 | Supplied trace audit | Parse the attached metadata-only trace and inspect only event types, timing, status, numeric counts, and sanitized IDs | Partial pass; instrumentation defect found | Chrome 150 trace had 258 entries over 47.8 s, five completed responses, a confirmed `debug_echo` round trip, four speech turns, and one real barge-in with `output_audio_buffer.cleared` plus `conversation.item.truncated`. It contained zero local interruption markers because generation had completed while output audio was still playing |
| 2026-07-15T22:46:47+0530 | Playback/cost-control implementation | Add output-buffer lifecycle tracking, completion/clear ordering coverage, late-stale invalidation, response usage extraction, usage UI/export, 256-token response cap, 4,000-token rolling context, and 20,000-token auto-disconnect; run `make test`, `make lint`, `make build`, and `git diff --check` | Pass | 64 frontend and 38 backend tests passed; all lint/build/diff checks passed. Live cost settings and corrected markers still require one short acceptance retest |
| 2026-07-15T22:45:49+0530 | Updated dashboard smoke | Inspect the disconnected localhost UI and browser console without connecting the microphone | Pass | Token budget rendered as `0 / 20,000`, the four-card layout was visually intact, and no browser warning/error was present. This check made no Realtime call and consumed no API tokens |
| 2026-07-15T22:57:28+0530 | Second supplied trace audit and false-positive correction | Reconcile each local marker against output playback and server settlement; tighten eligibility to confirmed audible playback; rerun `make test`, `make lint`, `make build`, and `git diff --check` | Partial live pass; deterministic pass | Trace recorded all configured cost controls and 3,507 / 20,000 tokens. Four markers followed output playback and clear/truncation with zero stale events. Marker 3 occurred before playback and cancelled a zero-token response, so it was rejected. 64 frontend and 38 backend tests plus all lint/build/diff checks pass |
| 2026-07-15T23:01:10+0530 | Final live M1 acceptance | Audit all five markers against prior output playback, buffer clear, conversation truncation, settlement, stale output, numeric usage, cost configuration, privacy allowlists, and the owner's separate perception report | Pass | Five playback-backed interruptions; five clears; five truncations; five successful settlements; zero stale events; 0–0.1 ms local handler-state stop; owner: “Wonderful. Worked well.”; 5,378 / 20,000 tokens; no forbidden content/secret fields. ID-free summary checked in under `artifacts/evidence/` |
| 2026-07-15T23:05:22+0530 | Final clean milestone gate | Parse the evidence JSON; run `make test`, `make lint`, `make build`, and `git diff --check` | Pass | 64 frontend and 38 backend tests passed; ESLint, Ruff lint/format, TypeScript, Vite, Python compileall, JSON parsing, and diff checks passed |

### Live Realtime evidence

Complete. Client-secret minting, WebRTC connection, session acknowledgement, two-way voice, dummy-tool continuation, layered cost controls, and five consecutive playback-backed interruptions passed. The final trace contains no stale-output event and passed the strict metadata allowlist audit.

The final 45.7-second acceptance trace used 5,378 tokens, or 26.9% of the per-connection guardrail. Future live checks keep the same narrow budget policy: mini model, short responses, no automatic retries, and prompt disconnect after the required evidence.

Configuration used:

| Field | Observed value |
|---|---|
| Date/time | Final trace generated 2026-07-15T23:01:10+0530 |
| Browser and version | Chrome 150.0.0.0 on macOS, from the exported user agent |
| Realtime model | `gpt-realtime-2.1-mini` |
| Voice | `marin` |
| VAD type/settings | `server_vad`; threshold 0.5, prefix padding 300 ms, silence 500 ms, create/interrupt response enabled; acknowledgement observed through connected state |
| Session payload (redacted) | Second export captured audio-only output, 256 output-token cap, server VAD, 4,000-token/0.8-retention truncation, and disabled input transcription |
| Connected/session events observed | `session.created`, client `session.update`, and `session.updated` |
| Output transcript event observed | `response.output_audio_transcript.delta` and `.done` metadata observed |
| Tool-call/output events observed | Function-call argument deltas/done, local `tool.output_sent`, client `conversation.item.create`, client `response.create`, and local `tool.round_trip_confirmed` |
| Interruption cancellation/truncation events observed | Five `output_audio_buffer.cleared` events immediately after their speech starts, each followed by `conversation.item.truncated` |
| Response trigger after tool output | Yes; the client sent `response.create` and continuing output was observed |
| Redacted trace location | Full traces remain user attachments; checked-in aggregate is `artifacts/evidence/m1-realtime-acceptance-summary.json`. Final trace: 297 entries generated 2026-07-15T17:31:10.193Z |

Second-trace token usage: 3,507 total; 2,687 input; 820 output; 1,984 cached input; 184 input-audio; and 472 output-audio tokens. This is 17.5% of the per-connection guardrail. The approximate dollar range above is an inference because the trace retains total cached tokens but not their cached audio/text split; the API dashboard remains authoritative.

Final-trace token usage: 5,378 total; 4,008 input; 1,370 output; 3,200 cached input; 354 input-audio; and 888 output-audio tokens. This is 26.9% of the per-connection guardrail.

Dummy-tool result: **pass**. The trace contains the function-call arguments completion, validated function output, explicit `response.create`, and continuing assistant output confirmed by `tool.round_trip_confirmed`.

Pre-fix interruption audit: the trace contains four user speech turns, but only the last began while output audio was still playing. That turn produced an immediate server buffer clear and conversation-item truncation, matching the user's perceived result. The UI did not create a marker because it had cleared `activeResponseId` at `response.done`, roughly 8.7 seconds before playback was interrupted. The corrected client now follows output-buffer playback events; the table below remains pending until retested.

Second-trace audit: five local markers settled as success with zero stale events, but only markers 1, 2, 4, and 5 had prior `output_audio_buffer.started` evidence. Marker 3 was created 0.2 ms after `response.created`, before playback, and its `response.done` was cancelled with zero usage. It is treated as a pre-playback turn collision rather than an audible interruption.

Final-trace audit: every marker had prior matching `output_audio_buffer.started` evidence. Each speech start synchronously deactivated local teaching state, then received `output_audio_buffer.cleared`, a successful settlement, and `conversation.item.truncated`. No stale-output metadata followed any marker. The trace dropdowns remained `not-recorded`; the owner separately supplied the overall perceptual judgment “Wonderful. Worked well.” This is recorded as an overall judgment, not misrepresented as five per-run “Immediate” selections.

Five-interruption record:

| Run | Active response before speech | Speech-start marker | Local teaching state stopped | Stale continuation absent | Local stop latency | Perceived audio stop | Result |
|---:|---|---|---|---|---|---|---|
| 1 | Yes; playback started | Yes | Yes | Yes | 0.0 ms | Worked well (overall owner report) | Pass |
| 2 | Yes; playback started | Yes | Yes | Yes | 0.0 ms | Worked well (overall owner report) | Pass |
| 3 | Yes; playback started | Yes | Yes | Yes | 0.1 ms | Worked well (overall owner report) | Pass |
| 4 | Yes; playback started | Yes | Yes | Yes | 0.0 ms | Worked well (overall owner report) | Pass |
| 5 | Yes; playback started | Yes | Yes | Yes | 0.0 ms | Worked well (overall owner report) | Pass |

Do not infer perceived audio-stop latency from the local-state timing. Do not claim the original `<300 ms` target unless the relevant metric was actually measured.

### Known limitations and skipped checks

- M1 live acceptance is complete. The separate OBS/system-audio recording setup remains unverified and belongs to later rehearsal work.
- Account access to `gpt-realtime-2.1-mini` is verified; the optional larger Realtime model and future board model remain unverified.
- Microphone permission and WebRTC stability passed in Chrome 150. OBS/system-audio capture and the eventual recording setup remain unverified.
- Backend tests currently emit one upstream Starlette TestClient deprecation warning suggesting an unfamiliar `httpx2` package. It does not affect production runtime; the package was not added without a justified dependency review.
- This localhost prototype has no authentication, persistence, multi-user isolation, deployment hardening, or production child-safety review.
- OpenAI receives live audio during use. No claim of local-only processing is made.
- No student audio, images, names, or raw utterances should be retained as evidence; use synthetic test speech and redacted event metadata.
- The API key was supplied through the conversation for this run. It is stored only in ignored `.env`, but it should be revoked and replaced after validation because chat disclosure is outside the intended secret-handling path.

### Discoveries and corrections

- The initially proposed root command `uv run --project backend uvicorn app.main:app ...` failed because selecting a uv project does not change the process working directory. The documented Make target now passes `--app-dir backend`; it was retested from the repository root with `/health` returning HTTP 200.
- Root pytest likewise needed the backend config and test path explicitly; `make test` now uses `-c backend/pyproject.toml backend/tests`.
- Pydantic field limits do not enforce a byte cap before JSON parsing. A middleware-level 4 KiB body cap now rejects both declared and streamed oversized requests.
- A configurable upstream host could exfiltrate the standard API key. The backend now pins `https://api.openai.com/v1/realtime/client_secrets`, disables redirects, and ignores proxy environment variables.
- Browser smoke testing exposed `Illegal invocation` because native `fetch` lost its receiver when stored. The client now binds the native function and includes a regression test.
- The final lifecycle audit found late-media leaks, incomplete terminal cleanup, reconnect state carryover, cancelled-tool execution, over-trusting trace IDs, and an arbitrary frontend API base. Each was corrected and covered before the final root suite.
- OpenAI's MIT-licensed TypeScript Agents SDK is a credible way to avoid greenfield Realtime transport work. For this branch, migrating before live validation would discard acceptance-specific coverage and still require custom trace/interruption logic, so it is recorded as a post-M1 consolidation option.
- The supplied trace disproved the assumption that `response.done` means audible playback has stopped. One response completed generation at 33.747 s but remained audible until speech at 42.471 s caused `output_audio_buffer.cleared`. The client now keeps teaching state active through the output-buffer lifecycle and retains settled-response mappings long enough to invalidate late stale deltas.
- The original exporter intentionally dropped the upstream `response.done.usage` object wholesale, so the first live run cannot be priced exactly from the retained trace. The exporter now keeps only bounded numeric token counts and still drops transcripts, audio, tool arguments, and credentials.
- The second trace exposed the opposite boundary: `response.created` can be cancelled by nearly simultaneous speech before any output begins. Such a zero-token pre-playback cancellation must not count toward an audible interruption streak. Marker creation and the visible “speaking” state now both require confirmed output-buffer playback.

### Rollback

- Keep all Realtime protocol payloads and event names inside the frontend adapter.
- If semantic VAD is unstable, revert to documented server VAD and record the comparison.
- Stay on `gpt-realtime-2.1-mini` during development unless measured behavior requires escalation.
- If WebRTC fails, diagnose the handshake and account/model access. Do not silently substitute a different transport.
- Revert root setup with a normal Git revert only after it is committed; do not destructively reset user work.

### Next smallest evidence-backed actions at M1 completion

1. Implement and validate the M2 shared lesson schema and minimal hardcoded projectile op set.
2. Build the deterministic seeded board renderer and fixed concurrent sync without spending live API tokens during routine development.

## 2026-07-15 — M2 established

M1 remains preserved at commit `e6822f5`, and M2 is isolated on `codex/m2-deterministic-board`. The M2 contract was re-audited against `AGENTS.md`, `ARCHITECTURE.md`, `PLANS.md`, and the original build plan. The audited contract overrides the original sequential fallback: fixed mode must begin narration and ink together and retain a partial stroke on interruption.

The dependency audit selected rough.js for stable seeded sketch geometry, KaTeX for formula layout with `trust: false`, mathjs for browser-side compilation after a stricter CHALK expression allowlist, and Ajv for runtime validation of the shared JSON Schema. These libraries replace commodity geometry/typesetting/parsing work; CHALK still owns schema budgets, reference validation, deterministic layout, per-op isolation, animation, state transitions, and Realtime coordination.

Live API use is not required for routine M2 implementation. Credentials remain local, ignored, and outside source control.

### M2 deterministic implementation evidence

The frontend now loads a four-step projectile program through the shared JSON Schema and generated TypeScript types. The minimal M2 DSL contains only `text`, `equation`, `sketch`, `axes`, and `curve`. Ajv validates the wire contract; the defensive decoder separately salvages valid sibling ops while rejecting over-budget steps, duplicate IDs, dangling anchors/axes, unsafe LaTeX, invalid axis ranges, and expressions outside CHALK's allowlist. KaTeX runs with `trust: false`; mathjs compiles only after the stricter AST walk and bounded finite sampling.

The SVG renderer resolves the 1600 × 900 region/anchor layout, caches rough.js geometry by validated op and stable element-ID seed, and reveals immutable paths with normalized dash offsets. The fixed-sync reducer begins animation only after narration activity, weights ops across the word-count duration, freezes without changing progress, rejects stale request/step/cycle events, and advances only after animation, response generation, audio-buffer stop, and a 260 ms drain guard. Realtime narration correlation retains both completion signals in either arrival order.

At 2026-07-15T23:34:37+0530, `make test`, `make lint`, `make build`, `npm --prefix frontend audit --omit=dev`, schema regeneration, and `git diff --check` passed: 91 frontend and 38 backend tests, zero production npm audit findings, and a clean local browser load with no console warning/error. The renderer suite proves stable paths and a visible one-third partial cannon stroke across rerender; the reducer suite completes three consecutive four-step runs. Vite reports a non-blocking chunk-size warning because the restricted mathjs/KaTeX application bundle is about 988 kB uncompressed (298 kB gzip).

At this stage the milestone was not yet accepted. Three live mini-model runs, human judgment of concurrent voice/ink and audible non-overlap, and one microphone interruption during a visibly partial stroke still remained. Deterministic tests were not substituted for that perceptual gate.

## 2026-07-16 — M2 seam audit and hardening

The independent M2 infrastructure audit in `artifacts/audit/2026-07-16-m2-infra-audit.md` was checked against the implementation rather than accepted wholesale. Seven M2-critical findings were confirmed and fixed: rejected narration now releases its correlation lock and resets the lesson safely; an in-progress lesson resets when its Realtime connection ends; the decoder enforces the shared 240-character script cap; lesson responses use bounded Realtime response metadata so an unrelated VAD response cannot claim the pending narration; animation starts only on `output_audio_buffer.started`, not transcript generation; curve validation and rendering share the axes domain and sample density while clipped runs render as separate segments; and dense region layout remains inside its region.

The response-correlation design follows the current official Realtime contract: client `event_id` identifies a rejected request, while response `metadata` disambiguates simultaneous responses. Metadata contains only CHALK request/step/cycle identifiers and purpose—never narration, transcript, audio, credentials, or tool arguments. Resume remains deliberately step-level: ink continues from its frozen position while the short current script restarts, but the button now remains disabled until Q&A generation/playback is idle. Word-level alignment is still out of scope.

The audit's request to commit immediately was rejected because `AGENTS.md` requires the relevant acceptance gate to pass first. Backend streaming/ASGI concerns belong to M3, while axes decoration and bundle splitting are non-gating cosmetics/performance work. `.env` remains ignored and no environment file is tracked.

At 2026-07-16T13:04:01+0530, 100 frontend and 38 backend tests passed. Frontend ESLint, TypeScript, Vite production build, backend Ruff lint/format, Python compileall, deterministic schema regeneration during `npm test`, `npm audit --omit=dev` (zero findings), `git diff --check`, and a disconnected in-app browser smoke passed. The browser rendered the M2 shell with the logical `1600 × 900` board, no board warning, and no console warning/error. The Vite chunk-size warning remains non-blocking. At that point the three-run microphone/perceptual gate remained pending, so no M2 commit had been created.

## 2026-07-16 — M2 live three-run evidence captured

The hardcoded four-step projectile lesson reached `DONE` three times in the Codex in-app browser using `gpt-realtime-2.1-mini` with voice `marin`. A playback-backed interruption froze visible ink at 19%, retained the partial stroke, settled with zero stale output, and resumed to completion. Later speech detections exercised the same recovery path repeatedly. Resume remained unavailable while Q&A audio was active and became available after `output_audio_buffer.stopped`; no simultaneous playback buffers were observed. The final session ended at 13,589 / 20,000 tokens and was disconnected immediately after `DONE 3 / 3`.

ID-free machine evidence is checked in at `artifacts/evidence/m2-deterministic-board-live-summary.json`. On 2026-07-16 the owner explicitly confirmed that ink felt concurrent with narration and that consecutive narration did not overlap. That confirmation closes the final live acceptance item; M2 now satisfies every exit condition and is eligible for its checkpoint commit.

## 2026-07-16 — M2 accepted

M2 is complete. The deterministic five-op whiteboard, validated renderer, fixed concurrent synchronization, response correlation, partial-stroke freeze/resume, disconnect/rejection recovery, three consecutive live four-step runs, and owner perceptual gate all pass. A final local checkpoint gate then passed with 100 frontend and 38 backend tests, lint/format, TypeScript/Vite build, Python compileall, zero production npm audit findings, valid evidence JSON, secret-pattern scanning, and clean diff hygiene. The passing checkpoint is the baseline for subsequent visual or pacing fine-tuning; response-coordinator, VAD-policy, out-of-band narration, manifests, live generation, and paced-sync changes remain deliberately outside this checkpoint.

## 2026-07-16 — M4 cached interaction slice

Status at this implementation checkpoint: **deterministic implementation complete; one minimal live rehearsal pending**. Superseded by the accepted live retest recorded below.

### Scope and decisions

- Default demo mode now uses a product tutor prompt, hides protocol evidence panels, and exposes no diagnostic tool. `VITE_CHALK_MODE=diagnostics` retains the M1/M2 evidence workflow and `debug_echo`.
- Sketch source strokes reveal sequentially by deterministic path-length weight; rough variants of one source stroke remain concurrent.
- A bounded response coordinator assigns manual narration/checkpoint prompts by metadata and VAD-created answers by an explicitly armed purpose. Resume clears a matching unbound Q&A reservation so a false detection cannot poison a later checkpoint.
- The tutor receives a compact manifest built only from successfully rendered, fully revealed geometry. Context and temporary checkpoint guidance replace session instructions serially and wait for `session.updated` before a dependent scripted response.
- Step 2 now has explicit checkpoint asking, listening, and feedback phases. Early student speech safely moves directly from asking to feedback, and advancement still requires generation, playback-stop, and drain settlement.
- Full-script resume remains the accepted M2 fallback. Word slicing was rejected because board progress is not spoken-word alignment. Transcript-delta pacing and duration-only false-freeze auto-resume remain deferred until measurement provides a reliable correction/classifier. Static whole-lesson context was rejected because it exposes future board state.

### Validation evidence

| Date/time (Asia/Kolkata) | Check | Command/procedure | Result | Notes/evidence |
|---|---|---|---|---|
| 2026-07-16T14:58+0530 | M4 deterministic implementation gate | `make test`; `make lint`; `make build`; `npm --prefix frontend audit --omit=dev`; `git diff --check` | Pass | 115 frontend tests in 16 files and 38 backend tests passed; ESLint, Ruff lint/format, TypeScript, Vite, Python compileall, production audit, and diff hygiene passed. The known non-blocking ~996 kB uncompressed Vite chunk warning remains. |
| 2026-07-16T14:58+0530 | Local serving check | Start Vite and request `http://localhost:5173/` with `curl --fail` | Pass | Vite served the current HTML on localhost. This is not visual browser evidence. |
| 2026-07-16T14:58+0530 | Disconnected browser smoke | Reload the existing localhost in-app browser tab after starting Vite | Blocked by browser policy | The browser-control surface rejected the localhost reload by URL policy. No workaround or credentialed API call was attempted; the human browser and live checkpoint/perception gate remain pending. |

The deterministic M4 slice was committed as `232a828` on `codex/m4-cached-interaction-loop`. M1 (`e6822f5`) and M2 (`4f3d9ed`) remain preserved as rollback points. Documentation was then reconciled across the repository; historical audit reports and the original product brief retain their original dated content with explicit status notices rather than rewritten history.

## 2026-07-16 — M4 microphone feedback hardening

The first owner rehearsal visibly froze in `QA` during step 1 and the tutor appeared to answer itself. The state evidence confirms a VAD speech-start event—not a checkpoint transition—so the most credible cause is the continuously enabled microphone capturing speaker output or ambient audio. Browser echo cancellation is retained, but is not treated as a sufficient demo-control boundary.

Commit `c0d6f48` implements deliberate one-turn input gating. The captured track remains muted after connection; **Speak** enables it; `input_audio_buffer.speech_stopped` automatically mutes it at the documented end of the user turn; assistant playback also force-mutes as a safety backstop. This preserves intentional barge-in without using the rejected sub-400 ms false-alarm heuristic.

At 2026-07-16T15:37+0530, `make test`, `make lint`, `make build`, `npm --prefix frontend audit --omit=dev`, and `git diff --check` passed: 116 frontend and 38 backend tests, zero production vulnerabilities, and the existing non-blocking Vite chunk warning. Live confirmation that self-triggering is gone remains pending.

## 2026-07-16 — M4 cached interaction slice accepted

The owner reloaded and reran the published post-fix checklist, then reported “passed.” This closes the cached-interaction D6 gate: deliberate **Speak** input no longer produced the observed self-response loop, interruption/recovery remained usable, and the tutor-initiated checkpoint accepted the answer, responded, and advanced. This entry records owner-observed acceptance only; no machine trace, exact latency, token usage, or broader three-run claim is inferred.

The completed execution plan is now `docs/exec-plans/completed/m4-cached-interaction-loop.md`. The broader M4 work—deixis overlays, annotation, two additional cached lessons, and its full three-run gate—remains pending. M3 live lesson generation is the next product-enabling milestone if approved.

## 2026-07-16 — M3 started

M3 is isolated on `codex/m3-live-lesson-generation` from the accepted cached-interaction checkpoint `e0c0aa8`. The active execution record is `docs/exec-plans/active/m3-live-lesson-generation.md`. The audited scope is a real vertical slice: topic request, server-owned Responses API streaming, per-line schema and semantic validation, at most two scoped repairs, CHALK-owned NDJSON envelopes, browser cancellation/stale-event rejection, generated lesson playback, and a cached fallback.

The current official OpenAI documentation was checked before implementation. It confirms `POST /v1/responses` with `stream: true`, typed SSE events including `response.output_text.delta` and `response.completed`, and the documented `gpt-5.6-terra` model. This verification changed no runtime code and made no credentialed request. The ten-topic live evaluation remains an explicitly controlled later gate; starting M3 is not treated as approval to spend that batch budget.

## 2026-07-16 — M3 deterministic implementation passed

The bounded live-generation vertical slice is implemented. `POST /lesson` terminates upstream Responses SSE in the backend and projects only CHALK-owned `application/x-ndjson` envelopes. Each candidate step passes the checked-in JSON Schema, semantic budgets, accepted-ID/reference state, axes checks, and a non-evaluating Python AST expression allowlist. Invalid candidates receive at most two scoped JSON-mode repair attempts and are revalidated; no raw model line is forwarded. Stream time, bytes, candidate count, repairs, concurrency, request bodies, output tokens, topics, and logs are bounded or redacted.

The browser validates the stream schema and complete accepted lesson prefix before rendering, handles arbitrary UTF-8/chunk boundaries and final lines, rejects stale request IDs, aborts replaced requests, and accepts only the expected NDJSON media type. A terminal failure after useful output retains the validated prefix; zero surviving steps load the accepted cached projectile path. A manual topic form and the Realtime tutor's nonblocking `teach` tool both enter the same generation path. Ten deterministic golden lessons now cover representative calculus, trigonometry, mechanics, vector, exponential, and wave topics.

At 2026-07-16T18:21+0530, `make test`, `make lint`, `make build`, `npm --prefix frontend audit --omit=dev`, and `git diff --check` passed: 140 frontend and 68 backend tests, current generated schema types, ESLint, Ruff lint/format, TypeScript/Vite, Python compileall, zero production npm findings, and clean diff hygiene. The final audit added explicit invalid UTF-8, upstream transport failure, generation-timeout, zero-step terminal failure, and partial-prefix retention regressions before accepting the deterministic gate. Vite retains its known non-blocking large-chunk warning. The owner reported the current browser smoke “passed.” Because that report did not include a board-model ID, timing, trace, ten-topic outcomes, or reviewer screenshots, it is recorded only as a browser smoke—not as the M3 live exit gate.

M3 therefore remains active. The only acceptance work left is explicitly controlled live evidence: one bounded Terra access/smoke call, then (with owner approval) the ten-topic rubric, first-valid-visible-stroke timing, redacted artifacts, and human layout review. At least eight of ten topics must pass and the renderer must have zero crashes before M3 can be committed as accepted.

## 2026-07-16 — M3 live-evaluation path prepared without API spend

The remaining live gate no longer depends on ad hoc commands. `app.m3_evaluation` contains the fixed ten-topic rubric and refuses to start without `--approved-by-owner`. When approved, it sends one request per topic sequentially, never retries or parallelizes, stops on access/configuration failures, validates every returned CHALK envelope again, and retains the raw synthetic-topic NDJSON. Its summary records only topic keys, model and prompt hashes, first-valid-step/terminal timings, accepted-step/repair/drop counts, terminal codes, and empty screenshot/human-review fields. The standard API key, authorization headers, client UUID, student context, and logs are not written to the summary.

The product diagnostics now covers the other timing boundary: the backend returns bounded model and SHA-256 prompt metadata, the browser timestamps the first validated step, and the board reports only when geometry is actually visible. **Copy M3 timing** exports the redacted request-to-step and step-to-ink measurements after completion. A diagnostics-only importer revalidates captured NDJSON and reveals it step by step for screenshots and human layout review, avoiding a duplicate ten-topic generation batch.

The harness refusal path was exercised without the approval flag and correctly exited before any network request. Deterministic tests cover raw capture, localhost-only routing, metadata allowlists, captured-stream request-ID integrity, and one-shot visible-ink measurement. A fresh local diagnostics load displayed **Review captured lesson without regenerating** and produced no browser console warning/error. At 2026-07-16T18:37+0530, the expanded root gate passed with 143 frontend and 73 backend tests, lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, secret-pattern scanning, and clean diff hygiene. No credentialed request was made in this preparation work.

## 2026-07-16 — M3 evidence acceptance made mechanical

`app.m3_evidence` is a read-only final gate over the future live evidence directory. It revalidates every retained raw envelope, request-ID and terminal/count consistency, exact fixed-topic order, Terra and prompt-hash identity, screenshot existence and file signature, bounded reviewer notes, explicit schema/render/layout/crash verdicts, and the representative browser timing components. It requires zero renderer crashes, at least eight complete human passes, a non-partial representative lesson, and request-to-first-visible-ink below 6,000 ms. Summary totals and the explicit exit-gate flag must match the underlying evidence; missing values never default to success.

Synthetic-package tests prove a complete package passes while missing human layout review, slow first ink, and evidence-path traversal fail. This closes the last deterministic ambiguity around D9 but does not substitute for the approved live calls or human judgment.

At 2026-07-16T18:42+0530 the final no-spend gate passed with 143 frontend and 76 backend tests, lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, secret-pattern scanning, and clean diff hygiene. The known non-blocking Vite chunk-size warning remains.

## 2026-07-16 — M3 qualification moved to Luna

The owner chose `gpt-5.6-luna` as the first board-model qualification tier. Current official model guidance positions Luna as the efficient GPT-5.6 tier, and its standard input and output rates are 60% below Terra. This is a cost decision, not a weaker acceptance decision: the live gate remains ten fixed topics, at least eight full schema/render/layout passes, zero renderer crashes, and representative first visible ink below six seconds.

The checked-in and local `BOARD_MODEL` defaults now use Luna, while the runtime allowlist retains Terra and Sol for explicitly approved escalation. `GET /health` exposes only the non-secret configured board-model ID and configured boolean. The live harness checks that response before creating an evidence directory or issuing any lesson call, then rechecks response headers during the batch in case configuration changes. An unconfigured or stale Terra process therefore spends zero lesson calls and cannot be mislabeled as Luna evidence. If Luna fails, only the failed topics should be compared on Terra under a new explicit approval; mixed-model evidence cannot satisfy the Luna gate.

Targeted model-switch checks passed: 21 backend tests covering generation, evaluation, and evidence plus all 11 lesson-stream client tests. One initially mistyped Vitest path found no tests and was corrected immediately; it made no network request. After adding the zero-spend health preflight, the final no-spend gate passed with 143 frontend and 81 backend tests, ESLint, Ruff lint/format, TypeScript/Vite production build, Python compileall, zero production npm vulnerabilities, checked-in secret scanning, and clean diff hygiene. The known non-blocking Vite chunk-size warning remains. No credentialed request was made.

## 2026-07-16 — M3 one-call smoke made structurally safe

The documented order required one bounded Luna access smoke before deciding on the ten-topic rubric, but the prepared CLI exposed only one approval flag and that flag launched the entire batch. That was an operator-safety defect: an instruction to run “one smoke” had no one-call implementation.

`app.m3_evaluation` now has explicit `smoke` and `batch` subcommands. Both require their own `--approved-by-owner` acknowledgement after the mode name. Smoke performs the free health/model preflight and then exactly one projectile `POST /lesson`, with no retry, no parallelism, and no Realtime/narration session. It retains validated raw NDJSON and a distinct `chalk.m3-live-smoke.v1` summary; that artifact is diagnostic and cannot pass the ten-topic evidence verifier. Batch behavior and its fixed topic order remain unchanged.

Focused tests prove both subcommands refuse before calling a runner without their acknowledgement, approved smoke cannot route to batch, smoke invokes exactly one topic, and its summary records one expected and attempted topic. The real unapproved smoke command exited with the expected refusal before creating its output directory. The complete no-spend gate then passed with 143 frontend and 85 backend tests, ESLint, Ruff lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, checked-in secret scanning, and clean diff hygiene. No credentialed request was made.

## 2026-07-16 — First Luna smoke failed safely

The owner explicitly approved one Luna smoke and no broader spend. The backend was started without reload, the free `/health` preflight reported a configured `gpt-5.6-luna` board model, and the `smoke` subcommand issued exactly one `POST /lesson`. It did not connect Realtime, did not narrate, did not retry, and could not route to the batch. The backend was stopped after evidence inspection.

The retained package is `artifacts/evidence/m3-smoke-20260716-202350/`. Luna access succeeded. The validated CHALK stream contains three accepted steps with 14, 13, and 17 spoken words; their op sets are text/equation, equation/axes, and curve/equation. There were zero repairs and zero drops. The smoke still failed: the first valid step arrived at 8,947.8 ms, the terminal arrived at 10,765.7 ms as `invalid_stream`, and `smoke_pass` is false. This cannot be counted as the M3 access/stream pass, the six-second gate, or batch approval.

Current official Responses documentation was checked after the failure and still specifies typed `response.output_text.delta` events followed by `response.completed`; the implementation therefore does not accept an undocumented terminal substitute. The best-supported local inference is a byte-accounting defect: the 128 KiB model-output limit was applied to the entire SSE transport, whose terminal event includes the full response object. The smoke did not retain upstream event sizes, so this cause is not claimed as live-proven.

The fix keeps three independent safety bounds: 2 MiB for complete upstream SSE transport, 128 KiB for cumulative model-authored text deltas, and 16 KiB per JSONL line. Regression tests prove terminal-event overhead above 128 KiB no longer consumes the model-text budget while text and transport remain separately bounded. The low-effort smoke also missed latency before rendering. Official GPT-5.6 guidance supports `reasoning.effort: none` and identifies it as the latency baseline, so `BOARD_REASONING_EFFORT=none` is now explicit in config, health, upstream requests, response metadata, captured evaluation summaries, browser timing export, and final evidence verification. `low` remains allowlisted only for a measured quality comparison.

The corrected path passes the complete no-spend gate: 143 frontend and 95 backend tests, ESLint, Ruff lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, checked-in secret scanning, clean diff hygiene, and an explicit assertion over the retained failed-smoke summary. The known non-blocking Vite chunk warning remains. No second live call was made. A fresh one-call smoke approval is required; the ten-topic batch is not justified.

## 2026-07-16 — Corrected Luna smoke passed

The owner separately approved exactly one corrected Luna smoke. Before spending, the command path, `.env` model/effort values, split byte limits, and diff hygiene were inspected; 71 relevant backend tests passed. A free `/health` preflight then confirmed the running server was configured for `gpt-5.6-luna` with `reasoning.effort: none`. The smoke issued exactly one `POST /lesson`, with no retry, Realtime session, narration, or batch. A harmless zsh wrapper error occurred only after the harness had written its passing result; the request was not repeated.

The retained package is `artifacts/evidence/m3-smoke-corrected-20260716-204203/`. Its summary and raw NDJSON were independently asserted after the run: one start, four schema-valid steps, one normal `lesson.done`, zero errors, zero repairs, and zero drops. The first valid step arrived in 2,865.1 ms and the terminal in 5,156.2 ms, so the backend stream was both correct and inside the six-second first-step target. The backend was stopped immediately after inspection. The production frontend decoder then loaded that exact retained NDJSON as one complete, non-partial four-step lesson. All 24 focused stream/board/golden rendering tests passed, and a local diagnostics load produced no console warnings or errors. No additional model request was made, and the temporary verification script and diagnostics server were removed/stopped.

This passing smoke satisfies the M3 one-call access/stream prerequisite and provides live evidence for the split byte-accounting correction and `none` latency baseline. It does not substitute for the ten-topic 8/10 rubric, human layout review, screenshots, or actual browser first-visible-ink timing. Those remain unrun and require separate approval; no batch authority is inferred from this smoke approval.

## 2026-07-16 — First Luna batch attempt stopped after one topic

The owner separately approved the fixed ten-topic Luna batch. Before spending, `git diff --check`, the CLI mode and fixed-topic loop, the runtime `gpt-5.6-luna`/`none` configuration, 71 relevant backend tests, and the free live health identity check all passed. The batch began sequentially with no retries and no Realtime usage. Its fail-fast rule stopped after the first derivative request returned a terminal `upstream_rejected`, so the approval resulted in exactly one paid lesson call, not ten. The backend was stopped immediately and no retry was attempted.

The retained package is `artifacts/evidence/m3-luna-batch-20260716-210607/`. The derivative stream is useful but not passing acceptance evidence: three schema-valid steps arrived with zero repairs and zero drops, the first at 2,503.1 ms, followed by `lesson.error` with code `upstream_rejected` at 4,375.0 ms. Model, reasoning effort, and both prompt hashes matched the qualification contract. Valid output rules out an initial primary HTTP rejection, but it does not rule out a later repair-call rejection or a collapsed streaming terminal. The old evidence therefore cannot establish whether access/configuration played any part after generation began.

The audit found a diagnostic and harness classification gap. `_stream_model_lines` maps an HTTP error, `response.failed`, `response.incomplete`, and a generic streaming `error` into the same `upstream_rejected` code. `ACCESS_FAILURE_CODES` then treats that collapsed code as an access failure and stops the batch. Current official Responses documentation states that `response.incomplete` includes the incomplete Response and its `incomplete_details`; the adapter did not retain an allowlisted terminal category or reason, so the exact upstream outcome of this call cannot be recovered. Existing deterministic tests cover ordinary completion and transport failure but not incomplete/failed termination after valid step deltas.

No inference that the response hit a token limit is recorded, and no code fix or second live call was made under the consumed approval. That approval ended with this attempt. The deterministic follow-up below distinguishes terminal classes without retaining content, covers post-valid-output failure, and separates a failed topic from repeatable identity/access/configuration/transport stop conditions. Any fresh batch still requires new explicit approval.

## 2026-07-16 — Upstream terminal classification fixed

The deterministic follow-up is complete; no credentialed request was made. The backend now maps HTTP rejection, `response.incomplete`, `response.failed`, generic streaming `error`, transport unavailability, and local parsing/timeout outcomes to distinct CHALK-owned terminal codes. Upstream detail is reduced to one closed reason category (`max_output_tokens`, `content_filter`, `rate_limit`, `authentication`, `permission`, `server_error`, `invalid_request`, or `unknown`). Arbitrary upstream codes, messages, and response bodies are neither forwarded nor logged.

The stream schema now separates errors that may carry an upstream reason from local errors that cannot. Frontend types were regenerated from that schema, the browser keeps a validated reason on both partial-prefix results and zero-step failures, and the evaluation summary records the same bounded value. Existing evidence remains valid and unchanged. In particular, `artifacts/evidence/m3-luna-batch-20260716-210607/` still says only `upstream_rejected`; because the server discarded the original upstream event under the old contract, its precise cause cannot be recovered after the fact.

The batch policy was also corrected. It proceeds to the next fixed topic without retry only when the bounded reason is clearly topic-scoped: `max_output_tokens` or `content_filter`. It stops early on a board-model or reasoning mismatch, missing configuration, HTTP rejection, transport unavailability, or any other, missing, or unknown upstream reason. This preserves useful topic-level quality evidence while preventing an ambiguous, repeatable, or infrastructure fault from consuming the remaining call budget.

Regression coverage includes incomplete, failed, and generic error terminals after accepted output; terminal events arriving during final SSE flush; allowlisted and unknown reason mapping; upstream message/body redaction; HTTP status classification; schema rejection of arbitrary reasons and reasons on local failures; browser propagation; and both batch continuation and fail-fast behavior with no retry. The complete no-spend gate passes 146 frontend and 115 backend tests, ESLint, Ruff lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, tracked-secret scanning, and `git diff --check`. The existing Vite bundle-size warning and Starlette TestClient deprecation warning remain non-blocking. The next action is not another code fix: it is a fresh, explicit approval for a new ten-topic Luna batch, followed by local evidence review, browser first-visible-ink measurement, screenshots, and human layout judgments.

## 2026-07-16 — M3 spend and evidence hardening passed

An independent audit correctly identified prospective evidence and budget gaps around repair calls and batch termination. Its stronger historical suggestion—that the 21:06 failure probably occurred during repair—is not supported by the retained stream: the old adapter also collapsed multiple streaming terminal classes. The prior cause remains unknown, and no historical artifact was rewritten.

The implementation now owns one four-call repair budget per lesson in addition to the primary generation call. Each repair is counted before dispatch, including HTTP rejection, transport failure, and timeout. Every current terminal envelope carries only a closed `generation` or `repair` origin and the bounded repair count; the schema keeps those fields optional solely to decode historical streams. The browser and evaluator preserve the fields without forwarding upstream detail. Output arriving after `response.completed` is now rejected as an invalid stream rather than silently accepted.

The ten-topic harness now stops at the third machine failure because the required 8/10 result is mathematically unreachable. If a paid topic path raises locally, it recovers only safe counts from already-written valid envelopes, reduces the exception to a closed category, writes a `chalk.m3-live-evaluation.v2` summary, and stops; private exception text is not retained. The evidence verifier requires v2, no stop reason, and at least eight independently recomputed machine-complete topics. Future smoke summaries use `chalk.m3-live-smoke.v2` and `one_topic_no_retry`, making clear that bounded repairs are calls within one topic rather than topic retries; retained v1 smokes remain unchanged. Automatic resume remains deliberately absent because it could duplicate paid calls. The backend also rejects non-local Host headers before `/lesson`, closing the localhost DNS-rebinding path to the paid endpoint.

The complete no-spend gate passes 147 frontend and 128 backend tests, ESLint, Ruff lint/format, TypeScript/Vite build, Python compileall, zero production npm vulnerabilities, tracked-secret scanning, and `git diff --check`. Coverage includes repair HTTP/transport/timeout attribution, aggregate repair exhaustion, historical-envelope compatibility, third-failure stops across local and upstream categories, redacted crash summaries with partial-count recovery, output after terminal, evidence-v2 enforcement, and hostile Host rejection before an upstream call. The existing Vite bundle-size and Starlette TestClient deprecation warnings remain non-blocking. No live API call was made. A new ten-topic Luna batch still requires fresh explicit approval.

## 2026-07-16 — Second Luna batch isolated a repair-request rejection

The owner explicitly approved one fresh fixed ten-topic Luna batch. Before spending, `git diff --check`, 65 focused backend tests, local `gpt-5.6-luna`/`reasoning.effort: none` configuration, a free live health check, and the three circuit-breaker paths passed. The backend ran without reload. The harness made topic requests sequentially, never retried, and stopped before topic five when the fourth topic met an immediate-stop condition. The backend was then shut down; port 8000 was confirmed free.

The retained `chalk.m3-live-evaluation.v2` package is `artifacts/evidence/m3-luna-batch-20260716-222005/`. Derivative, chain rule, and integral area each completed with four accepted steps, zero repairs, zero drops, and first valid output at 3,981.1 ms, 1,649.2 ms, and 1,994.7 ms respectively. Unit circle produced no accepted step: its first repair request returned `upstream_rejected` with the closed reason `invalid_request`. The new origin/count fields prove this was repair—not primary generation—and that exactly one repair request occurred. The run made four primary topic requests plus one rejected repair request; there was no retry or fifth topic. The evidence does not establish whether the rejected request was billed. The standard evidence verifier rejects the package as intended because only four topics ran and human/timing review is absent. It is diagnostic evidence, not M3 acceptance.

## 2026-07-16 — Repair path corrected and isolated probe prepared

Current official OpenAI documentation says GPT-5.6 Luna supports the Responses API and Structured Outputs, and documents `text.format` as the Responses formatting surface. The live failure nevertheless isolated `invalid_request` to the repair-only request shape; primary requests with the same model, effort, authentication, input family, and output-token controls completed. The repair request's nonessential `text.format=json_object` field was therefore removed. Repair now uses the same plain-text Responses surface as primary generation. The repair prompt still demands exactly one JSON object, and every result must still pass JSON parsing, the checked-in schema, semantic/reference validation, and lesson budgets before acceptance. No safety boundary was weakened.

To avoid consuming another batch as a repair probe, `app.m3_evaluation repair-smoke` is now a separate owner-gated mode. It sends one fixed synthetic invalid step through the production repair function, performs exactly one repair call with no retry or primary generation call, validates the returned step, and writes only model/effort, prompt hash, timing, and closed pass/failure metadata. Generated repair content is never retained, and the command cannot route to topic smoke or batch. Deterministic tests prove refusal without its own approval, one-call execution, content-free evidence, and route isolation. The complete no-spend gate passes 147 frontend and 131 backend tests, lint/format, build/compile, zero production npm vulnerabilities, tracked-secret scanning, and diff hygiene. No further live call was made. The next permitted spend, if separately approved, is exactly one repair smoke—not another batch.

## 2026-07-16 — Corrected Luna repair path passed

The owner separately approved exactly one Luna repair smoke. Before spending, `git diff --check`, 63 focused backend tests, local Luna/`none` configuration, route isolation, and the absence of a running backend passed. `repair-smoke` then issued exactly one direct production repair request. It made no primary lesson request, topic smoke, batch request, Realtime connection, or retry.

The repaired step passed the checked-in schema and semantic validator. The request completed in 2,767.0 ms. The retained artifact is `artifacts/evidence/m3-repair-smoke-20260716-223721/summary.json`; it records `repair_pass=true`, one attempted repair call, Luna/`none`, the repair-prompt SHA-256, and null terminal/harness errors. Its exact key set and values were asserted after the call. The directory contains only the 498-byte summary: scans found no credential, authorization value, synthetic input, generated repaired content, or probe IDs. No backend process was running before or after the probe.

This closes the repair-path prerequisite created by the 22:20 batch failure. The repair-smoke approval is consumed and does not authorize another request. The next live action is a newly approved fixed ten-topic Luna batch; if that completes, the remaining work is local captured-stream rendering, screenshots, human layout verdicts, and representative browser first-visible-ink evidence.

## 2026-07-16 — Fixed ten-topic Luna batch passed the machine gate

The owner separately approved one fixed ten-topic Luna batch. Before spending, `git diff --check`, 68 focused backend tests, local Luna/`none` configuration, a free health identity check, and the absence of another backend passed. The backend ran without reload. The evaluation harness made exactly ten sequential topic requests, never retried, and did not stop early. It then exited successfully and the backend was stopped; port 8000 was confirmed free.

All ten fixed topics completed with four accepted steps each: 40 accepted steps, zero repairs, zero drops, no terminal error, and no harness error. First-valid-step latency ranged from 1,161.6 ms to 3,012.7 ms; the slowest topic was unit circle, still below the six-second request-to-first-valid-step component of the target. The retained `chalk.m3-live-evaluation.v2` package is `artifacts/evidence/m3-luna-batch-20260716-224159/`. Its summary and ten small raw NDJSON files passed independent machine identity/completeness checks, and secret scanning found no credential.

This is a machine-generation pass, not yet the complete M3 acceptance gate. The read-only evidence verifier now fails only the deliberately empty local fields: per-topic render, layout, renderer-crash, screenshot, and bounded reviewer-note evidence, plus one representative product-path first-visible-ink record. No further model call is authorized by the consumed batch approval. The next work is local captured-stream review without regeneration, followed by a separately authorized representative connected product check only if one is still required to obtain honest first-visible-ink evidence.

## 2026-07-17 — M3 local render and human-layout gate passed 9/10

The retained ten-topic Luna batch was replayed locally through the production NDJSON decoder and board renderer without contacting the backend, Realtime API, or board model. The first visual pass exposed a deterministic renderer defect rather than a model-quality miss: long handwritten labels and KaTeX equations clipped inside fixed boxes, and broad `left`/`right`/`full` placements could overlap grid-cell placements. The renderer now wraps and size-fits handwritten text, size-fits equations, avoids material cross-region collisions while preserving curve/axes overlays, and separates axis names from endpoint values. Focused coverage proves broad/grid collision avoidance, long-label wrapping, the ten golden renderer fixtures, and existing stable partial-stroke behavior.

All ten captured streams then loaded locally with no board warning, console warning/error, or renderer crash. Final screenshots and bounded human notes are retained under `artifacts/evidence/m3-luna-batch-20260716-224159/`. Nine topics pass schema, render, and human layout review. Exponential growth/decay remains an explicit layout failure: the combined doubling-time/half-life equation is present but too small for comfortable demo readability. The evidence summary records `human_pass_topics=9`, zero crashes, per-topic verdicts, and `exit_gate_pass=false`.

The full frontend gate passes 149 tests across 18 files, plus ESLint, TypeScript, and the Vite production build. The existing bundle-size warning remains non-blocking. The read-only backend verifier now reports exactly two expected issues: the summary does not mark the exit gate passed, and the representative timing file is missing. No credentialed call was made. Current relevant runtime behavior remains diagnostics-only local replay plus the normal demo path; no evidence-directory serving hook remains in product code. The next smallest task is one explicitly authorized connected product-path first-visible-ink measurement. Until that exists, M3 remains open and no timing claim is made.

## 2026-07-17 — Accumulated-whiteboard prompt iteration prepared

The default `BOARD_PROMPT_VERSION=v2` prompt now explicitly asks for one progressive spatial argument: top-left-to-bottom-right teaching order, adjacency through anchors, coherent graph/explanation reservations, reuse of visible context, and no filler. It directs short identities and labels to the handwritten `text` op and reserves KaTeX equations for genuinely structured notation. The worked derivative example follows that rule. Remaining structured KaTeX output uses the existing chalk palette with a subtle chalk-softening treatment rather than stark pasted-document styling. The exact qualified prompt remains available as the runtime `v1` fallback; both the upstream request and response prompt hash follow the selected version.

This prompt edit creates a new prompt SHA-256 and therefore a new live experiment. The retained ten-topic package at `artifacts/evidence/m3-luna-batch-20260716-224159/` remains unchanged and comparable only to its captured `v1` prompt hash; none of its verdicts or screenshots were relabeled. The demo UI still exposes no narration transcript, and synchronization/evidence chrome remains diagnostics-only, so no subtitle bar was added or moved. A local demo-mode browser load confirmed zero sync/diagnostic strips and no console warning or error, then the preview server and tab were closed. Verification passed with 149 frontend tests and 134 backend tests, ESLint, Ruff lint/format, TypeScript, Vite production build, and diff hygiene; the existing Vite chunk-size warning remains non-blocking. No credentialed request was made. Requalifying `v2` or collecting a hash-matched representative connected timing record requires its own explicit owner approval under the documented call ceilings.

## 2026-07-17 — Accumulated-whiteboard v2 passed the 8/10 rubric

After the exact batch ceiling was stated, the owner approved one v2 ten-topic Luna batch. Before spending, 71 focused tests, diff hygiene, exact v1 evidence-hash preservation, the distinct v2 prompt hash, Luna/`none`/v2 settings, configured-key boolean, and idle ports all passed. The harness free health preflight then succeeded. It made exactly ten sequential primary topic calls, no topic retries, no repair calls, and did not stop early. All ten topics completed with 39 accepted steps, zero drops, no terminal or harness error, and first-valid-step latency from 1,421.8 to 2,583.3 ms. The backend was stopped immediately; port 8000 was confirmed free. Identity, stream completeness, and credential scans passed.

The retained package is `artifacts/evidence/m3-luna-v2-batch-20260717-0635/`, with board prompt SHA-256 `bdcb2d54250af75cec3877a684f46292e79f52b54bca4705302885275aeaaa5c`. All ten raw streams were replayed locally through the production decoder and renderer at the normal browser viewport. Ten screenshots and bounded notes are retained. There were no board warnings, console warnings/errors, or renderer crashes. Exactly eight topics pass schema, rendering, and human layout review. Unit circle fails because lower-right identities and explanation collide; standing waves fails because node, antinode, and amplitude labels stack into an unreadable block. These failures were recorded rather than excused. Temporary local evidence-serving code was removed, the browser tab and preview server were closed, and ports 5173 and 8000 are free.

The read-only verifier now reports exactly two expected issues: `exit_gate_pass` remains false and the representative timing path is absent. M3 therefore meets its unchanged 8/10 quality and zero-crash thresholds but is not accepted yet. The next smallest task is one separately approved connected v2 product-path timing run: one primary board-model call with at most four repair calls, plus a short `gpt-realtime-2.1-mini` session needed to start visible ink. The consumed batch approval authorizes neither action.

## 2026-07-17 — First v2 timing attempt stopped before credential minting

The owner approved one v2 topic attempt with at most four repair calls plus one short mini-Realtime session, with no retry. The no-spend gate passed 74 focused backend tests, diff hygiene, the hash match against the v2 evidence package, Luna/`none`/v2 and mini-Realtime configuration, configured-key boolean, and idle ports. The backend and diagnostics frontend then started locally.

The in-app browser opened `http://127.0.0.1:5173/`, while the backend's exact allowed frontend origin is `http://localhost:5173`. The first **Connect microphone** action therefore failed at the CORS preflight: the backend recorded only `OPTIONS /session` with HTTP 400. No `POST /session`, OpenAI client-secret request, board-model request, repair request, Realtime connection, lesson generation, or retry occurred. The browser retained only the closed local `connection.failed`/`TypeError` metadata and displayed `Failed to fetch`; no timing was recorded or claimed.

Per the live-check stop policy, the run was not retried under the same approval. Both services were stopped, the browser tab was closed, and ports 5173 and 8000 are free. The deterministic correction for a future separately approved attempt is operational, not architectural: open the product at the configured `http://localhost:5173` origin. The M3 evidence remains unchanged and still lacks only the representative hash-matched timing record.

## 2026-07-17 — M3 accepted with hash-matched first-visible-ink evidence

The owner freshly approved the same bounded timing run: one Luna v2 topic attempt with at most four repair calls plus one short mini-Realtime session, with no further retry. Preflight confirmed clean diff hygiene, the exact v2 evidence hash, configured server key, `http://localhost:5173` origin, v2 prompt selection, mini Realtime, and idle ports. The corrected browser origin connected successfully. The backend minted one ephemeral client secret; the browser observed `session.created` and `session.updated` for `gpt-realtime-2.1-mini` with `marin`.

The product then made exactly one derivative lesson attempt. It completed with four accepted steps, zero repairs, zero drops, and non-partial output. Diagnostics measured 1,355.7 ms from request to first validated step, 1,363.4 ms from validation to first visible ink, and 2,719.1 ms request-to-first-visible-ink. The session used 1,987 total Realtime tokens at disconnect. No topic retry or second lesson call occurred. The Realtime session, browser tab, frontend, and backend were closed immediately after capture; ports 5173 and 8000 are free.

CHALK displayed `Timing copied`, but the browser automation clipboard bridge returned empty. The exact visible product measurements were therefore retained in `timing/representative.json` with a redacted nonessential request-ID suffix and supporting `timing-browser.png`; model, reasoning, and prompt hashes match the v2 batch package. The read-only verifier now passes with ten topics, exactly eight human layout passes, zero renderer crashes, and first visible ink at 2,719.1 ms against the 6,000 ms target. M3 is complete. The next active milestone is broader M4: two additional cached lessons, deixis/annotation, and three full cached MVP rehearsals.

## 2026-07-17 — Broader M4 execution plan activated

The active plan is `docs/exec-plans/active/m4-full-interruption-grounding.md`. It preserves the accepted fixed-sync, manifest, checkpoint, and turn-gated microphone paths. The remaining MVP scope is a committed visible-target inventory; four instant local deixis tools with soft unknown-ID failures; a bounded stale-safe annotation overlay endpoint; curated derivative and unit-circle caches alongside projectile; manifest-publication timing and hash agreement evidence; and three consecutive cached projectile interruption/grounding/resume rehearsals.

Paced synchronization, partial-stroke targeting, widgets, student drawing, and new lesson DSL primitives remain outside this gate. The planned live acceptance ceiling is one freshly approved short `gpt-realtime-2.1-mini` connection for three cached loops, with no board-model or annotation-model call and no automatic retry. No credentialed request was made while planning.

## 2026-07-17 — Broader M4 deterministic implementation

The committed board snapshot now produces both the bounded tutor manifest and the exact fully revealed element inventory used for grounding. `point_at`, `circle_el`, `underline`, and `flash` are strict Realtime tools that render stable browser-local rough overlays and soft-fail unknown, future, failed, or partial IDs. Temporary marks auto-expire and never enter manifest state. Context publication now retains only bounded send-to-acknowledgement latency and an eight-hex factual fingerprint; diagnostics can prove the current visible manifest matches the last acknowledged context without retaining instruction text.

Annotation uses a separate `shared/schema/annotation.schema.json` rather than widening the lesson DSL. It permits at most five target-relative circle, underline, arrow, text, or equation overlays, forbids axes/curves/regions/absolute coordinates/styles/URLs, and validates every target against the request's committed visible IDs on both backend and frontend. `POST /annotate` has a 6 KiB request cap, 32 KiB response cap, 15-second timeout, one-request concurrency lane, one primary call, and at most two counted repairs. Cancellation, replacement, resume, new lesson, reset, and disconnect discard stale results. Local deixis and voice remain the fallback; no annotation call is required for the M4 live gate.

Derivative and unit-circle caches now join projectile under `demo/cached_lessons/`. All three load through the production decoder and render locally without a network path; simple identities use handwritten text. A disconnected diagnostics browser pass selected and loaded all three caches with no console warning/error. That pass exposed an empty-board offline preview, so disconnected cached lessons now deliberately show the fully committed board as `PREVIEW` while the connected teaching path still resets grounding and animates from an empty board. A final visual recheck of that correction remains pending.

The complete no-spend gate passes 179 frontend tests across 22 files and 148 backend tests, ESLint, Ruff lint/format, TypeScript, Vite production build, Python compileall, current generated tracked schema types, zero production npm vulnerabilities, secret-pattern review, and diff hygiene. The secret scan's only key-shaped match is the deliberate `sk-secret-placed-in-wrong-variable` rejection fixture in `backend/tests/test_api.py`; it is not a credential. The existing Vite chunk-size and Starlette TestClient deprecation warnings remain non-blocking. One malformed narrow Vitest invocation found no files before the corrected cache suite and full suite passed; this was a command-path error, not a product failure. No credentialed request was made. Final cache screenshots, retained M4 rehearsal evidence, and the three-loop owner-approved mini-Realtime gate remain pending.

## 2026-07-17 — Space-to-interrupt shortcut

One unmodified Space keydown outside form controls now enters the existing deliberate Speak path. It enables the microphone once, ignores held-key repeats and modified shortcuts, and leaves VAD responsible for speech detection, interruption, automatic microphone shutoff, and the tested freeze/QA transition. The visible guidance now says to press Space; the Speak button remains as an accessible fallback and can still stop listening. Seven focused shortcut tests, frontend ESLint, the TypeScript/Vite production build, and `git diff --check` pass. No credentialed request was made; the running local frontend can be used for the perceptual check.

## 2026-07-17 — Natural-drawing feature plan: deterministic phases implemented

The audit-driven plan `docs/exec-plans/active/natural-drawing.md` executed its five deterministic phases in one session. Browser lesson decoding is now incremental (`decodeStep` plus a decode context): a streamed step the browser rejects costs only that op or step, is counted as `browserDroppedSteps` in stream progress and diagnostics, and the cached fallback activates only when zero streamed steps survive. The `lesson.done` cross-check now compares the server's accepted count against received step envelopes, and a synchronous generation token closes the double-`teach` re-entrancy window.

The backend now mirrors the browser's rendering truth so repair can fire before an unrenderable step streams: `expression_runtime.py` samples every curve at 121 points with a bounded interpreter over the already-validated AST (non-finite/complex, |y| budget, discontinuity, and two-contiguous-visible-samples rules), `latex_lint.py` structurally lints equations (forbidden/unknown commands, unbalanced groups, unpaired `\left`, math-mode `$`), normalization rewrites `**` to `^` and enforces the browser expression charset, scripts must contain a spoken word, and a lesson carries at most one checkpoint. `shared/fixtures/curve-parity.json` and `latex-parity.json` pin the two-sided contract; both suites consume them. The repair prompt names the new issue vocabulary.

Board prompt v3 (`BOARD_PROMPT_VERSION=v3`, prior prompts retained as v1/v2) adds the spatial contract: column/row grid geometry with real proportions, broad-region overlaps, y-down sketch coordinates, axes sizing guidance, curve domain rules, a sketch worked example validated against the production validator, and `visible_board` declared non-anchorable; the browser now sends an empty board state for fresh lessons. Layout switched from count-division slots to flowing per-region cursors and is prefix-stable by construction — a corpus-wide property test over all thirteen cached/golden lessons proves streaming a later step never moves committed ink. Axes and curves joined sketches in sequential stroke reveal with content-length animation weights, cubic ease-in-out per stroke, and axis labels held until their strokes near completion. `teach` during QA now aborts the current lesson (QA → GENERATING as documented), the tutor prompt explains mid-lesson switching, and the live-failure fallback picks the keyword-matched cached lesson instead of always projectile.

Gate status: 250 frontend tests across 27 files, 197 backend tests, ESLint, Ruff lint/format, and `tsc` all pass; no credentialed request was made. Still pending under the plan's verification gates: owner visual re-approval of the three cached lessons under the new layout/choreography, the separately approved prompt-v3 smoke plus ten-topic extended-rubric batch, and the mid-lesson topic-switch live rehearsal.

## 2026-07-18 — Playback-gated paced drawing wired

The reported narration/drawing mismatch exposed a real implementation gap: architecture and configuration documented `SYNC_MODE=paced`, but the browser always ran the fixed word-count clock and discarded transcript progress. The backend now validates `SYNC_MODE` as `fixed` or `paced` and projects it in `/health` and the normalized `/session` response. Review then confirmed that transcript generation can race ahead of audible playout, so fixed remains the default and paced is retained only as an experimental comparison.

Both modes still wait for the documented WebRTC `output_audio_buffer.started` event before starting ink. Paced mode retains only a bounded cumulative transcript-character count and uses it as an approximate 0.5×–3× rate hint; transcript generation never starts drawing. When `output_audio_buffer.stopped` arrives with ink pending, either mode completes the remainder within 400 ms, preventing a long silent drawing tail. A missed start event also recovers from the stronger observed stop signal. The disconnected cached board is now labeled `STATIC PREVIEW` so a completed preview is not mistaken for a synchronized run. Diagnostics display the backend-selected sync mode.

Deterministic verification passes: 256 frontend tests across 26 files, 197 backend tests, frontend ESLint, Ruff lint/format, TypeScript, and the Vite production build. Focused coverage proves transcript progress cannot start ink, pacing-rate clamps, bounded character-only retention, stale correlation, missed-start recovery, and the 400 ms catch-up window. The existing Vite chunk-size and Starlette TestClient deprecation warnings remain non-blocking. No credentialed API request was made. One short owner-approved mini-Realtime cached rehearsal remains required for perceptual acceptance; deterministic tests cannot prove audible word-to-mark alignment.

## 2026-07-18 — Fixed sync restored and shared-canvas physics drawing added

Review of the paced controller confirmed that transcript deltas can complete ahead of audible WebRTC playout, so `SYNC_MODE=fixed` is again the runtime, example, and local default. Paced mode remains behind its explicit flag as an experimental comparison. The topic-switch path now creates the replacement request ID before generation begins, clears the interrupted lesson state, and makes every late old-request event stale. Curve exponent evaluation is recursively capped before exponentiation, closing the nested-power resource-exhaustion path.

Schema 1.1 adds deterministic `line`, `arrow`, `point`, and `angle_arc` operations with closed solid/dashed styling. The first primitive claims a board region; related primitives inherit its normalized y-down coordinate space through an already accepted `canvas_id`. Layout retains a canvas-level occupancy box and a specific element box, so multi-step diagrams remain registered while labels and later anchors target the actual ray, point, or angle. Dashed marks are individual stable rough strokes, arrowheads and angle arcs reveal sequentially, labels wait for most of their diagram ink, and manifest summaries expose only bounded semantic descriptions. The v3 prompt includes the contract and a validated total-internal-reflection example. All three cached lesson files remain untouched.

Deterministic verification passes: 263 frontend tests across 26 files, 201 backend tests, frontend ESLint, Ruff lint/format, Python compileall, TypeScript, and the Vite production build. The local backend was restarted on `127.0.0.1:8000`; `/health` reports `sync_mode: fixed`, and the existing frontend dev server remains on `localhost:5173`. No credentialed API call was made. Remaining live gates are unchanged: a separately approved prompt-v3 smoke/batch, two mid-lesson topic-switch rehearsals, and the measured remote-audio analyser spike before replacing fixed scheduling.

## 2026-07-18 — M4 drawing intelligence techniques implemented

CHALK now borrows the useful control techniques from tldraw's agent template
without adopting its editor or runtime. The current v3 and repair prompts
expand a deterministic 2,371-character wire contract generated from
`lesson.schema.json`; it covers every op variant, field, enum, range, ID rule,
region, and budget. Prompt v1/v2 remain byte-identical, while response evidence
hashes the fully expanded current prompt so prior batches cannot be mixed.

A safe-only sanitizer now runs before schema validation in Python and at the
browser decode boundary. Shared fixtures prove parity for surrounding
whitespace, `**` normalization, and normalized point/anchor-gap clamps within
0.05 of `[0,1]`. It explicitly leaves fuzzy IDs, case, numeric strings,
overlong content, duplicates, inferred geometry, and materially invalid
coordinates untouched. Accepted corrections emit a closed `step_sanitized`
warning plus optional terminal step/field totals; diagnostics display those
separately from repairs and drops, and retained evidence contains no corrected
model text.

Annotation grounding now sends up to 30 committed `{id, kind, bounds}` records,
with three-decimal normalized y-down board bounds, instead of a redundant ID
list. Backend validation derives the target allowlist from that structure and
rejects duplicate, non-finite, zero-size, or off-board elements. The compact
Realtime tutor manifest is unchanged, a worst-case request still fits the 6
KiB cap, and cached lesson files were not edited.

An evaluation-only `python -m app.annotation_vision_smoke` harness is present
but was not run live. It refuses execution without `--approved-by-owner`, uses
one retained synthetic board, performs one structured control followed by one
structured-plus-Base64-image call with `detail: low`, `store: false`, and no
retry, and never retains the image data URL. Structured bounds remain
authoritative; product `/annotate` sends no screenshot. Product integration
requires a separate plan after a human A/B verdict.

The deterministic gate passes: 270 frontend tests across 26 files, 220 backend
tests, frontend ESLint, Ruff lint/format checks, Python compileall, TypeScript,
the Vite production build, generated schema types, and `git diff --check`. The
existing Vite chunk-size and Starlette TestClient deprecation warnings remain
non-blocking. No credentialed API call was made. Next: owner approval for the
two-call annotation vision comparison, or continue the existing prompt-v3 and
M4 live rehearsal gates independently.

## 2026-07-18 — Exponent asymmetry and diagram-quality observations pinned

The shared curve fixture now documents the intentional backend-stricter exponent
cap: `x^40` is a finite, visible curve accepted by the browser sampler, while the
bounded Python interpreter rejects exponents above 32 before evaluation. Optional
per-runtime expectations make that asymmetry explicit without weakening the rule
that every unmarked curve case must agree across runtimes.

The pending prompt-v3 live rubric now explicitly records primitive-label collisions
and diagram fragmentation/cramping. The general four-op step limit remains unchanged
until retained live screenshots show repeated pressure; any later change should be a
tightly bounded diagram-primitive allowance, not a global budget increase. No live
or credentialed request was made.

## 2026-07-18 — Checkpoint cutoff hardened and deterministic visual lints added

Checkpoint prompts no longer treat every `response.done` as successful completion.
An unprompted `cancelled` or `incomplete` checkpoint emits a correlated failure,
stays out of listening, and receives exactly one bounded retry; a cancellation caused
by detected student speech remains the intentional early-answer path. Checkpoint
answer-evaluation guidance is cleared while the question is requested and installed
only after prompt audio begins, removing the contradictory "student is answering"
instruction from question generation.

The browser now computes closed, deterministic layout findings from resolved geometry:
primitive-label overlap, labels escaping their shared diagram canvas, and handwritten
text that cannot fit at the minimum font size. These findings appear only in diagnostics
and never move committed or partially revealed ink. Prompt v3 now chooses a visual
structure appropriate to the concept and applies a word-removal test with evidence-
bearing values. Its fully expanded SHA-256 is
`1ef5b74244e997ba58e3040ae9861f3186d430a7cde78780afd957bc6c9396e6`;
future v3 evidence must use that hash rather than earlier v3 evidence.

Deterministic verification passes: 278 frontend tests across 27 files, 222 backend
tests, frontend ESLint, TypeScript, and the Vite production build. The existing Vite
chunk-size and Starlette TestClient deprecation warnings remain non-blocking. No live
or credentialed request was made. Remaining acceptance is perceptual: the M4 cached
three-loop gate and the separately approved prompt-v3 smoke/batch.

## 2026-07-18 — Blank teaching-step response race closed

The reported run—one short framing sentence followed by `TEACHING · step 1` on an
empty board—was a response-coordination race, not an empty lesson. The filler
`response.create` was registered before the service returned `response.created`, but
the public snapshot exposed only active IDs. Auto-start could therefore enter teaching
during that invisible pending window; the later narration request correctly refused to
overlap the filler, then had no state change that would make it retry.

Realtime snapshots now expose pending registrations immediately. All lesson start,
replay, resume, and generation gates treat pending, active, or playing responses as
busy. Auto-start also rechecks the client's current authoritative snapshot after the
asynchronous board-context acknowledgement, closing the check/use window. Scripted
narration refuses any coordinator in-flight work and emits its current snapshot on a
busy rejection, so the lesson hook retries only after a real busy-to-idle transition.
An eight-second `response.created` watchdog releases an unbound request, while a
twenty-second settlement watchdog releases a created response that never completes
both generation and playback. Scripted failures return through their existing safe
state path; a missing filler response simply allows lesson auto-start to continue.

Regression coverage reproduces the exact pending-filler race, the transient narration
rejection/recovery sequence, a missing `response.created`, and a created response that
never settles. The full deterministic frontend gate passes 283 tests across 27 files,
ESLint, TypeScript, and the Vite production build. The existing Vite chunk-size warning
remains non-blocking. No credentialed request was made. A connected cached/live lesson
rehearsal remains necessary to confirm the audible filler-to-narration handoff in the
selected browser; deterministic tests do not claim that perceptual evidence.

## 2026-07-18 — Generic direct Q&A drawing implemented behind a flag

The Realtime tutor can now request one or two small, target-relative visual marks
during an interrupted-question answer when `VITE_QA_DIRECT_DRAW=on`. The closed
tool vocabulary is circle, underline, arrow, short text, and equation; it contains
no topic keywords, absolute coordinates, erase, axes, or lesson mutation. The
browser accepts calls only in `QA`, resolves targets against the current committed
renderer snapshot, assigns annotation IDs, stamps the current manifest version,
and validates the completed program through the existing annotation schema before
placing it on the disposable overlay layer. Unknown/future targets and invalid or
oversized batches fail softly. The existing board-model `annotate` tool remains the
fallback, and the default `off` value preserves the dependable demo path.

Verification covers tool-schema exposure under the flag, strict argument
decoding, Q&A phase and visible-target gates, current-version stamping, schema
validation, tool-output continuation, and refusal of oversized/unsafe batches.
The full frontend gate passes 342 tests across 40 files, ESLint, TypeScript, and
the Vite production build; the existing bundle-size warning remains non-blocking.
No credentialed API call was made. Remaining evidence is a live mini-model Q&A
rehearsal measuring target validity, placement quality, response/tool ordering,
and interruption behavior before considering the flag for the recording path.

## 2026-07-18 — Checkpoint-feedback deadlock closed

A connected run stopped at `checkpoint_feedback · step 3/4` after the spoken
feedback cut off. The reducer was waiting for feedback settlement, but the
Realtime failure dispatcher emitted terminal events only for lesson narration
and checkpoint prompts. A failed or timed-out feedback response was released
internally without telling the lesson state machine, leaving it stuck forever.

Checkpoint feedback now has a correlated failure event that completes the
checkpoint and advances to the next step. Cancelled/incomplete feedback fails
immediately; a created response that never settles fails through the existing
twenty-second lifecycle watchdog; and an automatic response that never produces
`response.created` now has an eight-second creation watchdog. Successful feedback
still requires generation completion, playback stop, and the drain guard. Focused
Realtime, coordinator, reducer, and sync verification passes 76 tests; TypeScript
and ESLint pass. No credentialed API call was made. A live checkpoint rehearsal
is still needed to verify audible behavior, but none of the three missing-terminal
paths can retain `CHECKPOINT_FEEDBACK` indefinitely.

## 2026-07-18 — Closed composition-archetype contract implemented

The persistent resolved-stepwise lesson plan now accepts one optional closed
`composition_archetype`: `single_large_figure`, `derivation_plus_diagram`,
`worked_example_column`, `comparison_pair`, or `graph_with_summary`. Omitting the
field remains valid, so retained plans and cached lessons do not need migration.
The shared schema rejects custom archetypes, arrays, object-shaped compositions,
extra zone fields, and arbitrary rectangles or bounds.

Board prompt v3 and the resolved continuation prompt now expand a deterministic
lesson-plan contract generated from the shared schema. The contract tells the board
model that the archetype is a semantic selection only; browser-owned code maps it to
existing regions. Repair does not receive irrelevant plan instructions, and pinned
board v1/v2 hashes remain unchanged. The fully expanded board-v3 prompt hash is now
`a0ea53cec1c4443b6325b0d973186b3db1b8eddc4380aa6789eb23740157cb64`; the continuation
prompt hash is `94da5792d10f7e4c938244d936a053f8490694695e0decb04e640af2853d63a8`.

New browser-owned `compositionPlan.ts` maps every archetype to deterministic semantic
zone names, existing schema regions, and qualitative occupancy roles. Peer layouts
declare horizontal balance; primary/supporting layouts do not. The module exposes no
rectangle, coordinate, bounds, or custom-zone surface and is deliberately not wired
into the concurrently changing resolver yet, so this slice cannot move committed ink
or alter cached rendering.

Focused verification passes 79 backend prompt, plan/scene, lesson, continuation-
receipt, and stream tests plus 37 targeted frontend composition/stream/continuation
tests. The widened deterministic gate passes all 273 backend and 386 frontend tests,
Ruff lint/format, ESLint, TypeScript, the Vite production build, generated schema types,
and diff hygiene. The existing Starlette deprecation and Vite chunk-size warnings remain
non-blocking. No live, vision, or credentialed call was made. Impact review: the closed name should improve
lesson-wide spatial continuity and gives density scoring an honest expectation source;
the main risk is applying final-board occupancy too early in a streamed prefix, so
integration must remain progression-aware and advisory until its retained gate passes.
Renderer-failure recovery remains the separate unfinished half of roadmap Phase 4.

## 2026-07-18 — Continuation prompt context bound to authenticated receipts

The resolved-step continuation receipt now binds a canonical SHA-256 of the bounded
topic and student context in addition to request/client identity, accepted prefix,
lesson plan, cumulative repairs, and model/prompt configuration. The receipt contains
no raw student context. Both initial and rotated receipts use the same whitespace
normalization as the validated lesson request, and verification happens before the
replay ledger or any model dispatch. This closes a gap where a valid receipt could be
reused with a different topic or learner context while keeping its prefix and plan.

Receipt decoding now also rejects noncanonical Base64URL aliases. Without that check,
different final characters whose unused padding bits decode to the same authenticated
signature bytes could pass HMAC verification while producing distinct receipt-string
digests in the process replay ledger. A deterministic regression constructs that alias
and proves rejection before upstream dispatch.

The combined focused backend gate passes 95 lesson, resolved-scene, drawing-experiment,
and prompt-contract tests, including explicit topic/student-context substitution and
noncanonical receipt aliases with zero upstream calls. No credentialed or live request
was made. The broader drawing-roadmap audit remains in progress.

The continuation configuration identity is now also bound to the exact bytes of the
lesson, lesson-plan, and resolved-scene schemas plus a deliberately maintained
browser-resolver policy revision. Mutation of any one identity rejects the prior
receipt before model dispatch; a maintenance test pins the schema-byte hashes and the
revision rather than asking FastAPI to inspect arbitrary frontend source at runtime.
Drawing experiment records include the same identities in their fully canonical
configuration digest and now report `renderer_dropped_ops` separately from
browser/backend `dropped_steps`, at both topic and aggregate level. The focused gate
passes 15 receipt/identity/experiment tests plus scoped Ruff lint and format checks.
No live, paid, vision, microphone, or credentialed request was made.

Drawing experiment schema 1.1 closes two additional evidence gaps. A stopped bounded
run can now retain an exact completed-topic prefix plus one content-free terminal
attempt with an allowlisted stop category and explicitly counted requests, model calls,
and repairs; it cannot promote or carry calibration. Live configurations now pin
complete Realtime model/voice/base-instruction/tool-contract identity, browser
engine/version, and annotation prompt/schema hashes whenever their corresponding flag
or latency metric applies. Partial bundles and null identities on enabled paths fail
verification. The 35-test experiment gate covers empty-first-attempt aborts, prefix
ordering, unrepresented call rejection, closed abort rationale, and live identity
completeness. No live or credentialed request was made.

## 2026-07-18 — Phase 5 transient attention rail implemented behind a flag

`VITE_ATTENTION_CHOREOGRAPHY=on` now routes temporary board emphasis through a
one-at-a-time browser-owned rail during `QA` and `CHECKPOINT_FEEDBACK`. Every action
is stamped with the active lesson request, renderer manifest version, visible target,
and a closed duration; the rail holds at most four actions, removes them automatically,
and cancels the entire queue on interruption, lesson replacement, manifest change, or
target disappearance. The new `trace_path` action reuses the target's actual retained
SVG path (including completed composite parts), while `focus_on` temporarily masks
unrelated ink. Neither changes permanent geometry or appears in board context.

The flag remains `off`: existing point/circle/underline/flash behavior and the
rough-SVG demo path are unchanged until three cached Q&A/checkpoint loops find the
rail explanatory and show no target, tool-order, interruption, or distraction
regression. The flag registry, homogeneous experiment schema, `.env.example`, and
lifecycle contract include its promote/park/remove milestone.

Focused verification passes 47 choreography/overlay/protocol/router tests, 12 Phase-0
experiment-contract tests, scoped ESLint and Ruff, and diff hygiene. TypeScript was
temporarily blocked by concurrently in-progress Phase 3/4 files and must be rerun at
their integration boundary; no live, microphone, paid, or credentialed call was made.

## 2026-07-18 — Phase 6A remote-audio activity spike is instrumented, not promoted

The opt-in `VITE_REMOTE_AUDIO_ACTIVITY=on` path now attaches a Web Audio analyser to
the remote WebRTC stream after the normal audio element is configured. A bounded RMS
detector requires consecutive active frames to start and a longer silent window to
stop, reducing chatter around the threshold. It retains only closed activity/silence
trace transitions, sample count, current activity, and maximum sample cost; it stores
no waveform, audio bytes, transcript, utterance, word, or sentence position. Failure
to create Web Audio records one closed unavailable code and leaves playback untouched.

This is measurement-only: it does not gate animation, alter `SYNC_MODE=fixed`, or
authorize Phase 6C narration beats. The flag registry declares promotion only after
the separately owner-approved two-voice cached comparison measures latency, false
pauses, CPU cost, interruption, and three consecutive perceptual preferences.

Focused verification passes 65 Realtime/protocol/activity tests plus scoped ESLint,
and the 12 Phase-0 flag/evidence tests remain green. No live session, microphone run,
or paid/credentialed API call was made; Phase 6B comparison and any beat schema remain
pending evidence rather than being inferred from deterministic tests.

The Phase 6B comparison now also has a content-free deterministic planner and evidence
collector. It derives either one normalized response or two-to-five complete sentence
responses from the exact same cached script, pins the exact response-call ceiling,
refuses to request sentence N+1 until both generation and playback of N settle (or N
fails), and retains only response counts, total latency, inter-sentence gaps, failure,
and interruption metadata. Seven focused audio/sentence experiment tests pass. This
scaffold makes the eventual bounded comparison auditable; it does not dispatch calls,
select a winner, or authorize beats.

## 2026-07-18 — Phase 7 annotation whitespace resolver implemented behind fallback

`ANNOTATION_WHITESPACE=bounded` now derives two target-relative side choices for every
committed visible element from the exact normalized bounds already supplied to
`/annotate`. The deterministic scorer mirrors the renderer's largest current
text/equation overlay box, includes the target and all neighboring ink in overlap
cost, penalizes board-edge clamping, and breaks ties in a fixed order. Generation and
repair receive only the compact ID-to-side allowlist; backend semantic validation
rejects arrow/text/equation output outside it. No topic keyword, arbitrary coordinate,
student text, or renderer-internal record is introduced.

The default is deliberately `off`, which omits the new field and preserves the prior
annotation prompt input and target allowlist. Circle/underline are unaffected, local
deixis remains available, and the 6 KiB browser request ceiling is unchanged. Promotion
requires retained placement improvement without increased repairs, drops, latency, or
stale-target failures at the separately approved Phase-7 gate.

Focused verification passes 35 annotation, whitespace, request-budget, flag-registry,
and experiment-record tests; scoped Ruff lint/format and diff hygiene pass. No model,
live, microphone, paid, or credentialed call was made. Permanent Q&A micro-steps remain
correctly unimplemented until the existing disposable-overlay live gate passes.

## 2026-07-18 — Phase 3 universal constructions resolve from committed geometry

Lesson schema 1.3 adds five closed, topic-independent spatial relationships:
`along`, `midpoint_of`, `intersection_of`, `perpendicular_through`, and
`offset_from`. The model names the relationship and prior-step source IDs; it never
emits the derived point or endpoints. FastAPI validates the schema, types, prior-step
reference inventory, budgets, and repair contract. The browser then resolves exact
1600x900 geometry from already laid-out renderer truth, inherits one canonical canvas,
and rejects unknown, cross-canvas, ambiguous, parallel, disconnected, degenerate, or
off-canvas results with closed codes. A failed construction omits only that op and
keeps unrelated ink renderable.

Resolved points and lines use the normal stable rough-path, reveal, label, snapshot,
manifest, and continuation paths. Their concise summaries preserve relationship
meaning for voice and continuation grounding only after the geometry succeeds.
Constructed roots cannot enter layout-movement relations, and a later streamed step
cannot move their committed prefix. Shared fixtures pin successful and rejected cases,
floating-point boundaries, browser/backend authority differences, exact normalized
contact geometry, and reuse across optics, Euclidean geometry, mechanics, calculus,
vectors, and free-body diagrams. Cached lessons and golden source fixtures remain
byte-identical.

The expanded board-v3 prompt SHA-256 is
`dae52fecd9075bc486ffa6179df89112c385a1ffd0d46eb8ad3656b7b0450bcb`;
repair is `a24199c33d9163805ac719000ed814517716a2f454d05d4bd05be40e5d1f9d91`,
and resolved continuation is
`d85254f72da31ead61e941f31ad6159c6a3528b2f38f5bd6a78056484a4f6d95`.
Pinned board v1/v2 prompts remain unchanged, so no new evidence may be mixed with the
pre-1.3 v3 hash.

The integrated deterministic gate passes 474 frontend tests across 54 files and 308
backend tests, plus frontend ESLint, TypeScript, the Vite production build, Ruff
lint/format, generated schema types, fixture parity, and diff hygiene. The existing
Vite chunk-size and Starlette TestClient deprecation warnings remain non-blocking. No
live, vision, microphone, paid, or credentialed request was made. Remaining risks are
explicit: curve relations use the deterministic 121-sample conceptual polyline rather
than analytical roots, rough ink may visually wobble around an exact conceptual
contact, and server-side validation cannot predict browser-only geometric ambiguity.
The next retained live rubric must prove that the model uses these relations correctly
and that their extra prior-step accumulation does not create cramped lessons or buffer
stalls before they are considered qualified for the recording path.

## 2026-07-18 — Phase 6 comparisons now have strict, content-free execution evidence

The earlier Phase 6A analyser and 6B planner could expose activity/count signals but
could not produce a trustworthy promotion record. A new shared evidence contract pins
the exact cached step by SHA-256, Realtime model, candidate voice, browser label,
`fixed` fallback, detector revision, and exact response ceiling. Its semantic verifier
recomputes activity latency, detector-stop lead, false pauses, sampling cost,
inter-response gaps, and total latency from monotonic retained timestamps; rejects
mixed experiments, voices/configurations, stale metrics, overlapping responses,
post-failure calls, and incomplete promotion records; and requires the relevant human
preference and interruption result before a promotion can pass.

The 6A recorder accepts the existing analyser callback, buffer lifecycle, and
human-observed audible windows while dropping RMS values. It claims at most one
response and fails unsupported before spend. The 6B runner re-hashes its immutable
in-memory script immediately before dispatch, executes serially with no retry, stops
on the first failure, and rejects AbortSignal or superseded-run results. It has no
default dispatcher, network client, credential, media acquisition, or product UI;
future live execution still requires fresh owner approval and an explicitly injected
dispatcher. Neither path changes animation or authorizes beats, and `SYNC_MODE=fixed`
remains authoritative.

Focused verification passes 30 Phase-6 evidence, recorder, runner, legacy planner,
and analyser tests, TypeScript, scoped ESLint, schema regeneration, and diff hygiene.
No live, WebRTC, microphone, paid, credentialed, vision, or model call was made. The
remaining work is the exact owner-approved three-run/two-voice 6A comparison and the
one-step single-versus-sentence 6B comparison with human ratings; Phase 6C remains
forbidden unless one of those live gates wins.
