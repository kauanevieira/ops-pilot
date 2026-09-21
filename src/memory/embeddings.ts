import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Multilingual, not the model requested (008-semantic-memory, R-002,
 * measured against the real runtime): `all-MiniLM-L6-v2` is English-only.
 * On Portuguese pairs, every UNRELATED pair scored 0.30-0.39 — above the
 * 0.3 recall cutoff, so FR-014 would filter nothing — and a paraphrase
 * scored 0.70, short of the 0.92 dedup threshold (FR-010 would never fire).
 * This model, same library/pooling/dimension, separated the groups cleanly
 * (unrelated 0.03-0.32, related 0.39-0.64, paraphrase 0.93). Decided with
 * the user; see research.md R-002 for the full measurement table.
 */
export const EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBEDDING_DTYPE = "q8";
export const EMBEDDING_DIM = 384;

/**
 * `data/models/`, not the library's default
 * (`node_modules/@huggingface/transformers/.cache/`) — R-006, verified: the
 * default is wiped by any `npm ci` or `node_modules` reinstall, forcing a
 * fresh 113 MB download. `data/` is already gitignored and is where the
 * project's other local artifacts (the SQLite file) live. Resolved from
 * `import.meta.url`, not `process.cwd()`, so it doesn't depend on where the
 * process happens to be launched from.
 */
export const MODEL_CACHE_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "data", "models");

/** A normalized (norm 1), EMBEDDING_DIM-length vector representing a text's meaning. */
export interface Embedder {
  embed(text: string): Promise<Float32Array>;
}

interface LoadOptions {
  /**
   * false ⇒ never touch the network; a model not already in
   * MODEL_CACHE_DIR fails immediately instead of downloading (R-005).
   * Defaults to true (production).
   */
  allowRemote?: boolean;
}

/**
 * The real loader: imports the library lazily (R-003) so no test that only
 * needs the fake embedder pays for loading the native ONNX module, sets
 * the cache directory, and builds a feature-extraction pipeline.
 */
async function loadRealExtractor(options: LoadOptions): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = MODEL_CACHE_DIR;
  env.allowRemoteModels = options.allowRemote ?? true;
  return pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE });
}

/**
 * Builds an `Embedder` around any extractor loader — the real one in
 * production, or a fake in `embeddings.test.ts` that never touches the
 * model, so the singleton/retry behavior (E1-E3) is tested without paying
 * for or requiring the ONNX runtime (contracts/memory-store.md).
 *
 * The Promise itself is memoized (R-003), not its result: N concurrent
 * `embed()` calls made while the model is still loading share the same
 * load (FR-008) instead of racing N loads. On failure, the memo is
 * cleared so the NEXT call retries instead of the embedder staying broken
 * for the rest of the process (a server that started without network
 * shouldn't need a restart once the network comes back).
 */
export function createEmbedderFromLoader(load: () => Promise<FeatureExtractionPipeline>): Embedder {
  let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

  function getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!extractorPromise) {
      extractorPromise = load().catch((error: unknown) => {
        extractorPromise = undefined;
        throw error;
      });
    }
    return extractorPromise;
  }

  return {
    async embed(text: string): Promise<Float32Array> {
      const extractor = await getExtractor();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      // Defensive copy: nothing in the library's contract promises the
      // returned tensor's underlying buffer isn't reused by a later call.
      return new Float32Array(output.data as Float32Array);
    },
  };
}

/** The production `Embedder` — a lazy singleton over the real model (R-003). */
export function createLocalEmbedder(options: LoadOptions = {}): Embedder {
  return createEmbedderFromLoader(() => loadRealExtractor(options));
}
