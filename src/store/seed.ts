import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { alertSchema, incidentSchema, serviceSchema } from "../domain/schemas.ts";
import type { WorldState } from "./types.ts";

const SEED_FILE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed.json");

/**
 * Same entities as domain/schemas.ts, but with date fields coerced from the
 * ISO strings that JSON carries instead of the Date instances the domain
 * schemas expect at runtime.
 */
const seedFileSchema = z.object({
  services: z.array(serviceSchema),
  alerts: z.array(alertSchema.extend({ firedAt: z.coerce.date() })),
  incidents: z.array(
    incidentSchema.extend({ openedAt: z.coerce.date(), resolvedAt: z.coerce.date().nullable() }),
  ),
});

/**
 * Loads the baseline (or current) state from seed.json (FR-020, FR-021).
 * This is the "database" for now (R-008): a JSON file the model's tools
 * read from, with new items (e.g. incidents opened during a run) living
 * only in the in-memory WorldState built from it, not written back to disk.
 * Reapplying this loader against an untouched seed.json always yields the
 * same state, since the file itself doesn't change.
 */
export function baselineState(): WorldState {
  const raw = readFileSync(SEED_FILE_PATH, "utf-8");
  const parsed = seedFileSchema.parse(JSON.parse(raw));
  return parsed;
}
