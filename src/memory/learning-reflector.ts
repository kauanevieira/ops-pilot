import { memoryFactSchema, type RememberResult } from "../domain/schemas.ts";
import type { Distiller } from "./distiller.ts";
import { looksLikeSecret } from "./secret-guard.ts";
import type { MemoryStore } from "./memory-store.ts";

/** Independent of the request's own 180 s deadline (contracts/learning-reflector.md, R-005). */
export const LEARNING_TIMEOUT_MS = 30_000;

export type LearningSkipReason = "no-learning" | "invalid-fact" | "secret-in-message" | "secret-in-fact";

/**
 * The result of one examination, delivered to `onLearning` (R-006, R-007).
 * Not a domain entity — never validated or persisted — so it lives here,
 * next to the orchestration that produces it, rather than in
 * `domain/schemas.ts`.
 */
export type LearningOutcome =
  | { kind: "learned"; userId: string; result: RememberResult }
  | { kind: "skipped"; userId: string; reason: LearningSkipReason }
  | { kind: "failed"; userId: string; stage: "distill" | "remember"; error: unknown };

export type LearningReflector = (userId: string, message: string) => Promise<LearningOutcome>;

/**
 * Builds an `AbortController` that aborts itself after `timeoutMs`, and a
 * promise that races `work(signal)` against that timeout — deliberately
 * NOT `AbortSignal.timeout()`: that built-in creates a timer that node:test
 * (Node 22.22.2, verified) flags as "still pending" and cancels the rest of
 * the test file over, even when the race settles correctly and nothing is
 * actually leaked. A plain `setTimeout`, cleared in every branch, doesn't
 * trip that detector. A distiller that ignores its `signal` argument still
 * cannot hold up the reflector past `timeoutMs` (R-005, L5), because this
 * function's own promise settles on the timeout regardless.
 */
function withTimeout<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Tempo limite do refletor de aprendizado excedido."));
    }, timeoutMs);
    work(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Builds the learning reflector (contracts/learning-reflector.md): examines
 * one message, decides whether it holds a durable fact about the person who
 * sent it, and saves at most one through `memoryStore.remember` — the same
 * dedup, same user, same recall as 008 (FR-012). The returned promise NEVER
 * rejects (L1): every failure becomes a `"failed"` outcome instead, because
 * by the time this runs, the HTTP response has already been sent — there is
 * no request left to fail (R-007, same precedent as 008's fail-open recall).
 */
export function createLearningReflector(deps: {
  memoryStore: MemoryStore;
  distiller: Distiller;
  timeoutMs?: number;
}): LearningReflector {
  const { memoryStore, distiller, timeoutMs = LEARNING_TIMEOUT_MS } = deps;

  return async (userId, message): Promise<LearningOutcome> => {
    // Step 1: the raw message itself, BEFORE the distiller is even called
    // (R-008) — a secret the model might paraphrase past any pattern
    // applied only to the distilled fact never gets that chance.
    if (looksLikeSecret(message)) {
      return { kind: "skipped", userId, reason: "secret-in-message" };
    }

    // Step 2: distill, bounded by its own timeout, independent of the
    // request's 180 s deadline (R-005).
    let decision;
    try {
      decision = await withTimeout(timeoutMs, (signal) => distiller(message, signal));
    } catch (error) {
      return { kind: "failed", userId, stage: "distill", error };
    }

    // Step 3: no learning proposed.
    if (!decision.hasLearning) {
      return { kind: "skipped", userId, reason: "no-learning" };
    }

    // Step 4: the proposed fact must itself be a valid fact (non-empty,
    // ≤500 chars, 008's own rule) — a decision that SAYS there is
    // learning but brings nothing usable is "nothing to learn" (FR-014),
    // never a failure.
    const parsed = memoryFactSchema.safeParse(decision.fact);
    if (!parsed.success) {
      return { kind: "skipped", userId, reason: "invalid-fact" };
    }
    const fact = parsed.data;

    // Step 5: the second, model-independent barrier, now on the fact the
    // model actually proposed (FR-010) — covers the model proposing a
    // secret even when the message itself didn't look like one.
    if (looksLikeSecret(fact)) {
      return { kind: "skipped", userId, reason: "secret-in-fact" };
    }

    // Steps 6-7: save through the exact same path as 008's tool used to
    // (FR-012) — same dedup, same user scoping.
    try {
      const result = await memoryStore.remember(userId, fact);
      return { kind: "learned", userId, result };
    } catch (error) {
      return { kind: "failed", userId, stage: "remember", error };
    }
  };
}

/**
 * Default `onLearning` (production): logs the outcome server-side, never in
 * the HTTP response, which was already sent by the time this fires
 * (FR-013). `learned` never logs the fact's text — only its id and whether
 * it was newly created. `skipped` logs nothing: it's the common case, and
 * logging every ordinary request would be noise.
 */
export function logLearningOutcome(outcome: LearningOutcome): void {
  if (outcome.kind === "failed") {
    console.error(
      `Refletor de aprendizado falhou (userId: ${outcome.userId}, etapa: ${outcome.stage}):`,
      outcome.error,
    );
    return;
  }
  if (outcome.kind === "learned") {
    console.info(
      `Refletor de aprendizado: fato ${outcome.result.created ? "guardado" : "já existia"} ` +
        `(userId: ${outcome.userId}, memoryId: ${outcome.result.memoryId}).`,
    );
  }
}
