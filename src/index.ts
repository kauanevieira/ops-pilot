import { z } from "zod";
import { createApp } from "./http/server.ts";
import { openDatabase } from "./store/db.ts";
import { seedDatabase } from "./store/sqlite-schema.ts";
import { SqliteOpsStore } from "./store/sqlite-ops-store.ts";
import { SqliteConversationStore } from "./store/sqlite-conversation-store.ts";
import { baselineState } from "./store/seed.ts";

/**
 * `PORT` is external input like any other (a CLI flag, an HTTP body) and
 * the project's convention is that all of it is validated with zod
 * (R-011) — without this, `PORT=abc` would coerce to `NaN` and `listen`
 * would silently pick a random port instead of failing loudly.
 */
const portSchema = z.coerce.number().int().min(1).max(65535).default(3000);

function resolvePort(): number {
  try {
    return portSchema.parse(process.env.PORT);
  } catch (error) {
    console.error("PORT inválida:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function main(): void {
  const port = resolvePort();

  // Durable storage (FR-010): the API's composition root is the only
  // caller that opens OPSPILOT_DB — the arena and the bench stay on the
  // in-memory store on purpose, so strategy comparisons keep starting from
  // the same point (R-014).
  const db = openDatabase();
  // SqliteOpsStore's constructor applies the DDL (FR-004) — it MUST run
  // before seedDatabase, which assumes the tables already exist.
  const store = new SqliteOpsStore(db);
  seedDatabase(db, baselineState());

  // 007-persistent-conversation: conversation history lives in the same
  // file/connection as operational state (R-014) — its own DDL is applied
  // by this store's constructor and never touches seedDatabase.
  const conversationStore = new SqliteConversationStore(db);

  const app = createApp({ store, conversationStore });

  app.listen(port, () => {
    console.log(`OpsPilot ouvindo em http://localhost:${port}`);
  });
}

main();
