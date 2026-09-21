import { z } from "zod";
import type { RequestHandler } from "express";
import type { OpsRepository } from "../store/repository.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { DEFAULT_MAX_ITERATIONS, UnknownStrategyError, type ResolveStrategy } from "../agents/index.ts";
import type { ReasoningStrategy } from "../agents/types.ts";
import { HISTORY_WINDOW, withConversationHistory } from "../agents/conversation-history.ts";
import { ConversationNotFoundError } from "../domain/errors.ts";
import { userIdSchema, type ConversationMessage, type RecalledMemory } from "../domain/schemas.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import { createMemoryTools } from "../memory/memory-tools.ts";
import { withMemory } from "../memory/with-memory.ts";
import type { LearningReflector, LearningOutcome } from "../memory/learning-reflector.ts";
import { toErrorBody, zodIssuesToDetails } from "./errors.ts";
import { buildContextBreakdown } from "../context/breakdown.ts";
import type { StrategyResult } from "../trace/types.ts";

/**
 * Validates only the SHAPE of the body (R-003): whether `strategy` names a
 * real strategy is checked afterwards, against the registry, in a separate
 * step — that split is what makes 400 (invalid_body) and 422
 * (unknown_strategy) distinguishable. `z.object` (not `z.strictObject`)
 * silently drops unknown fields (edge case in spec.md); `.trim().min(1)` on
 * `strategy` means a whitespace-only value is a *shape* problem (400), not
 * an unknown-name problem (422). Same rule applies to `conversationId`
 * (007-persistent-conversation, R-011): empty/whitespace-only is 400, not
 * "conversation not found" — that's a 404, reserved for a well-formed id
 * that simply doesn't exist.
 */
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "message é obrigatória e não pode ser vazia."),
  strategy: z.string().trim().min(1, "strategy não pode ser vazia.").optional(),
  reflect: z.boolean().optional().default(false),
  conversationId: z.string().trim().min(1, "conversationId não pode ser vazio.").optional(),
  /** 008-semantic-memory, FR-019/FR-020: empty/whitespace-only is 400, same rule as the fields above. */
  userId: userIdSchema.optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** `StrategyResult` plus the conversation the turn belongs to (FR-011). */
export type ChatResponse = StrategyResult & { conversationId: string };

export interface CreateChatHandlerOptions {
  store: OpsRepository;
  /** 007-persistent-conversation: durable/fake conversation history store. */
  conversationStore: ConversationStore;
  /** 008-semantic-memory: durable/fake semantic memory store. */
  memoryStore: MemoryStore;
  /**
   * 009-learning-reflector: examines the raw message after a successful
   * response and saves at most one durable fact through `memoryStore`
   * (contracts/learning-reflector.md). Never awaited by the handler
   * (FR-002) — its promise never rejects (R-007), so nothing here needs to
   * catch a failure from it, only hand its outcome to `onLearning`.
   */
  learn: LearningReflector;
  /** Production: logs the outcome. Tests: a probe that resolves a promise (FR-023). */
  onLearning: (outcome: LearningOutcome) => void;
  resolveStrategy: ResolveStrategy;
  /** FR-018: 180_000 in production; injected short in tests (FR-025). */
  timeoutMs: number;
}

/**
 * The `POST /chat` handler (contracts/chat-endpoint.md, amended by
 * 007-persistent-conversation/contracts/chat-endpoint.md). Fixed order:
 * parse body -> validate shape (400) -> resolve strategy (422) -> resolve
 * conversation (404) -> run with a deadline (504/500) -> record the turn ->
 * 200. Nothing past a failed step runs.
 */
