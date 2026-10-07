import type { ChatErrorCode, ModelPrices, RequestRecord, Route } from "../domain/schemas.ts";

// Pure (Principle I): no clock, no database. The `GET /stats` handler loads
// the window's records and hands them here (015, contracts/stats-endpoint.md).

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
export const MAX_SINCE_MS = 90 * UNIT_MS.d;
export const DEFAULT_SINCE = "24h";

/** `"24h"` → 86 400 000. `null` for anything outside `<positive int><m|h|d>` up to 90 days (FR-001). */
export function parseSince(raw: string): number | null {
  const match = /^([1-9][0-9]{0,6})(m|h|d)$/.exec(raw);
  if (!match) return null;
  const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
  return ms <= MAX_SINCE_MS ? ms : null;
}

/** Nearest-rank (ST5): the value at position ⌈q·n⌉ of the sorted list; `null` when empty. */
export function percentile(sortedAsc: readonly number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.max(1, Math.ceil(q * sortedAsc.length));
  return sortedAsc[rank - 1]!;
}

/**
 * Estimated INPUT cost of one request (FR-006). `:free` is always 0; a paid
 * model needs both a price and recorded tokens, otherwise the cost is
 * unknown (`null`) — never silently 0 (SC-003).
 */
export function costOf(record: Pick<RequestRecord, "modelUsed" | "promptTokens">, prices: ModelPrices): number | null {
  if (record.modelUsed?.endsWith(":free")) return 0;
  if (record.modelUsed == null || record.promptTokens == null) return null;
  const price = prices[record.modelUsed];
  return price === undefined ? null : (record.promptTokens * price) / 1_000_000;
}

export interface LatencyPercentiles {
  p50: number | null;
  p95: number | null;
}

interface Aggregate {
  requests: number;
  promptTokens: number;
  costUsd: number;
  unpricedRequests: number;
  latencyMs: LatencyPercentiles;
}

export type RouteStats = { route: Route | null } & Aggregate;
export type ModelStats = { model: string | null } & Aggregate;

export interface Stats {
  since: string;
  from: string;
  to: string;
  total: number;
  errors: number;
  errorsByCode: Partial<Record<ChatErrorCode, number>>;
  promptTokens: number;
  costUsd: number;
  unpricedRequests: number;
  latencyMs: LatencyPercentiles;
  byRoute: RouteStats[];
  byModel: ModelStats[];
}

const roundUsd = (value: number): number => Math.round(value * 1e6) / 1e6;

function aggregate(records: readonly RequestRecord[], prices: ModelPrices): Aggregate {
  let promptTokens = 0;
  let costUsd = 0;
  let unpricedRequests = 0;
  for (const record of records) {
    promptTokens += record.promptTokens ?? 0;
    const cost = costOf(record, prices);
    if (cost === null) unpricedRequests += 1;
    else costUsd += cost;
  }
  const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    requests: records.length,
    promptTokens,
    costUsd: roundUsd(costUsd),
    unpricedRequests,
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
  };
}

function groupBy<K>(records: readonly RequestRecord[], key: (r: RequestRecord) => K): Map<K, RequestRecord[]> {
  const groups = new Map<K, RequestRecord[]>();
  for (const record of records) {
    const k = key(record);
    const list = groups.get(k);
    if (list) list.push(record);
    else groups.set(k, [record]);
  }
  return groups;
}

/** ST6: most requests first; ties broken by key, `null` last. */
function byRequestsThenKey<T extends { requests: number }>(keyOf: (item: T) => string | null) {
  return (a: T, b: T): number => {
    if (b.requests !== a.requests) return b.requests - a.requests;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  };
}

/**
 * Aggregates the records of one window (FR-002 to FR-008). Only records whose
 * `receivedAt` falls in `[from, to]` count. Errors (status ≠ 200) enter
 * `total`/`errors`/`errorsByCode` only: they have no route, model or
 * execution, and their millisecond durations would distort the latency of
 * actually serving a request (FR-007).
 */
export function computeStats(input: {
  records: readonly RequestRecord[];
  since: string;
  from: Date;
  to: Date;
  prices: ModelPrices;
}): Stats {
  const { prices, from, to } = input;
  const inWindow = input.records.filter((r) => r.receivedAt >= from && r.receivedAt <= to);
  const ok = inWindow.filter((r) => r.status === 200);

  const errorsByCode: Partial<Record<ChatErrorCode, number>> = {};
  for (const r of inWindow) {
    if (r.status !== 200 && r.errorCode) errorsByCode[r.errorCode] = (errorsByCode[r.errorCode] ?? 0) + 1;
  }

  const overall = aggregate(ok, prices);
  // Tokens and cost of the window = those of its 200s: an error records none.
  const byRoute = [...groupBy(ok, (r) => r.route)].map(([route, rs]) => ({ route, ...aggregate(rs, prices) }));
  const byModel = [...groupBy(ok, (r) => r.modelUsed)].map(([model, rs]) => ({ model, ...aggregate(rs, prices) }));

  return {
    since: input.since,
    from: from.toISOString(),
    to: to.toISOString(),
    total: inWindow.length,
    errors: inWindow.length - ok.length,
    errorsByCode,
    promptTokens: overall.promptTokens,
    costUsd: overall.costUsd,
    unpricedRequests: overall.unpricedRequests,
    latencyMs: overall.latencyMs,
    byRoute: byRoute.sort(byRequestsThenKey<RouteStats>((g) => g.route)),
    byModel: byModel.sort(byRequestsThenKey<ModelStats>((g) => g.model)),
  };
}
