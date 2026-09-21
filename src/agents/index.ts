import type { ReasoningStrategy } from "./types.ts";
import { createReactStrategy } from "./react.ts";
import { createPlanAndExecuteStrategy } from "./plan-and-execute.ts";
import { withReflection } from "./reflection.ts";
import { withIncidentConfirmation } from "./incident-confirmation.ts";
import type { OpsRepository } from "../store/repository.ts";

export { DEFAULT_MAX_ITERATIONS } from "./types.ts";

/**
 * `withIncidentConfirmation` wraps every base strategy (005-provider-status-tool
 * amendment to 004's `open_incident` contract, `contracts/ops-tools.md`): a
 * prompt-only fix for the model's final answer omitting or fabricating the
 * incident id made things worse in live testing, so the guarantee is
 * applied here in code instead, underneath `reflect:*` — the critic then
 * judges the already-corrected answer, not a possibly-fabricated one.
 */
const BASE_FACTORIES: Record<string, (store: OpsRepository) => ReasoningStrategy> = {
  react: (store) => withIncidentConfirmation(createReactStrategy(store)),
  "plan-and-execute": (store) => withIncidentConfirmation(createPlanAndExecuteStrategy(store)),
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

/**
 * Raised by both `resolveStrategy` (003-chat-http-api) and `createStrategy`
 * (001-reasoning-core) when the requested name doesn't exist. `validStrategies`
 * carries the exact list the caller should have chosen from — `resolveStrategy`
 * fills it with `baseStrategyNames()`, `createStrategy` with
 * `availableStrategyNames()` — so an HTTP handler can surface it verbatim as
 * FR-015's 422 `details.validStrategies` without re-deriving the list itself.
 */
export class UnknownStrategyError extends Error {
  readonly validStrategies: string[];

  constructor(name: string, validStrategies: string[]) {
    super(`Unknown strategy: "${name}". Valid strategies: ${validStrategies.join(", ")}`);
    this.name = "UnknownStrategyError";
    this.validStrategies = validStrategies;
  }
}

/** Consulting an unknown name MUST error listing the valid names (FR-033). */
export function createStrategy(name: string, store: OpsRepository): ReasoningStrategy {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new UnknownStrategyError(name, availableStrategyNames());
  }
  return factory(store);
}

// --- 003-chat-http-api: the surface the HTTP layer consumes ---------------

/**
 * Only the base names — react, plan-and-execute. This is the single source
 * of truth for the HTTP endpoint's validation and its 422 error message
 * (FR-011): it deliberately does NOT include the `reflect:*` derived names,
 * since on the API reflection is the `reflect` boolean, not a name prefix.
 */
export function baseStrategyNames(): string[] {
  return Object.keys(BASE_FACTORIES);
}

/** What the API body expresses: a base strategy name plus reflection as a modifier (FR-010). */
export interface StrategySelection {
  name?: string;
  reflect?: boolean;
}

export type ResolveStrategy = (selection: StrategySelection, store: OpsRepository) => ReasoningStrategy;

/**
 * Resolves an API selection to a strategy: `name` defaults to "react"
 * (FR-007), `reflect` defaults to false (FR-008), and `withReflection` is
 * applied over whichever base strategy was picked (FR-010) — no entry has to
 * be registered per combination. Composite names like "reflect:react" are
 * rejected: on the API, reflection is controlled by the `reflect` field only.
 */
export const resolveStrategy: ResolveStrategy = (selection, store) => {
  const name = selection.name ?? "react";
  const factory = BASE_FACTORIES[name];
  if (!factory) {
    throw new UnknownStrategyError(name, baseStrategyNames());
  }
  const strategy = factory(store);
  return selection.reflect ? withReflection(strategy) : strategy;
};
