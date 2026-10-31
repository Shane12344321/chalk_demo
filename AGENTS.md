# CHALK repository instructions

## Mission

Build CHALK as a reliable hackathon demo: a math and physics tutor that speaks while a whiteboard animates and that can be interrupted mid-response and mid-stroke. Optimize for a convincing, repeatable three-minute local demo, not for a generalized education platform.

Read `chalk-build-plan.md` completely before implementing a phase. Treat it as the product brief and this file as the audited execution contract. Where they conflict, follow this file and record the divergence in `PROGRESS.md`.

## Working principles

- Challenge assumptions that are not supported by code, a test, or current official documentation. Do not turn a speculative API shape into architecture.
- Build one thin vertical slice before broadening the DSL: one hardcoded projectile lesson, one voice session, one animated curve, one interruption, and one resume path.
- Keep every risky feature behind a runtime flag and preserve the last known-good demo path.
- Prefer a deterministic cached or hardcoded path over live generation when recording reliability is at stake. The demo should show live generation once, not depend on it throughout.
- Do not add abstractions for hypothetical deployment, accounts, storage, mobile, multi-user support, or other out-of-scope features.
- Do not silently weaken an acceptance criterion. If a gate is missed, document the evidence, cut a lower-priority feature, and restore the gate.
- Maintain `PROGRESS.md` with dated entries for completed work, verification performed, known failures, current flags, and the next smallest task.

## Audited corrections to the build plan

These corrections are intentional:

1. A browser cannot use native `EventSource` for `POST /lesson`. Stream lesson steps from the POST response as `application/x-ndjson` and consume `fetch(...).body` line by line. If true SSE is later required, use a POST that creates a job followed by a GET event stream.
2. The Python backend cannot call `mathjs.compile()`. It must validate a restricted expression subset without evaluation; the TypeScript renderer performs the final `mathjs` compile and finite-value sampling. Never claim that Python validated mathjs itself.
3. Do not create undocumented `role: "system"` Realtime conversation items for board state. Prefer replacing the session `instructions` with `BASE_TUTOR_PROMPT + latest manifest` through `session.update`, and wait for `session.updated`. Keep this behind a `BoardContextPublisher` interface so the mechanism can change after a documented smoke test.
4. Transcript deltas track generation, not guaranteed speaker playback. Paced synchronization is perceptual and heuristic. `response.done` alone is not proof that buffered WebRTC audio has finished playing.
5. The safe sync fallback must still animate ink concurrently with narration. Use `SYNC_MODE=fixed` for a word-count-duration schedule that starts on observed output-buffer playback activity. Transcript deltas prove generation, not audible playout, and must not start ink directly. Keep a strictly sequential mode only as an emergency diagnostic; it does not satisfy the final demo claim.
6. A Realtime tool call must not remain open for the full lesson generation. The `teach` handler starts the NDJSON request, returns a small `{"status":"started","request_id":"..."}` function result promptly, and lets lesson generation continue independently. Do not assume the model will keep speaking while an unresolved tool call blocks.
7. Generated-expression examples containing free symbols such as `v` or `g` are invalid unless the schema explicitly declares those parameters. For v1 lesson curves, allow only `x`, numeric literals, `pi`, `e`, and allowlisted functions. Inline other constants.
8. Dropping an invalid step can invalidate later references. Validation state must contain only accepted IDs; later steps that refer to a dropped ID must be repaired or dropped too.
9. Golden-topic snapshots are deterministic renderer fixtures, not proof that a nondeterministic live model will always generate good lessons. Keep live model evaluation separate from default CI.
10. “Safety beyond API defaults” is not entirely out of scope. This is a local prototype, but it still must avoid arbitrary code execution, avoid storing student audio/images/PII, stay within math and physics tutoring, and make no production or child-safety claims.

## Current OpenAI API baseline

API details are version-sensitive. Verify them against official OpenAI documentation before wiring or changing the Realtime adapter. As of 2026-07-15, the documented model IDs are:

