# Phase 1 — Data Model: Camada de Reflexão

**Feature**: `002-reflection-layer` | **Date**: 2026-09-18

Entidades e tipos que a feature acrescenta ou altera. Os tipos da 001 (`TraceEvent`,
`RunMetrics`, `StrategyResult`, `ReasoningStrategy`) estão em
[`../001-reasoning-core/data-model.md`](../001-reasoning-core/data-model.md) e só aparecem
aqui quando mudam.

---

## Entidades novas

### `Critique` — o parecer de revisão

A saída estruturada do crítico. Validada por zod, porque saída de modelo é entrada externa.

| Campo | Tipo | Regras |
|---|---|---|
| `approved` | `boolean` | Obrigatório. `true` encerra o ciclo (FR-011). |
| `feedback` | `string` | Obrigatório. Não vazio quando `approved = false` (FR-009, SC-005); pode ser vazio quando `approved = true`. |

```ts
const critiqueSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
});
type Critique = z.infer<typeof critiqueSchema>;
```

### `CritiqueContext` — o que o crítico recebe

Estrutura pura, montada a partir do resultado de uma tentativa. É o que torna o crítico
injetável e a montagem testável offline (R-004).

| Campo | Tipo | Origem |
|---|---|---|
| `input` | `string` | Pedido original do usuário, sempre o original — nunca o enriquecido. |
| `answer` | `string` | `StrategyResult.answer` da tentativa avaliada. |
| `observations` | `{ tool?: string; content: string; isError?: boolean }[]` | Eventos `observation` do rastro da tentativa, na ordem (FR-008). |
| `actions` | `{ tool: string; args: Record<string, unknown> }[]` | Eventos `action` do rastro da tentativa, na ordem. |

Derivada por função pura `buildCritiqueContext(input, result): CritiqueContext`.

### `Critic` — o avaliador

```ts
type Critic = (context: CritiqueContext, callbacks: BaseCallbackHandler[]) => Promise<Critique>;
```

**Refinamento feito na implementação**: `callbacks` foi acrescentado à assinatura para resolver
uma lacuna do desenho original — sem ele, nada permitia ao decorator atribuir as chamadas de
modelo do crítico às métricas do ciclo (FR-022). O decorator cria um `LlmCallCounter` por `run()`
e o passa em `callbacks`; `createLlmCritic()` o encaminha ao `.invoke(...)`, do mesmo jeito que
`react.ts`/`plan-and-execute.ts` já fazem. Um crítico injetado que não faz chamada real de modelo
(como os dublês de teste) pode simplesmente ignorar o array — contribuindo corretamente 0
chamadas às métricas.

Um valor de função, não uma classe. O padrão é `createLlmCritic()`; os testes injetam um
crítico determinístico (R-004).

### `ReflectionOptions` — configuração da camada

| Campo | Tipo | Padrão | Regras |
|---|---|---|---|
| `maxReflections` | `number` | `2` (FR-004) | Inteiro ≥ 0. `0` desliga a revisão (FR-016, R-010). |
| `critic` | `Critic` | `createLlmCritic()` | Ponto de injeção; não exposto na arena. |

### `Attempt` — tentativa (conceitual, não persistida)

Uma execução completa da estratégia base dentro do ciclo. Não existe como tipo próprio: é o
`StrategyResult` que a base devolveu, acumulado pelo laço. A tentativa *k* é identificável
no rastro final como o trecho entre a crítica *k-1* e a crítica *k* (R-007, FR-021).

---

## Tipos alterados

### `StoppedReason` — um valor novo

```diff
- type StoppedReason = "completed" | "max-iterations" | "max-steps";
+ type StoppedReason = "completed" | "max-iterations" | "max-steps" | "max-reflections";
```

Mudança **aditiva** em `src/trace/types.ts` (R-005). `"max-reflections"` significa: o ciclo
esgotou as reflexões sem que o crítico aprovasse (FR-015).

**Regra de precedência do `stoppedReason` devolvido pela estratégia refletida:**

| Situação | `stoppedReason` |
|---|---|
| Crítico aprovou | o da tentativa aprovada |
| `maxReflections = 0` | o da única tentativa, intacto (FR-016) |
| Crítico falhou / parecer inválido | o da tentativa corrente (FR-017) |
| Reflexões esgotadas sem aprovação | `"max-reflections"` (FR-015) — prevalece sobre o da tentativa |

### `TraceEvent` — sem mudança

O evento `critique` já existe desde a 001 e é reaproveitado como está (R-006). O `content`
segue um prefixo estável:

| Prefixo | Significado | Requisito |
|---|---|---|
| `aprovado: <feedback>` | revisão aprovou | FR-018 |
| `reprovado: <feedback>` | revisão reprovou | FR-018 |
| `indisponível: <motivo>` | revisão não pôde ser concluída | FR-020 |

---

## Montagem do rastro final

```text
[ eventos da tentativa 1 ]  ← inclui o `answer` da tentativa 1
critique  "reprovado: ..."
[ eventos da tentativa 2 ]
critique  "aprovado: ..."
```

Invariantes (FR-019, FR-021):

1. A ordem cronológica é preservada dentro de cada tentativa e entre tentativas.
2. Cada evento `critique` vem imediatamente após o último evento da tentativa que avaliou.
3. O número de eventos `critique` é igual ao número de avaliações **concluídas ou
   falhadas** — nunca maior que `maxReflections + 1`, nunca maior que o número de
   tentativas.
4. O `answer` de cada tentativa permanece no rastro, inclusive o das reprovadas: a
   regressão precisa ser auditável (edge case "regenerar produz resposta pior").

## Agregação de métricas

| Métrica | Regra | Requisito |
|---|---|---|
| `llmCalls` | Σ `metrics.llmCalls` de cada tentativa + nº de chamadas do crítico | FR-022, R-008 |
| `latencyMs` | relógio de parede do `run` decorado inteiro (não é soma das tentativas) | FR-023 |

## Input enriquecido da regeneração

Não é uma entidade persistida — é o `input` passado à base na tentativa *k > 1* (R-002,
FR-012). Composto por: pedido original, resposta reprovada, feedback do crítico, ações já
executadas com suas observações, e a instrução de não repetir ações com efeito colateral.
O `input` do `CritiqueContext` continua sendo o **pedido original**, para que o crítico
julgue contra o que o usuário pediu, não contra o andaime da regeneração.
