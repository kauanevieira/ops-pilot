# Contract: withReflection

**Feature**: `002-reflection-layer` | Satisfies FR-001 a FR-006, FR-011 a FR-026

Decorator que envolve qualquer `ReasoningStrategy` em um ciclo de crítica e regeneração,
devolvendo uma estratégia que cumpre o mesmo contrato.

## Interface

```ts
function withReflection(
  strategy: ReasoningStrategy,
  options?: ReflectionOptions,
): ReasoningStrategy;

interface ReflectionOptions {
  maxReflections?: number;  // default 2 (FR-004)
  critic?: Critic;          // default createLlmCritic() (R-004)
}
```

`ReasoningStrategy`, `RunOptions` e `StrategyResult` são os da
[001](../../001-reasoning-core/contracts/reasoning-strategy.md), sem alteração.
`Critique`, `Critic` e `ReflectionOptions` estão em [data-model.md](../data-model.md).

## Algoritmo

```text
attempt   := 1
answerRun := strategy.run(input, options)          # tentativa 1
trace     := answerRun.trace
calls     := answerRun.metrics.llmCalls

se maxReflections == 0:  devolve answerRun com name decorado    # FR-016

repete no máximo maxReflections vezes:
    critique := critic(buildCritiqueContext(input, answerRun))   # FR-006..FR-010
      ↳ em erro: trace += critique("indisponível: …"); encerra   # FR-017, FR-020
    trace += critique("aprovado:|reprovado: " + feedback)        # FR-018
    se critique.approved: encerra com answerRun                  # FR-011
    answerRun := strategy.run(enriquecer(input, answerRun, critique), options)  # FR-012
    trace += answerRun.trace ; calls += answerRun.metrics.llmCalls
    attempt += 1

se saiu por esgotamento sem aprovação: stoppedReason := "max-reflections"   # FR-015
```

## Obrigações do implementador

| # | Obrigação | Requisito |
|---|-----------|-----------|
| 1 | `name` é `` `reflect:${strategy.name}` `` — derivado, nunca literal | FR-003, R-011 |
| 2 | A estratégia base não é modificada nem precisa saber que foi decorada | FR-001 |
| 3 | `RunOptions` recebido é repassado **íntegro** à base em toda tentativa | FR-005 |
| 4 | A base é executada no máximo `maxReflections + 1` vezes | FR-014, SC-003 |
| 5 | `maxReflections = 0` devolve o resultado da base sem crítica e sem chamada extra | FR-016, R-010 |
| 6 | Falha ou parecer inválido do crítico nunca propaga como erro de `run` | FR-017, SC-006 |
| 7 | O rastro concatena todas as tentativas em ordem, com a crítica após a resposta avaliada | FR-019, R-007 |
| 8 | `llmCalls` soma tentativas + chamadas do crítico | FR-022 |
| 9 | `latencyMs` cobre o `run` decorado inteiro | FR-023 |
| 10 | Instâncias são reutilizáveis: duas chamadas a `run` não compartilham contador nem rastro | FR-002 (herdado da 001) |
| 11 | Decorar uma estratégia já decorada é aninhamento simples, sem tratamento especial | edge case |

## Garantias para o chamador

- O valor devolvido é intercambiável com qualquer estratégia crua, inclusive na arena.
- `trace` contém entre 0 e `maxReflections + 1` eventos `critique`.
- A resposta devolvida é sempre a da **última** tentativa executada, aprovada ou não.
- `stoppedReason === "max-reflections"` ⟺ o ciclo esgotou sem aprovação (FR-015).

## Registro na arena

`registry.ts` deriva as entradas refletidas a partir das fábricas base (R-011, FR-024):

| Nome na arena | Composição |
|---|---|
| `react` | `createReactStrategy(store)` |
| `plan-and-execute` | `createPlanAndExecuteStrategy(store)` |
| `reflect:react` | `withReflection(createReactStrategy(store))` |
| `reflect:plan-and-execute` | `withReflection(createPlanAndExecuteStrategy(store))` |

`availableStrategyNames()` passa a devolver os quatro nomes, o que faz a mensagem de erro
de nome inválido já existente listar as versões refletidas sem alteração (FR-025). O
comportamento padrão da arena sem `--strategies` passa a rodar as quatro.

`ReflectionOptions` **não** é exposto como flag de CLI nesta feature: a arena usa sempre o
padrão de 2 reflexões.
