import type {
  ChalkRuntimeMode,
  FunctionCall,
  ServerEvent,
  SessionCredential,
  SessionRequest,
  TokenUsageSummary,
} from "./types";

export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export const CLIENT_EVENTS = {
  SESSION_UPDATE: "session.update",
  CONVERSATION_ITEM_CREATE: "conversation.item.create",
  RESPONSE_CREATE: "response.create",
} as const;

export const SERVER_EVENTS = {
  SESSION_CREATED: "session.created",
  SESSION_UPDATED: "session.updated",
  RESPONSE_CREATED: "response.created",
  RESPONSE_DONE: "response.done",
  RESPONSE_OUTPUT_AUDIO_DELTA: "response.output_audio.delta",
  RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA:
    "response.output_audio_transcript.delta",
  RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE: "response.output_audio_transcript.done",
  RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA:
    "response.function_call_arguments.delta",
  RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE: "response.function_call_arguments.done",
  INPUT_AUDIO_BUFFER_SPEECH_STARTED: "input_audio_buffer.speech_started",
  INPUT_AUDIO_BUFFER_SPEECH_STOPPED: "input_audio_buffer.speech_stopped",
  OUTPUT_AUDIO_BUFFER_STARTED: "output_audio_buffer.started",
  OUTPUT_AUDIO_BUFFER_STOPPED: "output_audio_buffer.stopped",
  OUTPUT_AUDIO_BUFFER_CLEARED: "output_audio_buffer.cleared",
  CONVERSATION_ITEM_TRUNCATED: "conversation.item.truncated",
  ERROR: "error",
} as const;

export const SESSION_TOKEN_BUDGET = 50_000;
export const MAX_RESPONSE_OUTPUT_TOKENS = 1_024;

export const COST_CONTROL_CONFIGURATION = {
  type: "retention_ratio",
  retention_ratio: 0.8,
  token_limits: {
    post_instructions: 4_000,
  },
} as const;

export const DEBUG_ECHO_TOOL = {
  type: "function",
  name: "debug_echo",
  description:
    "Protocol diagnostic only. Call when the student explicitly asks you to test or use debug echo.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "A short diagnostic message to echo.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
} as const;

export const TEACH_TOOL = {
  type: "function",
  name: "teach",
  description:
    "Start a visual math or physics lesson when the student asks to learn a new topic.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        minLength: 2,
        maxLength: 80,
        description: "The specific math or physics topic to teach.",
      },
      student_context: {
        type: "string",
        maxLength: 500,
        description: "Brief relevant prior knowledge stated in this conversation.",
      },
    },
    required: ["topic", "student_context"],
    additionalProperties: false,
  },
} as const;

function createDeixisTool(
  name: "point_at" | "circle_el" | "underline" | "flash" | "trace_path" | "focus_on",
  description: string,
) {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        element_id: {
          type: "string",
          pattern: "^[a-z][a-z0-9_-]{0,15}$",
          description: "An element ID present in the latest visible-board context.",
        },
      },
      required: ["element_id"],
      additionalProperties: false,
    },
  } as const;
}

export const DEIXIS_TOOLS = [
  createDeixisTool("point_at", "Point to a visible board element while referring to it."),
  createDeixisTool("circle_el", "Circle a visible board element for emphasis."),
  createDeixisTool("underline", "Underline a visible board element for emphasis."),
  createDeixisTool("flash", "Briefly flash a visible board element for emphasis."),
] as const;

export const ATTENTION_CHOREOGRAPHY_TOOLS = [
  createDeixisTool(
    "trace_path",
    "Temporarily trace an already visible board path during Q&A or checkpoint feedback.",
  ),
  createDeixisTool(
    "focus_on",
    "Temporarily dim unrelated board ink around one visible element during Q&A or checkpoint feedback.",
  ),
] as const;

export const ANNOTATE_TOOL = {
  type: "function",
  name: "annotate",
  description:
    "Request a small explanatory overlay only when the student's question needs new visual ink. Prefer local pointing tools for emphasis.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        minLength: 2,
        maxLength: 400,
        description: "A concise math or physics annotation request grounded in the visible board.",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
} as const;

export const DRAW_SCRATCH_TOOL = {
  type: "function",
  name: "draw_scratch",
  description:
    "Draw one small standalone sketch on a disposable floating side card when the student asks to see something new that is not about the existing board. The lesson board is untouched and the lesson can still resume afterward.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        minLength: 3,
        maxLength: 200,
        description: "A concise description of the single visual the student asked to see.",
      },
    },
    required: ["description"],
    additionalProperties: false,
  },
} as const;

