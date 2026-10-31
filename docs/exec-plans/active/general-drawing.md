# General drawing: one scene model, a few universal mechanisms

Status: active — Phase 1 implemented 2026-10-18; Phase 2 implemented 2026-10-19 (`VITE_CHALK_SCENE=scene`, default still `legacy`); Phase 3 `figure` op and Phase 4 prompt v4 first cut 2026-10-19; prompt v4 is the default since 2026-10-21 (40-topic suite vs v3: coverage 0.875→0.971, repairs 20→1, median lesson 23.2→14.5 s, clean boards 36 vs 31–38 across three v4 runs; owner-approved AI blind judgment in place of the human page: v4 better on 26 topics, v3 on 7, 7 split); motions on the wire, MathJax, and closed-loop repair not started; live/paid gates need owner approval
Planned: 2026-10-18
Supersedes the op-by-op fix approach in `drawing-intelligence-roadmap.md` (its prefix-stability, evidence, and rollback rules still apply)
Rollback baselines: `VITE_LESSON_GENERATION=one-shot`, `BOARD_PROMPT_VERSION=v3`, legacy op path until `VITE_CHALK_SCENE=scene` passes its gate

## Why this plan exists

The owner's blind test on 2026-10-18 picked the new system on 9/10 topics but the
new renderer on 0/10 when the lesson was held fixed. The gains came from the model
and prompt; renderer work had been a sequence of local patches (axes look wrong →
axes code; a label lands on a line → a nudge for that case). That does not converge
on a tutor that can draw anything a teacher would sketch.

A read-only audit of `frontend/src/board/` (2026-10-18) measured the fragmentation:

- **11 coordinate systems** — board pixels, the A1–D3 region grid, three different
  "gap" units (target size, board size, canvas size), a square y-down diagram canvas,
  axes data space, a stretched sketch space, construction space, annotation pixel
  offsets, normalized manifest bounds, a 40×24 occupancy grid, and KaTeX CSS pixels.
- **Label positions decided in 13 places**, each with its own offsets (+16/−12, −14,
  −18, radius+24, 20 px along the normal …) and three separate search loops.
- **Duplicated math**: data→pixel mapping written 3 times, normalized→canvas 4
  times, the overlap ratio 3 times, arrowheads and arc sampling twice each.
- **Fixed intrinsic sizes** (axes 700×430, sketch 318×190, text 310×64, diagrams
  520×520) instead of content-driven sizes.
- **Layout ignored labels** and accepted a root that overlapped a neighbour by up to
  15% of the smaller box after scoring at most two alternatives.
- **Expressiveness caps**: curves only `y = f(x)`; no point, arrow, label, or fill in
  a graph's data coordinates; no polygons, filled regions, parametric or polar curves,
  transforms, or symmetry; 16 primitives per diagram; 4 ops per step.

## North star

The board model says **what** to draw in a real coordinate system; the renderer
applies a **small set of universal mechanisms** to decide **where and how big**, and
reports exact renderer truth back. No mechanism may be specific to one op kind or
topic. A capability counts only when it improves a broad, fixed evaluation suite
under blind human judgment — not one board.

## Design principles

1. **One scene model.** Board → frames → marks. A frame is a box with one coordinate
   window `x:[a,b] × y:[c,d]` (math y-up), with `axes: edge | origin | none`, `grid`,
   and `equal_scale`. A plot and a diagram are the same thing with different options,
   so any mark can sit on a graph in data units.
2. **One general mark vocabulary** in frame coordinates: point, path (polygon when
   closed; smooth; arrowheads), line (through/to/slope/tangent_to/normal_to), vector,
   circle, ellipse, arc, function `y(x)`, parametric `x(t), y(t)`, polar `r(θ)`, region
   (under/between functions or inside/outside closed marks), angle, measure (dimension
   line), label, and group with transform (translate, rotate, scale, mirror) and repeat.
   Point references (`{"on":id,"x":…}`, `{"hit":[a,b]}`, `{"mid":…}`, `{"foot":…}`)
   replace the six bespoke construction rules.
3. **One label solver.** Labels state a target and a mobility (`fixed`, `nudge`,
   `free`), never a final position. One cost function scores candidates against
   stroke-level ink of every element, typeset blocks, and earlier labels. Labels are
   solved in commit order, so committed labels never move (prefix-stable by
   construction).
4. **One no-overlap guarantee.** Root boxes never intrude on committed roots: after
   placement scoring, an intruding root moves to the nearest clear spot, and only then
   shrinks. Labels count as occupied space.
5. **One fit rule.** Every text-bearing thing (text, LaTeX, labels) renders at a base
   size and shrinks only to fit measured ink inside its box. Nothing clips silently;
   anything that cannot fit becomes a lint.
