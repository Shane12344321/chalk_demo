import {
  getResponseId,
  getResponseStatus,
  getResponseUsage,
  isRecord,
  COST_CONTROL_CONFIGURATION,
  MAX_RESPONSE_OUTPUT_TOKENS,
  SERVER_VAD_CONFIGURATION,
} from "./protocol";
import type {
  InterruptionMarker,
  ServerEvent,
  TraceDirection,
  TraceEntry,
  TraceExportContext,
} from "./types";

const SAFE_METADATA = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_EXPORTED_TRACE_ENTRIES = 500;
const MAX_EXPORTED_INTERRUPTION_MARKERS = 50;

export function eventToTraceEntry(
  event: ServerEvent,
  direction: TraceDirection,
  sequence: number,
  atMs: number,
): TraceEntry {
  const entry: TraceEntry = {
    sequence,
    at_ms: round(atMs),
    direction,
    type: sanitizeTraceIdentifier(event.type) ?? "unknown",
  };

  assign(entry, "event_id", event.event_id);
  assign(entry, "response_id", getResponseId(event));
  assign(entry, "status", getResponseStatus(event));
  assign(entry, "session_id", readNestedId(event, "session"));
  assign(entry, "item_id", readNestedId(event, "item"));
  assign(entry, "call_id", event.call_id);

  const usage = getResponseUsage(event);
  if (usage) {
    entry.total_tokens = usage.total_tokens;
    entry.input_tokens = usage.input_tokens;
    entry.output_tokens = usage.output_tokens;
    entry.cached_input_tokens = usage.cached_input_tokens;
    entry.input_audio_tokens = usage.input_audio_tokens;
    entry.output_audio_tokens = usage.output_audio_tokens;
  }

  if (isRecord(event.error)) {
    assign(entry, "code", event.error.code);
  }

  return entry;
}

export function createLocalTraceEntry(
  type: string,
  sequence: number,
  atMs: number,
  metadata: Pick<
    TraceEntry,
    | "response_id"
    | "call_id"
    | "status"
    | "code"
    | "purpose"
    | "reason"
    | "active"
    | "playback"
    | "in_flight"
  > = {},
): TraceEntry {
  const entry: TraceEntry = {
    sequence,
    at_ms: round(atMs),
    direction: "local",
    type: sanitizeTraceIdentifier(type) ?? "local.unknown",
  };
  assign(entry, "response_id", metadata.response_id);
  assign(entry, "call_id", metadata.call_id);
  assign(entry, "status", metadata.status);
  assign(entry, "code", metadata.code);
  assign(entry, "purpose", metadata.purpose);
  assign(entry, "reason", metadata.reason);
  if (typeof metadata.active === "boolean") entry.active = metadata.active;
  if (typeof metadata.playback === "boolean") entry.playback = metadata.playback;
  if (typeof metadata.in_flight === "boolean") entry.in_flight = metadata.in_flight;
  return entry;
}

export function serializeRedactedTrace(
  trace: TraceEntry[],
  interruptions: InterruptionMarker[],
  context: TraceExportContext = {},
): string {
  return JSON.stringify(
    {
      schema: "chalk.realtime-trace.v1",
      generated_at: new Date().toISOString(),
      privacy: "metadata-only; transcript, audio, tool arguments, and credentials omitted",
      session_configuration: {
        model: sanitizeTraceIdentifier(context.model),
        voice: sanitizeTraceIdentifier(context.voice),
        output_modalities: ["audio"],
        max_output_tokens: MAX_RESPONSE_OUTPUT_TOKENS,
        turn_detection: SERVER_VAD_CONFIGURATION,
        truncation: COST_CONTROL_CONFIGURATION,
        input_transcription: "disabled",
      },
      session_token_budget: boundedInteger(
        context.tokenBudget,
        0,
        1_000_000_000,
      ),
      session_token_usage: sanitizeTokenUsage(context.tokenUsage),
      board_context: {
        visible_manifest_hash: sanitizeManifestHash(context.visibleManifestHash),
        acknowledged_manifest_hash: sanitizeManifestHash(
          context.lastAcknowledgedManifestHash,
        ),
        hashes_match:
          sanitizeManifestHash(context.visibleManifestHash) !== undefined &&
          sanitizeManifestHash(context.visibleManifestHash) ===
            sanitizeManifestHash(context.lastAcknowledgedManifestHash),
        publications: (context.contextPublications ?? []).slice(-32).map((item) => ({
          manifest_hash: sanitizeManifestHash(item.manifest_hash) ?? "invalid",
          latency_ms: boundedNumber(item.latency_ms, 0, 60_000),
        })),
      },
      browser: sanitizeBrowserLabel(context.browser),
      trace: trace
        .slice(-MAX_EXPORTED_TRACE_ENTRIES)
        .map((entry, index) => sanitizeTraceEntry(entry, index)),
      interruptions: interruptions
        .slice(-MAX_EXPORTED_INTERRUPTION_MARKERS)
        .map((marker, index) => sanitizeInterruptionMarker(marker, index)),
    },
    null,
    2,
  );
}

export function sanitizeTraceIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return SAFE_METADATA.test(value) ? value : undefined;
}

