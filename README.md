# CHALK

CHALK is a live voice tutor for maths and physics that teaches on an whiteboard.

A student asks for a topic, and CHALK generates a structured lesson, narrates it aloud, and draws the supporting equations, graphs, and diagrams as it explains. The student can interrupt with the space bar or by clicking the voice orb, ask a question about the board, and resume without losing the lesson state.

The board is not just a visual output: it tracks what has actually been drawn so the tutor can ground follow-up explanations in the visible diagram.

GPT 5.6 Luna creates the structured lesson plan while GPT Realtime 2.1 handles the live interaction between the interface and the student. My custom built "drawer" intermediary acts as an orchestrator between both the models and the whiteboard surface, providing a platform for Luna to "draw".




CHALK is a localhost hackathon prototype for a math and physics tutor that talks while drawing and stops when the student interrupts. M1 proves the browser-to-OpenAI Realtime WebRTC voice foundation. M2 adds the deterministic SVG whiteboard and concurrent voice/ink synchronization. The accepted cached M4 slice adds visible-board grounding, turn-gated speech, and a tutor-initiated checkpoint. M3 now adds bounded topic-driven lesson generation through a validated NDJSON stream.




## How CHALK was built: Codex and GPT-5.6

**Foundation — Codex.** The milestone architecture, M1 through M4, was built end-to-end by OpenAI's Codex (using GPT 5.6 Sol) across four isolated, audited branches (`codex/m1-realtime-scaffold` through `codex/m4-full-interruption-grounding`), under the evidence-gated discipline recorded in `AGENTS.md`: no milestone was accepted without live-gated proof — five consecutive interruption trials for the Realtime voice slice, a fixed ten-topic Luna generation rubric that closed at 39 accepted steps with zero repairs/drops/retries/errors and 8/10 human layout passes, hash-matched first-visible-ink timing under six seconds — and every paid or live check required explicit owner approval before it ran. Codex also did the hardest engineering in the repository: the deterministic SVG board renderer with prefix-stable layout (a corpus-wide property test over all thirteen cached/golden lessons proves streaming a later step never moves already-committed ink), the resolved-stepwise continuation contract that authenticates every generation request with a rotating HMAC receipt bound to the immutable accepted prefix, geometric construction relations, occupancy-based placement scoring, and the broader drawing-intelligence initiative — composition archetypes, renderer-failure recovery fed back into continuation requests, a flagged attention-choreography rail, and a gated tldraw-technique adaptation.

**GPT-5.6 (`gpt-5.6-luna`), it's what CHALK draws with.** It is the board-generation model called at runtime by `/lesson` and `/scratch`, selected after the accumulated-whiteboard v2 prompt passed the 8/10 human layout rubric across ten fixed topics with zero repairs, drops, or renderer crashes (see `PROGRESS.md`). `gpt-realtime-2.1-mini` is the separate, session-cost-bounded voice model. Every decision above is about *building* CHALK; this one is a property *of* CHALK.

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


## Current status

M1, M2, and M3 are complete, and the cached-interaction M4 slice has passed. Broader M4 deterministic implementation now includes committed-element grounding, four instant local deixis overlays, a bounded stale-safe annotation overlay path, three offline recording caches, and manifest acknowledgement timing/fingerprint evidence. Its three-loop live rehearsal gate is still pending. M3's approved accumulated-whiteboard v2 Luna/`none` evidence completed all ten fixed topics with 39 accepted steps, zero repairs/drops/retries/errors, zero renderer crashes, and exactly 8/10 human layout passes. Unit circle and standing waves retain explicit live-generation collision failures. A separate connected product run measured 1.36 seconds to the first validated step and 2.72 seconds to first visible ink, passing the six-second target. The read-only verifier accepts the redacted package at `artifacts/evidence/m3-luna-v2-batch-20260717-0635/`. Automated checks never call the live API. See `PROGRESS.md` for exact evidence and remaining M4 work.


## Project guidance

- `AGENTS.md` is the audited execution contract.
- `ARCHITECTURE.md` records system boundaries and decisions.
- `PLANS.md` records milestones, assumptions, validation, and rollback.
- `PROGRESS.md` records evidence from work actually performed.
- `chalk-build-plan.md` is the original product brief; audited corrections in `AGENTS.md` take precedence.