- Development voice: `gpt-realtime-2.1-mini`
- Recording voice: `gpt-realtime-2.1`
- Default board model (owner-selected 2026-10-18): `gpt-6.1-sol` at `reasoning.effort: low` with board prompt v3, chosen for drawing quality over the six-second latency gate (v3 beat v2 on Sol for completion, latency, and layout in the 2026-10-18 batches). 6.1 Sol and `gpt-6-astra` reject `none`. `gpt-6-luna` at `none` is the low-cost, low-latency fallback.
- Historical M3 qualification: `gpt-5.6-luna` at `none`. The M3 evaluation harness stays pinned to it so old and new evidence never mix; the GPT-6.1 Sol configuration has no live rubric evidence yet.

Relevant official references:

- `https://developers.openai.com/api/docs/guides/realtime-webrtc`
- `https://developers.openai.com/api/docs/guides/realtime-conversations`
- `https://developers.openai.com/api/docs/guides/realtime-vad`
- `https://developers.openai.com/api/docs/models/gpt-realtime-2.1`
- `https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini`
- `https://developers.openai.com/api/docs/models/gpt-6.1-sol`
- `https://developers.openai.com/api/docs/models/gpt-6-luna`
- `https://developers.openai.com/api/docs/models/gpt-5.6-luna`
- `https://developers.openai.com/api/docs/guides/latest-model`

Keep all OpenAI event names and payload construction inside `frontend/src/realtime/`; do not scatter protocol strings through UI components. Before considering the Realtime layer complete, capture in `PROGRESS.md` the model ID, session payload, events observed in a live smoke test, browser used, and date.

The documented baseline currently includes:

- ephemeral client secrets from `POST /v1/realtime/client_secrets`;
- WebRTC as the recommended browser transport;
- `session.update` / `session.updated` for session instructions;
- `input_audio_buffer.speech_started` and `.speech_stopped` for VAD lifecycle;
- `response.output_audio_transcript.delta` for output transcript progress;
- `response.done` for completed response generation;
- automatic cancellation and truncation of unplayed audio on WebRTC interruption when VAD interruption is enabled.

Treat this list as a smoke-test checklist, not a permanent guarantee. Send `OpenAI-Safety-Identifier` when minting a client secret, using a non-PII, locally generated identifier.

## Architecture invariants

- The Realtime model owns conversation, tutoring style, turn-taking, and runtime tool selection. It never emits raw board drawing programs.
- The board model owns lesson and annotation programs. It never controls the microphone, audio playback, or lesson state machine.
- The browser owns WebRTC media, tool routing, animation state, manifest construction, stale-request cancellation, and defensive rendering.
- FastAPI owns the standard API key, client-secret minting, board-model calls, validation/repair, cached lessons, and structured logs.
- `shared/schema/lesson.schema.json` is the sole wire-format source of truth. Do not maintain divergent hand-written TS and Python schemas. Generated types are acceptable only when generation is deterministic and checked in or reproducible; until then, validate Python dictionaries with JSON Schema and derive TypeScript types from that schema.
- No OpenAI standard API key, prompt secret, or environment dump may reach the frontend bundle or logs.
- Every async lesson, annotation, or widget request carries a `request_id`. Use `AbortController` and ignore all events from stale request IDs after a new topic, clear, or lesson end.

## Repository shape

Keep the intended top-level layout:

```text
frontend/
backend/
shared/schema/
tests/golden/
demo/cached_lessons/
demo/video_script.md
PROGRESS.md
```

Place focused tests beside code where that ecosystem expects them. Do not create duplicate DSL definitions in `frontend/src/board/dsl.ts` and `backend/app/schemas.py`; those modules should import, generate from, or validate against the shared contract.

## DSL v1 contract

Implement the smallest contract needed by the three cached demo lessons before adding more operations.

