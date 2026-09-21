import { EMBEDDING_DIM, type Embedder } from "./embeddings.ts";

/**
 * A deterministic, offline stand-in for `Embedder` (008-semantic-memory,
 * R-004): used by every test except the one real-model test
 * (embeddings.test.ts), so the store's threshold logic (dedup > 0.92,
 * recall >= 0.3, top-3, tie-break) is exercised against EXACT, known dot
 * products instead of whatever a real model happens to produce — the
 * thing under test is the arithmetic, not the model.
 *
 * `table` maps text to a normalized vector built by `unitVector`. `embed`
 * throws for any text not in the table — a test that reaches for an
 * unplanned proximity should fail loudly, not silently get an arbitrary
 * vector.
 */
export function createTableEmbedder(table: Record<string, Float32Array>): Embedder {
  return {
    async embed(text: string): Promise<Float32Array> {
      const vector = table[text];
      if (!vector) {
        throw new Error(`createTableEmbedder: no vector planned for text ${JSON.stringify(text)}`);
      }
      return vector;
    },
  };
}

/**
 * Builds a normalized EMBEDDING_DIM-length vector whose dot product with
 * `unitVector(0, ...)` (or any other angle) is exactly `Math.cos(angle -
 * otherAngle)` when both vectors are constructed in the same 2D plane
 * (positions 0 and 1; every other position is 0). That's what lets a test
 * assert an exact score like 0.95 or 0.3 instead of an approximate one.
 *
 * Only safe for a table of at most two related texts: with three or more
 * vectors sharing the same plane, any two whose angle to a shared "query"
 * is close will *also* be close to each other, which is a fact-to-fact
 * proximity a test almost never intends — use `axisVector` for that case.
 *
 * `angle` in radians. `dims` defaults to EMBEDDING_DIM so vectors from this
 * helper pass the store's BLOB size CHECK unmodified.
 */
export function unitVector(angle: number, dims: number = EMBEDDING_DIM): Float32Array {
  const v = new Float32Array(dims);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

/**
 * Builds a normalized vector at EXACTLY `score` proximity to the "query"
 * vector `axisVector(1, 0)` (i.e. the unit vector on axis 0), by putting
 * the rest of its length on its own private `axis` (>= 1).
 *
 * Unlike `unitVector`, two facts built on DIFFERENT axes have a dot
 * product of `score1 * score2` with each other — decoupled from how close
 * each is to the query — which is what a recall test with 3+ candidate
 * facts needs: it wants to control each fact's score to the query
 * independently, without an unplanned `remember()` dedup between facts
 * that merely happen to have similar scores to that query.
 *
 * `axis` MUST be >= 1 and distinct per fact — axis 0 IS the score
 * component (index 0), so `axisVector(s, 0)` would overwrite it with
 * `sqrt(1 - s*s)` instead of leaving `s` in place. Reusing the same axis
 * for two facts makes them identical on purpose.
 */
export function axisVector(score: number, axis: number, dims: number = EMBEDDING_DIM): Float32Array {
  if (axis === 0) throw new Error("axisVector: axis must be >= 1 (axis 0 is the score component itself)");
  const v = new Float32Array(dims);
  v[0] = score;
  v[axis] = Math.sqrt(Math.max(0, 1 - score * score));
  return v;
}

/** The "query" vector every `axisVector` score is measured against: e0. */
export function queryVector(dims: number = EMBEDDING_DIM): Float32Array {
  const v = new Float32Array(dims);
  v[0] = 1;
  return v;
}
