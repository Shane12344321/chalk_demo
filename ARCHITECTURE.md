# CHALK architecture

Status: M1, M2, and M3 accepted; M4 cached interaction slice accepted and broader interruption/grounding gate active
Last reviewed: 2026-07-16
Companion documents: `chalk-build-plan.md`, `AGENTS.md`

## Purpose and authority

This document describes how CHALK is intended to work as a system. It captures component boundaries, runtime flows, failure behavior, and decisions that must remain coherent across the frontend and backend.

- `chalk-build-plan.md` defines the product, schedule, and demo story.
- `AGENTS.md` defines audited implementation rules and acceptance standards.
- `ARCHITECTURE.md` defines the current system design and records how it changes as code is built.
- `shared/schema/lesson.schema.json` defines the implemented lesson wire contract and is authoritative for payload shapes. Future wire contracts belong beside it rather than being copied into this document.

Use these status labels throughout:

- **VERIFIED-DOC**: supported by current official documentation, but still requires an account/browser smoke test.
- **DECIDED**: an architectural choice for this project.
- **SPIKE**: deliberately unresolved until measured in the real app.
- **STRETCH**: optional and outside the MVP gate.

Update this document when a component boundary, public contract, state transition, fallback, or security boundary changes. Do not update it for ordinary internal refactors.

## Architectural drivers

In priority order:

1. Interruption must feel immediate: speech and the active stroke stop together.
2. Voice and ink must appear concurrent, even in fallback mode.
3. A malformed model response must never crash or poison the board.
4. The three cached demo lessons must work without board-model availability.
5. Time to first visible ink should be under six seconds for live generation.
6. The system must remain understandable enough to debug during a seven-day build.

This is a localhost hackathon prototype. Availability across regions, persistence, multi-user isolation, horizontal scaling, authentication, and production child-safety requirements are not architectural goals.

## System context

```mermaid
flowchart LR
    Student["Student"]
    Browser["React browser app"]
    Backend["FastAPI backend"]
    Realtime["OpenAI Realtime API"]
    BoardModel["OpenAI Responses API<br/>board model"]

    Student <-->|"voice, board interaction"| Browser
    Browser <-->|"WebRTC audio + data channel"| Realtime
    Browser <-->|"HTTPS JSON / NDJSON"| Backend
    Backend <-->|"client-secret minting"| Realtime
    Backend <-->|"lesson and annotation generation"| BoardModel
```

The browser is the orchestration point because it observes both Realtime events and rendered-board progress. The backend is not in the live audio path.

## Core rule: two brains, one deterministic board

**DECIDED:** the Realtime model and board model have separate responsibilities.

| Concern | Owner |
|---|---|
| Conversation, voice, turn-taking, tool selection | Realtime model |
| Lesson and annotation program generation | Board model |
| Tool execution and request correlation | Browser |
| Session secrets and board-model credentials | Backend |
| DSL validation and repair | Backend |
| Final expression compilation and defensive rendering | Browser |
| Visible-board inventory | Browser manifest builder |
| Lesson/interruption state | Browser sync engine |

The Realtime model never produces raw ink operations. The board model never controls audio, turn-taking, or state transitions. The renderer never consumes unvalidated model text.

## Runtime components

### Browser

#### `RealtimeClient`

Owns the `RTCPeerConnection`, remote audio element/stream, data channel, session setup, and translation between OpenAI events and typed internal events.

- Protocol event strings stay inside `frontend/src/realtime/`.
- It exposes typed semantic events such as `student.speech_started`, `narration.*`, and `checkpoint.*` to the sync engine while keeping raw protocol names inside the adapter.
- It does not own lesson state or render board elements.
- Demo mode uses product tutor instructions and no diagnostic tool; diagnostics mode restores the evidence UI and `debug_echo` without changing the transport.
- The captured microphone track is muted after connection. The user opens it with **Speak** for one turn; `input_audio_buffer.speech_stopped` and assistant playback close it again to prevent acoustic feedback from becoming a new VAD turn.

#### `RealtimeResponseCoordinator`

Serializes and identifies lesson narration, checkpoint prompts, VAD-created Q&A/feedback, and diagnostic continuations so unrelated `response.created` events cannot claim the wrong lifecycle. It records bounded response purpose, request/step/cycle correlation, and generation/playback settlement.

`response.done` means generation/sending completed; it is not treated as proof that the remote audio buffer is silent.

Manual lesson narration requests carry a client `event_id` and bounded response metadata containing only purpose/request/step/cycle identifiers. The coordinator binds narration only when the echoed metadata matches; a simultaneous VAD-created response cannot claim the lesson cycle. A matching recoverable error releases the pending narration and resets the fixed-sync run. Fixed ink begins on `output_audio_buffer.started`, because transcript deltas indicate generation rather than audible playout.

#### `ToolRouter`

Validates Realtime tool arguments and dispatches:

- instant local tools to the overlay renderer;
- `teach` to the lesson-stream client;
- `annotate` to the backend;
- state-control tools to the sync engine;
- optional widget and vision tools to their adapters.

Every tool result is returned to the Realtime conversation as a function-call output. Unknown tools, invalid arguments, and unknown board IDs return soft machine-readable failures.

#### `LessonStreamClient`

Starts `POST /lesson`, consumes NDJSON with `fetch().body`, handles arbitrary chunk boundaries, and emits only validated stream envelopes. It owns the `AbortController` for the active request.

#### `SyncEngine`

Is the sole writer of lesson lifecycle state. It queues validated steps, schedules narration and animation, freezes/resumes work, and ignores stale events.

Implement it as a reducer/state machine plus explicit effects. React views may dispatch events but may not mutate state directly.

#### Board subsystem

The board subsystem has four layers, bottom to top:

1. accepted lesson ink;
2. temporary deixis and annotation overlays;
3. widgets;
4. student ink.

It contains:

- a schema-derived DSL decoder;
- a region and anchor layout resolver;
- a defensive rough.js/KaTeX renderer;
- a stroke animator that can freeze at its current progress;
- a manifest builder derived from committed visible state.
- a committed-element inventory derived from that same renderer snapshot for
  local deixis and annotation target validation, including exact normalized
  bounds sent only to the annotation service.

Rough geometry is seeded by element ID and generated once so React rerenders do not move existing strokes. Layout is prefix-stable by construction: region packing uses a flowing per-region cursor that depends only on earlier ops, so a later streamed step can never move ink already on the board. Axes, curves, and sketches reveal their strokes sequentially through one shared reveal-group mechanism, animation weights follow drawn content length, and axis labels appear only after their axes strokes are nearly complete.

### Backend

#### Session service

Mints a short-lived Realtime client secret with the standard OpenAI API key and returns it to the browser. The standard key never leaves the backend.

#### Lesson service

Calls the configured board model through the Responses API, incrementally parses model-produced JSONL, validates and repairs each complete step, and emits accepted steps as NDJSON stream envelopes.

#### Annotation service

Generates a bounded overlay batch from the latest accepted manifest, exact
committed element kinds/bounds, and a student question. It does not create new
axes and may return at most five ops. The tutor manifest remains the compact
Realtime context; the bounds-bearing inventory is scoped to `/annotate`.

#### Validation service

Applies a closed safe-only sanitizer, then JSON Schema, budgets,
reference-state validation, safe expression-AST validation, and normalization.
The sanitizer trims outer whitespace, rewrites `**` to `^`, and clamps only
normalized values within 0.05 of a legal boundary; it never guesses a
reference or meaning. It never evaluates model-produced code: curve
expressions are numerically sampled by a bounded interpreter over CHALK's own
already-validated AST node set, mirroring the browser sampling contract pinned
in `shared/fixtures/curve-parity.json`. Equation LaTeX passes a conservative
structural lint mirroring the classes KaTeX strict mode rejects, pinned in
`shared/fixtures/latex-parity.json`.

