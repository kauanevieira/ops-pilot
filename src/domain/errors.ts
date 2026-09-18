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

/**
 * Distinct from ServiceNotFoundError (FR-029a): a service that exists but
 * has no runbook written is a different message to whoever is on call than
 * a service that doesn't exist at all — the first says "no procedure is
 * written for this", the second says "check the name, this isn't real".
 */
export class RunbookNotFoundError extends DomainError {
  constructor(serviceId: string) {
    super(`Runbook not found for service: ${serviceId}`);
    this.name = "RunbookNotFoundError";
  }
}