- Canvas coordinates resolve to a logical 1600 x 900 board.
- Regions are `A1` through `D3`, plus `left`, `right`, and `full`.
- Element IDs are unique across the active board and must match `^[a-z][a-z0-9_-]{0,15}$`.
- References must point to an already accepted element or an earlier op in the same step. Forward references and cycles are invalid.
- Limit a lesson to 8 accepted steps, 4 ops per step, and 30 spoken words per script. Enforce request and response byte limits as well.
- `dx` and `dy` are normalized fractions of the target region or anchor box, clamped to `[-1, 1]`. `w`, `h`, and `gap` are normalized non-negative fractions, clamped to `[0, 1]`. Axes values remain data-space coordinates; sketch points remain normalized `[0, 1]` coordinates.
- A curve expression may use numbers, `x`, `pi`, `e`, parentheses, `+ - * / ^`, and the allowlisted functions `sin`, `cos`, `tan`, `exp`, `log`, `sqrt`, and `abs`. No property access, indexing, assignments, strings, or additional names.
- The Python validator may translate `^` to `**`, parse with `ast.parse(..., mode="eval")`, and walk a strict AST-node/name/operator allowlist. It must never call `eval`, `exec`, SymPy `parse_expr`, or any model-produced code.
- The frontend compiles with a locked-down mathjs instance, samples the domain before rendering, rejects non-finite values and pathological discontinuities, and skips only the failing op.
- KaTeX renders model-provided LaTeX with trust disabled. Never allow model-provided HTML, SVG markup, JavaScript, CSS, URLs, or rough.js options outside the schema.
- Use stable rough.js seeds derived from element IDs. Generate geometry once and animate the resulting paths; rerenders must not make strokes jump.
- `erase` and `clear` must be idempotent. Unknown IDs log a structured warning and do not crash.

Each accepted step should have an internal normalized representation after validation. The renderer consumes only that representation, never raw model text.

## Streaming, validation, and repair

`POST /lesson` returns validated NDJSON lines. Never forward a raw model line to the browser.

For each complete incoming line:

1. enforce a maximum line length;
2. parse JSON;
3. validate JSON Schema;
4. validate budgets and expression AST;
5. validate references against accepted state;
6. normalize the step;
7. emit it to the browser and add its IDs to accepted state.

On failure, run at most two scoped repair requests for that line and at most four repair calls across the entire lesson, using the invalid line, validation errors, and current accepted-ID inventory. Count each repair before dispatch so timeouts and HTTP/transport failures cannot disappear from cost evidence. Keep repair generation on plain text; the live Luna batch rejected the repair-only `text.format=json_object` request, and local schema/semantic validation is the actual trust boundary. A repair must return exactly one step object. If repair still fails or the lesson budget is exhausted, log and drop the step. Continue validating later lines against accepted state only. Terminal evidence may retain only the closed failure origin (`generation` or `repair`) and bounded repair-call count, never repair content or upstream messages.

The client parser must tolerate arbitrary network chunk boundaries, blank lines, a final line without a newline, cancellation, and a truncated final line. It must never attempt to render a partial JSON line.

## Realtime and tool-routing rules

- Mint ephemeral credentials on the server. Keep the standard API key server-only.
- Configure the session from environment-backed model and voice values. Audition `marin` and `cedar`, but do not hardcode a choice in multiple files.
- Default to product-facing `demo` mode, which exposes no diagnostic tool or evidence dashboard. Use `VITE_CHALK_MODE=diagnostics` only for deliberate evidence collection; never place a credential in a `VITE_*` variable.
- Keep the captured microphone track muted by default. A deliberate **Speak** action may enable it for one user turn; `input_audio_buffer.speech_stopped` and assistant playback must disable it again so speaker feedback cannot create self-responses. Do not replace this turn boundary with a duration guess.
- Use server VAD with interruption enabled for the demo unless a measured browser test shows semantic VAD is better. Log the exact VAD settings used for the final take.
- With WebRTC and VAD interruption enabled, expect the service to cancel the active response and truncate unplayed audio. On `input_audio_buffer.speech_started`, immediately freeze the local animator and transition to QA. Do not issue redundant cancel events unless the app created a manual response that VAD did not cancel.
- Tools must return a function-call output and then explicitly trigger the next response when required by the current API flow.
- Deixis tools validate the target ID against the latest manifest and fail softly with a machine-readable result such as `{"ok":false,"reason":"unknown_element"}`.
- `annotate` may add at most five overlay ops, may not add axes, and must prefer anchors to existing elements.
- Do not rely on a model promise to read scripts verbatim. Measure it on the hardcoded lesson. If drift is visible, shorten scripts and move critical wording into deterministic UI/demo sequencing rather than adding more prompt prose.

