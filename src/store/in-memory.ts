import { randomUUID } from "node:crypto";
import type { AlertStatus, Incident, IncidentStatus, Runbook, Service } from "../domain/schemas.ts";
import { IncidentNotFoundError } from "../domain/errors.ts";
import { openIncident as pureOpenIncident, resolveIncident as pureResolveIncident } from "./state.ts";
import type { OpsRepository } from "./repository.ts";
import type { WorldState } from "./types.ts";
import { baselineState } from "./seed.ts";

/**
 * Thin, stateful shell around the pure transitions in state.ts (FR-018).
 * Owns the current WorldState in memory and is the only place that touches
 * time (Date.now) or generates ids (crypto.randomUUID).
 */
export class InMemoryOpsRepository implements OpsRepository {
  #state: WorldState;

  constructor(initialState: WorldState = baselineState()) {
    this.#state = initialState;
  }

  get state(): WorldState {
    return this.#state;
  }

  listAlerts(status?: AlertStatus) {
    if (!status) return [...this.#state.alerts];
    return this.#state.alerts.filter((a) => a.status === status);
  }

  findService(id: string): Service | undefined {
    return this.#state.services.find((s) => s.id === id);
  }

  openIncident(input: { title: string; serviceId: string; severity: Incident["severity"] }): Incident {
    const id = `inc-${randomUUID()}`;
    this.#state = pureOpenIncident(this.#state, {
      id,
      title: input.title,
      serviceId: input.serviceId,
      severity: input.severity,
      openedAt: new Date(),
    });
    const created = this.#state.incidents.find((i) => i.id === id);
    if (!created) {
      throw new IncidentNotFoundError(id);
    }
    return created;
  }

  resolveIncident(id: string): Incident {
    this.#state = pureResolveIncident(this.#state, { id, resolvedAt: new Date() });
    const resolved = this.#state.incidents.find((i) => i.id === id);
    if (!resolved) {
      throw new IncidentNotFoundError(id);
    }
    return resolved;
  }

  getIncident(id: string): Incident | undefined {
    return this.#state.incidents.find((i) => i.id === id);
  }

  listIncidents(status?: IncidentStatus): Incident[] {
    if (!status) return [...this.#state.incidents];
    return this.#state.incidents.filter((i) => i.status === status);
  }

  findRunbook(serviceId: string): Runbook | undefined {
    return this.#state.runbooks.find((r) => r.serviceId === serviceId);
  }
}
