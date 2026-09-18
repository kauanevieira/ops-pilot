import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DomainError,
  IncidentAlreadyResolvedError,
  IncidentNotFoundError,
  ServiceNotFoundError,
} from "./errors.ts";

describe("domain errors", () => {
  it("ServiceNotFoundError is a DomainError carrying the service id", () => {
    const err = new ServiceNotFoundError("checkout");
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /checkout/);
  });

  it("IncidentNotFoundError is a DomainError carrying the incident id", () => {
    const err = new IncidentNotFoundError("inc-1");
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /inc-1/);
  });

  it("IncidentAlreadyResolvedError is a DomainError carrying the incident id", () => {
    const err = new IncidentAlreadyResolvedError("inc-1");
    assert.ok(err instanceof DomainError);
    assert.match(err.message, /inc-1/);
  });

  it("a plain technical error is not a DomainError", () => {
    const err = new TypeError("boom");
    assert.ok(!(err instanceof DomainError));
  });
});
