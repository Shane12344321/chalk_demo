import {
  createDecodeContext,
  decodeStep,
  type DecodeContext,
  type NormalizedLesson,
  type NormalizedStep,
} from "../board/decode";
import { isLessonStreamEnvelope, lessonStreamSchemaErrors } from "./schema";
import type {
  Error as LessonStreamErrorEnvelope,
  InkDelta as LessonStreamInkDeltaEnvelope,
  LessonStreamEnvelope,
  LessonStep,
  UpstreamError as LessonStreamUpstreamError,
} from "./stream.generated";
import type { LessonPlan } from "./lessonPlan.generated";
import {
  recoveryEvidenceFromDecode,
  type RecoveryEvidence,
} from "../board/failureRecovery";

type ServerErrorCode = LessonStreamErrorEnvelope["code"];
type UpstreamReason = NonNullable<LessonStreamUpstreamError["upstream_reason"]>;
type FailureOrigin = NonNullable<LessonStreamErrorEnvelope["failure_origin"]>;

const MAX_ENVELOPE_BYTES = 24 * 1024;
const MAX_STREAM_BYTES = 256 * 1024;

export interface LessonStreamRequest {
  requestId: string;
  clientId: string;
  topic: string;
  studentContext?: string;
  boardState?: string;
  generationMode?: "one_shot" | "resolved_stepwise";
}

export interface LessonStreamProgress {
  requestId: string;
  title: string;
  steps: NormalizedStep[];
  complete: boolean;
  warnings: number;
  browserDroppedSteps: number;
  sanitizedSteps: number;
  sanitizedFields: number;
  plan?: LessonPlan;
  continuationAvailable?: boolean;
  continuationReceipt?: string;
  boardModel?: string;
  boardReasoningEffort?: string;
  boardPromptSha256?: string;
  repairPromptSha256?: string;
  continuationPromptSha256?: string;
  configurationSha256?: string;
  recoveryEvidence: RecoveryEvidence[];
  receiptPrefix: Array<LessonStep | NormalizedStep>;
}

export interface LessonStreamResult extends LessonStreamProgress {
  lesson: NormalizedLesson;
  repairs: number;
  droppedSteps: number;
  partial: boolean;
  errorCode?: ServerErrorCode;
  upstreamReason?: UpstreamReason;
  failureOrigin?: FailureOrigin;
  boardModel?: string;
  boardReasoningEffort?: string;
  boardPromptSha256?: string;
  repairPromptSha256?: string;
}

export interface StreamLessonOptions {
  apiBaseUrl: string;
  request: LessonStreamRequest;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: LessonStreamProgress) => void;
  /** Experimental: ignored unless the caller has registered the accepted op header. */
  onInkDelta?: (delta: LessonStreamInkDeltaEnvelope) => void;
}

export class LessonStreamClient {
  private active?: { requestId: string; controller: AbortController };

  constructor(
    private readonly apiBaseUrl: string,
    private readonly clientId: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  start(
    request: Omit<LessonStreamRequest, "clientId">,
    onProgress?: (progress: LessonStreamProgress) => void,
  ): Promise<LessonStreamResult> {
    this.cancel();
    const controller = new AbortController();
    const active = { requestId: request.requestId, controller };
    this.active = active;
    return streamLesson({
      apiBaseUrl: this.apiBaseUrl,
      request: { ...request, clientId: this.clientId },
      signal: controller.signal,
      fetchImpl: this.fetchImpl,
      onProgress: (progress) => {
        if (this.active?.requestId === progress.requestId) onProgress?.(progress);
      },
    }).then((result) => {
      if (this.active !== active || controller.signal.aborted) {
        throw new DOMException("Lesson generation was superseded.", "AbortError");
      }
      return result;
    }).catch((error: unknown) => {
      if (this.active !== active || controller.signal.aborted) {
        throw new DOMException("Lesson generation was superseded.", "AbortError");
      }
      throw error;
    }).finally(() => {
      if (this.active === active) this.active = undefined;
    });
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }
}

export class LessonStreamError extends Error {
  constructor(
    message: string,
    readonly code:
      | "http_error"
      | "missing_body"
      | "invalid_envelope"
      | "invalid_sequence"
      | "server_error"
      | "truncated_stream"
      | "invalid_lesson",
    readonly upstreamReason?: UpstreamReason,
    readonly failureOrigin?: FailureOrigin,
    readonly repairAttempts = 0,
  ) {
    super(message);
  }
}

export async function streamLesson(options: StreamLessonOptions): Promise<LessonStreamResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(`${options.apiBaseUrl.replace(/\/$/u, "")}/lesson`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: options.request.requestId,
      client_id: options.request.clientId,
      topic: options.request.topic,
      student_context: options.request.studentContext ?? "",
      board_state: options.request.boardState ?? "",
      generation_mode: options.request.generationMode ?? "one_shot",
    }),
    signal: options.signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new LessonStreamError(`Lesson service failed with HTTP ${response.status}.`, "http_error");
  }
  if (!response.body) {
    throw new LessonStreamError("Lesson service returned no readable stream.", "missing_body");
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/x-ndjson")) {
    throw new LessonStreamError("Lesson service returned an unexpected content type.", "http_error");
  }

  const assembler = new LessonStreamAssembler(
    options.request.requestId,
    options.onProgress,
    responseMetadata(response.headers),
    options.onInkDelta,
  );
  const parser = new NdjsonParser();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of parser.feed(value)) assembler.accept(parseEnvelope(line));
    }
    const finalLine = parser.finish();
    if (finalLine !== undefined) {
      // A final line without a newline is valid only if it is one complete envelope.
      assembler.accept(parseEnvelope(finalLine));
    }
    return assembler.finish();
  } finally {
    reader.releaseLock();
  }
}

