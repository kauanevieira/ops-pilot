import { z } from "zod";
import { InMemoryOpsRepository } from "./store/in-memory.ts";
import { createReactStrategy } from "./agents/react.ts";
import { createPlanAndExecuteStrategy } from "./agents/plan-and-execute.ts";
import { DEFAULT_MAX_ITERATIONS } from "./agents/types.ts";
import { SCENARIOS, benchBaselineState } from "./bench/scenarios.ts";
import { formatMetrics, formatTrace } from "./trace/format.ts";
import type { ReasoningStrategy } from "./agents/types.ts";
import type { OpsRepository } from "./store/repository.ts";

const SCENARIO_IDS = SCENARIOS.map((s) => s.id.toLowerCase());

const argsSchema = z.object({
  scenario: z.enum(SCENARIO_IDS as [string, ...string[]]).optional(),
  noReplanner: z.boolean(),
});

interface ParsedArgs {
  scenario?: string;
  noReplanner: boolean;
}

function parseArgv(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { noReplanner: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenario") {
      parsed.scenario = argv[++i];
    } else if (arg === "--no-replanner") {
      parsed.noReplanner = true;
    }
  }

  return parsed;
}

function validateArgs(argv: string[]) {
  const raw = parseArgv(argv);
  return argsSchema.parse({
    scenario: raw.scenario?.toLowerCase(),
    noReplanner: raw.noReplanner,
  });
}

/**
 * `react` has no replanner to disable, so `--no-replanner` only ever
 * affects the plan-and-execute build. `disableReplanner` is a
 * construction-time choice (it changes the strategy's graph shape), not a
 * per-run option, so it's threaded in here rather than through
 * `RunOptions`.
 */
const STRATEGY_FACTORIES: readonly {
  name: string;
  create: (store: OpsRepository, noReplanner: boolean) => ReasoningStrategy;
}[] = [
  { name: "react", create: (store) => createReactStrategy(store) },
  {
    name: "plan-and-execute",
    create: (store, noReplanner) => createPlanAndExecuteStrategy(store, { disableReplanner: noReplanner }),
  },
];

interface ResultRow {
  cenario: string;
  estrategia: string;
  acerto: string;
  llmCalls: number;
  latencyMs: number;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  let args: z.infer<typeof argsSchema>;
  try {
    args = validateArgs(argv);
  } catch (error) {
    console.error("Argumentos inválidos:", error instanceof Error ? error.message : error);
    console.error(`--scenario aceita: ${SCENARIO_IDS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const scenarios = args.scenario ? SCENARIOS.filter((s) => s.id.toLowerCase() === args.scenario) : SCENARIOS;

  const rows: ResultRow[] = [];

  for (const scenario of scenarios) {
    for (const factory of STRATEGY_FACTORIES) {
      // Fresh, independently-seeded state per (scenario, strategy) pair —
      // the same guarantee arena.ts gives its runs, so nothing here leaks
      // into another combination's store.
      const initial = benchBaselineState();
      const store = new InMemoryOpsRepository(initial);
      const strategy = factory.create(store, args.noReplanner);

      console.log(`\n━━━ ${scenario.id} (${scenario.label}) — ${strategy.name} ━━━`);
      const result = await strategy.run(scenario.prompt, { maxIterations: DEFAULT_MAX_ITERATIONS });
      console.log(formatTrace(result.trace));
      console.log(`  ${formatMetrics(result.metrics, result.stoppedReason)}`);

      // Acerto is checked against the STORE'S final state, not the answer
      // text (deterministic, no LLM-as-judge needed) — `initial` is the
      // pre-run snapshot, `store.state` the post-run one; the pure state
      // transitions in store/state.ts never mutate `initial` in place.
      const acerto = scenario.check(initial, store.state);
      rows.push({
        cenario: `${scenario.id} (${scenario.label})`,
        estrategia: strategy.name,
        acerto: acerto ? "✅" : "❌",
        llmCalls: result.metrics.llmCalls,
        latencyMs: result.metrics.latencyMs,
      });
    }
  }

  console.log("\n━━━ Resultado consolidado ━━━");
  console.table(rows);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
