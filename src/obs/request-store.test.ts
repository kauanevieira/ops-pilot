import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUEST_SCHEMA_SQL, SqliteRequestStore } from "./request-store.ts";
import {
  chatErrorCodeSchema,
  requestStatusSchema,
  routeSchema,
  routeSourceSchema,
  nodeNameSchema,
  stoppedReasonSchema,
  strategyLabelSchema,
  traceEventTypeSchema,
  type RequestRecord,
} from "../domain/schemas.ts";
import type { TraceEvent } from "../trace/types.ts";

function record(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    requestId: "r1", receivedAt: new Date("2026-10-07T12:00:00.000Z"), durationMs: 10, status: 200, errorCode: null,
    conversationId: "c1", userId: "u1", route: "react", strategy: "react", routeSource: "router",
    stoppedReason: "completed", llmCalls: 2, promptTokens: 100, modelUsed: "m/x",
    historyMessages: 0, summaryCoveredMessages: 0, recalledMemories: 0, traceEvents: 3,
    ...overrides,
  };
}

const TRACE: TraceEvent[] = [
  { type: "route", route: "react", strategy: "react", reason: "r", source: "router", nodeName: "router" },
  { type: "action", tool: "list_alerts", args: { status: "open" }, nodeName: "react" },
  { type: "answer", content: "feito" },
];

const newStore = () => new SqliteRequestStore(new DatabaseSync(":memory:"));

describe("SqliteRequestStore (014, contracts/database-schema.md)", () => {
  it("round-trips the record and the trace in position order (DB4)", () => {
    const store = newStore();
    store.record(record(), TRACE);
    const got = store.get("r1");
    assert.ok(got);
    assert.deepEqual(got.request, record());
    assert.deepEqual(got.trace, TRACE);
  });

  it("returns undefined for an unknown id", () => {
    assert.equal(newStore().get("nao-existe"), undefined);
  });

  it("stores an event without nodeName as NULL and returns it without the key", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteRequestStore(db);
    store.record(record(), TRACE);
    const row = db.prepare("SELECT node_name FROM trace_events WHERE request_id = ? AND position = 2").get("r1");
    assert.equal(row?.node_name, null);
    assert.equal("nodeName" in store.get("r1")!.trace[2]!, false);
  });

  it("is atomic: a bad event rolls back the record too (DB3)", () => {
    const store = newStore();
    const bad = [TRACE[0]!, TRACE[1]!, { type: "nope" } as unknown as TraceEvent];
    assert.throws(() => store.record(record(), bad), /CHECK constraint failed/);
    assert.equal(store.get("r1"), undefined);
  });

  it("the database itself rejects values outside the closed sets", () => {
    const store = newStore();
    const cases: Array<Partial<RequestRecord>> = [
      { status: 418 as never, errorCode: "internal" },
      { status: 200, errorCode: "internal" },
      { status: 400, errorCode: null },
      { strategy: "x" as never },
      { durationMs: -1 },
    ];
    cases.forEach((c, i) => {
      assert.throws(() => store.record(record({ requestId: `bad-${i}`, ...c }), []), /CHECK constraint failed/, `case ${i}`);
    });
  });

  it("the constructor is idempotent over the same connection", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteRequestStore(db);
    assert.doesNotThrow(() => new SqliteRequestStore(db));
  });

  it("an error record with an empty trace round-trips", () => {
    const store = newStore();
    const r = record({ requestId: "e1", status: 504, errorCode: "timeout", route: null, strategy: null, routeSource: null, stoppedReason: null, llmCalls: null, promptTokens: null, modelUsed: null, historyMessages: null, summaryCoveredMessages: null, recalledMemories: null, traceEvents: 0 });
    store.record(r, []);
    assert.deepEqual(store.get("e1"), { request: r, trace: [] });
  });

  it("survives closing and reopening a real file (RQ5)", () => {
    const dir = mkdtempSync(join(tmpdir(), "opspilot-014-"));
    try {
      const path = join(dir, "t.db");
      const first = new DatabaseSync(path);
      new SqliteRequestStore(first).record(record(), TRACE);
      first.close();
      const second = new SqliteRequestStore(new DatabaseSync(path));
      assert.deepEqual(second.get("r1")?.trace, TRACE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no column that could hold message or answer text (DB7)", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteRequestStore(db);
    const cols = db.prepare("PRAGMA table_info(requests)").all().map((c) => String(c.name));
    for (const forbidden of ["message", "answer", "content", "text"]) {
      assert.equal(cols.includes(forbidden), false, forbidden);
    }
  });
});

describe("sync between the DDL CHECK lists and the zod enums (DB2)", () => {
  const listFor = (column: string): string[] => {
    const match = new RegExp(`${column}\\s+(?:TEXT|INTEGER)[^,]*CHECK \\(${column} IN \\(([^)]+)\\)\\)`).exec(REQUEST_SCHEMA_SQL);
    assert.ok(match, `CHECK not found for ${column}`);
    return match[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  };
  const cases: Array<[string, readonly string[]]> = [
    ["status", requestStatusSchema.options.map((o) => String(o.value))],
    ["error_code", chatErrorCodeSchema.options],
    ["route", routeSchema.options],
    ["strategy", strategyLabelSchema.options],
    ["route_source", routeSourceSchema.options],
    ["stopped_reason", stoppedReasonSchema.options],
    ["type", traceEventTypeSchema.options],
    ["node_name", nodeNameSchema.options],
  ];
  for (const [column, expected] of cases) {
    it(column, () => {
      assert.deepEqual([...listFor(column)].sort(), [...expected].sort());
    });
  }
});
