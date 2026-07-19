# CHALK

CHALK is a localhost hackathon prototype for a math and physics tutor that talks while drawing and stops when the student interrupts. M1 proves the browser-to-OpenAI Realtime WebRTC voice foundation. M2 adds the deterministic SVG whiteboard and concurrent voice/ink synchronization. The accepted cached M4 slice adds visible-board grounding, turn-gated speech, and a tutor-initiated checkpoint. M3 now adds bounded topic-driven lesson generation through a validated NDJSON stream.

This is not a production service and is not suitable for unsupervised use by children. It has no authentication, persistence, deployment hardening, or production privacy controls.

## Current status

M1, M2, and M3 are complete, and the cached-interaction M4 slice has passed. Broader M4 deterministic implementation now includes committed-element grounding, four instant local deixis overlays, a bounded stale-safe annotation overlay path, three offline recording caches, and manifest acknowledgement timing/fingerprint evidence. Its three-loop live rehearsal gate is still pending. M3's approved accumulated-whiteboard v2 Luna/`none` evidence completed all ten fixed topics with 39 accepted steps, zero repairs/drops/retries/errors, zero renderer crashes, and exactly 8/10 human layout passes. Unit circle and standing waves retain explicit live-generation collision failures. A separate connected product run measured 1.36 seconds to the first validated step and 2.72 seconds to first visible ink, passing the six-second target. The read-only verifier accepts the redacted package at `artifacts/evidence/m3-luna-v2-batch-20260717-0635/`. Automated checks never call the live API. See `PROGRESS.md` for exact evidence and remaining M4 work.

## How CHALK was built: Codex, Claude, and GPT-5.6

CHALK went through two agentic development phases with different coding assistants, plus one model that is a runtime dependency of the product rather than a build tool for it. This is not a summary written after the fact — it is reconstructed from the branch history, the audited `PROGRESS.md`/`ARCHITECTURE.md` evidence trail, and the live diagnostic traces produced while working.

**Foundation — Codex.** The milestone architecture, M1 through M4, was built end-to-end by OpenAI's Codex CLI across four isolated, audited branches (`codex/m1-realtime-scaffold` through `codex/m4-full-interruption-grounding`), under the evidence-gated discipline recorded in `AGENTS.md`: no milestone was accepted without live-gated proof — five consecutive interruption trials for the Realtime voice slice, a fixed ten-topic Luna generation rubric that closed at 39 accepted steps with zero repairs/drops/retries/errors and 8/10 human layout passes, hash-matched first-visible-ink timing under six seconds — and every paid or live check required explicit owner approval before it ran. Codex also did the hardest engineering in the repository: the deterministic SVG board renderer with prefix-stable layout (a corpus-wide property test over all thirteen cached/golden lessons proves streaming a later step never moves already-committed ink), the resolved-stepwise continuation contract that authenticates every generation request with a rotating HMAC receipt bound to the immutable accepted prefix, geometric construction relations, occupancy-based placement scoring, and the broader drawing-intelligence initiative — composition archetypes, renderer-failure recovery fed back into continuation requests, a flagged attention-choreography rail, and a gated tldraw-technique adaptation.

**Extension and hardening — Claude.** I picked the project up at the strategy layer: critiquing a drawing-intelligence brainstorm against what Codex had already shipped, and reordering the roadmap around the judgment that deterministic spatial-reasoning work should land before agent experimentation. From there the work moved into direct engineering, most of it decided live with the user rather than pre-planned:

- **Caught a near-loss of work.** Roughly 155 files of Codex's drawing-intelligence implementation existed only on local disk, never committed. A routine `git status` surfaced this before it could be lost; I staged and committed the full body of work and pushed it to `main`.
- **Diagnosed two live production bugs from telemetry instead of guessing.** The user reported the tutor's voice randomly cutting off mid-lesson. I built a new diagnostics surface — the board engine feed — that streams the Realtime voice lifecycle and lesson sync-phase transitions into the UI as they happen. Reading that feed live with the user pinpointed two distinct root causes: an uncapped post-tool "framing" response was lecturing for 25+ seconds instead of bridging with one sentence, and a missed `output_audio_buffer.started` event was silently abandoning fully-generated lesson steps at 0% ink. Both got structural fixes — a hard 120-token cap on framing responses, and a bounded fallback that assumes playback started if the event never arrives — plus regression tests, not prompt-level hopes.
- **Made and reversed a product decision live with the user.** Asked to fix "the student can't get CHALK to draw something new mid-lesson," I first proposed two heavier options — treating the request as an implicit topic restart, then a full new backend state machine for appended micro-steps. The user rejected both as insufficiently clean and proposed a floating, disposable scratch card instead. I designed and shipped it full-stack: a bounded `POST /scratch` endpoint reusing the existing validation/repair pipeline, a `draw_scratch` Realtime tool, and a draggable, resizable React window — deliberately isolated from the lesson's committed prefix so it can never mutate grounding state.
- **Tuned real cost/quality tradeoffs against observed failures, not defaults.** Raised the session token budget (20k → 50k) and the per-response cap (256 → 1,024) after live traces showed genuine mid-sentence truncation, while adding a separate, *lower* cap for bridging responses so the fix didn't just relocate the over-talking problem.

**GPT-5.6 (`gpt-5.6-luna`) is not a development tool here — it's what CHALK draws with.** It is the board-generation model called at runtime by `/lesson` and `/scratch`, selected after the accumulated-whiteboard v2 prompt passed the 8/10 human layout rubric across ten fixed topics with zero repairs, drops, or renderer crashes (see `PROGRESS.md`). `gpt-realtime-2.1-mini` is the separate, session-cost-bounded voice model. Every decision above is about *building* CHALK; this one is a property *of* CHALK.

## Local setup

Prerequisites:

- Node.js `^20.19.0` or `>=22.12.0` with npm (the current development machine uses Node 25 and npm 11).
- [`uv`](https://docs.astral.sh/uv/) for the Python environment.
- A current Chromium-family browser with localhost microphone permission for the live check.
- An OpenAI API key with access to `gpt-realtime-2.1-mini` for voice and `gpt-5.6-luna` for live M3 lesson generation.

From the repository root:

```bash
uv python install 3.12
make install
cp .env.example .env
```

`uv sync --project backend --python 3.12` creates and uses the backend's isolated Python 3.12 environment; the system Python version does not need to change.
`npm ci` installs the exact frontend dependency graph recorded in the checked-in lockfile.

Add `OPENAI_API_KEY` to the root `.env`. Keep it server-only: never put it in `frontend/`, browser storage, a `VITE_*` variable, screenshots, or logs. The checked-in development defaults are:

```dotenv
REALTIME_MODEL=gpt-realtime-2.1-mini
REALTIME_VOICE=marin
SAFETY_IDENTIFIER_SALT=chalk-local-development-v1
BOARD_MODEL=gpt-5.6-luna
BOARD_REASONING_EFFORT=none
BOARD_PROMPT_VERSION=v2
ANNOTATION_GENERATION_TIMEOUT_SECONDS=15
ANNOTATION_MAX_CONCURRENT=1
SYNC_MODE=fixed
DRAWBACK_MODE=vision
FRONTEND_ORIGIN=http://localhost:5173
```

`SAFETY_IDENTIFIER_SALT` is a non-secret domain-separation value, not an authentication credential. Choose a deliberate per-app value if this prototype is ever adapted beyond local development. `SYNC_MODE=fixed` is the dependable concurrent schedule: ink starts only on observed audio playback activity and advances on a bounded word-count clock. `paced` remains an experimental comparison because transcript generation can lead audible playout and must not be treated as playback position. `BOARD_MODEL` selects the M3 lesson generator, and `BOARD_REASONING_EFFORT=none` is the documented six-second latency baseline. `BOARD_PROMPT_VERSION=v3` enables the explicit spatial contract; `v2` preserves the accepted accumulated-whiteboard prompt and `v1` preserves the earlier retained-batch prompt. Prompt hashes always identify the selected version, and evidence from different versions must not be combined. `low` remains allowlisted only for a measured quality comparison. `DRAWBACK_MODE` remains forward configuration. Audition `cedar` against `marin` before recording. If Luna misses the unchanged rubric, compare only the failed topics on Terra before changing the default; Sol remains a last escalation. Any further live model evaluation requires explicit owner approval.

## Run locally

Start each service in a separate terminal from the repository root:

```bash
make dev-backend
```

```bash
make dev-frontend
```

Then open [http://localhost:5173](http://localhost:5173). The backend binds to `127.0.0.1:8000`, CORS permits exactly `http://localhost:5173`, and Host validation accepts only `localhost`, `127.0.0.1`, and the in-process test host. Do not expose either service to a LAN or the public internet. The frontend uses `VITE_API_BASE_URL=http://127.0.0.1:8000` by default; a non-default value must still be a trusted localhost URL for this prototype.

The default frontend mode is the product-facing demo. It hides the evidence dashboard and does not expose the `debug_echo` tool. Local pointing and bounded annotation remain product tools. Start the diagnostic UI only when collecting protocol evidence:

```bash
VITE_CHALK_MODE=diagnostics make dev-frontend
```

`VITE_*` variables are browser-visible. Never place a credential in one.

The health endpoint does not require a key and must not reveal its value. It reports the non-secret Realtime and board model IDs so the M3 harness can reject a stale server before spending a lesson request:

```bash
curl --fail http://127.0.0.1:8000/health
```

## Developer commands

The Make targets below are thin wrappers around the native project commands.

| Task | Root command | Native command |
|---|---|---|
| Install frontend | `make install-frontend` | `npm --prefix frontend ci` |
| Install backend with Python 3.12 | `make install-backend` | `uv sync --project backend --python 3.12` |
| Start frontend | `make dev-frontend` | `npm --prefix frontend run dev` |
| Start backend | `make dev-backend` | `uv run --project backend uvicorn --app-dir backend app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir backend` |
| Frontend tests | `make test-frontend` | `npm --prefix frontend run test` |
| Backend tests | `make test-backend` | `uv run --project backend pytest -c backend/pyproject.toml backend/tests` |
| All tests | `make test` | both test commands above |
| Frontend lint | `make lint-frontend` | `npm --prefix frontend run lint` |
| Backend lint/format check | `make lint-backend` | `uv run --project backend ruff check backend` and `ruff format --check backend` |
| Frontend production build | `make build-frontend` | `npm --prefix frontend run build` |
| Regenerate lesson types | — | `npm --prefix frontend run schema:types` |
| Backend syntax build | `make build-backend` | `uv run --project backend python -m compileall -q backend/app backend/tests` |
| All lint/build checks | `make lint` / `make build` | the corresponding commands above |

The production frontend build is a static validation artifact only; deployment is out of scope.

## Trying M3 topic generation

Start both services, connect, enter a bounded math or physics topic under **What should Chalk teach?**, and select **Generate & teach**. The browser starts once the first validated step arrives; raw model output is never rendered. **Use cached demo** cancels active generation. If generation fails before any valid step, CHALK loads the cached projectile lesson; if it fails later, CHALK finishes the already-accepted prefix.

The Realtime tutor can invoke the same path through its `teach` tool. The tool returns immediately with `status=started`, allowing one short filler sentence while the backend generates. Do not run the ten-topic live rubric repeatedly or in CI; it is a separately approved, budgeted acceptance check.

### Owner-approved M3 evaluation

The live evaluation harness is intentionally not a test or Make target. Its `repair-smoke`, `smoke`, and `batch` modes have independent approvals. Repair smoke makes exactly one synthetic repair call with no primary generation call and retains no generated content. Topic smoke cannot launch the ten-topic rubric. Topic modes perform the no-cost Luna health preflight, never retry a topic, and never run topics in parallel. One topic always makes one primary Responses API call and may make up to four additional scoped repair calls, so approval language must distinguish topic attempts from underlying paid API calls. Batch proceeds after a failed topic only for the clearly topic-scoped `max_output_tokens` and `content_filter` reasons, and it stops as soon as a third machine failure makes the 8/10 gate unreachable. Identity, access, configuration, transport, server, invalid-request, missing, and unknown upstream outcomes stop the remaining calls immediately.

After explicit approval for exactly one repair-path probe, run it without starting the backend:

```bash
PYTHONPATH=backend uv run --project backend python -m app.m3_evaluation \
  repair-smoke \
  --approved-by-owner \
  --output-dir artifacts/evidence/m3-repair-smoke-YYYYMMDD-HHMM
```

The probe sends one fixed invalid synthetic step directly through the production repair function, validates the returned step locally, and writes only bounded status, timing, model, and prompt-hash metadata. It never stores the repaired content and cannot route to topic smoke or batch. The retained passing probe is `artifacts/evidence/m3-repair-smoke-20260716-223721/`; do not run another without fresh approval.

After the owner approves exactly one Luna access/stream smoke, run from the repository root with the backend already running:

```bash
PYTHONPATH=backend uv run --project backend python -m app.m3_evaluation \
  smoke \
  --approved-by-owner \
  --output-dir artifacts/evidence/m3-smoke-YYYYMMDD-HHMM
```

Smoke mode makes exactly one paid `POST /lesson` topic request for synthetic projectile content, does not connect Realtime, and writes its validated raw NDJSON plus a `chalk.m3-live-smoke.v2` `summary.json`. That request makes one primary model call and can make up to four paid repair calls if generated lines are invalid; it never retries the topic. Review the captured file in diagnostics mode without regenerating it. A smoke can prove model access and the server stream path; it does not establish the ten-topic quality gate or browser first-visible-ink timing. The retained historical v1 smoke at `artifacts/evidence/m3-smoke-20260716-202350/` verified Luna access but failed its terminal and latency gates. Do not run another smoke without fresh explicit approval.

Only after the corrected access smoke and the current repair-path smoke have passed—and the owner separately approves a new full batch—run:

```bash
PYTHONPATH=backend uv run --project backend python -m app.m3_evaluation \
  batch \
  --approved-by-owner \
  --output-dir artifacts/evidence/m3-live-YYYYMMDD-HHMM
```

Use a new output directory. Batch mode submits the fixed ten synthetic topics sequentially and retains server-owned raw NDJSON plus a `chalk.m3-live-evaluation.v2` `summary.json` containing model/prompt hashes, first-valid-step timing, repair/drop counts, failure origin, stop reason, and empty human-review fields. A paid-path harness exception is reduced to a closed category and still produces a summary; exception text is never retained. It does not connect Realtime or generate narration. A smoke directory is intentionally not treated as batch acceptance evidence.

For layout review, start the frontend with `VITE_CHALK_MODE=diagnostics`, use **Review captured lesson without regenerating**, and load each file from the evaluation directory's `raw/` folder. The browser revalidates the stream locally and reveals the accepted lesson through the selected step without another API call. Capture the board screenshot and fill the matching summary fields. Separately run one representative connected lesson and use **Copy M3 timing** after the stream and first ink complete; that evidence measures request-to-first-valid-step and first-valid-step-to-first-visible-ink from the actual product path.

After all review fields and the representative timing file have been added to `summary.json`, run the read-only verifier:

```bash
PYTHONPATH=backend uv run --project backend python -m app.m3_evidence \
  --evidence-dir artifacts/evidence/m3-live-YYYYMMDD-HHMM
```

It returns success only for exactly ten fixed topics, consistent Luna/prompt identity, complete raw streams, bounded reviewer notes, screenshots for rendered lessons, zero renderer crashes, at least eight schema/render/layout passes, and representative first visible ink under six seconds. Missing or ambiguous evidence is a failure; the verifier never edits the package. Before issuing any lesson request, the harness checks the no-cost health response and refuses an unconfigured or non-Luna backend. It also rechecks the model on every lesson response in case configuration changes mid-run.

## Reproducing the M2 projectile lesson gate

The board program is checked in at `demo/cached_lessons/projectile-range.lesson.json`. It is decoded through `shared/schema/lesson.schema.json`; no board-model request is made in M2.

1. Start both services, open the app, and connect the microphone using the mini Realtime model. The media track remains muted until you click **Speak**.
2. Click **Start lesson**. Confirm the first moving ink begins on the first narration activity rather than before the voice or after it finishes.
3. During a visibly incomplete stroke, click **Speak** and ask a short question. Confirm the stroke freezes where it is and remains visible while the app is in `QA`; the microphone should pause automatically when the speech turn ends.
4. After the answer finishes, click **Resume frozen step**. Narration restarts for that step while ink continues from its retained progress.
5. Let all four steps finish. Confirm the counter increments only when the last step clears animation, generation, audio-stop, and drain gates.
6. Repeat until the UI shows **3 / 3 completed runs**. Confirm no next-step narration audibly overlaps the prior step.
7. Disconnect immediately after recording the result to conserve credits.

The deterministic suite covers schema failures, unsafe expressions and equations, dangling references, region/anchor layout, stable rough paths, partial-stroke retention, response/audio event-order races, stale request/cycle rejection, and three full reducer runs. The deliberately human M2 gate also passed: the owner confirmed that voice and ink felt concurrent and consecutive narration did not overlap in the recording browser.

## Reproducing the cached M4 interaction check

Use the default demo mode and keep the run to one short mini-model session.

1. Connect, start the cached projectile lesson, and confirm the cannon strokes reveal one after another. The microphone should remain paused while Chalk speaks.
2. Optionally click **Speak** during one moving stroke, ask a short question about visible content, then use **Resume frozen step** after the answer.
3. After the range curve finishes, confirm Chalk asks “Where does the curve peak?” without a presenter action.
4. Click **Speak**, answer “45 degrees,” and confirm the control automatically returns to **Speak** when your turn ends. Chalk should give one brief acknowledgement or correction, not mention Resume, and advance to the formula step only after its feedback audio settles.
5. Confirm the demo contains no diagnostic metrics or debug-tool prompt. Disconnect immediately after the observation.

Resume deliberately retains the accepted M2 behavior: ink continues from its frozen progress while the full current script restarts. Word-count slicing, direct transcript-driven pacing, and duration-only false-freeze recovery are deferred in the active execution plan because the available signals do not justify those heuristics yet.

## Realtime cost controls

M1 stays on `gpt-realtime-2.1-mini` and applies several independent limits:

- 256 maximum output tokens per assistant response;
- 4,000 post-instruction conversation tokens with 0.8 retention-ratio truncation;
- input transcription disabled, avoiding its separate transcription charge;
- cumulative numeric usage read from each `response.done` event and shown in the UI;
- automatic disconnect at 20,000 cumulative tokens for one connection.

The 20,000-token counter resets on reconnect and is therefore a session guardrail, not an account-wide spending cap. The first live trace predates numeric usage retention, so its exact cost cannot be reconstructed from the saved metadata.

## Reproducing the M1 live protocol check

With both services running and a configured API key:

Keep any rerun deliberately light: use `gpt-realtime-2.1-mini`, short synthetic phrases, and brief responses. Perform only the required handshake and five short interruption trials, then disconnect. Do not run live checks in loops or retry configuration/access failures automatically. Do not use the full Realtime model or extend the session without explicit owner approval.

1. Start the frontend in diagnostics mode, open the app, click **Connect microphone**, and allow access. Click **Speak** only for each deliberate test utterance; the input auto-mutes at the VAD speech-turn boundary.
2. Confirm the UI reaches its connected state and two-way voice works.
3. Start a response long enough to interrupt. Wait until the UI explicitly says **Chalk is speaking**, then speak and confirm the marker appears, local teaching state stops immediately, and no stale response continues afterward. A response that is merely created but has not started audio playback does not count.
4. Repeat step 3 five consecutive times. Record each run in `PROGRESS.md`; measure detected-speech-start to local-state stop separately from the subjective audio-stop judgment.
5. Confirm the session token metric remains below its limit, then disconnect.
6. Copy the redacted diagnostic trace. Record the five markers and numeric token usage; model, voice, browser, VAD settings, and the dummy-tool response trigger were captured in the earlier trace.

Expected event names from current documentation are only a checklist. The live trace is authoritative. Redact client-secret values, authorization data, audio payloads, raw utterance/transcript content, and any identifying data before retaining evidence.

## Privacy and security limitations

- The standard API key remains in the backend process; the browser receives only a short-lived client secret.
- Audio is sent from the browser to OpenAI during a live session. CHALK does not promise local-only audio processing.
- The prototype must not persist student audio, images, names, or raw utterances. Use synthetic, non-identifying content for testing.
- Diagnostics retain event metadata and timing only. Secret values, authorization headers, audio, image data URLs, and raw student content must be removed.
- The browser persists a random UUID for the local client. The backend sends only `SHA-256(salt + ":" + UUID)` as `OpenAI-Safety-Identifier`; the raw UUID is never sent upstream to OpenAI and must not be derived from a name, email address, IP address, or utterance. Clearing site data rotates the browser UUID.
- Localhost binding is a scope boundary, not production security. There is no authentication or multi-user isolation.

## Project guidance

- `AGENTS.md` is the audited execution contract.
- `ARCHITECTURE.md` records system boundaries and decisions.
- `PLANS.md` records milestones, assumptions, validation, and rollback.
- `PROGRESS.md` records evidence from work actually performed.
- `chalk-build-plan.md` is the original product brief; audited corrections in `AGENTS.md` take precedence.
