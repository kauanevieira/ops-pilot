import type { RequestHandler } from "express";
import type { RequestStore } from "../obs/request-store.ts";
import { toErrorBody } from "./errors.ts";

/**
 * `GET /requests/:id` (contracts/requests-endpoint.md): the request's record
 * plus its trace in the original order. Read-only (RQ4) and deliberately
 * outside the tracking middleware — it has no id of its own and writes
 * neither a record nor a log line. The id is never format-validated: it is
 * only a bound lookup parameter, and anything that doesn't exist is the
 * same 404 (RQ3).
 */
export function createGetRequestHandler(requestStore: RequestStore): RequestHandler {
  return (req, res, next) => {
    const requestId = String(req.params.id);
    try {
      const found = requestStore.get(requestId);
      if (!found) {
        res.status(404).json(toErrorBody("request_not_found", "Pedido não encontrado.", { requestId }));
        return;
      }
      res.status(200).json({
        request: { ...found.request, receivedAt: found.request.receivedAt.toISOString() },
        trace: found.trace,
      });
    } catch (error) {
      next(error);
    }
  };
}
