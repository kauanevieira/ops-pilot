export abstract class DomainError extends Error {}

export class ServiceNotFoundError extends DomainError {
  constructor(serviceId: string) {
    super(`Service not found: ${serviceId}`);
    this.name = "ServiceNotFoundError";
  }
}

export class IncidentNotFoundError extends DomainError {
  constructor(incidentId: string) {
    super(`Incident not found: ${incidentId}`);
    this.name = "IncidentNotFoundError";
  }
}

export class IncidentAlreadyResolvedError extends DomainError {
  constructor(incidentId: string) {
    super(`Incident already resolved: ${incidentId}`);
    this.name = "IncidentAlreadyResolvedError";
  }
}
