import type { RequestHandler } from "express";
import type { ModelPrices } from "../domain/schemas.ts";
import type { RequestStore } from "../obs/request-store.ts";
import { computeStats, DEFAULT_SINCE, parseSince } from "../obs/stats.ts";
import { toErrorBody } from "./errors.ts";

/**
 * `GET /stats?since=24h` (015, contracts/stats-endpoint.md). The edge only
 * reads the clock and the store; every number comes from the pure
 * `computeStats`. Read-only (ST7): outside the tracking middleware, so it
 * neither records a request nor emits `X-Request-Id`.
 */
export function createStatsHandler(deps: { requestStore: RequestStore; now: () => Date; prices: ModelPrices }): RequestHandler {
  const { requestStore, now, prices } = deps;
  return (req, res, next) => {
    const raw = req.query.since ?? DEFAULT_SINCE;
    // A repeated `?since=` arrives as an array: as malformed as "abc".
    const ms = typeof raw === "string" ? parseSince(raw) : null;
    if (ms === null) {
      res
        .status(400)
        .json(toErrorBody("invalid_query", "since deve ser <número><m|h|d>, até 90d (ex.: 30m, 24h, 7d).", { since: raw }));
      return;
    }
    try {
      const to = now();
      const from = new Date(to.getTime() - ms);
      const records = requestStore.listSince(from, to);
      res.status(200).json(computeStats({ records, since: raw as string, from, to, prices }));
    } catch (error) {
      next(error);
    }
  };
}