6. **One measurement truth.** Lints, the solver, layout, and the evaluation gallery
   share one geometry model (stroke polylines + measured boxes). A lint can never
   disagree with the mechanism it audits.
7. **Closed loop.** Universal findings (overlap, clip, off-board, tiny text,
   ambiguous label, mark outside its frame) flow back to the model as structured
   evidence for the next step or one bounded repair.
8. **Manim's model, not Manim's runtime.** Every visual effect is a pure function of
   step progress (`interpolate(alpha)` in Manim terms), so freeze and resume stay free.
   Marks and motions use Manim's names (Create, Write, FadeIn, Transform,
   TransformMatchingTex, Indicate, MoveAlongPath, `lag_ratio`, `rate_func`) because the
   board model already knows them. CHALK never runs Manim or model-written programs;
   see `docs/research/manim-study.md`.
9. **Data only, bounded.** Same safety contract as today: allowlisted expression AST
   per variable (`x`, `t`, `theta`), numeric bounds, mark-cost budgets, no free text
   beyond labels and notes, KaTeX `trust:false`.

## Phases

### Phase 1 — universal mechanisms on the current vocabulary (done 2026-10-18)

- `labelSolver.ts`: board-wide label placement with stroke-level ink (SVG paths
  flattened to polylines in a grid index), typeset-block and label avoidance,
  mobility levels, and a smaller-size fallback. Replaces `declutterCanvasLabels`,
  `resolveDiagramLabelCollisions`, and the straight-line nudge. Tests pin "free label
  leaves ink", "avoids every earlier element", "fixed never moves", "earlier labels
  unchanged when a later step arrives", and path flattening.
- `layoutLint.ts` now uses the solver's ink model across all elements, and bounds
  labels by the board edge instead of their own canvas.
- `layout.ts` `clearPlacement`: the board-wide no-overlap guarantee for region,
  anchored, and diagram roots (nearest clear spot, then shrink 0.85/0.72/0.6).
- Axes back on plot edges with faint zero reference lines (replaces the
  axis-through-origin special case the blind test rejected).
- Equations measure at full size and shrink only to fit (removed the length
  heuristic that collapsed long equations to 10 px).
- Board gallery (`frontend/gallery.html`, dev only): renders many saved lessons with
  the production renderer and scores them with one quality module.

Gate: full deterministic suite green (594 frontend, 354 backend); gallery baseline
recorded: 65 of 70 retained boards clean, all golden and cached lessons clean. Still
open: a blind renderer-only round on fresh lessons.

### Phase 2 — scene IR and renderer path (no wire change; done 2026-10-19)

Gate met (see `PROGRESS.md`): parity within 1.1e-13 px on all cached, golden, and
retained boards; scene-path prefix stability; freeze/resume equivalence through the
sync reducer; gallery fingerprint identical on both pipelines. Divergences: root
placement still comes from `layout.ts`; region fills live in `scene/marks.ts` (no
separate `clip` module) and are not yet in a per-frame underlay.


- New `frontend/src/board/scene/` with `types` (frames, marks, refs), `refs`
  (point-reference resolution with dependency graph), `sample` (fn/param/polar
  through the existing locked-down compiler), `marks` (geometry per mark kind using
  one frame transform), `clip` (region fills), and the label solver moved here.
- `compileLegacy.ts`: every current op compiles into frames and marks (axes → plot
  frame; curve → fn; diagram/sketch/standalone primitives → equal-scale frames with v
  flipped; constructions → point references; diagram text → `label` with side `on`).
- Delete the duplicated mappings (data→pixel ×3, canvas ×4, overlap ×3).
- Marks keep cubic Bézier subpaths alongside their `d`, so reveal and morph share one
  representation; `pathToPolylines` stays the collision flattener.
- Motion core (renderer-only, from the Manim study): `scene/motion.ts` (the
  `interpolate(alpha)` contract, a `rate` enum including smooth and there_and_back, and
  group stagger mapped onto op weights) and `scene/morph.ts` (subpath sorting, padding
  with degenerate subpaths, length-aware de Casteljau subdivision; grows from the tested
  `pathMorph.ts` spike). Morphs are built once at geometry preparation and evaluated as
  `d = morph(rate(opProgress))`; frame 1.0 is the target's own seeded rough.js path, and
  ink is never re-roughened per frame.
- Gate: the three cached lessons and all golden fixtures render with root boxes within
  1 px of Phase 1 output and stable rough seeds; prefix-stability property test passes
  on the compiled path; a freeze-at-*p*-then-resume run renders the same frames as an
  uninterrupted run; flag `VITE_CHALK_SCENE=legacy|scene` defaults to `legacy`.