function readNestedId(event: ServerEvent, key: string): unknown {
  const nested = event[key];
  return isRecord(nested) ? nested.id : undefined;
}

function assign<K extends keyof TraceEntry>(
  target: TraceEntry,
  key: K,
  value: unknown,
): void {
  const sanitized = sanitizeTraceIdentifier(value);
  if (sanitized !== undefined) {
    (target as unknown as Record<string, unknown>)[key] = sanitized;
  }
}

function sanitizeTraceEntry(entry: TraceEntry, index: number): TraceEntry {
  const sanitized: TraceEntry = {
    sequence: boundedInteger(entry.sequence, index + 1, 1_000_000_000),
    at_ms: boundedNumber(entry.at_ms, 0, 86_400_000),
    direction: ["client", "server", "local"].includes(entry.direction)
      ? entry.direction
      : "local",
    type: sanitizeTraceIdentifier(entry.type) ?? "unknown",
  };
  assign(sanitized, "event_id", entry.event_id);
  assign(sanitized, "session_id", entry.session_id);
  assign(sanitized, "response_id", entry.response_id);
  assign(sanitized, "item_id", entry.item_id);
  assign(sanitized, "call_id", entry.call_id);
  assign(sanitized, "status", entry.status);
  assign(sanitized, "code", entry.code);
  assign(sanitized, "purpose", entry.purpose);
  assign(sanitized, "reason", entry.reason);
  if (typeof entry.active === "boolean") sanitized.active = entry.active;
  if (typeof entry.playback === "boolean") sanitized.playback = entry.playback;
  if (typeof entry.in_flight === "boolean") sanitized.in_flight = entry.in_flight;
  copyTokenCount(sanitized, "total_tokens", entry.total_tokens);
  copyTokenCount(sanitized, "input_tokens", entry.input_tokens);
  copyTokenCount(sanitized, "output_tokens", entry.output_tokens);
  copyTokenCount(
    sanitized,
    "cached_input_tokens",
    entry.cached_input_tokens,
  );
  copyTokenCount(sanitized, "input_audio_tokens", entry.input_audio_tokens);
  copyTokenCount(sanitized, "output_audio_tokens", entry.output_audio_tokens);
  return sanitized;
}

function sanitizeTokenUsage(
  usage: TraceExportContext["tokenUsage"],
): TraceExportContext["tokenUsage"] {
  if (!usage) return undefined;
  return {
    total_tokens: boundedInteger(usage.total_tokens, 0, 1_000_000_000),
    input_tokens: boundedInteger(usage.input_tokens, 0, 1_000_000_000),
    output_tokens: boundedInteger(usage.output_tokens, 0, 1_000_000_000),
    cached_input_tokens: boundedInteger(
      usage.cached_input_tokens,
      0,
      1_000_000_000,
    ),
    input_audio_tokens: boundedInteger(
      usage.input_audio_tokens,
      0,
      1_000_000_000,
    ),
    output_audio_tokens: boundedInteger(
      usage.output_audio_tokens,
      0,
      1_000_000_000,
    ),
  };
}

function copyTokenCount(
  target: TraceEntry,
  key: keyof Pick<
    TraceEntry,
    | "total_tokens"
    | "input_tokens"
    | "output_tokens"
    | "cached_input_tokens"
    | "input_audio_tokens"
    | "output_audio_tokens"
  >,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    target[key] = Math.min(value, 1_000_000_000);
  }
}

function sanitizeInterruptionMarker(
  marker: InterruptionMarker,
  index: number,
): InterruptionMarker {
  const perceived = [
    "not-recorded",
    "immediate",
    "short-tail",
    "long-tail",
  ].includes(marker.perceived_audio_stop)
    ? marker.perceived_audio_stop
    : "not-recorded";
  const settlement = ["pending", "success", "failure"].includes(
    marker.settlement,
  )
    ? marker.settlement
    : "failure";
  const sanitized: InterruptionMarker = {
    id: sanitizeTraceIdentifier(marker.id) ?? `marker_${index + 1}`,
    at_ms: boundedNumber(marker.at_ms, 0, 86_400_000),
    local_handler_stop_latency_ms: boundedNumber(
      marker.local_handler_stop_latency_ms,
      0,
      60_000,
    ),
    perceived_audio_stop: perceived,
    settlement,
    stale_output_events: boundedInteger(marker.stale_output_events, 0, 10_000),
  };
  const responseId = sanitizeTraceIdentifier(marker.response_id);
  if (responseId) sanitized.response_id = responseId;
  if (marker.settled_after_ms !== undefined) {
    sanitized.settled_after_ms = boundedNumber(
      marker.settled_after_ms,
      0,
      86_400_000,
    );
  }
  return sanitized;
}

function sanitizeBrowserLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const printable = value.replace(/[^\x20-\x7E]/g, "");
  return printable.length > 0 ? printable.slice(0, 256) : undefined;
}

function sanitizeManifestHash(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}$/u.test(value) ? value : undefined;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? round(Math.min(maximum, Math.max(minimum, value)))
    : minimum;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(0, value))
    : fallback;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
