import { decodeLesson, type NormalizedLesson } from "../board/decode";

const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_SCRATCH_OPS = 4;

export interface ScratchRequest {
  requestId: string;
  description: string;
}

export interface ScratchResult {
  /** One-step lesson wrapper so the standard board renderer can paint it. */
  lesson: NormalizedLesson;
  repairs: number;
  boardModel?: string;
}

/**
 * Bounded client for the disposable scratch-card endpoint. The response step is
 * re-decoded through the standard lesson decoder against an empty context, so a
 * malformed or over-budget card is rejected here even if the backend accepted it.
 */
export class ScratchClient {
  private active?: { requestId: string; controller: AbortController };

  constructor(
    private readonly apiBaseUrl: string,
    private readonly clientId: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  start(request: ScratchRequest): Promise<ScratchResult> {
    this.cancel();
    const controller = new AbortController();
    this.active = { requestId: request.requestId, controller };
    return requestScratch({
      apiBaseUrl: this.apiBaseUrl,
      clientId: this.clientId,
      request,
      signal: controller.signal,
      fetchImpl: this.fetchImpl,
    })
      .then((result) => {
        if (this.active?.requestId !== request.requestId) {
          throw new DOMException("Stale scratch result.", "AbortError");
        }
        return result;
      })
      .finally(() => {
        if (this.active?.requestId === request.requestId) this.active = undefined;
      });
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }
}

export async function requestScratch(options: {
  apiBaseUrl: string;
  clientId: string;
  request: ScratchRequest;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<ScratchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(`${options.apiBaseUrl.replace(/\/$/u, "")}/scratch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: options.request.requestId,
      client_id: options.clientId,
      description: options.request.description,
    }),
    signal: options.signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Scratch service failed with HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("Scratch service returned an unexpected content type.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Scratch response exceeded its byte budget.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Scratch service returned invalid JSON.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { request_id?: unknown }).request_id !== options.request.requestId
  ) {
    throw new Error("Scratch response is stale or mismatched.");
  }
  const step = (value as { step?: unknown }).step;
  const decoded = decodeLesson({
    schema_version: "1.4",
    title: scratchTitle(options.request.description),
    steps: [step],
  });
  if (!decoded.lesson || decoded.lesson.steps.length !== 1) {
    throw new Error("Scratch step failed browser validation.");
  }
  const ops = decoded.lesson.steps[0].ops;
  if (ops.length === 0 || ops.length > MAX_SCRATCH_OPS) {
    throw new Error("Scratch step is outside the card op budget.");
  }
  if (decoded.lesson.steps[0].checkpoint !== null) {
    throw new Error("Scratch step cannot carry a checkpoint.");
  }
  const repairs = Number(response.headers.get("x-chalk-scratch-repairs") ?? "0");
  if (!Number.isInteger(repairs) || repairs < 0 || repairs > 2) {
    throw new Error("Scratch response contained invalid repair metadata.");
  }
  return {
    lesson: decoded.lesson,
    repairs,
    ...(response.headers.get("x-chalk-board-model")
      ? { boardModel: response.headers.get("x-chalk-board-model")! }
      : {}),
  };
}

function scratchTitle(description: string): string {
  const trimmed = description.trim();
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
}
