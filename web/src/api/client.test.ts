import { describe, expect, it, vi } from "vitest";
import { classifyResponse, createApiClient } from "./client.ts";

const RESPONSE_200 = {
  answer: "ok",
  trace: [{ type: "answer", content: "ok" }],
  metrics: { llmCalls: 1, latencyMs: 5 },
  stoppedReason: "completed",
  conversationId: "c1",
  requestId: "r1",
};

const RESPONSE_202 = {
  status: "pending_approval",
  requestId: "r2",
  conversationId: "c1",
  approval: { id: "ap-1", tool: "resolve_incident", args: { incidentId: "INC-42" }, description: "Resolver INC-42" },
};

const noHeaders = { get: () => null };
const idHeader = (id: string) => ({ get: (n: string) => (n.toLowerCase() === "x-request-id" ? id : null) });

describe("classifyResponse", () => {
  it("200 → answered", () => {
    const outcome = classifyResponse(200, noHeaders, RESPONSE_200);
    expect(outcome.kind).toBe("answered");
  });

  it("202 → pending", () => {
    const outcome = classifyResponse(202, noHeaders, RESPONSE_202);
    expect(outcome).toMatchObject({ kind: "pending", accepted: { approval: { id: "ap-1" } } });
  });

  it("4xx/5xx → api-error with the requestId from the body", () => {
    const body = { error: { code: "timeout", message: "x" }, requestId: "r9" };
    expect(classifyResponse(504, idHeader("hdr"), body)).toMatchObject({
      kind: "api-error",
      status: 504,
      requestId: "r9",
      body: { error: { code: "timeout" } },
    });
  });

  it("api-error falls back to X-Request-Id when the body has none", () => {
    const body = { error: { code: "internal", message: "x" } };
    expect(classifyResponse(500, idHeader("hdr"), body)).toMatchObject({ kind: "api-error", requestId: "hdr" });
  });

  it.each([
    ["200 without answer", 200, { ...RESPONSE_200, answer: undefined }],
    ["202 without approval", 202, { ...RESPONSE_202, approval: undefined }],
    ["302", 302, {}],
    ["error body without code", 500, { error: { message: "x" } }],
    ["a non-object body", 200, "texto"],
  ])("%s → malformed", (_name, status, body) => {
    expect(classifyResponse(status, noHeaders, body).kind).toBe("malformed");
  });

  it("keeps the unknown trace events in the answered result", () => {
    const outcome = classifyResponse(200, noHeaders, { ...RESPONSE_200, trace: [{ type: "vote" }] });
    expect(outcome.kind === "answered" && outcome.result.trace).toEqual([{ type: "vote" }]);
  });

  it("recognises a denial only when allowed", () => {
    const denied = { status: "denied", approvalId: "ap-1", conversationId: "c1", requestId: "r3" };
    expect(classifyResponse(200, noHeaders, denied, { allowDenied: true }).kind).toBe("denied");
    expect(classifyResponse(200, noHeaders, denied).kind).toBe("malformed");
  });
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("createApiClient", () => {
  it("POSTs only message and conversationId to {base}/chat", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, RESPONSE_200));
    const client = createApiClient({ baseUrl: "https://h/api/", fetch: fetchMock as unknown as typeof fetch });

    const outcome = await client.sendChat({ message: "oi", conversationId: "c1" });

    expect(outcome.kind).toBe("answered");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://h/api/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ message: "oi", conversationId: "c1" });
  });

  it("omits conversationId on a new conversation", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, RESPONSE_200));
    const client = createApiClient({ baseUrl: "http://h", fetch: fetchMock as unknown as typeof fetch });
    await client.sendChat({ message: "oi" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ message: "oi" });
  });

  it("POSTs the decision to {base}/approvals/{id}", async () => {
    const denied = { status: "denied", approvalId: "ap 1", conversationId: "c1", requestId: "r3" };
    const fetchMock = vi.fn(async () => jsonResponse(200, denied));
    const client = createApiClient({ baseUrl: "http://h", fetch: fetchMock as unknown as typeof fetch });

    const outcome = await client.decide("ap 1", "deny");

    expect(outcome.kind).toBe("denied");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h/approvals/ap%201");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "deny" });
  });

  it("network failure → unreachable (network) with the URL tried", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = createApiClient({ baseUrl: "http://h:1", fetch: fetchMock as unknown as typeof fetch });
    expect(await client.sendChat({ message: "oi" })).toEqual({
      kind: "unreachable",
      url: "http://h:1",
      reason: "network",
    });
  });

  it("client deadline → unreachable (timeout)", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = createApiClient({ baseUrl: "http://h", fetch: fetchMock as unknown as typeof fetch, timeoutMs: 20 });
    expect(await client.sendChat({ message: "oi" })).toMatchObject({ kind: "unreachable", reason: "timeout" });
  });

  it("invalid JSON → malformed", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>", { status: 200 }));
    const client = createApiClient({ baseUrl: "http://h", fetch: fetchMock as unknown as typeof fetch });
    expect(await client.sendChat({ message: "oi" })).toMatchObject({ kind: "malformed", status: 200 });
  });
});
