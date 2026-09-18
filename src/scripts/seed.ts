import { openDatabase } from "../store/db.ts";
import { seedDatabase } from "../store/sqlite-schema.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { baselineState } from "../store/seed.ts";

/**
 * Standalone baseline-seeding command (FR-024), now writing to the durable
 * store instead of just building an in-memory snapshot. Idempotent by
 * upsert (FR-026, R-006): running this repeatedly always leaves the same
 * baseline in place, and never touches incidents already registered
 * on-call (FR-027).
 */
function main(): void {
  const db = openDatabase();
  // SqliteOpsStore's constructor applies the DDL (FR-004) — it MUST run
  // before seedDatabase, which assumes the tables already exist.
  new SqliteOpsStore(db);
  const state = baselineState();
  seedDatabase(db, state);

  const firing = state.alerts.filter((a) => a.status === "firing").length;
  const resolved = state.alerts.filter((a) => a.status === "resolved").length;

  console.log(
    `Seeded ${state.services.length} services, ${state.alerts.length} alerts (${firing} firing, ${resolved} resolved), ${state.runbooks.length} runbooks.`,
  );

  db.close();
}

main();
