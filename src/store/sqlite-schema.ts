import type { DatabaseSync } from "node:sqlite";
import type { WorldState } from "./types.ts";

/**
 * Literal DDL — no part of it is generated, interpolated, or assembled at
 * runtime (Principle II; R-007). Every CREATE uses IF NOT EXISTS so opening
 * an already-structured database changes nothing and never fails (FR-005).
 *
 * Dates are TEXT (ISO-8601 UTC), never a SQLite date/time type: node:sqlite
 * silently writes NULL for a bound `Date` (R-003, verified), so every
 * mandatory date column is NOT NULL — the constraint that turns a missed
 * conversion into an immediate exception instead of a lost timestamp.
 *
 * The CHECK sets below MUST stay in sync with the zod enums in
 * src/domain/schemas.ts; a dedicated test (sqlite-ops-store.test.ts) checks
 * that sync mechanically, which is what makes literal SQL acceptable here
 * instead of DDL generated from the enums (R-007).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS services (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  tier  TEXT NOT NULL CHECK (tier IN ('tier-1','tier-2','tier-3'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  summary    TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status     TEXT NOT NULL CHECK (status IN ('firing','resolved')),
  fired_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  service_id  TEXT NOT NULL REFERENCES services(id),
  severity    TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status      TEXT NOT NULL CHECK (status IN ('open','resolved')),
  opened_at   TEXT NOT NULL,
  resolved_at TEXT,
  summary     TEXT
);

CREATE TABLE IF NOT EXISTS runbooks (
  service_id TEXT PRIMARY KEY REFERENCES services(id),
  title      TEXT NOT NULL,
  steps      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(status);
`;

/**
 * 007-persistent-conversation: DDL for conversation history, applied by
 * `SqliteConversationStore`'s own constructor — separate from `SCHEMA_SQL`
 * so either store can be opened alone over `:memory:` (contracts/database-schema.md).
 *
 * `messages.id` is an INTEGER PRIMARY KEY (rowid), not AUTOINCREMENT: it's
 * what gives a stable total order between messages recorded in the same
 * instant (FR-006) — two rows of the same turn share `created_at` — without
 * needing AUTOINCREMENT's only extra guarantee (no reuse after deletion),
 * which this feature never needs because it never deletes.
 *
 * `role` CHECK MUST stay in sync with `messageRoleSchema`
 * (sqlite-conversation-store.test.ts checks that mechanically, same pattern
 * as R-007 in 004-sqlite-persistence).
 */
export const CONVERSATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
`;

/**
 * Seeds the baseline scenario into an already-structured database.
 * Takes a validated WorldState, not a file path — that's what makes this
 * testable with a minimal scenario made up in the test itself (R-005),
 * decoupled from the real src/store/seed.json.
 *
 * Idempotent by upsert, not INSERT OR IGNORE (R-006, verified: OR IGNORE
 * returns changes: 0 on an existing key — it never reapplies a corrected
 * seed.json to an already-seeded database, so seed and database would
 * silently drift). Never touches `incidents` (FR-027) — that table is
 * on-call work, not scenario data.
 *
 * Wrapped in a transaction (R-010): the seed writes ~14 rows, and failing
 * partway through would leave the baseline incomplete inside a gitignored
 * data/ directory nobody inspects until the first odd request.
 */
export function seedDatabase(db: DatabaseSync, state: WorldState): void {
  const upsertService = db.prepare(
    `INSERT INTO services (id, name, tier) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier`,
  );
  const upsertAlert = db.prepare(
    `INSERT INTO alerts (id, service_id, summary, severity, status, fired_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         service_id = excluded.service_id,
         summary = excluded.summary,
         severity = excluded.severity,
         status = excluded.status,
         fired_at = excluded.fired_at`,
  );
  const upsertRunbook = db.prepare(
    `INSERT INTO runbooks (service_id, title, steps) VALUES (?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET title = excluded.title, steps = excluded.steps`,
  );

  db.exec("BEGIN");
  try {
    for (const service of state.services) {
      upsertService.run(service.id, service.name, service.tier);
    }
    for (const alert of state.alerts) {
      upsertAlert.run(
        alert.id,
        alert.serviceId,
        alert.summary,
        alert.severity,
        alert.status,
        alert.firedAt.toISOString(),
      );
    }
    for (const runbook of state.runbooks) {
      upsertRunbook.run(runbook.serviceId, runbook.title, JSON.stringify(runbook.steps));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
