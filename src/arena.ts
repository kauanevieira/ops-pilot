import { z } from "zod";
import { InMemoryOpsRepository } from "./store/in-memory.ts";
import { baselineState } from "./store/seed.ts";
import { availableStrategyNames, createStrategy, DEFAULT_MAX_ITERATIONS } from "./agents/registry.ts";
import { formatMetrics, formatTrace } from "./trace/format.ts";

const argsSchema = z.object({
  input: z.string().min(1, "O pedido em linguagem natural é obrigatório."),
  strategies: z.array(z.string().min(1)).min(1),
  maxIterations: z.number().int().min(1),
});

interface ParsedArgs {
  input?: string;
  strategies?: string;
  maxIterations?: string;
}

function parseArgv(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strategies") {
      parsed.strategies = argv[++i];
    } else if (arg === "--max-iterations") {
      parsed.maxIterations = argv[++i];
    } else if (arg) {
      positional.push(arg);
    }
  }

  return { ...parsed, input: positional.join(" ") || undefined };
}

function validateArgs(argv: string[]) {
  const raw = parseArgv(argv);
  return argsSchema.parse({
    input: raw.input ?? "",
    strategies: raw.strategies ? raw.strategies.split(",").map((s) => s.trim()) : availableStrategyNames(),
    maxIterations: raw.maxIterations ? Number(raw.maxIterations) : DEFAULT_MAX_ITERATIONS,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  let args: z.infer<typeof argsSchema>;
  try {
    args = validateArgs(argv);
  } catch (error) {
    console.error("Argumentos inválidos:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  const unknown = args.strategies.filter((name) => !availableStrategyNames().includes(name));
  if (unknown.length > 0) {
    console.error(
      `Estratégia(s) desconhecida(s): ${unknown.join(", ")}. Estratégias válidas: ${availableStrategyNames().join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  for (const name of args.strategies) {
    // Fresh, independently-seeded state per strategy so runs never interfere (FR-030).
    const store = new InMemoryOpsRepository(baselineState());
    const strategy = createStrategy(name, store);

    const result = await strategy.run(args.input, { maxIterations: args.maxIterations });

    console.log(`\n━━━ ${name} ━━━`);
    console.log(formatTrace(result.trace));
    console.log(`\n  ${formatMetrics(result.metrics, result.stoppedReason)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
