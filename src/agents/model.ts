import { AsyncLocalStorage } from "node:async_hooks";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { RunnableLambda, type Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { failureKindSchema, modelIdSchema, RETRYABLE_FAILURES, type FailureKind } from "../domain/schemas.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * A single model, tagged with the id it was built from — every producer of
 * `model_used`/`fallback` events (below) reports this id, never the
 * model object itself, so the trace stays JSON-serializable.
 */
export interface SourcedModel {
  id: string;
  model: BaseChatModel;
}

/**
 * Where `resilient` (below) gets the primary and, optionally, a backup
 * model (013-model-resilience, research R-005). Injectable so tests never
 * read the environment or hit the network (Constitution, Princípio V).
 * `envModelSource()` — the production default — reads `OPENROUTER_*` only
 * when `primary()`/`backup()` are actually called, never when the source
 * itself, or anything built on top of it, is merely constructed.
 */
export interface ModelSource {
  primary(): SourcedModel;
  /** `null` with no configured backup, an empty/whitespace value, or one equal to the primary (FR-002). */
  backup(): SourcedModel | null;
}

/** 013-model-resilience, FR-004: the primary gets up to this many attempts in total. */
export const MAX_PRIMARY_ATTEMPTS = 3;

/**
 * The `ChatOpenAI` factory, parametrized by model id (research R-003).
 * `maxRetries: 0` is new: the OpenAI client's own `AsyncCaller` retries up
 * to 6 times by default, underneath anything `withRetry` (below) adds —
 * without this, one attempt from `resilient` could silently become up to
 * 7 calls to the provider (FR-007).
 */
export function createChatModel(id: string): ChatOpenAI {
  return new ChatOpenAI({
    modelName: id,
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: 0,
    maxRetries: 0,
    // Some OpenRouter routes (notably rate-limited free-tier aliases) hang
    // instead of returning an error under load. Without a client-side
    // timeout a stuck call blocks the strategy forever; failing fast here
    // surfaces the problem instead of hanging the arena indefinitely. It's
    // also why a timed-out call is never retried on the primary (FR-005):
    // three attempts at up to 60s each could eat most of the request's
    // 180s deadline.
    timeout: 60_000,
    // 010-context-measurement, R-002: `streaming: true` MUST NOT be set
    // here. In that mode ChatOpenAI computes `usage_metadata.input_tokens`
    // itself, from a local tiktoken estimate over the prompt — a number
    // that would look exactly like the provider's real reported count to
    // `inputTokensFromResult`, but isn't one. `metrics.promptTokens` is
    // documented as real precisely because this factory never streams.
  });
}

/**
 * Production default `ModelSource` (research R-005): reads the environment
 * only inside `primary()`/`backup()`, never at construction, so building
 * it — and everything built on top of it — stays callable without
 * credentials (Princípio V).
 */
export function envModelSource(): ModelSource {
  return {
    primary() {
      const id = modelIdSchema.parse(requireEnv("OPENROUTER_MODEL"));
      return { id, model: createChatModel(id) };
    },
    backup() {
      const raw = process.env.OPENROUTER_MODEL_FALLBACK;
      if (!raw || raw.trim().length === 0) return null;
      const id = modelIdSchema.parse(raw);
      const primaryId = modelIdSchema.parse(requireEnv("OPENROUTER_MODEL"));
      if (id === primaryId) return null;
      return { id, model: createChatModel(id) };
    },
  };
}

/**
 * Classifies a model call's failure (013-model-resilience, research R-004).
 * `@langchain/openai`'s `wrapOpenAIClientError` already normalizes the
 * provider's own errors to `name: "TimeoutError"` and a numeric `status`
 * (401/404/429/5xx), so this reads those fields rather than re-parsing
 * anything provider-specific. `"aborted"` is not a model failure at all —
 * `resilient` never retries or falls back on it, it always propagates.
 */
export function classifyModelError(error: unknown, signal?: AbortSignal): FailureKind | "aborted" {
  if (signal?.aborted) return "aborted";
  if (error instanceof Error) {
    if (error.name === "AbortError") return "aborted";
    if (error.name === "TimeoutError") return "timeout";
    const status = (error as { status?: unknown }).status;
    if (status === 429) return "rate_limit";
    if (typeof status === "number" && status >= 500) return "provider_error";
    if (error instanceof TypeError) return "network";
  }
  return "non_transient";
}

/**
 * Raised when neither the primary nor the backup (or the primary alone,
 * with no backup configured) answered a call (FR-011). The `/chat` handler
 * translates this — by `instanceof`, never by message — into a 503
 * `model_unavailable` (contracts/chat-endpoint.md, MR4). `tried` lists the
 * model ids actually attempted, in order; `reason` is the primary's own
 * last failure classification (never the backup's, which would just say
 * "non_transient" after an already-explained primary failure).
 */
export class ModelUnavailableError extends Error {
  readonly tried: string[];
  readonly reason: FailureKind;

  constructor(tried: string[], reason: FailureKind) {
    super(`Nenhum modelo respondeu (tentados: ${tried.join(", ")}; motivo: ${reason}).`);
    this.name = "ModelUnavailableError";
    this.tried = tried;
    this.reason = reason;
  }
}

/** Custom callback events `resilient` dispatches (research R-007). Payloads never carry the provider's error message (FR-012). */
export const MODEL_USED_EVENT = "opspilot:model_used";
export const MODEL_FALLBACK_EVENT = "opspilot:model_fallback";

/**
 * Marks a call that skipped the primary because this request already
 * switched to the backup (research R-006) — never itself surfaced to a
 * caller; `resilient` always converts it into either a clean pass-through
 * to the backup, or (with no backup) the "inconsistent resilience wiring"
 * error below, which should be unreachable in practice (every call site in
 * one request shares the same `ModelSource`).
 */
class PrimarySkippedError extends Error {
  constructor() {
    super("Modelo principal pulado: este pedido já trocou para o reserva.");
    this.name = "PrimarySkippedError";
  }
}

interface ResilienceScope {
  primaryDown: boolean;
}

const resilienceScope = new AsyncLocalStorage<ResilienceScope>();

/**
 * Opens the per-request scope that makes a switch to the backup stick for
 * the rest of the request (013-model-resilience, FR-011a, research R-006):
 * once any call inside `fn` switches, every later call in the same `fn`
 * skips the primary's attempts entirely. `createProductionGraph`'s `run`
 * is the only production caller — one scope per `/chat` request. Arena and
 * bench never call this, so each of their calls decides independently,
 * matching FR-023's "same resilience, same behavior with no failure".
 */
export function runWithResilienceScope<T>(fn: () => Promise<T>): Promise<T> {
  return resilienceScope.run({ primaryDown: false }, fn);
}

/**
 * Wraps a model-consuming step with retry-then-fallback resilience
 * (013-model-resilience, contracts/model-factory.md). `build` is how the
 * CALLER prepares the model — `m => m.bindTools(tools)`, `m =>
 * m.withStructuredOutput(schema)`, or `m => m` for plain text — because
 * `withRetry`/`withFallbacks` return plain `Runnable`s that don't expose
 * `bindTools`/`withStructuredOutput` themselves (research R-001): the
 * model has to be prepared BEFORE resilience wraps it, not after.
 *
 * The primary gets up to `MAX_PRIMARY_ATTEMPTS` attempts, but only for
 * failures in `RETRYABLE_FAILURES` (rate limit, provider error, network) —
 * a timeout or a non-transient failure (unknown model, rejected request,
 * bad credential, malformed structured output) goes straight to the
 * backup. With no backup, or when the backup also fails (any reason other
 * than the request being cancelled), the call rejects with
 * `ModelUnavailableError`.
 */
export function resilient<RunInput, RunOutput>(
  build: (model: BaseChatModel) => Runnable<RunInput, RunOutput>,
  source: ModelSource = envModelSource(),
): Runnable<RunInput, RunOutput> {
  // Resolved lazily, INSIDE the steps below, never here — `source.primary()`
  // reads the environment (MF1), and merely calling `resilient(...)` must
  // not. `primaryId` is readable from `onFailedAttempt` because it's
  // always set before the attempt's promise can reject.
  let primaryId: string | undefined;
  let lastPrimaryError: unknown;
  // `RunnableWithFallbacks.invoke` (verified in the installed
  // `@langchain/core`) always rethrows the FIRST runnable's error when
  // every runnable failed — never the last one. A `ModelUnavailableError`
  // thrown from `backupStep` below would never reach the caller that way,
  // so the outer wrapper (bottom of this function) reconstructs the
  // outcome itself from this state instead of trusting the error object
  // `withFallbacks` propagates.
  let backupId: string | undefined;
  let lastBackupError: unknown;

  const primaryStep = RunnableLambda.from<RunInput, RunOutput>(async (input, config) => {
    if (resilienceScope.getStore()?.primaryDown) {
      throw new PrimarySkippedError();
    }
    const primary = source.primary();
    primaryId = primary.id;
    try {
      const output = await build(primary.model).invoke(input, config);
      await dispatchCustomEvent(MODEL_USED_EVENT, { model: primary.id }, config);
      return output;
    } catch (error) {
      lastPrimaryError = error;
      throw error;
    }
  }).withRetry({
    stopAfterAttempt: MAX_PRIMARY_ATTEMPTS,
    onFailedAttempt: (error: unknown) => {
      if (error instanceof PrimarySkippedError) throw error;
      const kind = classifyModelError(error);
      if (kind === "aborted" || !RETRYABLE_FAILURES.has(kind)) {
        console.error(`Modelo principal (${primaryId}) falhou (${kind}); sem nova tentativa:`, error);
        throw error;
      }
      console.error(`Modelo principal (${primaryId}) falhou (${kind}); tentando de novo:`, error);
    },
  });

  // Always attached — whether there's a configured backup is itself only
  // knowable by calling `source.backup()`, which has to wait until
  // invocation for the same reason as `source.primary()` above. Every
  // throw in here is TRANSPARENT (rethrows the real error, never
  // `ModelUnavailableError` directly) — see the note on `backupId` above
  // for why that translation happens one level up instead.
  const backupStep = RunnableLambda.from<RunInput, RunOutput>(async (input, config) => {
    const backup = source.backup();

    if (!backup) {
      throw lastPrimaryError;
    }
    backupId = backup.id;

    const scope = resilienceScope.getStore();
    const primaryWasSkipped = scope?.primaryDown ?? false;
    if (!primaryWasSkipped) {
      const reason = failureKindSchema.parse(classifyModelError(lastPrimaryError));
      if (scope) scope.primaryDown = true;
      await dispatchCustomEvent(MODEL_FALLBACK_EVENT, { from: primaryId, to: backup.id, reason }, config);
      console.error(`Trocando para o modelo reserva (${backup.id}) após falha do principal (${primaryId}):`, lastPrimaryError);
    }
    try {
      const output = await build(backup.model).invoke(input, config);
      await dispatchCustomEvent(MODEL_USED_EVENT, { model: backup.id }, config);
      return output;
    } catch (error) {
      lastBackupError = error;
      throw error;
    }
  });

  const combined = primaryStep.withFallbacks([backupStep]);

  // The outer wrapper: translates "every runnable above failed" into
  // `ModelUnavailableError`, using the state each step recorded — not the
  // error `withFallbacks` itself propagates (see the note above `backupId`).
  return RunnableLambda.from<RunInput, RunOutput>(async (input, config) => {
    try {
      return await combined.invoke(input, config);
    } catch (error) {
      if (classifyModelError(error, config?.signal) === "aborted") throw error;
      if (backupId !== undefined) {
        console.error(`Modelo reserva (${backupId}) também falhou:`, lastBackupError ?? error);
        throw new ModelUnavailableError([primaryId ?? "?", backupId], failureKindSchema.parse(classifyModelError(lastBackupError ?? error)));
      }
      console.error(`Modelo principal (${primaryId}) indisponível; sem reserva configurado:`, lastPrimaryError ?? error);
      throw new ModelUnavailableError([primaryId ?? "?"], failureKindSchema.parse(classifyModelError(lastPrimaryError ?? error)));
    }
  });
}
