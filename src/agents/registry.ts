import type { ReasoningStrategy } from "./types.ts";
import { createReactStrategy } from "./react.ts";
import { createPlanAndExecuteStrategy } from "./plan-and-execute.ts";
import type { OpsRepository } from "../store/repository.ts";

export { DEFAULT_MAX_ITERATIONS } from "./types.ts";

const FACTORIES: Record<string, (store: OpsRepository) => ReasoningStrategy> = {
  react: createReactStrategy,
  "plan-and-execute": createPlanAndExecuteStrategy,
};

export function availableStrategyNames(): string[] {
  return Object.keys(FACTORIES);
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
