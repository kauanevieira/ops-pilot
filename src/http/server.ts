import { DatabaseSync } from "node:sqlite";
import express, { type Express, type ErrorRequestHandler } from "express";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { InMemoryConversationStore } from "../store/in-memory-conversation-store.ts";
import { baselineState } from "../store/seed.ts";
import { resolveStrategy as defaultResolveStrategy, type ResolveStrategy } from "../agents/index.ts";
import type { OpsRepository } from "../store/repository.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import { SqliteMemoryStore } from "../memory/memory-store.ts";
import { createLocalEmbedder } from "../memory/embeddings.ts";
import type { Distiller } from "../memory/distiller.ts";
import { createModelDistiller } from "../memory/distiller.ts";
import type { LearningOutcome } from "../memory/learning-reflector.ts";
import { createLearningReflector, logLearningOutcome, LEARNING_TIMEOUT_MS } from "../memory/learning-reflector.ts";
import type { Summarizer } from "../context/summarizer.ts";
import { createModelSummarizer } from "../context/summarizer.ts";
import { SUMMARY_TIMEOUT_MS } from "../context/conversation-context.ts";
import type { Router } from "../agents/router.ts";
import { ROUTER_TIMEOUT_MS, createModelRouter } from "../agents/router.ts";
import { createChatHandler } from "./chat.ts";
import { DEFAULT_CORS_ORIGINS, createCors } from "./cors.ts";
import { toErrorBody, withRequestId } from "./errors.ts";
import { createRequestTracking, getObs } from "./request-tracking.ts";
import { createGetRequestHandler } from "./requests.ts";
import { createStatsHandler } from "./stats.ts";
import type { ModelPrices } from "../domain/schemas.ts";
import { errorName, runWithRequestContext, silentLogger, type Logger } from "../obs/logger.ts";
import { SqliteRequestStore, type RequestStore } from "../obs/request-store.ts";
import { randomUUID } from "node:crypto";

/**
 * Injectable dependencies (R-007, FR-022): production defaults below, and
 * tests substitute `resolveStrategy` with a fake, deterministic strategy
 * and `timeoutMs` with a short value (FR-025) — offline by construction,
 * not by mocking a module.
 */
export interface ChatAppDeps {
  /** FR-012a/b/c: one instance, shared by every request handled by this app. */
  store?: OpsRepository;
  /** 007-persistent-conversation: one instance, shared across requests, like `store`. */
  conversationStore?: ConversationStore;
  /**
   * 008-semantic-memory: one instance, shared across requests. The default
   * embedder is a lazy singleton (createLocalEmbedder, R-003) — building
   * this default never loads the model; only a request WITH a `userId`
   * ever calls `embed()`, so a request without one pays nothing (FR-024).
   */
  memoryStore?: MemoryStore;
  /**
   * 009-learning-reflector: examines a message's raw text after a
   * successful response. The default, `createModelDistiller()`, is only
   * ever CONSTRUCTED here — building it reads no environment variable, so
   * `createApp()` stays callable without credentials; only invoking it
   * (which no test does — tests always inject their own) would need
   * `OPENROUTER_*` (R-002, Princípio V).
   */
  distiller?: Distiller;
  /** FR-015: independent of `timeoutMs` — default `LEARNING_TIMEOUT_MS` (30s). */
  learningTimeoutMs?: number;
  /** Production default logs server-side (FR-013); tests inject a probe (FR-023). */
  onLearning?: (outcome: LearningOutcome) => void;
  resolveStrategy?: ResolveStrategy;
  /** FR-018: milliseconds before a `/chat` request is aborted. */
  timeoutMs?: number;
  /**
   * 011-history-summarization: folds what falls out of the recent history
   * window into a durable, cumulative summary. The default,
   * `createModelSummarizer()`, is only ever CONSTRUCTED here — building it
   * reads no environment variable, same pattern as `distiller` above.
   */
  summarizer?: Summarizer;
  /** 011-history-summarization, FR-010: independent of `timeoutMs` — default `SUMMARY_TIMEOUT_MS` (30s). */
  summaryTimeoutMs?: number;
  /**
   * 012-unified-graph: decides which strategy runs when the request omits
   * `strategy` and `reflect` (contracts/router.md). The default,
   * `createModelRouter()`, is only ever CONSTRUCTED here — building it
   * reads no environment variable, same pattern as `summarizer` and
   * `distiller` above; tests inject their own deterministic fake.
   */
  router?: Router;
  /** 012-unified-graph, FR-011: independent of `timeoutMs` — default `ROUTER_TIMEOUT_MS` (15s). */
  routerTimeoutMs?: number;
  /**
   * 014-request-tracing: durable record + trace of every `/chat` request,
   * read back by `GET /requests/:id`. Default: its own `:memory:` SQLite,
   * isolated per app like `memoryStore` — production injects one over the
   * real database file.
   */
  requestStore?: RequestStore;
  /**
   * 014-request-tracing, LG6: where the JSON log lines go. Default is
   * silent, so tests never spill into the runner's stdout; `src/index.ts`
   * is the only place that turns real logging on.
   */
  logger?: Logger;
  /** 014-request-tracing, FR-001: default `crypto.randomUUID`; tests inject a sequence. */
  generateRequestId?: () => string;
  /** 014-request-tracing: clock for `receivedAt`/`durationMs`; tests inject a controlled one. */
  now?: () => Date;
  /**
   * 015-request-stats: USD per 1M input tokens, by model id, for the cost
   * in `GET /stats`. Default `{}` — only `:free` models then have a known
   * cost. `src/index.ts` reads it from `OPENROUTER_PRICES`; tests inject it.
   */
  modelPrices?: ModelPrices;
  /**
   * 016-war-room-web: the origins the browser may call this API from
   * (contracts/cors.md). Default is the war room's own dev server;
   * `src/index.ts` reads `OPSPILOT_CORS_ORIGINS`.
   */
  corsOrigins?: string[];
}

