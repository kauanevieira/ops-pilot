import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const IN_MEMORY = ":memory:";

/**
 * OPSPILOT_DB is external input like any other and goes through zod at the
 * boundary (R-011, project convention) — an empty string must fail loudly
 * instead of silently becoming an empty path.
 */
const dbPathSchema = z.string().min(1).default("./data/opspilot.db");

function resolvePath(path?: string): string {
  if (path !== undefined) return path;
  try {
    return dbPathSchema.parse(process.env.OPSPILOT_DB);
  } catch (error) {
    throw new Error(
      `OPSPILOT_DB inválida: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolves OPSPILOT_DB (argument > env var > default), creates the parent
 * directory if it doesn't exist (FR-006 — nobody who clones the repo has
 * data/, and requiring a manual mkdir would be a preparation step the
 * constitution's Principle II forbids), and opens the connection with
 * foreign keys explicitly enabled (R-008 — already DatabaseSync's default,
 * declared anyway so the guarantee doesn't depend on a default of an
 * experimental library that may change).
 *
 * ":memory:" is checked for explicitly, not inferred from the path's shape:
 * it has no directory to create, and each open is a fresh, empty database —
 * exactly what tests want.
 */
export function openDatabase(path?: string): DatabaseSync {
  const resolved = resolvePath(path);

  if (resolved !== IN_MEMORY) {
    mkdirSync(dirname(resolved), { recursive: true });
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(resolved);
  } catch (error) {
    throw new Error(
      `Não foi possível abrir o banco de dados em "${resolved}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
