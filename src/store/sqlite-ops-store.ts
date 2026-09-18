import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import {
  alertSchema,
  incidentSchema,
  runbookSchema,
  serviceSchema,
  type AlertStatus,
  type Incident,
  type IncidentStatus,
  type Runbook,
  type Service,
} from "../domain/schemas.ts";
import { IncidentAlreadyResolvedError, IncidentNotFoundError, ServiceNotFoundError } from "../domain/errors.ts";
import type { OpsRepository } from "./repository.ts";
import { SCHEMA_SQL } from "./sqlite-schema.ts";

/**
 * Row shapes read back from SQLite, before domain validation. All columns
 * come back as the SQLite storage types (`string`, `number`, `null`) —
 * translated to domain values by the read helpers below.
 */
interface AlertRow {
  id: string;
  service_id: string;
  summary: string;
  severity: string;
  status: string;
  fired_at: string;
}

interface ServiceRow {
  id: string;
  name: string;
  tier: string;
}

interface IncidentRow {
  id: string;
  title: string;
  service_id: string;
  severity: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  summary: string | null;
}

interface RunbookRow {
  service_id: string;
  title: string;
  steps: string;
}

/**
 * The domain schemas extended with the wire shape a row produces:
 * `serviceId`/date fields are the snake_case → camelCase + string → Date
 * translation, validated in one place per entity (FR-023). No `Date` and
 * no `boolean` is ever bound to a parameter (R-003, verified): `Date`
 * silently writes NULL, so every date column round-trips as ISO-8601 text.
 */
const alertRowSchema = alertSchema
  .omit({ serviceId: true, firedAt: true })
  .extend({ service_id: z.string().min(1), fired_at: z.coerce.date() })
  .transform(({ service_id, fired_at, ...rest }) => ({ ...rest, serviceId: service_id, firedAt: fired_at }));

const incidentRowSchema = incidentSchema
  .omit({ serviceId: true, openedAt: true, resolvedAt: true })
  .extend({
    service_id: z.string().min(1),
    opened_at: z.coerce.date(),
    resolved_at: z.coerce.date().nullable(),
  })
  .transform(({ service_id, opened_at, resolved_at, ...rest }) => ({
    ...rest,
    serviceId: service_id,
    openedAt: opened_at,
    resolvedAt: resolved_at,
  }));

/**
 * `steps` round-trips through JSON in a single TEXT column rather than a
 * child table — the steps are never queried, filtered, or counted
 * individually, always read whole alongside the runbook (data-model.md §3).
 * A malformed JSON blob fails validation here rather than producing a
 * half-formed object (FR-023).
 */
const runbookRowSchema = runbookSchema
  .omit({ serviceId: true, steps: true })
  .extend({ service_id: z.string().min(1), steps: z.string() })
  .transform(({ service_id, steps, ...rest }) => ({
    ...rest,
    serviceId: service_id,
    steps: z.array(z.string().min(1)).min(1).parse(JSON.parse(steps)),
  }));

/**
 * Implements the OpsRepository interface over node:sqlite's synchronous
 * `DatabaseSync` (R-001) — the API stays synchronous end to end, which is
 * what makes swapping InMemoryOpsRepository for this implementation
 * invisible above the interface: every consumer (tools, strategies, the
 * arena/bench) already assumes a synchronous repository.
 *
 * Receives an already-open connection rather than opening one itself
 * (contract Q-constructor, src/store/db.ts): that's what lets a test pass
 * `new DatabaseSync(':memory:')` directly, without touching OPSPILOT_DB or
 * the filesystem.
 */
export class SqliteOpsStore implements OpsRepository {
  #db: DatabaseSync;

  #selectAlertsAll: StatementSync;
  #selectAlertsByStatus: StatementSync;
  #selectService: StatementSync;
  #insertIncident: StatementSync;
  #selectIncident: StatementSync;
  #updateIncidentResolved: StatementSync;
  #selectIncidentsAll: StatementSync;
  #selectIncidentsByStatus: StatementSync;
  #selectRunbook: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    // DDL is idempotent (IF NOT EXISTS): opening an already-structured
    // database changes nothing and never fails (FR-004, FR-005).
    this.#db.exec(SCHEMA_SQL);

