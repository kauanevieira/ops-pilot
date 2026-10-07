import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import {
  nodeNameSchema,
  requestRecordSchema,
  traceEventTypeSchema,
  type RequestRecord,
} from "../domain/schemas.ts";
import type { TraceEvent } from "../trace/types.ts";

/**
 * 014-request-tracing DDL (contracts/database-schema.md). Literal and
 * idempotent, applied by `SqliteRequestStore`'s constructor like the other
 * stores. Every `IN (...)` list MUST stay in sync with the zod enum in
 * `domain/schemas.ts`; request-store.test.ts checks that mechanically.
 * `payload` is the whole event as JSON; `type`/`node_name` repeat two of its
 * fields in columns of their own so the database can enforce the closed sets
 * (research R-009).
 */
export const REQUEST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS requests (
  id                       TEXT PRIMARY KEY,
  received_at              TEXT NOT NULL,
  duration_ms              INTEGER NOT NULL CHECK (duration_ms >= 0),
  status                   INTEGER NOT NULL CHECK (status IN (200,400,404,422,500,503,504)),
  error_code               TEXT CHECK (error_code IN ('invalid_body','unknown_strategy','conversation_not_found','timeout','internal','model_unavailable','request_not_found')),
  conversation_id          TEXT,
  user_id                  TEXT,
  route                    TEXT CHECK (route IN ('react','plan-and-execute','reflect')),
  strategy                 TEXT CHECK (strategy IN ('react','plan-and-execute','reflect:react','reflect:plan-and-execute')),
  route_source             TEXT CHECK (route_source IN ('router','override','fallback')),
  stopped_reason           TEXT CHECK (stopped_reason IN ('completed','max-iterations','max-steps','max-reflections')),
  llm_calls                INTEGER CHECK (llm_calls >= 0),
  prompt_tokens            INTEGER CHECK (prompt_tokens >= 0),
  model_used               TEXT,
  history_messages         INTEGER CHECK (history_messages >= 0),
  summary_covered_messages INTEGER CHECK (summary_covered_messages >= 0),
  recalled_memories        INTEGER CHECK (recalled_memories >= 0),
  trace_events             INTEGER NOT NULL CHECK (trace_events >= 0),
  CHECK ((status = 200) = (error_code IS NULL))
);

CREATE TABLE IF NOT EXISTS trace_events (
  request_id TEXT NOT NULL REFERENCES requests(id),
  position   INTEGER NOT NULL CHECK (position >= 0),
  type       TEXT NOT NULL CHECK (type IN ('thought','action','observation','plan','critique','answer','summarize','route','fallback')),
  node_name  TEXT CHECK (node_name IN ('context','router','react','plan-and-execute','reflect','response')),
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (request_id, position)
);
`;

export interface RequestStore {
  /** Atomic (FR-010): the record and every event, or nothing. Throws on a CHECK violation or write failure. */
  record(record: RequestRecord, trace: readonly TraceEvent[]): void;
  /** `undefined` when the id was never recorded. Rows are validated on read. */
  get(requestId: string): { request: RequestRecord; trace: TraceEvent[] } | undefined;
}

const requestRowSchema = z
  .object({
    id: z.string(),
    received_at: z.coerce.date(),
    duration_ms: z.number(),
    status: z.number(),
    error_code: z.string().nullable(),
    conversation_id: z.string().nullable(),
    user_id: z.string().nullable(),
    route: z.string().nullable(),
    strategy: z.string().nullable(),
    route_source: z.string().nullable(),
    stopped_reason: z.string().nullable(),
    llm_calls: z.number().nullable(),
    prompt_tokens: z.number().nullable(),
    model_used: z.string().nullable(),
    history_messages: z.number().nullable(),
    summary_covered_messages: z.number().nullable(),
    recalled_memories: z.number().nullable(),
    trace_events: z.number(),
  })
  .transform((row) =>
    requestRecordSchema.parse({
      requestId: row.id,
      receivedAt: row.received_at,
      durationMs: row.duration_ms,
      status: row.status,
      errorCode: row.error_code,
      conversationId: row.conversation_id,
      userId: row.user_id,
      route: row.route,
      strategy: row.strategy,
      routeSource: row.route_source,
      stoppedReason: row.stopped_reason,
      llmCalls: row.llm_calls,
      promptTokens: row.prompt_tokens,
      modelUsed: row.model_used,
      historyMessages: row.history_messages,
      summaryCoveredMessages: row.summary_covered_messages,
      recalledMemories: row.recalled_memories,
      traceEvents: row.trace_events,
    }),
  );

/** The payload's own `type` must agree with the column, or the row is corrupt. */
const eventRowSchema = z
  .object({
    type: traceEventTypeSchema,
    node_name: nodeNameSchema.nullable(),
    payload: z.string().transform((text) => JSON.parse(text) as unknown),
  })
  .refine((row) => (row.payload as { type?: unknown } | null)?.type === row.type, {
    message: "payload.type diverge da coluna type.",
  })
  .transform((row) => row.payload as TraceEvent);

export class SqliteRequestStore implements RequestStore {
  private readonly db: DatabaseSync;
  private readonly insertRequest: StatementSync;
  private readonly insertEvent: StatementSync;
  private readonly selectRequest: StatementSync;
  private readonly selectEvents: StatementSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(REQUEST_SCHEMA_SQL);
    this.insertRequest = db.prepare(
      `INSERT INTO requests (id, received_at, duration_ms, status, error_code, conversation_id, user_id,
         route, strategy, route_source, stopped_reason, llm_calls, prompt_tokens, model_used,
         history_messages, summary_covered_messages, recalled_memories, trace_events)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertEvent = db.prepare(
      "INSERT INTO trace_events (request_id, position, type, node_name, payload) VALUES (?, ?, ?, ?, ?)",
    );
    this.selectRequest = db.prepare("SELECT * FROM requests WHERE id = ?");
    this.selectEvents = db.prepare(
      "SELECT type, node_name, payload FROM trace_events WHERE request_id = ? ORDER BY position",
    );
  }

  record(record: RequestRecord, trace: readonly TraceEvent[]): void {
    this.db.exec("BEGIN");
    try {
      this.insertRequest.run(
        record.requestId,
        record.receivedAt.toISOString(),
        record.durationMs,
        record.status,
        record.errorCode,
        record.conversationId,
        record.userId,
        record.route,
        record.strategy,
        record.routeSource,
        record.stoppedReason,
        record.llmCalls,
        record.promptTokens,
        record.modelUsed,
        record.historyMessages,
        record.summaryCoveredMessages,
        record.recalledMemories,
        record.traceEvents,
      );
      trace.forEach((event, position) => {
        this.insertEvent.run(record.requestId, position, event.type, event.nodeName ?? null, JSON.stringify(event));
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(requestId: string): { request: RequestRecord; trace: TraceEvent[] } | undefined {
    const row = this.selectRequest.get(requestId);
    if (!row) return undefined;
    const request = requestRowSchema.parse(row);
    const trace = this.selectEvents.all(requestId).map((r) => eventRowSchema.parse(r));
    return { request, trace };
  }
}