## Board context publication

The manifest is concise factual state, not a second transcript. Keep it under approximately 120 tokens and include only visible, accepted elements plus the latest relevant widget/student event.

- Construct it from renderer state, never from the intended lesson program.
- Publish only after an op batch has actually committed to the board.
- Replace prior board context; do not append an unbounded sequence of manifests.
- The default implementation publishes `BASE_TUTOR_PROMPT + "\n\n" + manifest` through `session.update({instructions: ...})` and waits for `session.updated`.
- If a different mechanism is adopted, first prove its item role, deletion/update semantics, and latency against current official docs and a live smoke test. Record that decision in `PROGRESS.md`.
- A student sketch image is a user-role image input. Keep the text/vision fallback until the image path is proven with the selected Realtime model.

## Sync and interruption state machine

Keep state transitions explicit and testable:

```text
IDLE -> GENERATING -> TEACHING -> FROZEN -> QA -> TEACHING -> DONE
                         |
                         +-> CHECKPOINT_ASKING -> CHECKPOINT_LISTENING
                                   |                      |
                                   +-----> CHECKPOINT_FEEDBACK -> TEACHING
```

The checkpoint branch is entered only after a checkpoint-bearing teaching step settles. Early student speech may move directly from `CHECKPOINT_ASKING` to `CHECKPOINT_FEEDBACK`. Prompt and feedback advancement require generation completion, playback stop, and the drain guard, just like lesson narration.

Invalid transitions must be ignored with a structured warning. UI components must not mutate lesson state directly.

`SYNC_MODE=fixed` is the dependable concurrent fallback:

- request the step narration;
- begin the animation on observed output-buffer playback activity;
- estimate speech duration from word count with configurable bounds;
- distribute op completion by weight across that duration;
- wait for both response generation completion and animation completion, plus a small measured audio-drain guard, before advancing;
- freeze immediately on student speech.

`SYNC_MODE=paced` may adjust animation rate using transcript progress, but clamp changes and treat the signal as approximate. Never delete fixed mode. If paced mode fails three consecutive perceptual runs on a cached lesson, switch the final-demo default back to fixed and move on.

On resume, use the simplest behavior that passes the demo-quality test. The baseline may restart the current script while continuing the frozen ink, as the plan proposes. If that is confusing in testing, reset and replay only the current step; do not build word-level audio alignment during the hackathon.

## Testing and acceptance gates

Do not advance phases on code inspection alone.

### Deterministic checks

- Backend: schema, budget, safe expression AST, reference tracking, repair limits, stale request handling, and NDJSON chunking.
- Frontend: schema-derived types, layout, stable rough paths, mathjs rejection, per-op error isolation, manifest contents, reducer/state transitions, interruption freeze, and stale-event rejection.
- Golden fixtures: all ten topics have checked-in valid lesson programs. Headless rendering must complete without uncaught errors and flag unintended text/equation overlap above 15%.
- Cached demo lessons: projectile range, derivative as slope, and unit-circle-to-sine-wave load with no network dependency.

### Live checks

Live API checks require `OPENAI_API_KEY` and never run in default CI. Record results rather than snapshotting nondeterministic model text.

Live API usage is a scarce, explicitly controlled test resource. Use `gpt-realtime-2.1-mini`, short synthetic prompts, short responses, and the minimum number of calls needed for the active acceptance gate. Never run credentialed tests in loops, retries, broad topic matrices, or default automation. Disconnect as soon as the required observation is captured. A failed handshake or access error stops the live run for diagnosis; do not burn tokens retrying automatically. Switching to a larger model, running lesson-evaluation batches, or materially extending a live session requires the project owner's explicit approval.