#### Optional services

- **STRETCH:** widget selection and parameterization.
- **STRETCH:** student-sketch vision fallback.

## Trust boundaries

```mermaid
flowchart TB
    Untrusted["Untrusted inputs<br/>student + both models"]
    Validate["Schema, size, AST,<br/>reference and budget validation"]
    Normalized["Normalized internal ops"]
    Render["Defensive renderer"]

    Untrusted --> Validate
    Validate -->|"accepted only"| Normalized
    Validate -->|"reject / repair / drop"| Logs["Redacted structured logs"]
    Normalized --> Render
```

Student speech, typed text, images, Realtime tool arguments, and board-model output are all untrusted. No model output may become HTML, SVG markup, JavaScript, CSS, a URL, a shell command, or an evaluated expression.

## External interfaces

### Backend HTTP API

All endpoints bind to localhost for the demo and accept explicit size limits.

| Endpoint | Response | Purpose |
|---|---|---|
| `POST /session` | JSON | Mint a Realtime client secret |
| `POST /lesson` | `application/x-ndjson` | Stream validated lesson steps |
| `POST /annotate` | JSON | Return a validated overlay batch |
| `POST /widget` | JSON | **STRETCH:** select a widget template |
| `POST /vision` | JSON | **STRETCH:** describe student ink |
| `GET /health` | JSON | Local readiness plus allowlisted Realtime and board-model configuration; never a credential value |

Every mutating/generating request carries a browser-generated `request_id`. The backend echoes it in logs and responses. It must not log raw audio, image data URLs, authorization headers, client secrets, or raw student utterances.

The M1 `POST /session` request is capped at 4 KiB before JSON parsing. It accepts only canonical UUIDv4 identifiers:

```json
{"request_id":"<uuid-v4>","client_id":"<uuid-v4>"}
```

On success it returns a deliberately narrow projection rather than the raw upstream payload:

```json
{"request_id":"<uuid-v4>","client_secret":"<ephemeral-value>","expires_at":1800000000,"model":"gpt-realtime-2.1-mini","voice":"marin"}
```

`expires_at` is omitted when the upstream response does not provide it. Validated operational failures echo `request_id`; pre-parse size failures and schema failures cannot safely promise correlation. The browser rejects a response whose `request_id` does not match its active mint request.

### Lesson stream protocol

**DECIDED:** the board model may emit step objects as JSONL internally, but the backend-to-browser stream uses typed envelopes. This allows clean terminal and warning states without confusing them with DSL steps.

Illustrative envelopes; `shared/schema/lesson-stream.schema.json` is authoritative:

```json
{"type":"lesson.started","request_id":"req_123"}
{"type":"lesson.step","request_id":"req_123","step":{"id":"s1","script":"...","ops":[],"checkpoint":null}}
{"type":"lesson.warning","request_id":"req_123","code":"step_dropped","step_hint":"s2"}
{"type":"lesson.done","request_id":"req_123","accepted_steps":5}
{"type":"lesson.error","request_id":"req_123","code":"upstream_incomplete","upstream_reason":"max_output_tokens","fallback_available":true}
```

If an unrecoverable upstream failure happens after HTTP headers have been sent, emit `lesson.error` with a CHALK-owned non-sensitive code and then close the stream. HTTP rejection, transport unavailability, `response.incomplete`, `response.failed`, and generic streaming `error` remain distinct. The optional `upstream_reason` is a closed category from the shared schema; arbitrary upstream codes, messages, response bodies, and student/model content never cross this boundary. Local configuration, timeout, invalid-stream, and no-valid-step errors cannot carry an upstream reason. The browser retains accepted buffered steps and chooses the cached fallback if none were accepted.

Backpressure is bounded: the server awaits each emitted line, and the client keeps a maximum of eight accepted steps. There is no reason to buffer an unbounded lesson.

### Realtime protocol adapter

The following is the official-documentation baseline as of 2026-07-15:

- **VERIFIED-DOC:** browser connections use WebRTC and may authenticate with an ephemeral client secret from `POST /v1/realtime/client_secrets`.
- **VERIFIED-DOC:** `session.update` and `session.updated` update and acknowledge session instructions.
- **VERIFIED-DOC:** VAD emits `input_audio_buffer.speech_started` and `input_audio_buffer.speech_stopped`.
- **VERIFIED-DOC:** output transcript progress is available through `response.output_audio_transcript.delta`.
- **VERIFIED-DOC:** `response.done` reports response completion.
- **VERIFIED-DOC:** WebRTC sessions with VAD interruption enabled automatically cancel the active response and truncate unplayed audio when the user interrupts.
- **VERIFIED-DOC:** `response.done.response.usage` reports billed input/output totals and modality details; input transcription, when enabled, is billed separately.
- **VERIFIED-DOC:** `session.max_output_tokens` can cap each assistant response, and retention-ratio truncation with `token_limits.post_instructions` can bound the rolling conversation input.

Official references:

- <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- <https://developers.openai.com/api/docs/guides/realtime-conversations>
- <https://developers.openai.com/api/docs/guides/realtime-vad>
- <https://developers.openai.com/api/docs/guides/realtime-costs>
- <https://developers.openai.com/api/reference/resources/realtime>

**OBSERVED-LIVE (2026-07-15, Chrome 150):** the metadata-only traces captured connect, narration, dummy-tool output and explicit follow-up `response.create`, resumed audio, cost configuration/usage, and multiple interruptions. Genuine audible interruptions emitted `output_audio_buffer.cleared` immediately after `input_audio_buffer.speech_started`, followed by `conversation.item.truncated`. Crucially, `response.done` can precede the end of audible WebRTC playout by several seconds, while `response.created` can also be cancelled before any output begins. Client teaching state therefore follows matching `output_audio_buffer.started`, `.stopped`, and `.cleared` events: generation completion does not end audible state, and pre-playback cancellation does not count as audible barge-in. After correcting both boundaries, five consecutive playback-backed interruptions passed with zero stale output; the aggregate evidence is checked in under `artifacts/evidence/`.

## Primary flows

### 1. Session startup

```mermaid
sequenceDiagram
    participant UI as Browser UI
    participant API as FastAPI
    participant RT as Realtime API

    UI->>API: POST /session
    API->>RT: Mint client secret using server key
    RT-->>API: Ephemeral secret
    API-->>UI: Ephemeral secret
    UI->>RT: WebRTC handshake
    RT-->>UI: Session created
    UI->>RT: session.update(prompt, tools, model settings)
    RT-->>UI: session.updated
    UI-->>UI: Enter IDLE
```

Failure before `session.updated` leaves voice controls disabled and shows a retryable local error. The board remains usable for a cached silent lesson during development.

### 2. Starting a lesson

```mermaid
sequenceDiagram
    participant S as Student
    participant RT as Realtime model
    participant T as ToolRouter
    participant API as Lesson service
    participant BM as Board model
    participant Sync as SyncEngine

    S->>RT: Ask to learn a topic
    RT->>T: teach(topic, context)
    T->>API: POST /lesson with request_id
    T-->>RT: function output: started
    T->>RT: Request short filler/ack response
    API->>BM: Generate lesson JSONL
    BM-->>API: Text deltas
    API-->>T: Validated lesson.step envelopes
    T->>Sync: Buffer accepted steps
    Sync-->>Sync: Wait until filler turn is clear
    Sync->>RT: Request exact step narration
    Sync-->>S: Animate ink concurrently
```