    // All statements prepared once, here, and reused — the structural
    // guarantee that no query is ever assembled at runtime (FR-021, R-012).
    this.#selectAlertsAll = this.#db.prepare("SELECT * FROM alerts ORDER BY fired_at");
    this.#selectAlertsByStatus = this.#db.prepare("SELECT * FROM alerts WHERE status = ? ORDER BY fired_at");
    this.#selectService = this.#db.prepare("SELECT * FROM services WHERE id = ?");
    this.#insertIncident = this.#db.prepare(
      "INSERT INTO incidents (id, title, service_id, severity, status, opened_at, resolved_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.#selectIncident = this.#db.prepare("SELECT * FROM incidents WHERE id = ?");
    this.#updateIncidentResolved = this.#db.prepare(
      "UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'",
    );
    // Two fixed statements for the optional filter (R-013), never a WHERE
    // assembled conditionally — that's the most common, most innocent way
    // string-concatenated SQL enters a project, and the function that
    // accepts it once becomes the place the next filter enters the same way.
    this.#selectIncidentsAll = this.#db.prepare("SELECT * FROM incidents ORDER BY opened_at");
    this.#selectIncidentsByStatus = this.#db.prepare(
      "SELECT * FROM incidents WHERE status = ? ORDER BY opened_at",
    );
    this.#selectRunbook = this.#db.prepare("SELECT * FROM runbooks WHERE service_id = ?");
  }

  close(): void {
    this.#db.close();
  }

  listAlerts(status?: AlertStatus): import("../domain/schemas.ts").Alert[] {
    const rows = (status ? this.#selectAlertsByStatus.all(status) : this.#selectAlertsAll.all()) as unknown as AlertRow[];
    return rows.map((row) => alertRowSchema.parse(row));
  }

  findService(id: string): Service | undefined {
    // Same rule as every other read (FR-023): validated against the domain
    // schema, not cast — a `tier` that shouldn't exist given the CHECK
    // still gets caught here rather than handed to a tool unchecked.
    const row = this.#selectService.get(id) as ServiceRow | undefined;
    return row ? serviceSchema.parse(row) : undefined;
  }

  openIncident(input: { title: string; serviceId: string; severity: Incident["severity"] }): Incident {
    // Domain error raised BEFORE touching SQL — the CHECK/FK constraints
    // are the second line of defense (FR-018, SC-004), not the first.
    const service = this.findService(input.serviceId);
    if (!service) {
      throw new ServiceNotFoundError(input.serviceId);
    }

    const id = `inc-${randomUUID()}`;
    const openedAt = new Date();
    this.#insertIncident.run(id, input.title, input.serviceId, input.severity, "open", openedAt.toISOString(), null, null);

    // The record returned is the one just WRITTEN, re-read and validated —
    // not the object assembled in memory (contract invariant C9) — so a
    // failed CHECK or a lost date shows up here, not downstream.
    const created = this.getIncident(id);
    if (!created) {
      throw new IncidentNotFoundError(id);
    }
    return created;
  }

  resolveIncident(id: string): Incident {
    const resolvedAt = new Date();
    // Atomic by construction (R-009): a single conditional UPDATE, not a
    // read-then-write with a window between them. `changes` alone decides
    // which error to raise, and the WHERE status='open' guard is what keeps
    // a second resolution from overwriting the original resolved_at.
    const result = this.#updateIncidentResolved.run(resolvedAt.toISOString(), id);
    if (result.changes === 1) {
      const resolved = this.getIncident(id);
      if (!resolved) {
        throw new IncidentNotFoundError(id);
      }
      return resolved;
    }

    const existing = this.getIncident(id);
    if (!existing) {
      throw new IncidentNotFoundError(id);
    }
    throw new IncidentAlreadyResolvedError(id);
  }

  getIncident(id: string): Incident | undefined {
    const row = this.#selectIncident.get(id) as IncidentRow | undefined;
    return row ? incidentRowSchema.parse(row) : undefined;
  }

  listIncidents(status?: IncidentStatus): Incident[] {
    const rows = (
      status ? this.#selectIncidentsByStatus.all(status) : this.#selectIncidentsAll.all()
    ) as unknown as IncidentRow[];
    return rows.map((row) => incidentRowSchema.parse(row));
  }

  findRunbook(serviceId: string): Runbook | undefined {
    const row = this.#selectRunbook.get(serviceId) as RunbookRow | undefined;
    return row ? runbookRowSchema.parse(row) : undefined;
  }
}
