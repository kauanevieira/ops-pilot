import type { ReasoningStrategy } from "./types.ts";
import { createReactStrategy } from "./react.ts";
import { createPlanAndExecuteStrategy } from "./plan-and-execute.ts";
import { withReflection } from "./reflection.ts";
import type { OpsRepository } from "../store/repository.ts";

export { DEFAULT_MAX_ITERATIONS } from "./types.ts";

const BASE_FACTORIES: Record<string, (store: OpsRepository) => ReasoningStrategy> = {
  react: createReactStrategy,
  "plan-and-execute": createPlanAndExecuteStrategy,
};

/**
 * The reflected entries are DERIVED from the base factories, not written as
 * literal strings (FR-003, FR-024, R-011): the name a strategy reports
 * (`withReflection` sets it to `reflect:${strategy.name}`) can never drift
 * from the key it's registered under, which is what would silently break
 * the arena if the two were maintained by hand in two places.
 */
const FACTORIES: Record<string, (store: OpsRepository) => ReasoningStrategy> = Object.fromEntries([
  ...Object.entries(BASE_FACTORIES),
  ...Object.entries(BASE_FACTORIES).map(
    ([name, factory]) => [`reflect:${name}`, (store: OpsRepository) => withReflection(factory(store))] as const,
  ),
]);

export function availableStrategyNames(): string[] {
  return Object.keys(FACTORIES);
}

/**
 * The arena's default set when `--strategies` is omitted (T026): only the
 * raw strategies. Reflection multiplies model calls by up to
 * `maxReflections + 1` per strategy — an unflagged `npm run arena` should
 * not silently triple its cost. The reflected strategies stay fully
 * selectable via `--strategies reflect:react,...` (FR-026); this only
 * changes what runs with no flag at all.
 */
export function defaultStrategyNames(): string[] {
  return Object.keys(BASE_FACTORIES);
}

/** Consulting an unknown name MUST error listing the valid names (FR-033). */
export function createStrategy(name: string, store: OpsRepository): ReasoningStrategy {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new Error(
      `Unknown strategy: "${name}". Valid strategies: ${availableStrategyNames().join(", ")}`,
    );
  }
  return factory(store);
}