export function decodeLessonNdjson(value: string): LessonStreamResult {
  const parser = new NdjsonParser();
  const lines = parser.feed(new TextEncoder().encode(value));
  const finalLine = parser.finish();
  if (finalLine !== undefined) lines.push(finalLine);
  const envelopes = lines.map(parseEnvelope);
  const first = envelopes[0];
  if (!first || first.type !== "lesson.started") {
    throw new LessonStreamError("Captured lesson omitted its start envelope.", "invalid_sequence");
  }
  if (envelopes.some((envelope) => envelope.request_id !== first.request_id)) {
    throw new LessonStreamError("Captured lesson mixes request IDs.", "invalid_sequence");
  }
  const assembler = new LessonStreamAssembler(first.request_id);
  for (const envelope of envelopes) assembler.accept(envelope);
  return assembler.finish();
}

export class NdjsonParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private observedBytes = 0;

  feed(chunk: Uint8Array): string[] {
    this.observedBytes += chunk.byteLength;
    if (this.observedBytes > MAX_STREAM_BYTES) {
      throw new LessonStreamError("Lesson stream exceeded its byte budget.", "invalid_envelope");
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  finish(): string | undefined {
    this.buffer += this.decoder.decode();
    const lines = this.drain();
    if (lines.length > 0) {
      // drain() can only produce lines terminated by a newline. Callers should
      // receive those from feed(), so this protects against misuse.
      throw new LessonStreamError("Unexpected buffered NDJSON lines.", "invalid_sequence");
    }
    const finalLine = this.buffer.trim();
    this.buffer = "";
    if (!finalLine) return undefined;
    assertEnvelopeBudget(finalLine);
    return finalLine;
  }

  private drain(): string[] {
    const lines: string[] = [];
    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      assertEnvelopeBudget(line);
      lines.push(line);
    }
    if (new TextEncoder().encode(this.buffer).byteLength > MAX_ENVELOPE_BYTES) {
      throw new LessonStreamError("Lesson envelope exceeded its byte budget.", "invalid_envelope");
    }
    return lines;
  }
}

class LessonStreamAssembler {
  private title?: string;
  private steps: NormalizedStep[] = [];
  private warnings = 0;
  private serverStepEnvelopes = 0;
  private browserDroppedSteps = 0;
  private sanitizedSteps = 0;
  private sanitizedFields = 0;
  private plan?: LessonPlan;
  private readonly decodeContext: DecodeContext = createDecodeContext();
  private terminal?: Extract<LessonStreamEnvelope, { type: "lesson.done" }>;
  private serverErrorCode?: ServerErrorCode;
  private serverErrorReason?: UpstreamReason;
  private serverErrorOrigin?: FailureOrigin;
  private serverRepairAttempts = 0;
  private readonly recoveryEvidence = new Map<string, RecoveryEvidence>();
  private readonly receiptPrefix: LessonStep[] = [];

