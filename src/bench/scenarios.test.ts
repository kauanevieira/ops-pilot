import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, benchBaselineState } from "./scenarios.ts";
import type { Incident, Service } from "../domain/schemas.ts";
import type { WorldState } from "../store/types.ts";

function scenario(id: string) {
  const found = SCENARIOS.find((s) => s.id === id);
  assert.ok(found, `scenario ${id} must exist`);
  return found;
}

function incident(over: Partial<Incident>): Incident {
  return {
    id: "inc-1",
    title: "t",
    serviceId: "checkout",
    severity: "high",
    status: "open",
    openedAt: new Date("2026-01-01T01:00:00Z"),
    resolvedAt: null,
    summary: null,
    ...over,
  };
}

describe("benchBaselineState", () => {
  it("adds a catalog service on top of the canonical seed", () => {
    const state = benchBaselineState();
    assert.ok(state.services.some((s: Service) => s.id === "catalog"));
    // The canonical 5 services from 001-reasoning-core are still there.
    assert.equal(state.services.length, 6);
  });

  it("devolve o mesmo estado inicial em chamadas repetidas (FR-030, reprodutibilidade do bench)", () => {
    const first = benchBaselineState();
    const second = benchBaselineState();

    assert.deepEqual(
      first.services.map((s) => s.id).sort(),
      second.services.map((s) => s.id).sort(),
    );
    assert.equal(first.alerts.length, second.alerts.length);
    assert.equal(first.incidents.length, 0);
    assert.equal(second.incidents.length, 0);
    assert.deepEqual(
      first.runbooks.map((r) => r.serviceId).sort(),
      second.runbooks.map((r) => r.serviceId).sort(),
    );
  });
});

describe("C1 — direto", () => {
  const check = scenario("C1").check;

  it("passes when the store comes out exactly as it went in", () => {
    const state = benchBaselineState();
    assert.equal(check(state, state), true);
  });

  it("fails when an incident was opened for what should be a read-only question", () => {
    const initial = benchBaselineState();
    const final: WorldState = { ...initial, incidents: [incident({})] };
    assert.equal(check(initial, final), false);
  });
});

describe("C2 — estruturado", () => {
  const check = scenario("C2").check;

  function threeCorrectIncidents(): Incident[] {
    return [
      incident({ id: "i1", serviceId: "checkout", severity: "high", status: "resolved" }),
      incident({ id: "i2", serviceId: "payments", severity: "high", status: "open" }),
      incident({ id: "i3", serviceId: "catalog", severity: "high", status: "open" }),
    ];
  }

  it("passes for checkout/payments/catalog in order, sev2=high, first resolved", () => {
    const initial = benchBaselineState();
    const final: WorldState = { ...initial, incidents: threeCorrectIncidents() };
    assert.equal(check(initial, final), true);
  });

  it("fails when fewer than three incidents were created", () => {
    const initial = benchBaselineState();
    const final: WorldState = { ...initial, incidents: threeCorrectIncidents().slice(0, 2) };
    assert.equal(check(initial, final), false);
  });

  it("fails when the order doesn't match checkout, payments, catalog", () => {
    const initial = benchBaselineState();
    const swapped = threeCorrectIncidents();
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    const final: WorldState = { ...initial, incidents: swapped };
    assert.equal(check(initial, final), false);
  });

  it("fails when the severity isn't the sev2 -> high mapping", () => {
    const initial = benchBaselineState();
    const wrongSeverity = threeCorrectIncidents().map((i) => ({ ...i, severity: "critical" as const }));
    const final: WorldState = { ...initial, incidents: wrongSeverity };
    assert.equal(check(initial, final), false);
  });

  it("fails when the first incident wasn't resolved", () => {
    const initial = benchBaselineState();
    const notResolved = threeCorrectIncidents().map((i, idx) => (idx === 0 ? { ...i, status: "open" as const } : i));
    const final: WorldState = { ...initial, incidents: notResolved };
    assert.equal(check(initial, final), false);
  });

  it("fails when a later incident was resolved instead of the first", () => {
    const initial = benchBaselineState();
    const wrongOneResolved = threeCorrectIncidents().map((i, idx) => ({
      ...i,
      status: idx === 1 ? ("resolved" as const) : ("open" as const),
    }));
    const final: WorldState = { ...initial, incidents: wrongOneResolved };
    assert.equal(check(initial, final), false);
  });
});

describe("C3 — dinâmico", () => {
  const check = scenario("C3").check;

  it("passes when the incident opened is for the oldest firing alert's service", () => {
    const initial = benchBaselineState();
    // alert-1 (checkout) is the oldest firing alert in the seed.
    const final: WorldState = {
      ...initial,
      incidents: [incident({ serviceId: "checkout", status: "open" })],
    };
    assert.equal(check(initial, final), true);
  });

  it("fails when the incident is for a different service", () => {
    const initial = benchBaselineState();
    const final: WorldState = {
      ...initial,
      incidents: [incident({ serviceId: "payments", status: "open" })],
    };
    assert.equal(check(initial, final), false);
  });

  it("fails when more than one incident was opened", () => {
    const initial = benchBaselineState();
    const final: WorldState = {
      ...initial,
      incidents: [
        incident({ id: "i1", serviceId: "checkout", status: "open" }),
        incident({ id: "i2", serviceId: "payments", status: "open" }),
      ],
    };
    assert.equal(check(initial, final), false);
  });

  it("fails when no incident was opened at all", () => {
    const initial = benchBaselineState();
    assert.equal(check(initial, initial), false);
  });
});
