import express, { type Express, type ErrorRequestHandler } from "express";
import { InMemoryOpsRepository } from "../store/in-memory.ts";
import { InMemoryConversationStore } from "../store/in-memory-conversation-store.ts";
import { baselineState } from "../store/seed.ts";
import { resolveStrategy as defaultResolveStrategy, type ResolveStrategy } from "../agents/index.ts";
import type { OpsRepository } from "../store/repository.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { createChatHandler } from "./chat.ts";
import { toErrorBody } from "./errors.ts";

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
  resolveStrategy?: ResolveStrategy;
  /** FR-018: milliseconds before a `/chat` request is aborted. */
  timeoutMs?: number;
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
  const resolveStrategy = deps.resolveStrategy ?? defaultResolveStrategy;
  const timeoutMs = deps.timeoutMs ?? 180_000;

  const app = express();
  app.use(express.json());

  app.post("/chat", createChatHandler({ store, conversationStore, resolveStrategy, timeoutMs }));

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
    if (error instanceof SyntaxError && "status" in error && (error as { status?: unknown }).status === 400) {
      res.status(400).json(toErrorBody("invalid_body", "Corpo da requisição não é um JSON válido."));
      return;
    }
    // Any other unexpected failure (FR-017): no stack, no exception
    // message, in the response BODY — but it still needs to be visible
    // *somewhere*, or every 500 is a silent dead end for whoever runs the
    // server. Logged server-side only, never sent to the client.
    console.error("POST /chat falhou com erro inesperado:", error);
    res.status(500).json(toErrorBody("internal", "Erro interno ao processar a requisição."));
  };
  app.use(errorHandler);

  return app;
}