  constructor(
    private readonly expectedRequestId: string,
    private readonly onProgress?: (progress: LessonStreamProgress) => void,
    private readonly metadata: {
      boardModel?: string;
      boardReasoningEffort?: string;
      boardPromptSha256?: string;
      repairPromptSha256?: string;
      continuationPromptSha256?: string;
      configurationSha256?: string;
    } = {},
    private readonly onInkDelta?: (delta: LessonStreamInkDeltaEnvelope) => void,
  ) {}

  accept(envelope: LessonStreamEnvelope): void {
    if (envelope.request_id !== this.expectedRequestId) return;
    if (this.terminal || this.serverErrorCode) {
      throw new LessonStreamError("Lesson stream continued after completion.", "invalid_sequence");
    }
    if (envelope.type === "lesson.started") {
      if (this.title !== undefined || this.steps.length > 0) {
        throw new LessonStreamError("Lesson stream started more than once.", "invalid_sequence");
      }
      this.title = envelope.title;
      this.emit(false);
      return;
    }
    if (!this.title) {
      throw new LessonStreamError("Lesson stream omitted its start envelope.", "invalid_sequence");
    }
    if (envelope.type === "lesson.plan") {
      if (this.plan || this.steps.length > 0) {
        throw new LessonStreamError("Lesson plan arrived after drawing steps.", "invalid_sequence");
      }
      this.plan = envelope.plan;
      this.emit(false);
      return;
    }
    if (envelope.type === "lesson.ink_delta") {
      this.onInkDelta?.(envelope);
      return;
    }
    if (envelope.type === "lesson.warning") {
      this.warnings += 1;
      if (envelope.code === "step_sanitized") {
        this.sanitizedSteps += 1;
        this.sanitizedFields += envelope.correction_count;
      }
      this.emit(false);
      return;
    }
    if (envelope.type === "lesson.error") {
      const upstreamReason =
        "upstream_reason" in envelope ? envelope.upstream_reason : undefined;
      const failureOrigin = envelope.failure_origin;
      const repairAttempts = envelope.repair_attempts ?? 0;
      if (this.steps.length === 0) {
        throw new LessonStreamError(
          `Live lesson generation failed: ${envelope.code}.`,
          "server_error",
          upstreamReason,
          failureOrigin,
          repairAttempts,
        );
      }
      this.serverErrorCode = envelope.code;
      this.serverErrorReason = upstreamReason;
      this.serverErrorOrigin = failureOrigin;
      this.serverRepairAttempts = repairAttempts;
      this.emit(true);
      return;
    }
    if (envelope.type === "lesson.step") {
      // A step the browser rejects costs that step, never the accepted prefix.
      // The server remains the repair authority; the browser only drops.
      this.serverStepEnvelopes += 1;
      this.receiptPrefix.push(envelope.step);
      const decoded = decodeStep(envelope.step, this.decodeContext);
      this.warnings += decoded.warnings.length;
      for (const evidence of recoveryEvidenceFromDecode(
        this.expectedRequestId,
        envelope.step,
        decoded.warnings,
      )) {
        this.recoveryEvidence.set(evidence.findingId, evidence);
      }
      if (decoded.step) {
        this.steps.push(decoded.step);
      } else {
        this.browserDroppedSteps += 1;
      }
      this.emit(false);
      return;
    }
    if (envelope.type === "lesson.done") {
      if (envelope.accepted_steps !== this.serverStepEnvelopes || this.serverStepEnvelopes === 0) {
        throw new LessonStreamError("Lesson completion counts do not match accepted steps.", "invalid_sequence");
      }
      const hasSanitizedSteps = envelope.sanitized_steps !== undefined;
      const hasSanitizedFields = envelope.sanitized_fields !== undefined;
      if (
        hasSanitizedSteps !== hasSanitizedFields ||
        (hasSanitizedSteps && envelope.sanitized_steps !== this.sanitizedSteps) ||
        (hasSanitizedFields && envelope.sanitized_fields !== this.sanitizedFields)
      ) {
        throw new LessonStreamError(
          "Lesson completion counts do not match sanitization warnings.",
          "invalid_sequence",
        );
      }
      if (
        envelope.continuation_available === true &&
        typeof envelope.continuation_receipt !== "string"
      ) {
        throw new LessonStreamError(
          "Continuable lesson completion omitted its authenticated receipt.",
          "invalid_sequence",
        );
      }
      this.terminal = envelope;
      this.emit(!envelope.continuation_available);
    }
  }

