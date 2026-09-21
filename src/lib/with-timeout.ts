/**
 * Builds an `AbortController` that aborts itself after `timeoutMs`, and a
 * promise that races `work(signal)` against that timeout — deliberately
 * NOT `AbortSignal.timeout()`: that built-in creates a timer that node:test
 * (Node 22.22.2, verified) flags as "still pending" and cancels the rest of
 * the test file over, even when the race settles correctly and nothing is
 * actually leaked. A plain `setTimeout`, cleared in every branch, doesn't
 * trip that detector. Callers whose `work` ignores its `signal` argument
 * still cannot hold up the caller past `timeoutMs`, because this function's
 * own promise settles on the timeout regardless.
 *
 * Extracted from `memory/learning-reflector.ts` (009-learning-reflector,
 * R-005) by 011-history-summarization (R-006), which needed the same
 * mechanism for the conversation summarizer. `options.parentSignal` is new
 * in this extraction: when given, aborting it also aborts `work`'s own
 * `signal` and rejects — the summarizer needs to stop when the enclosing
 * `/chat` request is cancelled, not just when its own timer fires.
 */
export function withTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  options?: { parentSignal?: AbortSignal; timeoutMessage?: string },
): Promise<T> {
  const { parentSignal, timeoutMessage = "Tempo limite excedido." } = options ?? {};
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const onParentAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      reject(new Error(timeoutMessage));
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        onParentAbort();
        return;
      }
      parentSignal.addEventListener("abort", onParentAbort);
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      parentSignal?.removeEventListener("abort", onParentAbort);
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    work(controller.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parentSignal?.removeEventListener("abort", onParentAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parentSignal?.removeEventListener("abort", onParentAbort);
        reject(error);
      },
    );
  });
}
