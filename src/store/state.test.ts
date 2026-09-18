import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IncidentAlreadyResolvedError,
  IncidentNotFoundError,
  ServiceNotFoundError,
} from "../domain/errors.ts";
import { openIncident, resolveIncident } from "./state.ts";
import type { WorldState } from "./types.ts";

function baseState(): WorldState {
  return {
    services: [{ id: "checkout", name: "Checkout" }],
    alerts: [],
    incidents: [],
  };
}

describe("openIncident", () => {
  it("adds a new open incident for an existing service", () => {
    const state = baseState();
    const next = openIncident(state, {
      id: "inc-1",
      title: "Checkout down",
      serviceId: "checkout",
      severity: "critical",
      openedAt: new Date("2026-01-01T00:00:00Z"),
    });

    assert.equal(next.incidents.length, 1);
    assert.equal(next.incidents[0]?.status, "open");
    assert.equal(next.incidents[0]?.resolvedAt, null);
    assert.equal(next.incidents[0]?.serviceId, "checkout");
  });

  it("does not mutate the input state", () => {
    const state = baseState();
    openIncident(state, {
      id: "inc-1",
      title: "Checkout down",
      serviceId: "checkout",
      severity: "critical",
      openedAt: new Date(),
    });

    assert.equal(state.incidents.length, 0);
  });

  it("throws ServiceNotFoundError for an unknown service", () => {
    const state = baseState();
    assert.throws(
      () =>
        openIncident(state, {
          id: "inc-1",
          title: "X",
          serviceId: "does-not-exist",
          severity: "low",
          openedAt: new Date(),
        }),
      ServiceNotFoundError,
    );
  });
});

describe("resolveIncident", () => {
  function stateWithOpenIncident(): WorldState {
    return openIncident(baseState(), {
      id: "inc-1",
      title: "Checkout down",
      serviceId: "checkout",
      severity: "critical",
      openedAt: new Date("2026-01-01T00:00:00Z"),
    });
  }

  it("resolves an open incident, setting status and resolvedAt", () => {
    const state = stateWithOpenIncident();
    const resolvedAt = new Date("2026-01-01T01:00:00Z");
    const next = resolveIncident(state, { id: "inc-1", resolvedAt });

    assert.equal(next.incidents[0]?.status, "resolved");
    assert.equal(next.incidents[0]?.resolvedAt?.getTime(), resolvedAt.getTime());
  });

  it("does not mutate the input state", () => {
    const state = stateWithOpenIncident();
    resolveIncident(state, { id: "inc-1", resolvedAt: new Date() });

    assert.equal(state.incidents[0]?.status, "open");
  });

  it("throws IncidentNotFoundError for an unknown incident", () => {
    const state = stateWithOpenIncident();
    assert.throws(
      () => resolveIncident(state, { id: "does-not-exist", resolvedAt: new Date() }),
      IncidentNotFoundError,
    );
  });

  it("throws IncidentAlreadyResolvedError when resolving twice", () => {
    const resolvedAt = new Date("2026-01-01T01:00:00Z");
    const state = resolveIncident(stateWithOpenIncident(), { id: "inc-1", resolvedAt });

    assert.throws(
      () => resolveIncident(state, { id: "inc-1", resolvedAt: new Date() }),
      IncidentAlreadyResolvedError,
    );
  });
});