### Phase 3 — wire schema 1.5

- `shared/schema/lesson.schema.json`: `frame`, `text`/`tex` notes, mark ops, `pt`
  references, transforms, style enums (`stroke`, `tone`, `weight`, `fill`), and
  budgets (≤16 ops per step, ≤2 frames, ≤12 labels, expanded mark cost ≤32 per step,
  ≤96 per frame, ≤200 per lesson). Regenerate TS types.
- Backend: `lesson_validation.py` typed references and budgets,
  `expression_runtime.py` per-variable sampling, sanitizer parity, prompt-contract cap
  test (≤3.5 KB). Shared accept/reject fixtures run in both languages.
- Browser-only geometric failures (no unique intersection, empty clip) skip the mark
  and its dependents with a structured warning.
- Motion ops with Manim names and enum rates, never durations: `transform` (takes over
  the source ID; the target box is reserved at layout; source and target ink both count
  as occupied for that step), `match_tex`, `move_along`, `indicate`, `fade_in`. Manifest
  rule: the source stays listed until the morph commits, then the target replaces it; a
  freeze mid-morph publishes the source. Per-step motion budget.
- Equations as MathJax SVG glyph paths behind `VITE_CHALK_MATH=katex|mathjax`
  (Apache-2.0; parsed into CHALK path data, never injected as markup; the `latex.ts`
  blocklist still applies). Glyph matching for `match_tex` follows Motion Canvas's
  `{{…}}` part matching. Cached lessons are re-baselined for equations, so the 1 px
  parity gate excludes them; filled-glyph Write needs a blind visual check.
- Gate: parity fixtures green in Python and TS; request/response byte limits
  unchanged; repair path handles 1.5 field errors.

### Phase 4 — prompt v4 and the closed loop

- `board_engine_v4.md`: one coordinate convention, three worked 1.5 examples
  (graph with tangent and shaded integral; equal-scale diagram; symmetry via mirror),
  and no op-specific layout prose.
- Feed Phase-1 findings on the rendered prefix into `/lesson/continue` (resolved-
  stepwise already carries findings) and allow one bounded step repair when a hard
  finding appears.
- Gate: owner-approved live batch (below) beats prompt v3 on the blind suite.

### Phase 5 — broad evaluation (runs after every phase)

- **Suite**: 40 fixed prompts in 8 categories — calculus graphs, trigonometry and
  circles, geometry constructions and proofs, vectors and mechanics, waves and optics,
  probability and sets (Venn, trees), algebra/number lines/tables, and free-form
  shapes framed as math (symmetry, tessellation). Never tuned against individually.
- **Metrics** (gallery, automated): overlap, clipping, off-board, tiny text, orphan
  wraps, ambiguous labels, marks outside frame, board coverage, first-step latency,
  repairs/drops, cost per lesson.
- **Human**: blind pairwise page (the 2026-10-18 format) on a 10-topic random sample
  per phase; renderer-only and whole-system rounds.
- Promotion rule: a change ships only if automated metrics hold or improve on the full
  suite **and** the blind sample prefers it or calls it even.

### Phase 6 — retire legacy code

After 1.5 passes Phase 5 live: flip defaults, keep `compileLegacy.ts` permanently for
cached lessons, delete bespoke diagram/label/construction code in `geometry.ts` and
`construction.ts`, and extend annotations to add marks to existing frames.

## Live spend for this plan (requires owner approval per batch)

| Batch | Calls | Approx. cost |
|---|---|---|
| Phase 1 check: 40-prompt suite on prompt v3 | 40 | ~$0.40 |
| Phase 4: suite on prompt v4 vs v3 | 80 | ~$0.80 |
| Re-runs after fixes (estimate) | 80 | ~$0.80 |

## Risks

- **New vocabulary**: the model may keep y-down habits or invent fields. Mitigate with
  one convention, window-range validation, examples, and v3 as rollback.
- **Prompt size**: the contract grows; a test caps it.
- **Validator parity**: Python cannot clip or intersect; those failures are
  browser-only by design and covered by shared fixtures.
- **Prefix stability**: frames, boxes, and labels freeze on commit; fills paint in a
  per-frame underlay so later regions never cover earlier ink.
- **Motion semantics**: a transform rewrites committed ink by design; the takeover-ID
  and manifest rules above need a property test before the model may emit morphs.
  MathJax adds bundle size and coverage differences versus KaTeX (unmeasured).
- **Latency**: richer steps take longer on GPT-6.1 Sol (median first step ~12 s with
  v3 visual-first guidance). Resolved-stepwise streaming or a faster opening model is
  tracked separately.
