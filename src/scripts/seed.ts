import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { baselineState } from "../store/seed.ts";

/**
 * Standalone baseline-loading command (FR-019). Idempotent: the baseline is
 * a fixed literal, so running this repeatedly always yields the same state
 * (FR-021, SC-007).
 */
function main(): void {
  const store = new InMemoryOpsRepository(baselineState());
  const { services, alerts, incidents } = store.state;
  const firing = alerts.filter((a) => a.status === "firing").length;
  const resolved = alerts.filter((a) => a.status === "resolved").length;

  console.log(
    `Seeded ${services.length} services, ${alerts.length} alerts (${firing} firing, ${resolved} resolved), ${incidents.length} incidents.`,
  );
}

main();
