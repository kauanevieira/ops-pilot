import type { Alert, AlertStatus, Incident, IncidentStatus, Runbook, Service } from "../domain/schemas.ts";

export interface AlertRepository {
  listAlerts(status?: AlertStatus): Alert[];
  findService(id: string): Service | undefined;
}

export interface IncidentRepository {
  openIncident(input: {
    title: string;
    serviceId: string;
    severity: Incident["severity"];
  }): Incident;
  resolveIncident(id: string): Incident;
  getIncident(id: string): Incident | undefined;
  /**
   * Absent status ⇒ ALL incidents (invariant C2) — the "open" default lives
   * in the tool's schema (FR-028), not here: a repository that hid resolved
   * incidents by default would lie to every other consumer.
   */
  listIncidents(status?: IncidentStatus): Incident[];
}

export interface RunbookRepository {
  findRunbook(serviceId: string): Runbook | undefined;
}

export type OpsRepository = AlertRepository & IncidentRepository & RunbookRepository;