The lesson request is asynchronous from the Realtime function call. A new topic aborts the old HTTP request and increments the active request ID. Late lines from the old request are ignored even if network cancellation races.

### 3. Validating a generated step

```mermaid
flowchart LR
    Line["Complete JSONL line"] --> Size["Line-size limit"]
    Size --> JSON["JSON parse"]
    JSON --> Schema["JSON Schema"]
    Schema --> Budget["Step and lesson budgets"]
    Budget --> Expr["Safe expression AST"]
    Expr --> Refs["Accepted-ID references"]
    Refs --> Normalize["Normalize"]
    Normalize --> Emit["Emit lesson.step"]

    Size -. failure .-> Repair["Scoped repair, max 2/line and 4/lesson"]
    JSON -. failure .-> Repair
    Schema -. failure .-> Repair
    Budget -. failure .-> Repair
    Expr -. failure .-> Repair
    Refs -. failure .-> Repair
    Repair -->|"valid"| Normalize
    Repair -->|"still invalid"| Drop["Drop and warn"]
```

Accepted IDs are added only after successful normalization. Later lines cannot refer to IDs from a dropped step. Repair calls are counted before dispatch against one lesson-owned budget, so a timeout, rejection, or transport failure still consumes and appears in the bounded repair count. Terminal envelopes identify only whether failure occurred during `generation` or `repair`; they never retain raw repair content.

### 4. Playing a step

The stable mode is `SYNC_MODE=fixed`:

1. `SyncEngine` marks the step active and requests its narration.
2. Observed `output_audio_buffer.started` activity starts a fixed weighted animation schedule. Transcript generation alone never starts ink.
3. Op weights distribute expected duration; configuration clamps minimum and maximum durations.
4. If playback drains with ink pending, the remaining portion finishes within 400 ms rather than drawing through a long silent tail.
5. The next step waits for both plus a measured audio-drain guard.

`SYNC_MODE=paced` is retained only as an experimental comparison. It keeps the same audible-playback start gate and adds a bounded 0.5×–3× controller from cumulative transcript-character progress, but generation can finish several seconds before audible playout. Transcript progress is therefore not a playback-position signal and paced mode is not the demo default. The backend projects the validated runtime mode in the session response so the browser and server cannot silently disagree.

**SPIKE:** determine whether remote-audio activity can be measured reliably with a Web Audio analyser in the recording browser. The experiment must attach an analyser to the actual remote WebRTC media stream, compare its activity envelope against recorded audible output for at least three cached runs, and prove that pause/stop boundaries do not lead the speaker. An analyser can establish audible activity, not semantic word position; per-op word-to-mark alignment remains a separate future DSL design with narration cues. If the recording browser does not expose reliable remote-stream timing, retain fixed mode and calibrate the drain guard rather than inferring playback from transcript generation.

### 5. Interruption and resume

```mermaid
sequenceDiagram
    participant S as Student
    participant RT as Realtime API
    participant Sync as SyncEngine
    participant Board as Board renderer

    S->>RT: Starts speaking
    RT-->>Sync: input_audio_buffer.speech_started
    par Local reaction
        Sync->>Board: Freeze current animation progress
        Sync-->>Sync: TEACHING -> FROZEN -> QA
    and Realtime reaction
        RT-->>RT: Cancel active response and truncate unplayed WebRTC audio
    end
    S->>RT: Question
    RT->>Board: Optional local deixis tool
    RT-->>S: Answer
    RT->>Sync: resume_lesson()
    Sync-->>Sync: QA -> TEACHING
    Sync->>Board: Continue or replay current step
```

The half-drawn stroke remains visible during QA. The baseline resume restarts the current narration and continues the frozen ink. If rehearsal shows that this is confusing, reset and replay only the current step; do not build word-level audio alignment.

The browser does not redundantly send `response.cancel` for a VAD interruption unless a live event trace proves the automatic path did not cancel a manually created response.

### 6. Publishing board context

The manifest is derived from committed visible state, never the intended program. The current cached slice republishes after fully revealed lesson geometry changes; later annotation, widget, and student-sketch implementations must use the same path:

1. Build a compact inventory of visible elements and relevant computed facts.
2. Keep it to approximately 120 tokens.
3. Compose `BASE_TUTOR_PROMPT + latest manifest`.
4. Send it through `session.update({instructions: ...})`.
5. Do not assume publication until `session.updated` is observed.

This replaces prior board context and avoids unbounded conversation-item accumulation.

**SPIKE:** measure instruction-update latency and confirm it does not disrupt an active or immediately following response. `BoardContextPublisher` isolates this mechanism so it can be replaced without touching the renderer or tutor logic.

## State model

### Lesson lifecycle

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> GENERATING: teach accepted
    GENERATING --> TEACHING: first step buffered and response slot clear
    GENERATING --> IDLE: abort or no usable fallback
    TEACHING --> FROZEN: student speech starts
    FROZEN --> QA: interruption committed
    QA --> TEACHING: resume_lesson
    QA --> GENERATING: new topic
    TEACHING --> CHECKPOINT_ASKING: checkpoint step settles
    CHECKPOINT_ASKING --> CHECKPOINT_LISTENING: prompt generation + audio + drain settle
    CHECKPOINT_ASKING --> CHECKPOINT_FEEDBACK: student answers early
    CHECKPOINT_LISTENING --> CHECKPOINT_FEEDBACK: student answers
    CHECKPOINT_FEEDBACK --> TEACHING: feedback generation + audio + drain settle
    TEACHING --> DONE: terminal stream + final step complete
    DONE --> IDLE: close/reset
