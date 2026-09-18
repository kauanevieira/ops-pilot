import type { Alert, Incident, Service } from "../domain/schemas.ts";

export interface WorldState {
  readonly services: readonly Service[];
  readonly alerts: readonly Alert[];
  readonly incidents: readonly Incident[];
}

export interface OpenIncidentCommand {
  readonly title: string;
  readonly serviceId: string;
  readonly severity: Incident["severity"];
  readonly id: string;
  readonly openedAt: Date;
}

export interface ResolveIncidentCommand {
  readonly id: string;
  readonly resolvedAt: Date;
}
