# Contract: ReasoningStrategy

**Feature**: `001-reasoning-core` | Satisfies FR-001 a FR-006

A interface que toda estratégia de raciocínio implementa. É o ponto de extensão do
núcleo: acrescentar uma estratégia significa implementar este contrato e registrá-la.

## Interface

```ts
interface ReasoningStrategy {
  readonly name: string;
  run(input: string, options?: RunOptions): Promise<StrategyResult>;
}

interface RunOptions {
  maxIterations?: number;   // default definido no registro de estratégias
}

interface StrategyResult {
  answer: string;
  trace: TraceEvent[];
  metrics: RunMetrics;
  stoppedReason: "completed" | "max-iterations" | "max-steps";
}
```

`TraceEvent`, `RunMetrics` e as enumerações estão em [data-model.md](../data-model.md).

## Obrigações do implementador

| # | Obrigação | Requisito |
|---|-----------|-----------|
| 1 | `name` é estável, único e usável como valor de `--strategies` | FR-001, FR-032 |
| 2 | `run` nunca lança por limite atingido; encerra com `stoppedReason` correspondente | FR-005 |
| 3 | `run` propaga erro apenas para falhas irrecuperáveis (configuração ausente, falha de rede) | FR-010 |
| 4 | `metrics.llmCalls` reflete as chamadas realmente feitas naquela execução | FR-006 |
| 5 | `metrics.latencyMs` mede a execução inteira, do início de `run` ao retorno | FR-004 |
| 6 | Todo evento `action` no rastro carrega `tool` e `args` | FR-003 |
| 7 | Erros de domínio de ferramenta viram evento `observation` com `isError: true`, sem abortar | FR-015 |
| 8 | Instâncias são reutilizáveis: duas chamadas a `run` não compartilham contador nem rastro | FR-006 |

## Garantias para o chamador

- O rastro devolvido é a sequência ordenada completa do que ocorreu — não uma amostra.
- Um rastro pode terminar sem evento `answer` se `stoppedReason !== "completed"`.
- `metrics` está sempre presente, inclusive em execução interrompida por limite (SC-002).

## Registro de estratégias

```ts
const STRATEGIES: Record<string, () => ReasoningStrategy>
// chaves: "react" | "plan-and-execute"
```

Consultar um nome ausente MUST produzir erro listando as chaves válidas (FR-033).
