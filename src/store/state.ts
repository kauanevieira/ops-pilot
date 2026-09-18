import {
  IncidentAlreadyResolvedError,
  IncidentNotFoundError,
  ServiceNotFoundError,
} from "../domain/errors.ts";
import type { Incident } from "../domain/schemas.ts";
import type {
  OpenIncidentCommand,
  ResolveIncidentCommand,
  WorldState,
} from "./types.ts";

/**
 * Pure transition: (state, command) => newState. No I/O, no mutation of the
 * input state. Id and timestamp are supplied by the caller so this function
 * stays deterministic and side-effect free (FR-018).
 */
export function openIncident(
  state: WorldState,
  command: OpenIncidentCommand,
): WorldState {
  const service = state.services.find((s) => s.id === command.serviceId);
  if (!service) {
    throw new ServiceNotFoundError(command.serviceId);
  }

  const incident: Incident = {
    id: command.id,
    title: command.title,
    serviceId: command.serviceId,
    severity: command.severity,
    status: "open",
    openedAt: command.openedAt,
    resolvedAt: null,
    summary: null,
  };

  return {
    ...state,
    incidents: [...state.incidents, incident],
  };
}

export function resolveIncident(
  state: WorldState,
  command: ResolveIncidentCommand,
): WorldState {
  const existing = state.incidents.find((i) => i.id === command.id);
  if (!existing) {
    throw new IncidentNotFoundError(command.id);
  }
  if (existing.status === "resolved") {
    throw new IncidentAlreadyResolvedError(command.id);
  }

  const resolved: Incident = {
    ...existing,
    status: "resolved",
    resolvedAt: command.resolvedAt,
  };

  return {
    ...state,
    incidents: state.incidents.map((i) => (i.id === command.id ? resolved : i)),
  };
}
