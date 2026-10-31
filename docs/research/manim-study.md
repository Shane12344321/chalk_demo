# Manim study: what CHALK should take from it

Date: 2026-10-19 · Status: research only, no plan or code changes

Sources were read at pinned commits: **gl** = `3b1b/manim` (manimgl) at `fafa083a` (2026-09-09), and **ce** = `ManimCommunity/manim` at `b31c77e1` (2026-10-16). Both are MIT. Paths are relative to each repository root. Nothing was installed or run.

## Recommendation

**Take Manim's model and vocabulary, and port only a small path-morph core. Don't adopt a Manim library or port.**

- **CHALK already has Manim's central idea.** Every frame is a pure function of progress:
  - `renderer.ts:109-119` maps `(stepIndex, stepProgress)` to per-op progress;
  - `animation.ts:61-71` splits a step by op weight;
  - `Board.tsx:208-219` reveals strokes with `pathLength=1` and a dash offset.
- **What CHALK lacks is shape-to-shape motion:** Transform (one mark morphing into another), TransformMatchingTex (an equation rewriting itself), MoveAlongPath and Indicate.
- **Port about 400–700 lines of TypeScript:**
  - Bezier subpaths;
  - Manim-style alignment and subdivision;
  - the `interpolate(alpha)` contract;
  - an enum of rate functions;
  - later, behind a flag, a glyph matcher for equations built on **MathJax SVG**.
- **Effort:** 6–9 working days, not counting evaluation (see Effort).
- **Corrections to the claims in the question:**
  - The frame-loop claim holds for both versions. The ffmpeg part holds for manimgl only: ManimCE encodes in-process through PyAV.
  - manimgl now renders with wgpu/WGSL, not OpenGL.
  - "1–2k lines" undercounts the modules as written (6–14k lines) and overcounts what CHALK needs.

## 1. Why the output is video

**`Scene.play` is an offline loop with a fixed frame rate.**

- **gl.** `get_time_progression` builds frame times with `np.arange(0, run_time, 1/fps)` (`manimlib/scene/scene.py:452-476`). For each frame time `t`, `progress_through_animations` advances the clock, calls `animation.interpolate(t / run_time)`, runs updaters, draws, and emits the frame (`scene.py:547-563`). `play` is a blocking sequence of `begin → progress → finish` (`:575-592`). Raw RGBA frames are piped into an `ffmpeg` subprocess's stdin (`scene_file_writer.py:207-243,297-308`).
- **ce.** The same loop appears in `manim/scene/scene.py:1092-1130,1384-1418`.
  - Cairo hashes each `play` call, skips it on a cache hit, and writes one partial movie per call (`renderer/cairo_renderer.py:70-137`).
  - Frames go to a PyAV encoder thread (`scene/video_segment_encoder.py:18-100`, `scene_file_writer.py:504-527`), and the partial movies are concatenated with PyAV (`:768-830`).

**Renderers.**

- **gl:** wgpu with WGSL shaders (`manimlib/window.py:1-13`, `manimlib/shaders/*.wgsl`, `renderer/renderer.py:93-123`).
- **ce:** Cairo renders on the CPU. An OpenGL path uses moderngl_window/pyglet (`renderer/opengl_renderer.py`, `opengl_renderer_window.py:1-18`).

**The real-time modes preview the same loop. Neither is an interruptible runtime.**

- **gl window.** `draw_frame` sleeps so that virtual time never runs ahead of wall time (`scene.py:241-259`). Events are polled once per frame (`window.py:174-182`). The window's docstring says Manim "drives its own loop" (`window.py:69-81`). `interact` and `embed` work only between or after `play` calls (`scene.py:187-221`).
- **ce OpenGL.** `render` redraws in a busy loop until the wall clock catches up (`opengl_renderer.py:935-974`); frozen frames busy-wait (`:896-912`). `interactive_embed` runs after the scene (`scene.py:1439-1560`).
- **Neither version can pause in the middle of a `play` and resume.** The closest is a `stop_condition` that ends a loop early (gl `scene.py:594-619`, ce `scene.py:1405`).