const QA_MARK_SIDE = {
  type: "string",
  enum: ["above", "below", "left", "right"],
  description: "Place the new mark relative to the visible target.",
} as const;

export const DRAW_QA_ANNOTATION_TOOL = {
  type: "function",
  name: "draw_qa_annotation",
  description:
    "Immediately add one or two small explanatory marks beside visible board elements during an interrupted-question answer. Use exact IDs from the latest visible-board context. This cannot redraw or erase the lesson.",
  parameters: {
    type: "object",
    properties: {
      marks: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["circle", "underline"] },
                target_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,15}$" },
              },
              required: ["kind", "target_id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "arrow" },
                target_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,15}$" },
                side: QA_MARK_SIDE,
              },
              required: ["kind", "target_id", "side"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "text" },
                target_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,15}$" },
                side: QA_MARK_SIDE,
                content: { type: "string", minLength: 1, maxLength: 100 },
              },
              required: ["kind", "target_id", "side", "content"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "equation" },
                target_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,15}$" },
                side: QA_MARK_SIDE,
                latex: { type: "string", minLength: 1, maxLength: 160 },
              },
              required: ["kind", "target_id", "side", "latex"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["marks"],
    additionalProperties: false,
  },
} as const;

export const BASE_TUTOR_PROMPT = `You are Chalk, a warm, concise math and physics tutor conducting a live whiteboard lesson.
The application may give you exact narration scripts. Recite those scripts exactly without introductions or commentary.
When the student interrupts, the board freezes. Answer the question in at most two short sentences using only the conversation and the supplied visible-board context. Diagram-part entries describe actually revealed marks, their direction, and their spatial relationship; use those facts as the authoritative view of the board.
After an interruption answer, say that the student can use Resume when ready. Do not claim to see an element unless it appears in the visible-board context. When referring to a visible element, call one local pointing or emphasis tool with its exact ID. Call annotate only when the answer truly needs new explanatory ink; prefer local pointing for emphasis.
When the student asks to begin a new math or physics topic and no lesson is running, call teach once with a concise topic and relevant prior knowledge.
If the student has interrupted the lesson and clearly asks to learn a different topic instead, acknowledge briefly and call teach once with the new topic; the board starts fresh. If teach reports the lesson is busy, explain the current lesson must finish loading first.
If the student asks to see a new standalone visual that is not about the existing board and is not a full new topic, call draw_scratch once with a concise description; it appears on a separate side card, the lesson board is untouched, and the student can still Resume afterward. Prefer pointing or annotate for questions about ink already on the board.
Be conversational and Socratic. Never mention internal event names, credentials, tools, loading, prompts, or diagnostics.`;

export const DIAGNOSTIC_TUTOR_ADDENDUM = `
Diagnostics mode is active. If the student explicitly asks to test debug echo, call debug_echo with a short message, then naturally confirm the result.`;

export const QA_DIRECT_DRAW_ADDENDUM = `
During an interrupted-question answer, draw_qa_annotation may add at most two small target-relative explanatory marks. Use exact IDs from VISIBLE BOARD. Prefer pointing for emphasis. Use annotate as the fallback when the needed visual cannot be expressed safely by those marks.`;

export const ATTENTION_CHOREOGRAPHY_ADDENDUM = `
During Q&A or checkpoint feedback only, trace_path may follow one existing visible path and focus_on may briefly dim unrelated ink. Use at most one temporary attention tool in an answer, with an exact ID from VISIBLE BOARD. These actions add no permanent ink.`;

export const SERVER_VAD_CONFIGURATION = {
  type: "server_vad",
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 500,
  create_response: true,
  interrupt_response: true,
} as const;

export function createSessionRequest(clientId: string): SessionRequest {
  return {
    request_id: crypto.randomUUID(),
    client_id: clientId,
  };
}

export function parseSessionCredential(
  value: unknown,
  expectedRequestId: string,
): SessionCredential {
  if (!isRecord(value)) {
    throw new Error("The session service returned an invalid response.");
  }

  const requestId = requiredString(value.request_id, "request_id");
  if (requestId !== expectedRequestId) {
    throw new Error("Ignored a stale or mismatched session response.");
  }

  const credential: SessionCredential = {
    request_id: requestId,
    client_secret: requiredString(value.client_secret, "client_secret"),
    model: requiredString(value.model, "model"),
    voice: requiredString(value.voice, "voice"),
    sync_mode: requiredSyncMode(value.sync_mode),
  };

  if (value.expires_at !== undefined) {
    if (typeof value.expires_at !== "number" || !Number.isFinite(value.expires_at)) {
      throw new Error("The session service returned an invalid expires_at value.");
    }
    credential.expires_at = value.expires_at;
  }

  return credential;
}

