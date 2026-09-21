# Contract: ferramentas de memória

**Feature**: `008-semantic-memory` | Satisfaz FR-027 a FR-031

> **Emendado por `009-learning-reflector`**: `remember_fact` foi removida — guardar um
> fato passou a ser trabalho exclusivo do refletor de aprendizado, nunca mais do
> agente. `forget_fact` foi renomeada para `forget_preference`, com o mesmo
> comportamento. Ver
> [`specs/009-learning-reflector/contracts/memory-tools.md`](../../009-learning-reflector/contracts/memory-tools.md)
> para o texto atual das ferramentas; o que está registrado abaixo descreve o desenho
> original da 008 e não reflete mais o código.

`defineMemoryTools(memoryStore, userId)` e o adaptador `createMemoryTools(memoryStore, userId)`
em `src/memory/memory-tools.ts`. Mesmo formato de definição de `tool-definitions.ts`
(`name`, `description`, `schema`, `run → ToolOutcome`), mas **fora** de `defineOpsTools`, o
que impede por tipo a exposição pelo MCP (R-014).

`userId` é fechado na criação das ferramentas; nenhum esquema tem campo de usuário (FR-028).
Só são criadas quando o pedido tem `userId` (FR-029).

---

## `remember_fact`

**Descrição** (Princípio IV, as 6 regras):

> Guarda um fato duradouro sobre o plantonista para ser lembrado em conversas futuras.
> Use quando a pessoa pedir explicitamente para você lembrar algo ("lembra que…", "guarda
> isso") ou quando ela afirmar algo estável sobre si ou sobre como trabalha — serviços pelos
> quais responde, time, preferências de resposta. NÃO use para estado operacional (alertas,
> incidentes, status de serviço): isso muda e já tem ferramentas próprias; NÃO use para
> repetir fatos que já apareceram em "Fatos lembrados" neste pedido. Devolve JSON
> `{ memoryId, fact, created }`: `created: true` quando o fato foi guardado; `created: false`
> quando já existia um fato equivalente — nesse caso `fact` é o texto que já estava guardado,
> e nada novo foi gravado.

**Esquema**:

```ts
z.object({
  fact: memoryFactSchema.describe(
    "O fato em uma frase curta e autocontida, em terceira pessoa ou primeira pessoa do plantonista (ex.: 'É responsável pelo serviço checkout'). Até 500 caracteres.",
  ),
})
```

**Execução**: `memoryStore.remember(userId, fact)` → `{ text: JSON.stringify(result), isError: false }`.
Falha do gerador de vetores propaga (falha técnica, R-013).

---

## `forget_fact`

**Descrição**:

> Apaga um fato lembrado sobre o plantonista, para que não seja mais usado. Use quando a
> pessoa pedir para esquecer algo ou disser que um fato lembrado está errado ou desatualizado.
> O `memoryId` é o identificador entre colchetes na seção "Fatos lembrados" deste pedido; só é
> possível esquecer fatos que apareceram ali. NÃO use para corrigir um fato mantendo-o: esqueça
> o antigo e guarde o novo com `remember_fact`. Devolve JSON `{ forgotten: true }` quando o fato
> foi apagado, ou `{ forgotten: false }` quando nenhum fato com esse id pertence a esta pessoa —
> já esquecido, inexistente ou de outra pessoa.

**Esquema**:

```ts
z.object({
  memoryId: z.string().trim().min(1).describe(
    "Identificador do fato, exatamente como aparece entre colchetes em 'Fatos lembrados' (ex.: 'mem-3f2a…').",
  ),
})
```

**Execução**: `memoryStore.forget(userId, memoryId)` → `{ text: JSON.stringify({ forgotten }), isError: !forgotten }`.
`forgotten: false` é observação, não exceção (FR-018).

---

## Auditoria pelas 6 regras

| Regra | `remember_fact` | `forget_fact` |
|---|---|---|
| 1. O que faz (imperativo) | "Guarda um fato duradouro…" | "Apaga um fato lembrado…" |
| 2. Quando usar | pedido explícito ou afirmação estável sobre si | pedido de esquecer, fato errado/desatualizado |
| 3. Quando NÃO usar | estado operacional; fatos já lembrados | corrigir mantendo — use esquecer + guardar |
| 4. O que devolve | `{ memoryId, fact, created }`, incluindo o caso duplicado | `{ forgotten }`, incluindo o caso não encontrado |
| 5. Todo campo descrito | `fact` | `memoryId` |
| 6. Conjuntos fechados são enum | não há | não há |