**Why video:** scenes are imperative Python that mutates mobjects (Manim's scene objects), time is a `for` variable, and LaTeX needs subprocesses.

## 2. Core model

**Geometry.**

- **gl:** one structured array per VMobject holds `point`, `stroke_rgba`, `stroke_width` and `subpath_range` (`mobject/types/vectorized_mobject.py:64-75`). Curves are **quadratic** Beziers with anchors and handles interleaved, so n curves take 2n+1 points (`:1221-1268`). Cubic curves are approximated by quadratics (`:646-690`).
- **ce:** **cubic** Beziers, 4 points per curve (`vectorized_mobject.py:129,157`).

**Animation contract.**

- `begin()` copies the starting mobject and calls `interpolate(0)`. `finish()` calls `interpolate(final_alpha)` (gl `animation/animation.py:63-108`).
- `interpolate(alpha)` calls `interpolate_mobject`, which computes a per-submobject `sub_alpha`: `lag_ratio` staggers submobjects, then `rate_func` is applied (gl `:166-210`; ce `animation/animation.py:326-391`).
- Rate functions are plain `float → float`. `smooth` is a quintic smoothstep (gl `utils/rate_functions.py:13-109`).

**Primitives.**

| Animation | How it works |
|---|---|
| Create | `pointwise_become_partial(start, 0, alpha)` cuts the Bezier list (gl `creation.py:25-53`, `vectorized_mobject.py:1270-1309`; ce `creation.py:102-140`) |
| Write | Draw the border, then fill, staggered across glyphs (gl `creation.py:74-181`) |
| Transform | Align with a copy of the target, then blend the data arrays along `path_func` (gl `transform.py:54-68,116-123`, `mobject.py:1808-1838`) |
| FadeIn | A Transform from a shifted, transparent copy (ce `fading.py:98-145`) |
| Indicate | A Transform to a 1.2× copy with `there_and_back` timing (ce `indication.py:125-170`) |
| MoveAlongPath | `path.point_from_proportion(rate_func(alpha))` (ce `movement.py:173-202`) |

**Alignment before interpolation.**

- **gl:**
  - `align_family` pads submobject counts with invisible duplicates (`mobject.py:1739-1806`).
  - `VMobject.align_points` sorts subpaths by length and pads a missing subpath with a degenerate copy that runs out and back (`vectorized_mobject.py:1165-1212`).
  - It then adds curves by length-aware subdivision until each pair has the same number of curves (`:1221-1268`).
- **ce:**
  - `align_data` aligns null points, then submobjects, then points, recursively (`mobject.py:3117-3174`).
  - `align_points` pads with null curves and calls `bezier_remap` (`vectorized_mobject.py:1818-1945`, `utils/bezier.py:954-1016`).

## 3. The TeX pipeline

**gl.** `latex_to_svg` runs `latex` or `xelatex`, then `dvisvgm -n --stdout` (`utils/tex_file_writing.py:90-160`). The glyph outlines become submobjects.

- `StringMobject` maps substrings to glyphs by rendering a **second SVG** in which each isolated span has a unique color, then pairing glyphs by nearest centre (`mobject/svg/string_mobject.py:36-45,87-170`).
- `TransformMatchingStrings` runs difflib's `SequenceMatcher` over symbol substrings, then matches glyphs by shape. Leftovers fade out or in (`animation/transform_matching_parts.py:21-116,144-187`).

**ce.** Each `{{…}}` part is wrapped in `\special{dvisvgm:raw <g id='uniqueNNN'>}`, so glyphs come out grouped by part (`mobject/text/tex_mobject.py:429-499,522-540`).

- `TransformMatchingTex` keys each part by its `tex_string` (`transform_matching_parts.py:287-301`).
- `TransformMatchingShapes` keys each glyph by a hash of its normalized points (`:223-233`).

**What this means for CHALK.** Both matchers need vector paths for each glyph and a stable link from each glyph back to its source.

- KaTeX's HTML output provides neither.
- The TeX→DVI toolchain cannot run in a browser.
- The browser equivalent is MathJax SVG output (Apache-2.0). With `fontCache: 'none'`, each character becomes an explicit path.
- Motion Canvas already does this. Its `Latex.ts` uses `mathjax-full` (liteAdaptor, SVG output), splits on `{{…}}`, matches parts by glyph IDs, and fades the remainder.

## 4. Size

| Set | gl lines | ce lines |
|---|---:|---:|
| Whole Python package | 25,833 (102 files) + 1,431 WGSL | 76,213 (177 files) |
| **Minimal-port modules as written** (VMobject, Mobject, Animation, composition, creation, transform, movement, fading, indication, rate functions, bezier, paths) | **6,186 (24%)** | **13,852 (18%)** |
| Plus SVG, Tex and string mobjects, TeX writer, matching transforms | +1,671 | +2,104 |
| The actual mechanism (align/insert/partial, Animation, rate functions, align/interpolate) | **~570** | n/a |

Mobject is a general scene graph (updaters, 3D, styling), which is why the modules are large. CHALK needs only the mechanism. TeX is replaced, not ported.

## 5. Prior art

GitHub metadata was read on 2026-10-19.

| Project | License · activity | What it is | Fit |
|---|---|---|---|
| `maloyan/manim-web` | MIT · 487★ · pushed 2026-10-18 · v0.39.4 · 10 contributors, mostly the owner | ManimCE port (claims 0.22 parity); three.js canvas, KaTeX and `@mathjax/src`; `await scene.play(...)`; player with play, pause and scrub | **Poor.** Code authoring would mean model-written programs. It draws to a WebGL canvas with no SVG DOM for the manifest or rough.js, carries heavy dependencies, and is self-described as young. Worth reading, not adopting. |
| Motion Canvas | MIT · 19.4k★ · last npm release 3.17.2 (2024-12-14) | Generator timeline, editor and player | Poor as a runtime: it owns time and the canvas, and scenes are code. **Good reference** for matching MathJax parts. |
| Revideo, flubber, d3-interpolate-path | MIT / MIT / BSD-3 | A video fork of Motion Canvas; shape morphing by resampling into polygons (last push 2022); naive interpolation of `d` strings | No: video-first, stale or polygon-only, and too naive for subpaths. |

## 6. Fit with CHALK's constraints

- **Freeze and resume.** `currentStepProgress` advances only in `TEACHING` (`sync/useFixedLessonSync.ts:180-233`), and the reducer ignores ticks in any other phase (`sync/reducer.ts:202-209`). Freezing is free *as long as every effect is a pure function of progress*. Manim's `interpolate(alpha)` contract fits this; its mutating loop does not.
- **Narration timing.** Durations stay derived from narration and op weights; the model never supplies seconds. `run_time`, `lag_ratio` and `time_span` map onto weights, so only a `rate` enum and a group `lag` are needed.
- **Manifest.** An element counts once its progress is ≥0.999 (`manifest.ts:91-116`). Proposed rule for a morph:
  - the source ID stays listed until the morph commits, then the target ID replaces it;
  - a freeze in mid-morph publishes the source.
- **Data-only safety.** Copy Manim's vocabulary, not its programs. Use declarative ops (`transform`, `match_tex`, `move_along`, `indicate`) with enum rates. Parse MathJax output into CHALK-owned path data and never inject it as markup. Keep the command blocklist from `latex.ts`.
- **Committed ink.** A Transform rewrites committed ink. Make it an explicit op that takes over the source's ID:
  - the target box is reserved at layout time;
  - the label solver treats the source and target ink together as occupied for that step;
  - the endpoint is exact, so frame 1.0 is the target's own seeded rough.js path.

  Never re-roughen per frame: it would break the stable-seed rule.
- **Performance.** A morph lerps a few hundred points and sets `d`; alignment is precomputed once, like `begin()`. This has not been measured.
- **KaTeX → MathJax.**
  - Gains: exact ink bounds from the `viewBox`, which simplifies `FittedEquation`.
  - Costs: a bundle increase not measured here, and coverage differences that mean re-baselining cached lessons.
  - Phase 2's "within 1 px" gate cannot hold for equations.
  - Glyphs are filled outlines, so Write would trace the outline and then fill. This needs a blind visual check.

## Effort

| Piece | Days |
|---|---:|
| Morph core: subpaths, alignment, `interpolate`, rate enum, property tests | 1–2 |
| MathJax equations behind `VITE_CHALK_MATH=katex\|mathjax`, with parity for fitting, the manifest and safety | 3–4 |
| `transform` / `match_tex` ops: schema 1.5, Python validation, prompt examples, fixtures | 2–3 |
| **Total**, before Phase 5 evaluation | **6–9** |

## Risks

1. Morph semantics versus prefix stability and the manifest; this needs a property test before the model can emit morphs.
2. MathJax bundle size, latency and coverage differences from KaTeX.
3. The filled-glyph look versus chalk strokes.
4. Alignment artifacts such as crossing or inverted subpaths. Manim has them too; glyph-ID matching avoids most of them for equations.
5. The model overusing morphs, which needs a per-step budget.

## How this changes Phase 2 of `general-drawing.md`

This is a proposal; the plan itself is unchanged.

- **`scene/types`:** marks keep cubic Bezier subpaths alongside `d`, so reveal and morph share one representation. `pathToPolylines` (`labelSolver.ts:218`) stays the flattener for collision tests.
- **Add `scene/motion.ts` and `scene/morph.ts`:**
  - `motion.ts` holds the `interpolate(alpha)` contract, the rate enum and the stagger;
  - `morph.ts` holds alignment and interpolation (the spike below).
  - Both are renderer-only, so they fit Phase 2's "no wire change".
- **Gate addition:** a property test that freezing at *p* and resuming renders the same frames as an uninterrupted run.
- **Defer to Phase 3:** the `transform`, `match_tex`, `move_along` and `indicate` ops, plus MathJax behind its own flag. Use Manim's names (Create, Write, FadeIn, Transform, TransformMatchingTex, Indicate, MoveAlongPath, `lag_ratio`, `rate_func`) so the prompt can lean on what the model already knows about Manim.
- Phase 1 is unaffected.

## Spike: `frontend/src/board/pathMorph.ts`

New code only; it is not wired into the renderer.

- `createPathMorph(fromD, toD)` parses absolute `M/L/H/V/C/Q/Z` paths into cubic subpaths.
- Like gl, it sorts subpaths by length and pads missing ones with degenerate subpaths. It then adds curves where the remaining pieces are longest, using de Casteljau splits.
- It returns a pure `(alpha) => d`, and alpha ≤ 0 or ≥ 1 returns the original strings exactly.
- `pathMorph.test.ts` covers the exact endpoints, equal structure after alignment, midpoint geometry, mismatched subpath counts, preservation of curve shape under subdivision, and purity regardless of call order.

**Connecting it to the narration clock.** Build the morph once when the geometry is prepared, then render `d = morph(ease(opProgress(step.ops, opIndex, stepProgress)))`. Because it is a pure function of the progress CHALK already tracks, freeze, resume and the manifest's commit point keep working.