The M3 evaluation CLI keeps one-repair-call `repair-smoke`, one-topic `smoke`, and ten-topic `batch` as separate subcommands. Each requires its own `--approved-by-owner` acknowledgement, and approval for one mode never authorizes another. Repair smoke retains no generated content and cannot route to a topic mode. A topic uses one primary board-model call and may use up to four paid repair calls; describe both topic attempts and this underlying call ceiling before approval.

Keep M3 upstream outcomes semantically distinct. HTTP rejection, transport unavailability, `response.incomplete`, `response.failed`, and generic streaming `error` are not interchangeable. Emit only CHALK-owned terminal codes plus an optional closed, non-sensitive reason; never forward upstream messages or arbitrary error codes. The batch may continue to later topics without retry only for the clearly topic-scoped `max_output_tokens` and `content_filter` reasons. It must stop on model/reasoning mismatch, missing configuration, HTTP rejection, transport unavailability, or any other upstream reason, including a missing or unknown reason. It must also stop after the third machine-failed topic because the required 8/10 result is then mathematically unreachable. After any paid topic attempt, even a local harness exception must leave a redacted summary with a closed failure category.

- Realtime smoke: connect, converse, interrupt five times, execute a dummy tool, and confirm the observed event sequence.
- Lesson evaluation: run all ten golden topics; retain raw generated NDJSON, validator results, render screenshots, time-to-first-valid-step, and a human pass/fail rubric.
- MVP rehearsal: complete three uninterrupted full loops on a cached lesson: ask, generate/load, speak with ink, interrupt mid-stroke, use deixis, answer, resume, finish.

Measure interruption from detected `speech_started` to local animation freeze, and separately judge perceived audio stop. Do not present an unmeasured `<300 ms` claim as fact.

## Phase and cut policy

Treat the seven days as priority order, not permission to carry broken foundations forward.

1. Realtime voice loop, interruption, and dummy tool.
2. Hardcoded lesson, defensive renderer, and fixed concurrent sync.
3. Live lesson NDJSON, validation/repair, and golden evaluation.
4. Manifest, full interruption/resume loop, deixis, and annotation. This is the MVP gate.
5. Projectile widget only. Add grapher and pendulum only after the projectile interaction is stable.
6. Student draw-back fallback, then direct Realtime image input only if time remains.
7. Video, README, rehearsal, and submission only. No feature work.

If the MVP gate is not stable, cut in this order: direct image input, student draw-back, extra widgets, all widgets, paced sync. Do not cut interruption, defensive rendering, cached lessons, or fixed concurrent sync.

## Security and privacy

- Commit `.env.example`, never `.env` or credentials.
- Redact authorization headers, client-secret values, audio payloads, image data URLs, and raw student utterances from logs.
- Keep generated student names/context in memory only. Do not persist audio, sketches, or identifying information.
- Bind backend CORS to the explicit local frontend origin and reject Host headers outside the localhost allowlist; do not use wildcard origins with credentials.
- Limit request sizes, generation duration, repair attempts, concurrent generations, and expression sampling work.
- The application is a localhost hackathon prototype. README must not describe it as production-ready or suitable for unsupervised use by children.

## Git and change discipline

- Preserve user changes and never discard unrelated work.
- Initialize Git at this directory before implementation if it is still not inside a repository; do not accidentally initialize a parent directory.
- Commit only after the relevant acceptance gate passes. Use small descriptive commits and never commit secrets, generated recordings, dependency caches, or local logs.
- Before each commit, run the narrow tests for the changed area. Before an MVP or recording gate, run the full deterministic suite and the documented live rehearsal.
- Do not add a production dependency without stating why the current stack cannot meet the requirement.

## Definition of done for any task

A task is done only when:

- behavior is implemented on the intended path;
- relevant automated checks pass;
- failure and cancellation paths were exercised in proportion to risk;
- current runtime flags and any fallback are documented;
- `PROGRESS.md` states the evidence and remaining known issues;
- no secret or student payload was added to source control or logs.

When handing work off, lead with what is demonstrably working, then list failed checks, skipped live verification, and the next risk in priority order.
