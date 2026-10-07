import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "info" | "warn" | "error";

/**
 * Closed catalog of log events (contracts/log-format.md). An unknown name
 * doesn't compile, so the catalog and the code can't drift apart.
 */
export type LogEvent =
  | "server.listening"
  | "request.start"
  | "request.end"
  | "trace.event"
  | "request.persist_failed"
  | "request.internal_error"
  | "router.failed"
  | "memory.recall_failed"
  | "summary.failed"
  | "model.retry"
  | "model.failed"
  | "model.fallback"
  | "model.unavailable"
  | "learning.learned"
  | "learning.failed";

/**
 * FR-023, "metadata only", enforced by the type: no object, array or `Error`
 * can reach a log line, so no payload, trace content or provider message
 * leaks by accident. Exceptions go through `errorName`.
 */
export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(event: LogEvent, fields?: LogFields): void;
  warn(event: LogEvent, fields?: LogFields): void;
  error(event: LogEvent, fields?: LogFields): void;
}

export interface RequestContext {
  requestId: string;
  logger: Logger;
}

/**
 * Per-request context (research R-003). Opened by the `/chat` handler — not
 * by the id middleware: `express.json()` reads the body through socket
 * stream events created outside any context, and AsyncLocalStorage doesn't
 * survive that hop. Deep layers (router, memory, summarizer, `resilient`,
 * the learning reflector) read it with `currentLogger()`; outside an HTTP
 * request (arena, bench, MCP) it is `undefined` and they keep their
 * `console.error` (R-004, LG5).
 */
const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

export function currentLogger(): Logger | undefined {
  return requestContext.getStore()?.logger;
}

/**
 * The shared pattern of every deep layer (research R-004, LG5): inside an
 * HTTP request, emit a JSON line through the request's logger; anywhere
 * else (arena, bench, MCP) run `fallback`, which is the `console.*` call the
 * layer always had — so their output stays byte-for-byte what it was, and
 * the MCP server never gets a line on stdout.
 */
export function logInRequest(emit: (logger: Logger) => void, fallback: () => void): void {
  const logger = currentLogger();
  if (logger) emit(logger);
  else fallback();
}

/** Only the exception's class name — never its message or stack (FR-023). */
export function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
}

export interface LoggerOptions {
  sink?: (line: string) => void;
  now?: () => Date;
}

/**
 * One JSON object per call, on one line (`JSON.stringify` escapes line
 * breaks and quotes). `requestId` comes from the active context, never from
 * the caller. A failing sink is swallowed (FR-024): logging must never
 * change the outcome of a request.
 */
export function createLogger({
  sink = (line) => void process.stdout.write(line + "\n"),
  now = () => new Date(),
}: LoggerOptions = {}): Logger {
  const emit = (level: LogLevel, event: LogEvent, fields?: LogFields): void => {
    try {
      const requestId = requestContext.getStore()?.requestId;
      sink(
        JSON.stringify({
          ts: now().toISOString(),
          level,
          event,
          ...(requestId === undefined ? {} : { requestId }),
          ...fields,
        }),
      );
    } catch {
      // FR-024
    }
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** Default of `createApp` (LG6): tests don't spill JSON into the runner's stdout. */
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
