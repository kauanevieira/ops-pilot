# Data Model: Refletor de Aprendizado

**Feature**: `009-learning-reflector` | **Date**: 2026-09-21

**Nenhuma mudança de banco.** Um fato aprendido é uma linha comum da tabela `memories` da 008
(`id`, `user_id`, `fact`, `embedding`, `created_at`), gravada por `MemoryStore.remember` com a
mesma deduplicação (> 0,92). Não há coluna de origem (R-012).

## Entidades novas (transitórias, só em memória)

### `LearningDecision` — `src/domain/schemas.ts`

A saída estruturada do distiller (FR-005).

```ts
export const learningDecisionSchema = z.object({
  hasLearning: z
    .boolean()
    .describe("true só se a mensagem contém um fato durável sobre a própria pessoa, seguro de guardar"),
  fact: z
    .string()
    .describe("o fato em uma frase curta e autocontida, em terceira pessoa; string vazia quando hasLearning é false"),
});
export type LearningDecision = z.infer<typeof learningDecisionSchema>;
```

| Campo | Tipo | Regra |
|---|---|---|
| `hasLearning` | boolean | — |
| `fact` | string | sempre presente; validado **depois** com `memoryFactSchema` (trim, 1–500) — R-003 |

Estados que o refletor distingue:

| `hasLearning` | `fact` depois do trim | Desfecho |
|---|---|---|
| `false` | qualquer | `skipped / no-learning` |
| `true` | vazio ou > 500 | `skipped / invalid-fact` |
| `true` | válido, forma de credencial | `skipped / secret-in-fact` |
| `true` | válido, limpo | `remember` → `learned` ou `failed / remember` |

### `LearningOutcome` — `src/memory/learning-reflector.ts`

O desfecho de um exame, entregue ao gancho `onLearning` (R-007). Não é entidade de domínio
(não é validado nem persistido); é tipo de orquestração, por isso fica no módulo do refletor.

```ts
export type LearningSkipReason = "no-learning" | "invalid-fact" | "secret-in-message" | "secret-in-fact";

export type LearningOutcome =
  | { kind: "learned"; userId: string; result: RememberResult }
  | { kind: "skipped"; userId: string; reason: LearningSkipReason }
  | { kind: "failed"; userId: string; stage: "distill" | "remember"; error: unknown };
```

Transições de um exame (uma por pedido elegível):

```text
mensagem ──looksLikeSecret──► skipped/secret-in-message
    │
    ▼
distiller (≤ 30 s) ──rejeita/tempo──► failed/distill
    │
    ├─ hasLearning=false ──► skipped/no-learning
    ├─ fato inválido ─────► skipped/invalid-fact
    ├─ fato com segredo ──► skipped/secret-in-fact
    ▼
remember ──rejeita──► failed/remember
    │
    ▼
learned (created: true | false)
```

## Entidades alteradas

Nenhuma. `RememberResult`, `RecalledMemory`, `memoryFactSchema`, `userIdSchema` (008) são
reusados como estão. `RunMetrics` não ganha campo (spec, Assumptions).

## Constantes

| Nome | Valor | Onde |
|---|---|---|
| `LEARNING_TIMEOUT_MS` | `30_000` | `src/memory/learning-reflector.ts` |
