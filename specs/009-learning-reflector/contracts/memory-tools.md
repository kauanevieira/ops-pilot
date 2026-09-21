# Contract: ferramentas de memória (emenda)

**Feature**: `009-learning-reflector` | Satisfaz FR-016 a FR-019 | Substitui a parte de
ferramentas de [`008-semantic-memory/contracts/memory-tools.md`](../../008-semantic-memory/contracts/memory-tools.md)

Mudanças em `src/memory/memory-tools.ts`:

- `remember_fact` **removida** (FR-017). Guardar passa a ser só do refletor.
- `forget_fact` **renomeada** para `forget_preference`, com o mesmo esquema e a mesma execução.
- `defineMemoryTools(memoryStore, userId)` devolve `{ forget_preference }`.
- `createMemoryTools(memoryStore, userId)` devolve `ClientTool[]` com **um** elemento.

Continua fora de `tool-definitions.ts` (008 R-014): `forget_preference` não pode ser nomeada em
`MCP_TOOL_NAMES` sem erro de compilação (FR-019). `userId` continua fechado na criação, nunca
campo do esquema.

---

## `forget_preference`

**Descrição**:

> Apaga um fato lembrado sobre o plantonista, para que não seja mais usado. Use quando a
> pessoa pedir para esquecer algo ou disser que um fato lembrado está errado ou
> desatualizado. O `memoryId` é o identificador entre colchetes na seção "Fatos lembrados"
> deste pedido; só é possível esquecer fatos que apareceram ali. NÃO use para guardar nem
> corrigir fatos: guardar é automático — o que a pessoa disser de novo sobre si nesta mensagem
> é aprendido depois da resposta, sem ferramenta. NÃO use para estado operacional (alertas,
> incidentes): eles não ficam na memória. Devolve JSON `{ forgotten: true }` quando o fato foi
> apagado, ou `{ forgotten: false }` quando nenhum fato com esse id pertence a esta pessoa —
> já esquecido, inexistente ou de outra pessoa.

**Esquema** (inalterado):

```ts
z.object({
  memoryId: z.string().trim().min(1).describe(
    "Identificador do fato, exatamente como aparece entre colchetes em 'Fatos lembrados' (ex.: 'mem-3f2a…').",
  ),
})
```

**Execução** (inalterada): `memoryStore.forget(userId, memoryId)` →
`{ text: JSON.stringify({ forgotten }), isError: !forgotten }`.

### Auditoria das 6 regras (Princípio IV)

| Regra | Onde está |
|---|---|
| 1. O que faz | "Apaga um fato lembrado sobre o plantonista…" |
| 2. Quando usar | "quando a pessoa pedir para esquecer algo ou disser que um fato… está errado ou desatualizado" |
| 3. Quando NÃO usar | "NÃO use para guardar nem corrigir fatos: guardar é automático…"; "NÃO use para estado operacional" |
| 4. O que devolve | `{ forgotten: true }` / `{ forgotten: false }` e quando cada um |
| 5. Campos descritos | `memoryId` com `.describe()` |
| 6. Conjuntos fechados como enum | não há conjunto fechado no esquema |

FR-018: a descrição diz explicitamente que guardar é automático e não menciona nenhuma
ferramenta de guardar.

---

## Testes

`src/memory/memory-tools.test.ts` reescrito:

- `defineMemoryTools` devolve exatamente a chave `forget_preference`.
- Descrição: abertura "Apaga um fato lembrado", menciona "Fatos lembrados", "automático" e
  `forgotten: false`; **não** contém `remember_fact` nem `forget_fact`.
- Execução restrita ao `userId` e "não encontrado" sem lançar (casos da 008, renomeados).
- `createMemoryTools` devolve um array de nome `["forget_preference"]`.

`src/mcp/ops-mcp-server.test.ts`: a verificação da 008 passa a cobrir `forget_preference`
(e continua cobrindo que `remember_fact`/`forget_fact` não estão na lista).
