import { z } from "zod";
import { createApp } from "./http/server.ts";
import { openDatabase } from "./store/db.ts";
import { seedDatabase } from "./store/sqlite-schema.ts";
import { SqliteOpsStore } from "./store/sqlite-ops-store.ts";
import { SqliteConversationStore } from "./store/sqlite-conversation-store.ts";
import { SqliteMemoryStore } from "./memory/memory-store.ts";
import { createLocalEmbedder } from "./memory/embeddings.ts";
import { createModelDistiller } from "./memory/distiller.ts";
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

  // 008-semantic-memory: same file/connection as the other stores; its own
  // DDL is applied by this store's constructor. createLocalEmbedder() is a
  // lazy singleton (R-003) — the model isn't loaded until the first
  // request that sends a userId actually calls recall/remember.
  const memoryStore = new SqliteMemoryStore(db, createLocalEmbedder());

  // 009-learning-reflector: constructing the distiller reads no
  // environment variable (R-002) — only a request that actually reaches
  // the reflector invokes it, which is when OPENROUTER_* is required.
  const distiller = createModelDistiller();

  const app = createApp({ store, conversationStore, memoryStore, distiller });

  app.listen(port, () => {
    console.log(`OpsPilot ouvindo em http://localhost:${port}`);
  });
}

main();
