import { describe, expect, it } from "vitest";
import { requestScratch, ScratchClient } from "./client";

const REQUEST_ID = "783c6081-75a4-4ed2-8be7-4e0f32680a2b";

const VALID_STEP = {
  id: "s1",
  script: "A right triangle with the hypotenuse labeled.",
  ops: [{ op: "text", id: "title", region: "A1", content: "Right triangle" }],
  checkpoint: null,
};

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Chalk-Scratch-Repairs": "0",
      ...headers,
    },
  });
}

function fetchReturning(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}

describe("requestScratch", () => {
  it("decodes a valid one-step card through the standard lesson decoder", async () => {
    const result = await requestScratch({
      apiBaseUrl: "http://localhost:8000",
      clientId: "client",
      request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
      fetchImpl: fetchReturning(
        jsonResponse({ request_id: REQUEST_ID, step: VALID_STEP, sanitized_fields: 0 }),
      ),
    });
    expect(result.lesson.steps).toHaveLength(1);
    expect(result.lesson.steps[0].ops[0].op).toBe("text");
    expect(result.lesson.title).toBe("a labeled right triangle");
    expect(result.repairs).toBe(0);
  });

  it("rejects a mismatched request id", async () => {
    await expect(
      requestScratch({
        apiBaseUrl: "http://localhost:8000",
        clientId: "client",
        request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
        fetchImpl: fetchReturning(
          jsonResponse({ request_id: "other", step: VALID_STEP }),
        ),
      }),
    ).rejects.toThrow(/stale or mismatched/u);
  });

  it("rejects a step the browser decoder does not accept", async () => {
    await expect(
      requestScratch({
        apiBaseUrl: "http://localhost:8000",
        clientId: "client",
        request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
        fetchImpl: fetchReturning(
          jsonResponse({
            request_id: REQUEST_ID,
            step: { ...VALID_STEP, ops: [{ op: "text", id: "bad id", region: "A1", content: "x" }] },
          }),
        ),
      }),
    ).rejects.toThrow(/failed browser validation/u);
  });

  it("rejects a step carrying a checkpoint", async () => {
    await expect(
      requestScratch({
        apiBaseUrl: "http://localhost:8000",
        clientId: "client",
        request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
        fetchImpl: fetchReturning(
          jsonResponse({
            request_id: REQUEST_ID,
            step: {
              ...VALID_STEP,
              checkpoint: { question: "Ready to go on?", expected_gist: "yes" },
            },
          }),
        ),
      }),
    ).rejects.toThrow(/checkpoint/u);
  });

  it("rejects invalid repair metadata", async () => {
    await expect(
      requestScratch({
        apiBaseUrl: "http://localhost:8000",
        clientId: "client",
        request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
        fetchImpl: fetchReturning(
          jsonResponse(
            { request_id: REQUEST_ID, step: VALID_STEP },
            { "X-Chalk-Scratch-Repairs": "7" },
          ),
        ),
      }),
    ).rejects.toThrow(/repair metadata/u);
  });

  it("surfaces HTTP failures without retrying", async () => {
    let calls = 0;
    const failingFetch: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 502 }));
    };
    await expect(
      requestScratch({
        apiBaseUrl: "http://localhost:8000",
        clientId: "client",
        request: { requestId: REQUEST_ID, description: "a labeled right triangle" },
        fetchImpl: failingFetch,
      }),
    ).rejects.toThrow(/HTTP 502/u);
    expect(calls).toBe(1);
  });
});

describe("ScratchClient", () => {
  it("aborts a superseded request", async () => {
    let firstSignal: AbortSignal | undefined;
    const hangingFetch: typeof fetch = (_input, init) => {
      firstSignal ??= init?.signal ?? undefined;
      return new Promise(() => {});
    };
    const client = new ScratchClient("http://localhost:8000", "client", hangingFetch);
    void client.start({ requestId: REQUEST_ID, description: "first" }).catch(() => {});
    client.cancel();
    expect(firstSignal?.aborted).toBe(true);
  });
});