  finish(): LessonStreamResult {
    if (!this.title || (!this.terminal && !this.serverErrorCode)) {
      throw new LessonStreamError("Lesson stream ended before a valid completion envelope.", "truncated_stream");
    }
    if (this.steps.length === 0) {
      throw new LessonStreamError("No streamed step survived browser validation.", "invalid_lesson");
    }
    return {
      requestId: this.expectedRequestId,
      title: this.title,
      steps: this.steps,
      complete: !this.terminal?.continuation_available,
      warnings: this.warnings,
      browserDroppedSteps: this.browserDroppedSteps,
      sanitizedSteps: this.sanitizedSteps,
      sanitizedFields: this.sanitizedFields,
      lesson: { schemaVersion: "1.5", title: this.title, steps: this.steps },
      repairs: this.terminal?.repairs ?? this.serverRepairAttempts,
      droppedSteps: this.terminal?.dropped_steps ?? 0,
      partial: this.serverErrorCode !== undefined,
      recoveryEvidence: [...this.recoveryEvidence.values()],
      receiptPrefix: [...this.receiptPrefix],
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.terminal?.continuation_available
        ? {
          continuationAvailable: true,
          continuationReceipt: this.terminal.continuation_receipt,
        }
        : {}),
      ...this.metadata,
      ...(this.serverErrorCode ? { errorCode: this.serverErrorCode } : {}),
      ...(this.serverErrorReason ? { upstreamReason: this.serverErrorReason } : {}),
      ...(this.serverErrorOrigin ? { failureOrigin: this.serverErrorOrigin } : {}),
    };
  }

  private emit(complete: boolean): void {
    if (!this.title) return;
    this.onProgress?.({
      requestId: this.expectedRequestId,
      title: this.title,
      steps: [...this.steps],
      complete,
      warnings: this.warnings,
      browserDroppedSteps: this.browserDroppedSteps,
      sanitizedSteps: this.sanitizedSteps,
      sanitizedFields: this.sanitizedFields,
      recoveryEvidence: [...this.recoveryEvidence.values()],
      receiptPrefix: [...this.receiptPrefix],
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.terminal?.continuation_available
        ? {
          continuationAvailable: true,
          continuationReceipt: this.terminal.continuation_receipt,
        }
        : {}),
      ...this.metadata,
    });
  }
}

function responseMetadata(headers: Headers): {
  boardModel?: string;
  boardReasoningEffort?: string;
  boardPromptSha256?: string;
  repairPromptSha256?: string;
  continuationPromptSha256?: string;
  configurationSha256?: string;
} {
  const boardModel = boundedHeader(headers.get("x-chalk-board-model"), 40);
  const boardReasoningEffort = boundedHeader(
    headers.get("x-chalk-board-reasoning-effort"),
    8,
  );
  const boardPromptSha256 = sha256Header(headers.get("x-chalk-board-prompt-sha256"));
  const repairPromptSha256 = sha256Header(headers.get("x-chalk-repair-prompt-sha256"));
  const continuationPromptSha256 = sha256Header(
    headers.get("x-chalk-continuation-prompt-sha256"),
  );
  const configurationSha256 = sha256Header(headers.get("x-chalk-configuration-sha256"));
  return {
    ...(boardModel ? { boardModel } : {}),
    ...(boardReasoningEffort ? { boardReasoningEffort } : {}),
    ...(boardPromptSha256 ? { boardPromptSha256 } : {}),
    ...(repairPromptSha256 ? { repairPromptSha256 } : {}),
    ...(continuationPromptSha256 ? { continuationPromptSha256 } : {}),
    ...(configurationSha256 ? { configurationSha256 } : {}),
  };
}

function boundedHeader(value: string | null, maxLength: number): string | undefined {
  if (!value || value.length > maxLength || /[^a-zA-Z0-9._-]/u.test(value)) return undefined;
  return value;
}

function sha256Header(value: string | null): string | undefined {
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function parseEnvelope(line: string): LessonStreamEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new LessonStreamError("Lesson stream contained incomplete JSON.", "invalid_envelope");
  }
  if (!isLessonStreamEnvelope(parsed)) {
    const detail = lessonStreamSchemaErrors().join("; ");
    throw new LessonStreamError(`Lesson stream envelope failed validation: ${detail}`, "invalid_envelope");
  }
  return parsed;
}

function assertEnvelopeBudget(line: string): void {
  if (new TextEncoder().encode(line).byteLength > MAX_ENVELOPE_BYTES) {
    throw new LessonStreamError("Lesson envelope exceeded its byte budget.", "invalid_envelope");
  }
}