export function createChatHandler(options: CreateChatHandlerOptions): RequestHandler {
  const { store, conversationStore, memoryStore, learn, onLearning, resolveStrategy, timeoutMs } = options;

  return (req, res, next) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(toErrorBody("invalid_body", "Corpo da requisição inválido.", zodIssuesToDetails(parsed.error.issues)));
      return;
    }

    // Destructured once, right after a successful parse: `parsed.data`
    // itself doesn't narrow into the nested `runChat` closure below (TS
    // loses the `parsed.success` discriminant across a function
    // boundary), but these primitive/string values, once assigned, need
    // no further narrowing.
    const { message, conversationId, userId } = parsed.data;

    let strategy: ReasoningStrategy;
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

    // FR-013/R-002: a well-formed id that doesn't exist is 404, checked
    // BEFORE any execution starts. Absent `conversationId`, history is
    // empty and a conversation is only created after success (R-006,
    // FR-015) — a failed request must not leave a conversation behind.
    let history: ConversationMessage[];
    try {
      history = conversationId ? conversationStore.lastMessages(conversationId, HISTORY_WINDOW) : [];
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        res
          .status(404)
          .json(toErrorBody("conversation_not_found", error.message, { conversationId: error.conversationId }));
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

    // 008-semantic-memory, R-013: with a userId, recall happens HERE —
    // inside the promise that races the deadline, and only the raw message
    // (never the history-enriched text) is used as the query. A recall
    // failure is fail-open (FR-025): logged, treated as zero memories, and
    // the request proceeds — losing memory degrades the answer, it doesn't
    // corrupt it, unlike a failure inside the strategy's own tool calls.
    //
    // Composition (R-012, matching 007's R-008): withMemory wraps the base
    // `strategy` (which may already be withReflection-wrapped by
    // resolveStrategy) BEFORE withConversationHistory wraps everything —
    // so the final text is facts, then history, then the message, and both
    // decorators' metrics survive withReflection rebuilding `metrics`.
    async function runChat(): Promise<StrategyResult> {
      let strategyToRun: ReasoningStrategy = strategy;
      // 010-context-measurement: declared here (not inside the `if`) so
      // the context breakdown below can estimate the memories block for
      // ANY request — `[]` without a userId is the correct input for
      // FR-011's "absent source is 0", not a special case.
      let memories: RecalledMemory[] = [];
      if (userId) {
        try {
          memories = await memoryStore.recall(userId, message);
        } catch (error) {
          console.error("Falha ao recuperar memória semântica:", error);
        }
        strategyToRun = withMemory(strategyToRun, { memories, tools: createMemoryTools(memoryStore, userId) });
      }
      const finalStrategy = withConversationHistory(strategyToRun, history);
      const result = await finalStrategy.run(message, {
        maxIterations: DEFAULT_MAX_ITERATIONS,
        signal: controller.signal,
      });

      // 010-context-measurement, R-008: anchored HERE, outside every
      // decorator — `withReflection` rebuilds `metrics` from scratch on
      // every return, so anything attached inside it would be lost. The
      // estimate uses the same `message`/`history`/`memories` the
      // decorators above just composed the strategy's input from.
      return { ...result, metrics: { ...result.metrics, contextBreakdown: buildContextBreakdown({ message, history, memories }) } };
    }

    const runPromise = runChat();
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

        // FR-014/FR-015: the turn is recorded ONLY on this branch — the
        // timeout branch above never reaches here even if the run finishes
        // later, and any technical failure below falls through to `next`
        // (500) without a partial write reaching the client as success.
        const { result } = outcome;
        const resolvedConversationId = conversationId ?? conversationStore.create();
        conversationStore.append(resolvedConversationId, [
          { role: "user", content: message },
          { role: "assistant", content: result.answer },
        ]);

        const body: ChatResponse = { ...result, conversationId: resolvedConversationId };
        res.status(200).json(body);

        // 009-learning-reflector, FR-001 to FR-003: fired only here, AFTER
        // the response body was handed to Express — never awaited, so it
        // cannot delay or alter what the client already received (FR-002).
        // Only a request with a userId that reached this success branch
        // triggers it; every earlier `return` (400/404/422/504) and the
        // 500 path in the outer `.catch` below never reach this line.
        if (userId) {
          void learn(userId, message).then(onLearning, () => {});
        }
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        next(error);
      });
  };
}
