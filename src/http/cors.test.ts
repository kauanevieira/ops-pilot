import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CORS_ORIGINS, corsDecision, parseCorsOrigins } from "./cors.ts";

const ALLOW = ["http://localhost:5173", "https://kauane.dev"];

describe("parseCorsOrigins (FR-024)", () => {
  it("defaults to the war room's dev origin when unset or blank", () => {
    assert.deepEqual(parseCorsOrigins(undefined), DEFAULT_CORS_ORIGINS);
    assert.deepEqual(parseCorsOrigins(""), DEFAULT_CORS_ORIGINS);
    assert.deepEqual(parseCorsOrigins("   "), DEFAULT_CORS_ORIGINS);
    assert.deepEqual(DEFAULT_CORS_ORIGINS, ["http://localhost:5173"]);
  });

  it("accepts a comma-separated list, ignoring spaces, and normalizes each origin", () => {
    assert.deepEqual(parseCorsOrigins(" http://localhost:5173 , https://kauane.dev/ "), [
      "http://localhost:5173",
      "https://kauane.dev",
    ]);
  });

  it("rejects an item that is not an origin, naming the item", () => {
    for (const bad of [
      "nao-e-url",
      "ftp://host",
      "http://host/caminho",
      "http://host?x=1",
      "http://host#frag",
      "http://a.com,,http://b.com",
      ",",
    ]) {
      assert.throws(() => parseCorsOrigins(bad), /OPSPILOT_CORS_ORIGINS/, bad);
    }
    assert.throws(() => parseCorsOrigins("http://ok.com,nao-e-url"), /nao-e-url/);
  });
});

describe("corsDecision (contracts/cors.md)", () => {
  it("CO1: no Origin → no headers, never ends the response", () => {
    assert.deepEqual(corsDecision({ method: "POST" }, ALLOW), { headers: {}, end: false });
    assert.deepEqual(corsDecision({ method: "OPTIONS", requestMethod: "POST" }, ALLOW), { headers: {}, end: false });
  });

  it("an allowed origin on a normal request gets Allow-Origin, Expose-Headers and Vary", () => {
    const decision = corsDecision({ origin: "http://localhost:5173", method: "POST" }, ALLOW);
    assert.equal(decision.end, false);
    assert.deepEqual(decision.headers, {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Expose-Headers": "X-Request-Id",
      Vary: "Origin",
    });
  });

  it("a denied origin on a normal request gets only Vary", () => {
    const decision = corsDecision({ origin: "https://evil.example", method: "POST" }, ALLOW);
    assert.deepEqual(decision, { headers: { Vary: "Origin" }, end: false });
  });

  it("an allowed preflight ends with 204 and the allow headers", () => {
    const decision = corsDecision(
      { origin: "https://kauane.dev", method: "OPTIONS", requestMethod: "POST" },
      ALLOW,
    );
    assert.equal(decision.end, true);
    assert.deepEqual(decision.headers, {
      "Access-Control-Allow-Origin": "https://kauane.dev",
      "Access-Control-Expose-Headers": "X-Request-Id",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
  });

  it("a denied preflight ends, with no Access-Control-* header", () => {
    const decision = corsDecision(
      { origin: "https://evil.example", method: "OPTIONS", requestMethod: "POST" },
      ALLOW,
    );
    assert.equal(decision.end, true);
    assert.deepEqual(Object.keys(decision.headers), ["Vary"]);
  });

  it("an OPTIONS without Access-Control-Request-Method is not a preflight", () => {
    const decision = corsDecision({ origin: "http://localhost:5173", method: "OPTIONS" }, ALLOW);
    assert.equal(decision.end, false);
  });

  it("CO3: matches exactly — no wildcard, no suffix, no scheme or port confusion", () => {
    for (const origin of [
      "http://localhost:5173.evil.com",
      "http://localhost:5174",
      "https://localhost:5173",
      "http://localhost",
      "null",
      "*",
    ]) {
      const decision = corsDecision({ origin, method: "POST" }, ALLOW);
      assert.equal("Access-Control-Allow-Origin" in decision.headers, false, origin);
    }
  });

  it("CO4: never sends Allow-Credentials", () => {
    const decision = corsDecision(
      { origin: "http://localhost:5173", method: "OPTIONS", requestMethod: "POST" },
      ALLOW,
    );
    assert.equal("Access-Control-Allow-Credentials" in decision.headers, false);
  });
});