```

State carries at least:

- active lesson `request_id`;
- active step ID and index;
- accepted/buffered steps;
- active Realtime response ID and purpose;
- animation progress for the current op batch;
- stream status;
- latest committed manifest content and acknowledgement state;
- current sync mode;
- recoverable error and fallback status.

Invalid state/event combinations log and do nothing. Events with a stale request or response ID are ignored.

### Board element lifecycle

```text
generated -> validated -> normalized -> laid out -> animating -> committed -> erased
```

Only successfully rendered, fully revealed elements appear in the current manifest. Frozen partial geometry remains visible locally but is omitted from tutor grounding until a deliberately partial manifest contract is designed and validated.

## Data model boundaries

The lesson JSON Schema defines the implemented steps, ops, anchors, checkpoints, and budgets. Architecture-specific constraints reflected in that schema or its semantic decoder include:

- unique short IDs;
- no forward references;
- normalized dimensions rather than model-chosen pixels;
- no undeclared curve symbols;
- bounded sketch strokes and points;
- no raw markup or arbitrary renderer options;
- idempotent erase and clear behavior.

Curve expressions cross a two-stage boundary:

1. Python parses a deliberately restricted expression grammar using a safe AST walk and never evaluates it.
2. TypeScript compiles with a locked-down mathjs instance, samples the visible domain, and rejects non-finite or pathological output.

## Concurrency and cancellation

- At most one active lesson generation per browser session.
- At most one default-conversation Realtime response at a time.
- Annotation requests may run during QA but are tied to the manifest version they received. Stale results are discarded.
- Annotation output uses its own target-relative overlay schema, never the lesson
  program schema. It permits at most five circle, underline, arrow, text, or
  equation marks and cannot create axes or mutate the lesson manifest.
- Annotation targets carry committed IDs, kinds, and normalized y-down bounds.
  Structured geometry is authoritative. Screenshot context is absent from the
  product request and exists only in an owner-gated two-call evaluation harness.
- A new lesson aborts lesson generation, annotation, pending playback, and optional widget generation from the prior lesson.
- Backend repair calls are sequential per line to preserve accepted-ID order and share an aggregate four-call lesson budget.
- The renderer isolates each op: one render failure cannot cancel sibling ops or the lesson.
- Stream readers must handle cancellation while a partial UTF-8 or JSON line is buffered.

## Failure and fallback policy

| Failure | Local behavior | Fallback |
|---|---|---|
| Session mint/handshake fails | Keep voice disabled; show retry | Cached lesson can run silently for development |
| Tool arguments invalid | Return soft tool error | Tutor asks again or continues without tool |
| Board model slow | Realtime gives short bounded filler | Cached lesson after configured timeout |
| Model line invalid | Repair at most twice for that line and at most four times for the lesson | Drop line; validate later refs against accepted IDs |
| Streamed step fails browser validation | Drop only that op or step and count it as a browser drop | Cached fallback only when zero streamed steps survive |
| Repair request fails | Record closed `repair` origin and the already-consumed repair count | Terminate or retain the accepted prefix without exposing upstream content |
| Stream fails after steps | Finish accepted buffered steps | Explain lesson ended early; cached restart available |
| Live evaluation request ends for `max_output_tokens` or `content_filter` | Record bounded code/reason; do not retry that topic; continue the fixed sample | Human rubric marks that topic failed |
| Live evaluation sees model/effort mismatch, HTTP rejection, transport failure, missing configuration, or any other/missing upstream reason | Stop the batch immediately | Diagnose and require fresh approval; do not spend remaining calls |
| Live evaluation accumulates three machine-failed topics | Stop because the 8/10 gate is unreachable | Retain the redacted `v2` summary; require a new plan and approval |
| Evaluation harness fails after a paid request starts | Reduce the exception to a closed category and write a summary | Stop; never retain exception text or silently lose the attempted call |
| No valid live steps | Stop generation cleanly | Load matching cached lesson |
| Renderer op fails | Log and skip only that op | Continue the step |
| Paced sync looks unstable | Change runtime flag | `SYNC_MODE=fixed` |
| Deixis ID missing | Return soft failure | Answer verbally without pointing |
| Manifest publication fails | Retain last acknowledged version | Retry after active response |
| Direct sketch-image path fails | Do not block QA | Backend vision-text fallback |

Fallback activation must be visible in developer diagnostics and `PROGRESS.md`, but the tutor must not say “the API failed” or expose implementation detail during the demo.

## Observability

Use structured, redacted events with monotonic timestamps where possible:

- session connection milestones;
- Realtime event type and correlated response/tool IDs;
- lesson request start, first model delta, first valid step, and terminal status;
- validation and repair outcomes by error code, never raw student text by default;
- sanitized-step and sanitized-field counts, never before/after values;
- animation start/freeze/resume/commit;
- manifest version publish/ack;
- fallback activation;
- uncaught frontend and backend errors.

The developer overlay should show connection status, lesson state, active response purpose, request ID suffix, sync mode, buffered step count, and current fallback. Hide it for recording.

Primary performance measurements:

- session-connect latency;
- tool-call-to-first-valid-step;
- first-valid-step-to-first-stroke;
- detected-speech-start-to-animation-freeze;
- repair rate and dropped-step rate;
- three-run cached-lesson completion rate.

M3 captures request-to-first-valid-step at the browser stream boundary and first-valid-step-to-first-visible-ink when the renderer first commits nonzero geometry. Board-model and prompt identity travel only as bounded response headers. Terminal diagnostics retain only CHALK's closed terminal code, optional allowlisted reason, `generation`/`repair` origin, and repair-call count. The evaluation CLI separates one-call `repair-smoke`, one-topic `smoke`, and ten-topic `batch`; each has an independent approval acknowledgement. Repair smoke calls the production plain-text repair path once, locally validates the result, and retains no model content. Each topic uses one primary model call and at most four repair calls. The batch retains raw synthetic-topic NDJSON once; diagnostics revalidates and reviews those same outputs locally so layout screenshots do not require a duplicate model batch. Only `max_output_tokens` and `content_filter` consume one failed topic and proceed, and the third machine failure stops the run because 8/10 is then impossible. Identity, access, configuration, transport, server, invalid-request, missing, and unknown upstream outcomes stop the batch immediately. After any paid-path harness failure, `chalk.m3-live-evaluation.v2` retains a redacted stop reason and closed error category rather than losing the attempt.

Do not claim perceived audio interruption latency from the animation-freeze measurement.

## Live API test budget

Credentialed API checks are narrow acceptance probes, not load tests. Default automated tests use deterministic fakes and fixtures. Live Realtime validation stays on `gpt-realtime-2.1-mini`, uses brief synthetic speech and bounded responses, and disconnects immediately after the required handshake, tool, or interruption evidence is captured. There are no automatic live retries or credentialed test loops. Each response is capped at 1,024 output tokens (raised from the original 256 M1 guard after live sessions showed voice answers and narrations truncating mid-sentence with `response.done` status `incomplete`), bounds the post-instruction conversation window at 4,000 tokens with 0.8 retention, leaves input transcription disabled, displays cumulative billed usage, and auto-disconnects a connection at 50,000 total response tokens. Reconnecting resets that local counter, so it is not an account-wide budget. A larger model, a batch of generated topics, or an extended live session requires explicit owner approval and a recorded reason in `PROGRESS.md`.

## Security and privacy

- Standard OpenAI API keys exist only in backend environment variables.
- Client-secret minting is pinned to the official HTTPS endpoint with redirects and environment-derived proxy routing disabled.
- The browser persists a random UUIDv4; the backend sends only `SHA-256(SAFETY_IDENTIFIER_SALT + ":" + client_id)` as the non-PII safety identifier.
- CORS allows only the explicit local frontend origin, and Trusted Host validation accepts only localhost hostnames used by the app and tests.
- Logs redact secrets, authorization headers, audio, image data URLs, and raw student utterances.
- Student context, audio, and sketches remain in memory and are not persisted.
- KaTeX trust is disabled; no model-generated HTML or URLs are rendered.
- Request size, stream duration, expression complexity, sampling work, repair attempts, and concurrent jobs are bounded.
- The README identifies CHALK as a local hackathon prototype, not a production or unsupervised child-learning system.

## Drawing-experiment evidence boundary

Drawing experiments produce one bounded record per homogeneous configuration under
`shared/schema/drawing-experiment-record.schema.json`. Model, reasoning effort,
all three prompt hashes, lesson-schema version and content hash, plan/scene schema
content hashes, a deliberately bumped resolver-policy revision, renderer, sync,
partial-ink, Q&A-draw, and lesson-generation flags are all part of one canonical
configuration digest. Live gates additionally pin the complete Realtime
model/voice/base-instruction/tool-contract identity, browser engine/version, and
annotation prompt/schema identity when those paths apply; nullable fields mean the
path is genuinely absent, not unknown. A run cannot store arrays of competing prompt
hashes or flag values and call them one configuration; comparisons reference two or
more independently verified records. Browser-dropped steps and renderer-dropped
operations are separate closed counters at both topic and aggregate level: one may
never stand in for the other.

The backend verifier is read-only and offline. It rejects oversized/non-finite JSON,
duplicate file keys, stale configuration digests, missing or reordered retained
topics/ratings, inconsistent aggregate counts, exceeded request/model-call ceilings,
and post-run evidence inserted into a planned record. Records carry closed metrics and
numeric rubric scores only—not model content, student utterances, images, exception
text, or raw renderer state.

A stopped live run uses the schema-1.1 `aborted` form. Completed topic results must be
the exact retained-topic prefix, any human ratings must be a prefix of those completed
results, and the one unfinished terminal attempt carries only a closed stop category,
the next retained topic ID (or null before any topic was attempted), and bounded
request/model-call/repair counts. Aggregate totals include that explicit attempt, so a
transport or HTTP failure counted before dispatch cannot disappear merely because no
topic result completed. Aborted evidence is always decision-pending and cannot carry a
vision calibration.

Experiment runners must construct `ExperimentBudgetGuard` from the predeclared
ceilings and claim each outward request and each model call immediately before
dispatch. Transport failures therefore remain counted, and a call that would exceed
the ceiling is refused before network activity. Post-run verification is defense in
depth, not the only spend control.

Vision can earn a regression-proxy role only through the one predeclared calibration:
tie-aware Spearman rank correlation over 5–20 already-retained human ratings, with a
fixed passing threshold of 0.70 and at least three distinct human score levels. The
current binary M3 `layout_pass` values are insufficient ordinal evidence, so the helper
refuses them rather than manufacturing a correlation. It consumes numeric scores only,
makes no API call, and cannot validate mathematical or renderer truth.

Exact layout rescoring remains a browser responsibility because only the production
decoder/resolver/lints own fonts and final geometry. The no-network
`npm --prefix frontend run evidence:rescore` producer replays retained NDJSON and all
golden/cached fixtures and emits only closed topic/finding counts, with the same pinned
resolver-policy revision consumed by continuation receipts. Python must not grow an
approximate second layout engine to fill this gap.

The lifecycle and review milestone for each current experimental flag is normative in
`docs/experiment-flag-lifecycle.md`. Missing promotion evidence at the named milestone
means park or remove, never silent extension or default promotion.

## Universal geometric construction boundary

Schema 1.3 lets the board model declare five exact relationships without emitting
their resolved coordinates: along a contiguous line/curve, midpoint of point or
endpoint references, one bounded intersection, a perpendicular through a point, and
an offset from existing geometry. All inputs must be accepted in a prior step. This
deliberately trades same-line convenience for a stronger streaming invariant: every
source is already committed, cannot be moved by a current layout relation, and cannot
form a forward edge or cycle.

FastAPI validates the closed relation shape, reference inventory, and element types.
It does not reproduce browser layout. The browser resolves against final 1600x900
geometry, enforces one inherited coordinate space, rejects ambiguity/parallelism/
degeneracy/off-canvas output with closed codes, and excludes only the failing op.
Derived endpoints never exist in the wire program. The resulting point or line enters
the normal rough-path animation, renderer snapshot, semantic manifest, and
continuation scene only after successful resolution. Shared parity fixtures document
both the common backend reference decision and browser-only geometry decisions rather
than pretending the server knows rendered coordinates.

Schema 1.4 adds a sixth, intentionally conservative construction for local rate of
change: `tangent_at(curve,x,length)`. It can target only a previously accepted
axes-backed curve and an interior data-space `x`. The browser reuses the same finite
visible curve samples it renders, interpolates that local geometry, and constructs a
line of normalized length only when incoming and outgoing directions agree. Endpoints,
points outside the visible segment, disconnected branches, degenerate samples, and
corner-like direction changes fail closed; FastAPI only checks the prior accepted curve
reference and closed shape. This is a tangent to the renderer's visible finite polyline,
not a claim of a symbolic derivative.

## Runtime configuration

Expected server-side environment variables:

```dotenv
OPENAI_API_KEY=
REALTIME_MODEL=gpt-realtime-2.1-mini
BOARD_MODEL=gpt-5.6-luna
BOARD_REASONING_EFFORT=none
REALTIME_VOICE=marin
SAFETY_IDENTIFIER_SALT=chalk-local-development-v1
SYNC_MODE=fixed
DRAWBACK_MODE=vision
FRONTEND_ORIGIN=http://localhost:5173
```

`gpt-realtime-2.1` is used for recording after the development path passes on the mini model. Luna is the qualification board model and `reasoning.effort: none` is its latency baseline; `low` is retained only for a measured quality comparison. If Luna fails the unchanged gate, only the failed topics are compared on Terra before deciding whether a new default is justified; Sol is considered only after both lower-cost tiers are evidenced inadequate.

Client-visible configuration must contain only non-secret feature flags. Never expose `OPENAI_API_KEY` through Vite environment variables.

## Verification gates

### Day 1 protocol spike

- [x] Mint a client secret and complete the WebRTC handshake.
- [x] Capture the actual session-created/update acknowledgement events.
- [x] Confirm voice output and the selected transcript-delta event.
- [x] Confirm a dummy tool-call round trip and required response trigger.
- [x] Interrupt five responses and capture cancellation/truncation behavior.
- [x] Record observed event names and payload fixtures with secrets and content redacted.

### Day 2 board/sync spike

- [x] Hardcoded projectile lesson renders without uncaught errors.
- [x] Fixed mode starts voice and ink concurrently.
- [x] Rough paths do not jump on rerender.
- [x] Freeze retains a visibly partial stroke in deterministic rendering tests.
- [x] Response completion plus the chosen drain guard does not overlap steps.

### Day 3 generation spike

- [x] POST NDJSON survives arbitrary network chunk boundaries.
- [x] Invalid lines repair or drop without raw forwarding.
- [x] Dropped IDs cause dependent later references to repair or drop.
- [ ] First valid step reaches the browser within the target on a representative topic.
- [x] Zero valid steps activates the cached fallback.

### MVP gate

- [ ] Three consecutive cached projectile loops complete.
- [ ] Each loop includes interruption, partial-stroke freeze, grounded answer, and resume.
- [ ] The last acknowledged manifest matches visible committed board state.
- [x] No known crash exists on the three cached demo lessons.

## Decision record

| ID | Date | Decision | Reason |
|---|---|---|---|
| ADR-001 | 2026-07-15 | Browser connects directly to Realtime with WebRTC | Lowest-latency media path; backend stays out of audio transport |
| ADR-002 | 2026-07-15 | Voice model and board model are separate | Keeps drawing deterministic and interruption conversational |
| ADR-003 | 2026-07-15 | POST lesson streaming uses NDJSON over fetch | Native EventSource does not support POST; matches model JSONL parsing |
| ADR-004 | 2026-07-15 | JSON Schema is the wire-format source of truth | Avoids hand-maintained frontend/backend contract drift |
| ADR-005 | 2026-07-15 | Expression validation is split across safe Python AST and frontend mathjs | Python cannot compile mathjs; both trust boundaries remain defensive |
| ADR-006 | 2026-07-15 | Fixed concurrent sync is the stable fallback | Sequential ink-then-voice contradicts the product promise |
| ADR-007 | 2026-07-15 | Board context publishes through replaceable session instructions | Avoids undocumented system-role conversation items and context growth |
| ADR-008 | 2026-07-15 | Demo lessons are cached and live generation is shown once | Reduces recording risk without hiding the live capability |
| ADR-009 | 2026-07-15 | Layer per-response, rolling-context, and per-connection Realtime token limits | A single post-response ceiling cannot prevent one long answer from overshooting; visible usage and independent bounds make development spend predictable without removing the live path |
| ADR-010 | 2026-07-16 | Publish only successfully rendered, fully revealed geometry in the tutor manifest | Prevents future or failed elements from becoming model-visible claims while preserving a compact replaceable context |
| ADR-011 | 2026-07-16 | Coordinate responses by explicit purpose and use three checkpoint phases | Keeps manual narration, VAD answers, checkpoint prompts, and feedback from stealing each other's lifecycle events or advancing the lesson early |
| ADR-012 | 2026-07-16 | Qualify M3 on `gpt-5.6-luna` before escalating board generation | Luna is 60% cheaper than Terra at standard input/output rates and remains in the current GPT-5.6 family; the unchanged 8/10, zero-crash, and six-second gates protect quality |
| ADR-013 | 2026-07-16 | Separate upstream SSE bytes from model-text bytes and qualify Luna at `reasoning.effort: none` | The first low-effort smoke produced three valid steps but missed first-step latency and ended after a likely transport-overhead limit; official GPT-5.6 guidance names `none` as the latency baseline, while independent bounded budgets preserve safety |
| ADR-014 | 2026-07-16 | Retain the corrected Luna smoke as the access/stream prerequisite, not as M3 acceptance | One approved no-retry call produced four valid steps, zero repairs/drops, first valid output in 2.87 seconds, and a normal terminal; the separate ten-topic rubric and browser visible-ink evidence are still required |
| ADR-015 | 2026-07-16 | Preserve distinct upstream terminal classes and only bounded diagnostic reasons | Collapsing HTTP rejection, incomplete, failed, and streaming error events made a valid partial lesson look like an access failure and prematurely stopped the first batch; closed codes/reasons restore diagnosis without retaining sensitive upstream content, while the harness continues only clearly topic-scoped token/content outcomes and stops ambiguous or systemic failures to protect spend |
| ADR-016 | 2026-07-16 | Attribute and cap repairs, stop when the acceptance gate is unreachable, and retain paid-path harness failures | A failed repair previously looked like primary generation failure and could disappear from counts; one lesson now permits at most four counted-before-dispatch repairs, terminal evidence carries only closed origin/count fields, the third machine failure stops the 8/10 batch, and summary v2 records redacted harness failures without exception text |
| ADR-017 | 2026-07-16 | Use plain-text Responses for repair and qualify that seam with an independent one-call probe | The second batch proved the first unit-circle repair request—not primary generation—received `invalid_request`; Luna documents Structured Outputs support, but the repair-only JSON formatting request failed live. Removing the nonessential format parameter keeps schema validation as the trust boundary. The separately approved content-free repair smoke then passed in 2.77 seconds with exactly one request and no retry |
| ADR-018 | 2026-07-17 | Keep annotations in a separate target-relative overlay schema | The lesson DSL remains the stable recording contract. A five-op overlay contract can ground new explanatory ink to committed IDs without adding axes, absolute placement, or temporary marks to lesson or manifest state; local deixis remains the reliable fallback |
| ADR-019 | 2026-07-17 | Browser lesson decoding degrades per op/step and never discards an accepted prefix | Previously one browser-rejected op aborted the whole live lesson and loaded the wrong-topic cached fallback; the assembler now drops only the failing op or step, and the fallback is reserved for zero-usable-step lessons |
| ADR-020 | 2026-07-17 | Pre-sample curves and lint LaTeX on the backend with shared parity fixtures | The backend accepted expressions and equations the browser rejects at runtime (`1/x` across zero, `log`/`sqrt` over non-positive domains, `**`, strict-KaTeX failures), so repair could never fire; a bounded interpreter over the validated AST and a structural lint close the gap without evaluating model code, with `shared/fixtures/*-parity.json` as the two-sided contract |
| ADR-021 | 2026-07-17 | Layout is prefix-stable via flowing per-region cursors | Count-division slot sizing let a later streamed step resize and move earlier committed ink; cursor packing depends only on earlier ops, so placing step N can never move steps 1..N-1, verified by a corpus-wide prefix property test |
| ADR-022 | 2026-07-17 | Board prompt v3 carries an explicit spatial contract | The model was never told the grid geometry, region sizes and overlaps, y-down sketch orientation, axes sizing, or curve domain rules, and the hardest op (sketch) had no worked example; v3 states all of them, declares `visible_board` non-anchorable, and pairs with the browser sending an empty board state for fresh lessons. Live rubric qualification of v3 remains a pending approved gate |
| ADR-023 | 2026-07-17 | `teach` during QA creates a new request boundary before generation | The documented QA → GENERATING transition was unreachable because the teach handler required IDLE/DONE. The switch now cancels the Q&A expectation and immediately installs the replacement request ID with empty step state, so late narration and ink events from the old request are stale before new generation begins. |
| ADR-024 | 2026-07-18 | Retain transcript-paced ink only as an experimental flag; default to fixed | Transcript deltas measure generation rather than audible position and can race far ahead of speaker playback. The server still projects `SYNC_MODE`, playback stop still bounds the silent tail, but the dependable demo path remains playback-gated fixed scheduling until remote-audio position is measured directly. |
| ADR-025 | 2026-07-18 | Add schema-1.1 physics marks on a shared normalized canvas | A plain sketch cannot express ray direction, construction lines, labeled points, or measured angles. `line`, `arrow`, `point`, and `angle_arc` use closed properties and inherit an earlier diagram primitive's coordinate canvas, preserving deterministic validation, stable rough geometry, prefix-stable layout, and per-stroke interruption without allowing arbitrary SVG. Cached schema-1.0 lessons remain untouched. |
| ADR-026 | 2026-07-18 | Generate the v3 and repair wire contract from the shared lesson schema | Handwritten op syntax can drift from the sole wire source. A bounded deterministic renderer now injects exact fields, variants, enums, ranges, IDs, regions, and budgets into the current prompts; v1/v2 remain byte-identical and hashes cover the fully expanded prompt. |
| ADR-027 | 2026-07-18 | Sanitize only closed near-valid lesson mistakes before repair | Whitespace, `**`, and tiny normalized-boundary overshoot are unambiguous and should not consume a paid repair. Shared fixtures keep Python and TypeScript identical; fuzzy IDs, semantic edits, and material coordinate errors remain repair/drop cases, and closed warning counts preserve evidence honesty. |
| ADR-028 | 2026-07-18 | Make structured committed bounds authoritative for annotation and gate screenshots as an A/B spike | The renderer knows exact geometry more reliably than vision. `/annotate` now receives normalized ID/kind/bounds while the tutor manifest stays compact. A separate owner-acknowledged CLI may compare one structured call with one structured-plus-low-detail-image call; no screenshot enters the product path until evidence shows material benefit. |
| ADR-029 | 2026-07-18 | Retry one unprompted incomplete checkpoint, but preserve deliberate early answers | A non-completed checkpoint response previously emitted normal generation/playback completion and advanced to listening after partial speech. Unprompted `cancelled`/`incomplete` prompts now emit a correlated failure and receive one bounded retry; a response cancelled by detected student speech remains an intentional early-answer transition. Answer-evaluation guidance is installed only after prompt audio starts, avoiding contradictory instructions while the question is generated. |
| ADR-030 | 2026-07-18 | Add deterministic visual lints before vision or mutable patches | The browser already owns exact resolved geometry, so it now reports closed label-overlap, label-boundary, and text-overflow findings in diagnostics without moving committed ink. Prompt v3 also chooses concept-shaped visual structures and applies a word-removal test. Vision remains an optional owner-gated evaluator and cannot replace the human rubric. |
| ADR-031 | 2026-07-18 | Treat pending Realtime responses as busy and bound every response lifecycle | `response.create` previously had an invisible interval before `response.created`, allowing a generated lesson to enter `TEACHING` while its one-sentence tool continuation was still pending; the narration request then rejected once and never retried, leaving a blank board. Pending registrations now enter the public snapshot immediately, auto-start rechecks authoritative client state after context acknowledgement, scripted requests refuse all in-flight work, transient busy rejection retries only after an observed busy-to-idle transition, and bounded creation/settlement watchdogs prevent either lifecycle phase from remaining stuck indefinitely. |
| ADR-032 | 2026-07-18 | Add a bounded composite diagram op while keeping geometry renderer-owned | Multi-part educational drawings were forced through four-op step budgets and disconnected standalone marks. A composite op now groups up to sixteen semantic line, through-point smooth, rectangle, ellipse, arc, and point primitives on one canvas; the browser—not the model—constructs cubic paths, arrowheads, stable rough ink, exact curve/arc extents, and progressive reveal. This borrows the useful intent/geometry separation observed in Penecho without copying its AGPL source, accepting arbitrary SVG, or changing cached lessons. |
| ADR-033 | 2026-07-18 | Use coordinator-wide in-flight state as the authoritative Realtime busy signal | The short post-tool framing response could stop audible playback before its later `response.done`. During that interval the UI saw no pending creation, active response ID, or audio playback and started lesson narration, while the response coordinator correctly rejected it as still in flight. Because the public idle inputs did not change again, narration—and therefore ink—never retried. Snapshots now expose coordinator-wide `responseInFlight`; lesson auto-start, scripted narration, and UI actions all wait on the same settlement boundary. A reversed event-order regression pins playback-stop-before-generation-done. |
| ADR-034 | 2026-07-18 | Improve spatial work through one generic composite canvas, not topic-specific renderers | A renderer-owned operation for each lesson topic would expand the DSL without making novel topics better. Composite diagrams now also support bounded positioned text, so aligned arithmetic, derivations, tables, and annotated figures can share the same local coordinate system. Deliberate text positions remain fixed; incidental primitive labels use deterministic collision candidates against other labels and exact ink bounds before board clamping. No long-division-specific operation or code path is retained. |
| ADR-035 | 2026-07-18 | Ground questions with completed composite subparts and refresh context at detected speech | Treating a composite diagram as one indivisible manifest element hid useful rays, labels, forces, and spatial relations until the whole op settled. The renderer now assigns stable virtual IDs, exact bounds, and semantic summaries to completed primitive reveal groups, never future or partially drawn groups. At `input_audio_buffer.speech_started`, the browser republishes the current renderer snapshot through the existing queued `session.update` path so a voice question uses the freshest factual board state. |
| ADR-036 | 2026-07-18 | Separate board truth from React painting and add generic schema-1.2 layout relations | A renderer swap cannot be evaluated honestly while layout, manifest extraction, and diagnostics are embedded in one component. `BoardRenderer` now prepares immutable geometry and committed snapshots, while `BoardPatch` provides exact reversible candidate diffs. Generic place/align/stack/distribute relations move only new independent roots and their dependent geometry; prior committed ink remains immutable and cached schema-1.0 lessons are byte-identical. |
| ADR-037 | 2026-07-18 | Keep tldraw 5.2.5 as a lazy, licensed experiment; retain rough.js as default | The SDK can host locked CHALK-owned shapes and export board-only images, but the spike adds about 1.68 MB of lazy JavaScript plus CSS and currently preserves CHALK's SVG geometry rather than proving better native bindings or typography. It is therefore opt-in through `VITE_BOARD_RENDERER=tldraw`, obtains its licence from a no-store localhost endpoint, and cannot replace the dependable renderer until retained visual, interruption, performance, and bundle evidence wins the documented matrix. |
| ADR-038 | 2026-07-18 | Reserve partial ink for a dedicated append-only envelope, not partial lesson JSON | Repeatedly parsing unfinished lesson output would weaken the server-validation boundary. The experimental `lesson.ink_delta` carries only bounded normalized point additions for a separately accepted op header. A request-local store enforces monotonic sequence, total budgets, immutable prefixes, cancellation, and stale rejection; no backend producer or default rendering path is enabled before a measured latency gate. |
| ADR-039 | 2026-07-18 | Keep board-question images supplementary and evaluation-only | The active renderer can produce a board-only crop and a builder can pair it with authoritative IDs, bounds, and summaries, but no image is appended to Realtime instructions or routine questions. Invalid capture fails closed to structured context, evidence omits Base64, and the existing two-call no-retry smoke still requires fresh owner approval before any product integration decision. |
| ADR-040 | 2026-07-18 | Close the drawing loop through stateless resolved-prefix continuation | One-shot generation cannot observe post-layout geometry. Under the opt-in `resolved-stepwise` mode, the opening call emits a bounded persistent plan and one or two validated steps, targeting two; the browser resolves their actual scene and FastAPI independently generates one next step per continuation. Every call replays the complete accepted prefix to reconstruct validation/checkpoint/reference state, carries cumulative repair use, and rejects stale request/prefix identity. Committed history is immutable, future buffered geometry may grow only by append, and failure finishes the accepted prefix cleanly. The browser never holds a board-model credential or sends raw renderer records. |
| ADR-041 | 2026-07-18 | Preserve conceptual meaning only where derived summaries are insufficient | Blanket model-authored descriptions would duplicate labels and increase prompt noise. Optional bounded `meaning` is therefore limited to diagram primitives and bare sketch/line ops; renderer-owned summaries prefer it when present, while all other elements keep deterministic derived summaries. |
| ADR-042 | 2026-07-18 | Trial direct Realtime drawing only as bounded Q&A overlays | A unified tutor can improve visual answers without replacing compiled lessons or granting raw canvas access. Behind `VITE_QA_DIRECT_DRAW=on`, Realtime may request at most two target-relative circle, underline, arrow, text, or equation marks during `QA`; the browser assigns IDs, stamps current renderer-state version, validates the existing annotation schema and visible-target allowlist, and keeps the result out of lesson/manifest state. The board-model `/annotate` path and flag-off demo behavior remain unchanged until a live mini-model placement/interruption gate passes. |
| ADR-043 | 2026-07-18 | Failed checkpoint feedback advances rather than trapping the lesson | Checkpoint feedback is pedagogical commentary, not accepted board state, so a cancelled, incomplete, missing, or never-settling automatic response must not hold the lesson indefinitely. Feedback now has an explicit correlated failure event; non-completed responses fail immediately, created responses retain the bounded settlement watchdog, and automatic expectations gain the same eight-second creation watchdog as manual responses. Each failure completes the checkpoint and advances cleanly, while successful feedback still requires generation, playback stop, and drain settlement. |
| ADR-044 | 2026-07-18 | Promote drawing experiments only from bounded homogeneous records | Each run has one canonical configuration digest, predeclared ceilings and decision policy, closed per-topic metrics, retained numeric human ratings, and an explicit promote/park/remove outcome. The offline verifier rejects mixed/stale identity and inconsistent evidence. Vision is limited to a single fixed Spearman calibration against retained ratings, while exact geometry rescoring stays with the browser-owned renderer rather than being reimplemented in Python. |
| ADR-045 | 2026-07-18 | Authenticate every resolved-step continuation with a rotating state receipt | A client-supplied prefix, prompt context, and repair count are not authority by themselves. The opening stream now issues an opaque HMAC capability bound to request/client identity, the canonical accepted prefix and plan, a content-free hash of the bounded topic/student context, cumulative repairs, and the complete model/prompt/schema/resolver configuration identity; every accepted continuation consumes it and rotates a new receipt over the enlarged prefix. Exact lesson, plan, and resolved-scene schema bytes are SHA-256-bound, while browser-only placement policy uses one deliberately maintained revision because FastAPI must not inspect or hash arbitrary frontend source at runtime. Shared request/success/terminal schemas are validated on both sides, exact reuse is rejected by a bounded digest-only process ledger, and tampering, noncanonical Base64URL aliases, topic/context substitution, repair-budget downgrade, any identity drift, missing ordinary scene roots, or phantom ordinary IDs fail before model dispatch. Canonical opaque encoding is required because the replay ledger hashes receipt strings; accepting alternate spellings of the same signed bytes would create multiple ledger identities for one capability. HMAC state binding survives backend restart, while the best-effort exact-replay ledger intentionally does not; rotating the server-only API key invalidates outstanding receipts. |
| ADR-046 | 2026-07-18 | Express lesson-wide composition through five closed archetypes | Free-form plan rectangles would recreate model-authored layout and bypass renderer truth. The optional persistent-plan field therefore selects exactly one of five semantic archetypes; a browser-owned table maps it only to existing named regions and qualitative occupancy roles. Board v3 and continuation prompts receive the generated plan contract, legacy plans and board v1/v2 remain byte-identical, and committed ink is unaffected. The mapping is intentionally isolated until the density/candidate resolver consumes it in a coordinated phase-boundary change. |
| ADR-047 | 2026-07-18 | Keep visual attention on a bounded transient rail | Permanent geometry and the accepted manifest are the wrong place for momentary pointing. Behind `VITE_ATTENTION_CHOREOGRAPHY=on`, Q&A and checkpoint feedback may queue at most four browser-stamped actions and show only one at a time. Existing point/circle/underline/flash gain the same request, manifest-version, target, expiry, stale, and interruption boundary; trace copies already-rendered path geometry and focus uses a temporary mask. No action mutates lesson geometry or enters the manifest, and the legacy local-deixis path remains the flag-off fallback until three cached human loops pass. |
| ADR-048 | 2026-07-18 | Measure remote-audio activity without treating it as speech position | `VITE_REMOTE_AUDIO_ACTIVITY=on` attaches a bounded Web Audio analyser to the already-playing remote WebRTC stream and retains only start/stop transitions, sample count, and maximum sampling cost. A fixed RMS threshold with separate start/stop hysteresis can measure broad audible activity and pauses, but carries no transcript, word, sentence, or audio samples and does not pace ink. Unsupported Web Audio fails closed while playback continues; fixed sync remains authoritative until the Phase 6 perceptual gate wins. |
| ADR-049 | 2026-07-18 | Select annotation sides from exact committed whitespace behind a fallback flag | Structured bounds can do more than ground target IDs: the backend can mirror the current maximum overlay box, score all four target-relative sides against board edges and every visible bound, and expose the two least-crowded sides. Under `ANNOTATION_WHITESPACE=bounded`, generation and repair receive this compact allowlist and semantic validation rejects a sided mark that ignores it. `off` omits the field and preserves the prior `/annotate` contract; circle/underline remain unaffected, the browser still renders target-relative marks, and the flag cannot promote until retained placement improves without a repair/latency regression. |
| ADR-050 | 2026-07-18 | Resolve five universal geometric constructions only from committed browser geometry | Model-authored coordinates cannot reliably create exact contact. Schema 1.3 therefore adds along, midpoint, unique intersection, perpendicular-through, and offset relations whose inputs must be prior-step accepted geometry. FastAPI validates shape/type/reference safety; the browser owns inherited coordinate spaces and exact resolution, omits one failing op on parallel, ambiguous, degenerate, mismatched, or off-canvas results, and publishes concise relation semantics only after successful geometry. No topic-specific renderer or derived coordinate field is introduced. |
| ADR-051 | 2026-07-18 | Treat browser visual failures as authenticated append-only continuation tombstones | Backend validation cannot prove that a browser accepted or drew an operation. The stream now retains the exact server-issued prefix for receipt verification while the browser may send only an immutable ordered projection, with every filtered op or step covered by a closed redacted recovery finding. Decoder and renderer failures carry a bounded code, semantic intent, source indexes, unavailable IDs, and resolved neighborhood—not raw model/exception/renderer content. One continuation may re-express pending intent with entirely fresh IDs; recovered and abandoned findings remain tombstones, dangling references and resurrection fail closed, and stale, invalid, or unavailable recovery ends the accepted prefix cleanly as `recovery_abandoned`. The one-shot and cached paths remain unchanged. |
| ADR-052 | 2026-07-18 | Preserve stopped drawing experiments as closed aborted evidence and pin every applicable live identity | A record that allowed only planned or fully completed runs forced a transport/configuration failure between topics either to disappear or violate aggregate totals. Schema 1.1 adds one redacted aborted form: completed results are an exact retained prefix, the next terminal attempt carries only an allowlisted stop category plus bounded pre-dispatch request/model-call/repair counts, and promotion/calibration are forbidden. The canonical configuration now also requires nullable Realtime model, voice, base-instruction and tool-contract hashes, browser engine/version, and annotation prompt/schema hashes; semantic checks require complete bundles whenever paced/audio, attention, direct-Q&A, tldraw, annotation-whitespace, or browser-latency paths are enabled. Null means demonstrably not applicable, and partial identity fails verification. |
| ADR-053 | 2026-07-18 | Make Phase 6 comparisons executable only through bounded evaluation recorders | Aggregate analyser snapshots and an unconnected sentence planner could not prove the live synchronization gate. A shared content-free evidence schema now binds three audio runs across both candidate voices and an exact single-versus-sentence pair to cached-step SHA-256, model/voice/browser, fixed detector policy, exact call ceilings, monotonic lifecycle timing, abort/stale identity, first-failure termination, recomputed pause/gap/latency metrics, interruption evidence, and terminal human decisions. Evaluation runners have no product client, fetch, credential, retry, or built-in network dispatcher: an exact owner-approved harness must inject dispatch explicitly. They retain no script text, transcript, RMS value, waveform, audio, or upstream error. This records evidence only; it cannot pace ink, authorize Phase 6C, or displace authoritative `SYNC_MODE=fixed`. |
| ADR-054 | 2026-07-19 | Add a renderer-sampled tangent construction without claiming symbolic calculus | A generic local tangent improves rate-of-change diagrams across calculus, kinematics, and graph interpretation, but a model-authored line or a server-claimed derivative would violate the browser-truth boundary. Schema 1.4 therefore adds `tangent_at(curve,x,length)` only for a prior accepted axes-backed curve at an interior finite data x. The browser derives the line from the same visible sampled polyline, requires locally agreeing directions, and rejects endpoints, off-visible points, branches, degenerate samples, and corners. The backend validates only the closed relation and prior curve reference; no derived coordinates cross the wire. The resolver-policy revision changes, preventing pre- and post-tangent evidence from mixing. |

## Open spike decisions

These must be resolved with measurements, not preference:

1. Server VAD versus semantic VAD for the recording environment.
2. `marin` versus `cedar` for warmth and intelligibility.
3. Remote-audio activity detection versus a calibrated drain guard.
4. Continue-frozen-ink versus replay-current-step on resume.
5. Session-instruction manifest publication latency and timing.
6. Luna lesson quality on the ten-topic rubric; if it fails, a bounded comparison of failed topics on Terra.
7. Direct Realtime image input for student sketches versus the vision-text fallback.
8. Adopt, hybridize, or reject the lazy tldraw renderer after the retained comparison matrix.
9. Whether validated pen-prefix streaming produces enough first-ink latency improvement to justify a producer and product renderer path.

Record each resolution as a new ADR row with evidence in `PROGRESS.md`.
