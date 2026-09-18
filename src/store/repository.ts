import type { Alert, AlertStatus, Incident, Service } from "../domain/schemas.ts";

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
}

export type OpsRepository = AlertRepository & IncidentRepository;