/**
 * Builds the Express application WITHOUT opening a port (R-001, FR-026) —
 * that separation is what lets the integration test drive it on an
 * ephemeral port instead of a fixed one. `src/index.ts` is the only thing
 * that calls `.listen()`.
 */
export function createApp(deps: ChatAppDeps = {}): Express {
  const store = deps.store ?? new InMemoryOpsRepository(baselineState());
  const conversationStore = deps.conversationStore ?? new InMemoryConversationStore();
  const memoryStore = deps.memoryStore ?? new SqliteMemoryStore(new DatabaseSync(":memory:"), createLocalEmbedder());
  const distiller = deps.distiller ?? createModelDistiller();
  const learningTimeoutMs = deps.learningTimeoutMs ?? LEARNING_TIMEOUT_MS;
  const onLearning = deps.onLearning ?? logLearningOutcome;
  const resolveStrategy = deps.resolveStrategy ?? defaultResolveStrategy;
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const summarizer = deps.summarizer ?? createModelSummarizer();
  const summaryTimeoutMs = deps.summaryTimeoutMs ?? SUMMARY_TIMEOUT_MS;
  const router = deps.router ?? createModelRouter();
  const routerTimeoutMs = deps.routerTimeoutMs ?? ROUTER_TIMEOUT_MS;
  const requestStore = deps.requestStore ?? new SqliteRequestStore(new DatabaseSync(":memory:"));
  const logger = deps.logger ?? silentLogger;
  const generateRequestId = deps.generateRequestId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const modelPrices = deps.modelPrices ?? {};
  const corsOrigins = deps.corsOrigins ?? [...DEFAULT_CORS_ORIGINS];

  const learn = createLearningReflector({ memoryStore, distiller, timeoutMs: learningTimeoutMs });

  const app = express();
  // 016-war-room-web: before every route, so the headers reach even the 400 of
  // a malformed body, and a preflight never gets to the tracking middleware.
  app.use(createCors(corsOrigins));
  // 014-request-tracing (research R-002): the tracking middleware goes
  // BEFORE the JSON parser, so even a malformed body gets `X-Request-Id`.
  app.post(
    "/chat",
    createRequestTracking({ requestStore, logger, now, generateRequestId }),
    express.json(),
    createChatHandler({
      store,
      conversationStore,
      memoryStore,
      learn,
      onLearning,
      resolveStrategy,
      timeoutMs,
      summarizer,
      summaryTimeoutMs,
      router,
      routerTimeoutMs,
      requestStore,
      logger,
      now,
    }),
  );

  app.get("/requests/:id", createGetRequestHandler(requestStore));
  app.get("/stats", createStatsHandler({ requestStore, now, prices: modelPrices }));

  // Registered after the routes, as Express requires for a 4-arg error
  // handler to be recognized as one.
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    // express.json() throws a SyntaxError with `status: 400` and a `body`
    // property for a request body that isn't valid JSON (R-005) — treated
    // as the same invalid_body every other validation failure uses,
    // instead of letting Express's default HTML error page leak past
    // FR-016/FR-017.
    const obs = getObs(res);
    // 014-request-tracing: the id is on every error body (FR-003) and the
    // code is handed to the middleware's `finish` hook, which records it.
    const errorBody = (code: "invalid_body" | "internal", message: string) => {
      if (!obs) return toErrorBody(code, message);
      obs.errorCode = code;
      return withRequestId(toErrorBody(code, message), obs.requestId);
    };
    if (error instanceof SyntaxError && "status" in error && (error as { status?: unknown }).status === 400) {
      res.status(400).json(errorBody("invalid_body", "Corpo da requisição não é um JSON válido."));
      return;
    }
    // Any other unexpected failure (FR-017): no stack, no exception
    // message, in the response BODY — but it still needs to be visible
    // *somewhere*, or every 500 is a silent dead end for whoever runs the
    // server. Logged server-side only, never sent to the client.
    //
    // 014-request-tracing, FR-022/FR-023: now one metadata-only JSON line
    // (class name + request id) instead of the exception object. The
    // message and stack are deliberately NOT logged — the accepted cost of
    // "metadata only"; the request id leads to the saved trace and the
    // conversation, which is what reproduces the defect (research R-005).
    if (obs) {
      runWithRequestContext({ requestId: obs.requestId, logger }, () => {
        logger.error("request.internal_error", { errorName: errorName(error) });
      });
    } else {
      console.error("POST /chat falhou com erro inesperado:", error);
    }
    res.status(500).json(errorBody("internal", "Erro interno ao processar a requisição."));
  };
  app.use(errorHandler);

  return app;
}
