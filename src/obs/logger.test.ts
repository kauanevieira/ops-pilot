import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLogger, currentLogger, errorName, runWithRequestContext, silentLogger } from "./logger.ts";

const FIXED = new Date("2026-10-07T12:00:00.000Z");

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ sink: (l) => void lines.push(l), now: () => FIXED });
  return { lines, logger };
}

describe("logger (014, contracts/log-format.md)", () => {
  it("emits exactly one JSON line per call, even with newlines and quotes in a field (LG1)", () => {
    const { lines, logger } = capture();
    logger.info("request.start", { method: 'a\nb"c', path: "/chat" });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.includes("\n"), false);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.method, 'a\nb"c');
  });

  it("always has ts, level and event, and no requestId outside a context", () => {
    const { lines, logger } = capture();
    logger.warn("router.failed", { errorName: "Error" });
    assert.deepEqual(JSON.parse(lines[0]!), {
      ts: "2026-10-07T12:00:00.000Z",
      level: "warn",
      event: "router.failed",
      errorName: "Error",
    });
  });

  it("stamps requestId from the context across await and timers", async () => {
    const { lines, logger } = capture();
    await runWithRequestContext({ requestId: "r1", logger }, async () => {
      assert.equal(currentLogger(), logger);
      await new Promise((r) => setTimeout(r, 1));
      currentLogger()!.info("trace.event", { position: 0 });
      await new Promise<void>((r) => setTimeout(() => (currentLogger()!.info("trace.event", { position: 1 }), r()), 1));
    });
    assert.deepEqual(lines.map((l) => JSON.parse(l).requestId), ["r1", "r1"]);
  });

  it("keeps two concurrent contexts apart", async () => {
    const { lines, logger } = capture();
    const run = (id: string) =>
      runWithRequestContext({ requestId: id, logger }, async () => {
        await new Promise((r) => setTimeout(r, id === "a" ? 5 : 1));
        currentLogger()!.info("request.end", { who: id });
      });
    await Promise.all([run("a"), run("b")]);
    for (const l of lines) {
      const p = JSON.parse(l);
      assert.equal(p.requestId, p.who);
    }
  });

  it("has no current logger outside a context", () => {
    assert.equal(currentLogger(), undefined);
  });

  it("swallows a throwing sink (LG4)", () => {
    const logger = createLogger({
      sink: () => {
        throw new Error("disk full");
      },
    });
    assert.doesNotThrow(() => logger.error("request.persist_failed", { errorName: "Error" }));
  });

  it("errorName never returns the message", () => {
    assert.equal(errorName(new TypeError("segredo")), "TypeError");
    assert.equal(errorName("s"), "unknown");
    assert.equal(errorName(undefined), "unknown");
  });

  it("silentLogger writes nothing", () => {
    assert.doesNotThrow(() => silentLogger.info("server.listening", { port: 1 }));
  });

  it("rejects non-metadata fields at compile time (LG3)", () => {
    const { logger } = capture();
    // @ts-expect-error objects are not allowed in log fields
    logger.info("request.start", { payload: { a: 1 } });
    // @ts-expect-error an Error is not allowed in log fields
    logger.info("request.start", { error: new Error("x") });
    // @ts-expect-error event names are a closed set
    logger.info("nao.existe");
  });
});