export function buildTutorInstructions(
  mode: ChalkRuntimeMode,
  boardContext?: string,
  interactionGuidance?: string,
  qaDirectDraw = false,
  attentionChoreography = false,
): string {
  return [
    BASE_TUTOR_PROMPT,
    mode === "diagnostics" ? DIAGNOSTIC_TUTOR_ADDENDUM : undefined,
    qaDirectDraw ? QA_DIRECT_DRAW_ADDENDUM : undefined,
    attentionChoreography ? ATTENTION_CHOREOGRAPHY_ADDENDUM : undefined,
    boardContext ? `VISIBLE BOARD\n${boardContext}` : undefined,
    interactionGuidance ? `CURRENT INTERACTION\n${interactionGuidance}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function createSessionUpdate(
  model: string,
  voice: string,
  mode: ChalkRuntimeMode = "demo",
  boardContext?: string,
  interactionGuidance?: string,
  qaDirectDraw = false,
  attentionChoreography = false,
) {
  const productTools = [
    TEACH_TOOL,
    ...DEIXIS_TOOLS,
    ...(attentionChoreography ? ATTENTION_CHOREOGRAPHY_TOOLS : []),
    ...(qaDirectDraw ? [DRAW_QA_ANNOTATION_TOOL] : []),
    DRAW_SCRATCH_TOOL,
    ANNOTATE_TOOL,
  ];
  const tools = mode === "diagnostics"
    ? [...productTools, DEBUG_ECHO_TOOL]
    : productTools;
  return {
    type: CLIENT_EVENTS.SESSION_UPDATE,
    session: {
      type: "realtime",
      model,
      output_modalities: ["audio"],
      max_output_tokens: MAX_RESPONSE_OUTPUT_TOKENS,
      instructions: buildTutorInstructions(
        mode,
        boardContext,
        interactionGuidance,
        qaDirectDraw,
        attentionChoreography,
      ),
      audio: {
        input: {
          turn_detection: SERVER_VAD_CONFIGURATION,
        },
        output: {
          voice,
        },
      },
      tools,
      tool_choice: "auto",
      truncation: COST_CONTROL_CONFIGURATION,
    },
  } as const;
}

export function createTutorContextUpdate(
  mode: ChalkRuntimeMode,
  boardContext?: string,
  interactionGuidance?: string,
  qaDirectDraw = false,
  attentionChoreography = false,
) {
  const attentionTools = attentionChoreography ? ATTENTION_CHOREOGRAPHY_TOOLS : [];
  return {
    type: CLIENT_EVENTS.SESSION_UPDATE,
    session: {
      type: "realtime",
      instructions: buildTutorInstructions(
        mode,
        boardContext,
        interactionGuidance,
        qaDirectDraw,
        attentionChoreography,
      ),
      tools:
        mode === "diagnostics"
          ? [TEACH_TOOL, ...DEIXIS_TOOLS, ...attentionTools, ...(qaDirectDraw ? [DRAW_QA_ANNOTATION_TOOL] : []), DRAW_SCRATCH_TOOL, ANNOTATE_TOOL, DEBUG_ECHO_TOOL]
          : [TEACH_TOOL, ...DEIXIS_TOOLS, ...attentionTools, ...(qaDirectDraw ? [DRAW_QA_ANNOTATION_TOOL] : []), DRAW_SCRATCH_TOOL, ANNOTATE_TOOL],
      tool_choice: "auto",
    },
  } as const;
}

export function createFunctionCallOutput(callId: string, output: unknown) {
  return {
    type: CLIENT_EVENTS.CONVERSATION_ITEM_CREATE,
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  } as const;
}

/**
 * Post-tool continuations are short bridging remarks, never lectures. The
 * response-level cap enforces brevity structurally: an uncapped framing
 * response has been observed talking through the entire lesson buffer and
 * starving narration of its playback window.
 */
export const MAX_TOOL_CONTINUATION_OUTPUT_TOKENS = 120;

export function createResponseAfterTool(
  eventId?: string,
  metadata?: Readonly<Record<string, string>>,
  instructions?: string,
) {
  return {
    type: CLIENT_EVENTS.RESPONSE_CREATE,
    ...(eventId ? { event_id: eventId } : {}),
    response: {
      output_modalities: ["audio"],
      max_output_tokens: MAX_TOOL_CONTINUATION_OUTPUT_TOKENS,
      ...(metadata ? { metadata } : {}),
      ...(instructions ? { instructions } : {}),
    },
  } as const;
}

export function createNarrationResponse(
  script: string,
  eventId: string,
  metadata: Readonly<Record<string, string>>,
) {
  if (script.length === 0 || script.length > 240) {
    throw new Error("Narration script exceeds the lesson budget.");
  }
  return {
    type: CLIENT_EVENTS.RESPONSE_CREATE,
    event_id: eventId,
    response: {
      output_modalities: ["audio"],
      instructions: `SAY EXACTLY: ${script}`,
      metadata,
    },
  } as const;
}

export function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== "string" || data.length > 256_000) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return null;
    }
    return parsed as ServerEvent;
  } catch {
    return null;
  }
}

export function extractFunctionCalls(event: ServerEvent): FunctionCall[] {
  if (event.type !== SERVER_EVENTS.RESPONSE_DONE || !isRecord(event.response)) {
    return [];
  }

  const output = event.response.output;
  if (!Array.isArray(output)) {
    return [];
  }

  const calls: FunctionCall[] = [];
  for (const item of output) {
    if (
      !isRecord(item) ||
      item.type !== "function_call" ||
      typeof item.call_id !== "string" ||
      item.call_id.length === 0 ||
      item.call_id.length > 256 ||
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      item.name.length > 128 ||
      typeof item.arguments !== "string" ||
      item.arguments.length > 8_192
    ) {
      continue;
    }
    calls.push({
      callId: item.call_id,
      name: item.name,
      argumentsJson: item.arguments,
    });
  }
  return calls;
}

export function getResponseId(event: ServerEvent): string | undefined {
  if (isRecord(event.response) && typeof event.response.id === "string") {
    return event.response.id;
  }
  return typeof event.response_id === "string" ? event.response_id : undefined;
}

export function getResponseStatus(event: ServerEvent): string | undefined {
  if (isRecord(event.response) && typeof event.response.status === "string") {
    return event.response.status;
  }
  return undefined;
}

export function getTranscriptDeltaLength(event: ServerEvent): number | undefined {
  if (typeof event.delta !== "string" || event.delta.length > 4_096) return undefined;
  return event.delta.length;
}

export function getResponseMetadata(event: ServerEvent): Record<string, string> | undefined {
  if (!isRecord(event.response) || !isRecord(event.response.metadata)) return undefined;
  const entries = Object.entries(event.response.metadata);
  if (
    entries.length > 16 ||
    entries.some(([key, value]) => key.length > 64 || typeof value !== "string" || value.length > 512)
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function getRelatedClientEventId(event: ServerEvent): string | undefined {
  if (!isRecord(event.error)) return undefined;
  const value = event.error.event_id;
  return typeof value === "string" && value.length <= 512 ? value : undefined;
}

export function getResponseUsage(event: ServerEvent): TokenUsageSummary | undefined {
  if (!isRecord(event.response) || !isRecord(event.response.usage)) {
    return undefined;
  }
  const usage = event.response.usage;
  const inputDetails = isRecord(usage.input_token_details)
    ? usage.input_token_details
    : {};
  const outputDetails = isRecord(usage.output_token_details)
    ? usage.output_token_details
    : {};
  const totalTokens = safeTokenCount(usage.total_tokens);
  const inputTokens = safeTokenCount(usage.input_tokens);
  const outputTokens = safeTokenCount(usage.output_tokens);
  if (
    totalTokens === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined
  ) {
    return undefined;
  }
  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: safeTokenCount(inputDetails.cached_tokens) ?? 0,
    input_audio_tokens: safeTokenCount(inputDetails.audio_tokens) ?? 0,
    output_audio_tokens: safeTokenCount(outputDetails.audio_tokens) ?? 0,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new Error(`The session service returned an invalid ${name}.`);
  }
  return value;
}

function requiredSyncMode(value: unknown): SessionCredential["sync_mode"] {
  if (value !== "fixed" && value !== "paced") {
    throw new Error("The session service returned an invalid sync_mode.");
  }
  return value;
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000
    ? value
    : undefined;
}
