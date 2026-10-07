import type { RequestHandler, Response } from "express";
import {
  requestStatusSchema,
  type ChatErrorCode,
} from "../domain/schemas.ts";
import { errorName, runWithRequestContext, type LogFields, type Logger } from "../obs/logger.ts";
import { toRequestRecord } from "../obs/request-record.ts";
import type { RequestStore } from "../obs/request-store.ts";
import type { StrategyResult } from "../trace/types.ts";

/**
 * Per-response state shared by the middleware, the `/chat` handler and the
 * error handler through `res.locals.obs` (data-model.md).
 */
export interface RequestObs {
  requestId: string;
  receivedAt: Date;
  /** True once a persist was ATTEMPTED (even a failed one), so `finish` never writes twice. */
  recorded: boolean;
  durationMs?: number;
  errorCode?: ChatErrorCode;
  body?: { conversationId?: string; userId?: string };
  /** Metadata-only fields for the `request.end` line, filled on success. */
  summary?: LogFields;
}

export function getObs(res: Response): RequestObs | undefined {
  return res.locals.obs as RequestObs | undefined;
}

export interface TrackingDeps {
  requestStore: RequestStore;
  logger: Logger;
  now: () => Date;
}

/**
 * Persists the request row (and the trace, on success) and NEVER throws
 * (FR-012): a failure becomes a `request.persist_failed` line and the caller
 * proceeds as if nothing happened. Must run inside the request context so
 * that line carries the `requestId`.
 */
export function persistRequest(
  deps: TrackingDeps,
  obs: RequestObs,
  input: { status: number; errorCode: ChatErrorCode | null; conversationId: string | null; userId: string | null; result?: StrategyResult },
): void {
  obs.recorded = true;
  const finishedAt = deps.now();
  obs.durationMs = Math.max(0, Math.round(finishedAt.getTime() - obs.receivedAt.getTime()));
  try {
    const status = requestStatusSchema.parse(input.status);
    const record = toRequestRecord({
      requestId: obs.requestId,
      receivedAt: obs.receivedAt,
      finishedAt,
      status,
      errorCode: input.errorCode,
      conversationId: input.conversationId,
      userId: input.userId,
      ...(input.result ? { result: input.result } : {}),
    });
    deps.requestStore.record(record, input.result?.trace ?? []);
  } catch (error) {
    deps.logger.error("request.persist_failed", { errorName: errorName(error) });
  }
}

/**
 * Mounted on `POST /chat` BEFORE `express.json()` (research R-002): a body
 * that isn't valid JSON is rejected inside the parser and never reaches the
 * handler, so only a step ahead of it can put `X-Request-Id` on every
 * response. The id is always generated here; a client-sent `X-Request-Id`
 * is never read (FR-004).
 *
 * On `finish` it records every response the handler didn't already record
 * (all errors: empty trace) and logs `request.end`. The success path records
 * from the handler instead, before the response is written (FR-011).
 */
export function createRequestTracking(deps: TrackingDeps & { generateRequestId: () => string }): RequestHandler {
  const { generateRequestId, logger, now } = deps;
  return (req, res, next) => {
    const obs: RequestObs = { requestId: generateRequestId(), receivedAt: now(), recorded: false };
    res.locals.obs = obs;
    res.setHeader("X-Request-Id", obs.requestId);

    runWithRequestContext({ requestId: obs.requestId, logger }, () => {
      logger.info("request.start", { method: req.method, path: req.path });
    });

    res.on("finish", () => {
      runWithRequestContext({ requestId: obs.requestId, logger }, () => {
        if (!obs.recorded) {
          persistRequest(deps, obs, {
            status: res.statusCode,
            errorCode: res.statusCode === 200 ? null : (obs.errorCode ?? "internal"),
            conversationId: obs.body?.conversationId ?? null,
            userId: obs.body?.userId ?? null,
          });
        }
        const fields: LogFields = {
          status: res.statusCode,
          durationMs: obs.durationMs ?? 0,
          traceEvents: typeof obs.summary?.traceEvents === "number" ? obs.summary.traceEvents : 0,
          ...(res.statusCode === 200 ? obs.summary : { errorCode: obs.errorCode ?? "internal" }),
        };
        logger.info("request.end", fields);
      });
    });

    next();
  };
}
