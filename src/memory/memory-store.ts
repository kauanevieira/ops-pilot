import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { RecalledMemory, RememberResult } from "../domain/schemas.ts";
import type { Embedder } from "./embeddings.ts";
import { EMBEDDING_DIM } from "./embeddings.ts";

/** Strictly greater than (FR-010): exactly 0.92 is NOT a duplicate (M2). */
export const DEDUP_THRESHOLD = 0.92;
/** Inclusive (FR-014): exactly 0.3 IS recalled (M5). */
export const RECALL_MIN_SCORE = 0.3;
export const RECALL_LIMIT = 3;

/**
 * Pure boundary predicates, exported and tested directly with exact
 * `number`s (memory-store.test.ts) — deliberately NOT tested only through
 * an embedder round-trip: a real fact's score comes back from a Float32
 * BLOB, and float32(0.92) as a double is 0.9200000166893005 (verified),
 * always slightly ABOVE the float64 literal 0.92. Any vector constructed
 * to carry "exactly 0.92" through float32 storage would round to that
 * same value and always read back as a duplicate — which would test
 * float32 rounding, not the `>`/`>=` decision these two functions make.
 */
export function isDuplicateScore(score: number): boolean {
  return score > DEDUP_THRESHOLD;
}

export function isRecallable(score: number): boolean {
  return score >= RECALL_MIN_SCORE;
}

const EMBEDDING_BYTES = EMBEDDING_DIM * Float32Array.BYTES_PER_ELEMENT;

/**
 * Literal, idempotent DDL (Principle II), applied by `SqliteMemoryStore`'s
 * own constructor — separate from `SCHEMA_SQL` (ops) and
 * `CONVERSATION_SCHEMA_SQL` (007), because it depends on nothing from
 * either and no other store touches this table.
 *
 * `embedding BLOB … CHECK (length(embedding) = 1536)` is this table's only
 * "closed set": the dimension. Without it, a vector from a differently-
 * configured embedder (or a future model swap) would silently corrupt
 * every future comparison instead of failing on write (contracts/memory-store.md, M13).
 *
 * No foreign key: `user_id` is an opaque, unauthenticated string (spec,
 * Assumptions) — there is no `users` table to reference.
 */
export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  fact       TEXT NOT NULL,
  embedding  BLOB NOT NULL CHECK (length(embedding) = ${EMBEDDING_BYTES}),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
`;

export interface MemoryStore {
  remember(userId: string, fact: string): Promise<RememberResult>;
  recall(userId: string, query: string): Promise<RecalledMemory[]>;
  /** Synchronous — a single conditional DELETE, no embedding involved (FR-017/018). */
  forget(userId: string, memoryId: string): boolean;
}

interface MemoryRow {
  id: string;
  fact: string;
  embedding: Uint8Array;
  rowid: number;
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Copies out of the BLOB's own buffer before reinterpreting as Float32:
 * `Float32Array` requires a byteOffset multiple of 4, which nothing
 * guarantees for a BLOB read back from SQLite (007-persistent-conversation
 * precedent doesn't apply here — this is binary, not text — verified against
 * node:sqlite directly, see research.md R-007).
 */
function fromBlob(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Implements `MemoryStore` over `node:sqlite`'s synchronous `DatabaseSync`,
 * same construction pattern as `SqliteOpsStore`/`SqliteConversationStore`:
 * receives an already-open connection, applies its own idempotent DDL in
 * the constructor, prepares every statement once.
 *
 * Recall is a full scan in JS (R-008): SQLite has no native vector search,
 * and adding one (e.g. a native extension) would be another runtime
 * dependency for a scale — dozens to low hundreds of facts per user — where
 * 384 multiplications per row is negligible next to a model call.
 */
export class SqliteMemoryStore implements MemoryStore {
  #db: DatabaseSync;
  #embedder: Embedder;

  #selectByUser: StatementSync;
  #insert: StatementSync;
  #delete: StatementSync;

  constructor(db: DatabaseSync, embedder: Embedder) {
    this.#db = db;
    this.#embedder = embedder;
    this.#db.exec(MEMORY_SCHEMA_SQL);

    this.#selectByUser = this.#db.prepare("SELECT id, fact, embedding, rowid FROM memories WHERE user_id = ?");
    this.#insert = this.#db.prepare(
      "INSERT INTO memories (id, user_id, fact, embedding, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    this.#delete = this.#db.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?");
  }

  async remember(userId: string, fact: string): Promise<RememberResult> {
    // The vector is computed FIRST; everything after is synchronous SQLite
    // work with no `await` in between (R-009). node:sqlite is synchronous
    // and Node is single-threaded, so nothing else can interleave between
    // reading the user's existing vectors and inserting the new one — two
    // concurrent `remember` calls with the same fact can't both pass the
    // dedup check, because whichever's synchronous section runs second
    // already sees the first's freshly-inserted row.
    const vector = await this.#embedder.embed(fact);

    const rows = this.#selectByUser.all(userId) as unknown as MemoryRow[];
    let best: { row: MemoryRow; score: number } | undefined;
    for (const row of rows) {
      const score = dot(vector, fromBlob(row.embedding));
      if (!best || score > best.score) {
        best = { row, score };
      }
    }

    if (best && isDuplicateScore(best.score)) {
      return { memoryId: best.row.id, fact: best.row.fact, created: false };
    }

    const id = `mem-${randomUUID()}`;
    this.#insert.run(id, userId, fact, toBlob(vector), new Date().toISOString());
    return { memoryId: id, fact, created: true };
  }

  async recall(userId: string, query: string): Promise<RecalledMemory[]> {
    const vector = await this.#embedder.embed(query);
    const rows = this.#selectByUser.all(userId) as unknown as MemoryRow[];

    // Filter BEFORE capping (contracts/memory-store.md, M4/M5): capping
    // first and filtering after could silently return fewer than 3 facts
    // even when 3+ relevant ones exist beyond the first 3 by insertion
    // order, or admit a sub-threshold fact just because nothing else filled
    // the slots.
    return rows
      .map((row) => ({ memoryId: row.id, fact: row.fact, score: dot(vector, fromBlob(row.embedding)), rowid: row.rowid }))
      .filter((m) => isRecallable(m.score))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.rowid - a.rowid))
      .slice(0, RECALL_LIMIT)
      .map(({ memoryId, fact, score }) => ({ memoryId, fact, score }));
  }

  forget(userId: string, memoryId: string): boolean {
    const result = this.#delete.run(memoryId, userId);
    return result.changes === 1;
  }
}
