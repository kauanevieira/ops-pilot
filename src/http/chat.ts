import { z } from "zod";
import type { RequestHandler } from "express";
import type { OpsRepository } from "../store/repository.ts";
import { DEFAULT_MAX_ITERATIONS, UnknownStrategyError, type ResolveStrategy } from "../agents/index.ts";
import { toErrorBody, zodIssuesToDetails } from "./errors.ts";

/**
 * Validates only the SHAPE of the body (R-003): whether `strategy` names a
 * real strategy is checked afterwards, against the registry, in a separate
 * step — that split is what makes 400 (invalid_body) and 422
 * (unknown_strategy) distinguishable. `z.object` (not `z.strictObject`)
 * silently drops unknown fields (edge case in spec.md); `.trim().min(1)` on
 * `strategy` means a whitespace-only value is a *shape* problem (400), not
 * an unknown-name problem (422).
 */
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "message é obrigatória e não pode ser vazia."),
  strategy: z.string().trim().min(1, "strategy não pode ser vazia.").optional(),
  reflect: z.boolean().optional().default(false),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface CreateChatHandlerOptions {
  store: OpsRepository;
  resolveStrategy: ResolveStrategy;
  /** FR-018: 180_000 in production; injected short in tests (FR-025). */
  timeoutMs: number;
}

/**
 * The `POST /chat` handler (contracts/chat-endpoint.md). Fixed order:
 * parse body -> validate shape (400) -> resolve strategy (422) -> run with
 * a deadline (504/500) -> 200. Nothing past a failed step runs.
 */
export function createChatHandler(options: CreateChatHandlerOptions): RequestHandler {
  const { store, resolveStrategy, timeoutMs } = options;

  return (req, res, next) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(toErrorBody("invalid_body", "Corpo da requisição inválido.", zodIssuesToDetails(parsed.error.issues)));
      return;
    }

    let strategy;
    try {
      strategy = resolveStrategy({ name: parsed.data.strategy, reflect: parsed.data.reflect }, store);
    } catch (error) {
      if (error instanceof UnknownStrategyError) {
        res
          .status(422)
          .json(toErrorBody("unknown_strategy", error.message, { validStrategies: error.validStrategies }));
        return;
      }
      next(error);
      return;
    }

    // R-006: cancellation AND an independent clock, not just one of the
    // two. `signal` reaches the strategy so a run that outlives the
    // deadline actually stops touching the shared store (FR-020); the race
    // against `timeoutMs` is what guarantees the client gets a response in
    // time even if some path along the way ignored the signal.
    const controller = new AbortController();
    const runPromise = strategy.run(parsed.data.message, {
      maxIterations: DEFAULT_MAX_ITERATIONS,
      signal: controller.signal,
    });
    // The losing side of the race below must never become an unhandled
    // rejection: an aborted run typically rejects once the timeout wins,
    // and nothing else will ever look at that rejection.
    runPromise.catch(() => {});

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    });

    Promise.race([
      runPromise.then((result) => ({ kind: "result" as const, result })),
      timeoutPromise,
    ])
      .then((outcome) => {
        clearTimeout(timer);
        // FR-021: exactly one response per request — a run that finishes
        // right after the deadline fired must not try to write again.
        if (res.headersSent) return;
        if (outcome.kind === "timeout") {
          controller.abort();
          res.status(504).json(toErrorBody("timeout", `A execução excedeu o tempo limite de ${timeoutMs}ms.`));
          return;
        }
        res.status(200).json(outcome.result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        next(error);
      });
  };
}
