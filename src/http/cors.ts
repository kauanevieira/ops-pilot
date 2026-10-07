import type { RequestHandler } from "express";

/**
 * 016-war-room-web (contracts/cors.md, research R-001/R-002): the war room
 * is served from another origin, so the browser needs the API to release it.
 * Written by hand — the policy is a closed list of origins and three
 * headers, which fits one pure function (Principle I) instead of a runtime
 * dependency.
 */

/** FR-024: the war room's own dev server. Used when `OPSPILOT_CORS_ORIGINS` is unset or blank. */
export const DEFAULT_CORS_ORIGINS: readonly string[] = ["http://localhost:5173"];

function invalid(item: string, why: string): Error {
  return new Error(`OPSPILOT_CORS_ORIGINS inválida: "${item}" ${why}`);
}

/**
 * FR-024: `OPSPILOT_CORS_ORIGINS` is a comma-separated list of bare
 * `http`/`https` origins. Each is normalized (`new URL(o).origin`) so the
 * comparison later is exact. A bad item refuses the start, naming the item.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_CORS_ORIGINS];
  return raw.split(",").map((part) => {
    const item = part.trim();
    if (item === "") throw invalid(raw, "tem um item vazio.");
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw invalid(item, "não é uma URL. Use o formato http://host:porta.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw invalid(item, "precisa começar com http:// ou https://.");
    }
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      throw invalid(item, "deve ser só a origem, sem caminho, query nem fragmento.");
    }
    return url.origin;
  });
}

export interface CorsRequest {
  /** The `Origin` header, when the browser sent one. */
  origin?: string;
  method: string;
  /** `Access-Control-Request-Method` — its presence is what makes an OPTIONS a preflight. */
  requestMethod?: string;
}

export interface CorsDecision {
  headers: Record<string, string>;
  /** Preflight: answer 204 right here, never reaching a route. */
  end: boolean;
}

/** Pure: which headers a request gets, and whether the response ends here. */
export function corsDecision(request: CorsRequest, allowlist: readonly string[]): CorsDecision {
  const { origin, method, requestMethod } = request;
  // CO1: no Origin (curl, tests, the MCP server) — exactly as before this feature.
  if (origin === undefined) return { headers: {}, end: false };

  const preflight = method === "OPTIONS" && requestMethod !== undefined;
  // CO3: exact match against the normalized list. No wildcard, no suffix.
  if (!allowlist.includes(origin)) return { headers: { Vary: "Origin" }, end: preflight };

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "X-Request-Id",
    Vary: "Origin",
  };
  if (preflight) {
    headers["Access-Control-Allow-Methods"] = "GET, POST";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  // CO4: `Access-Control-Allow-Credentials` is never sent — the API has no cookies.
  return { headers, end: preflight };
}

/**
 * Registered before every route (CO5), so the 400 of a malformed body and
 * the 5xx of the error handler carry the headers too. A preflight ends here,
 * which keeps it out of `requestTracking` and the log (CO2).
 */
export function createCors(allowlist: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const decision = corsDecision(
      {
        method: req.method,
        ...(req.headers.origin !== undefined ? { origin: req.headers.origin } : {}),
        ...(typeof req.headers["access-control-request-method"] === "string"
          ? { requestMethod: req.headers["access-control-request-method"] }
          : {}),
      },
      allowlist,
    );
    for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
    if (decision.end) {
      res.status(204).end();
      return;
    }
    next();
  };
}
