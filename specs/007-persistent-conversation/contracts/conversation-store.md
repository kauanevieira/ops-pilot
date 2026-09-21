# Contract: `ConversationStore`

**Feature**: `007-persistent-conversation` | Satisfaz FR-001 a FR-008, FR-024, FR-025

Contrato novo, separado de `OpsRepository` (R-001). **Síncrono**, como `OpsRepository`.

---

## A interface — `src/store/conversation-store.ts`

```ts
import type { ConversationMessage, NewConversationMessage } from "../domain/schemas.ts";

export interface ConversationStore {
  /** Cria uma conversa vazia e devolve seu identificador opaco. */
  create(): string;

  /**
   * Acrescenta `messages` ao final da conversa, na ordem dada, atomicamente:
   * ou todas entram, ou nenhuma. Lança ConversationNotFoundError se a conversa
   * não existe — nunca a cria implicitamente.
   */
  append(conversationId: string, messages: NewConversationMessage[]): void;

  /**
   * As até `limit` mensagens mais recentes, em ordem cronológica (mais antiga
   * primeiro). Conversa existente e vazia ⇒ []. Conversa inexistente ⇒
   * ConversationNotFoundError.
   */
  lastMessages(conversationId: string, limit: number): ConversationMessage[];
}
```

## Implementações

| Classe | Arquivo | Uso |
|---|---|---|
| `SqliteConversationStore` | `src/store/sqlite-conversation-store.ts` | produção (`src/index.ts`), testes sobre `":memory:"` |
| `InMemoryConversationStore` | `src/store/in-memory-conversation-store.ts` | dublê de teste; default de `createApp` (R-015) |

`SqliteConversationStore` recebe uma `DatabaseSync` já aberta (como `SqliteOpsStore`),
aplica `CONVERSATION_SCHEMA_SQL` no construtor e prepara todos os statements ali.

---

## Invariantes

| # | Invariante | Requisito |
|---|---|---|
| CV1 | `create()` devolve um id novo a cada chamada; nunca reutiliza | FR-001 |
| CV2 | `lastMessages(create(), n)` ⇒ `[]` | R-002 |
| CV3 | `append` e `lastMessages` com id inexistente ⇒ `ConversationNotFoundError`; `append` não grava nada e não cria a conversa | FR-005, R-002 |
| CV4 | `append(id, [a, b])` ⇒ `a` e `b` entram juntas, nessa ordem; falha em qualquer uma ⇒ nenhuma entra | FR-014, R-005 |
| CV5 | `lastMessages(id, n)` devolve `min(n, total)` mensagens — as mais recentes — em ordem cronológica | FR-017 |
| CV6 | A ordem é total e estável mesmo com `createdAt` idêntico | FR-006, R-004 |
| CV7 | Papel fora de `{user, assistant}` é rejeitado pelo banco (`CHECK`) mesmo contornando a validação de aplicação | FR-003 |
| CV8 | Reabrir o mesmo banco não falha e não perde mensagens (DDL idempotente) | FR-007 |
| CV9 | Conversas distintas nunca veem mensagens umas das outras | US1-4 |
| CV10 | `limit` ≤ 0 ⇒ `[]` (sem erro); `lastMessages` nunca muta o store | — |

`createdAt` é atribuído pelo store no momento de `append` (R-013); todas as mensagens de
uma mesma chamada recebem o mesmo instante.

## Teste de contrato compartilhado

`src/store/conversation-store.contract.ts` exporta
`runConversationStoreContract(name, makeStore)` — uma bateria `describe` com CV1–CV6,
CV9, CV10, executada por:

- `src/store/sqlite-conversation-store.test.ts` com `new DatabaseSync(":memory:")`, que
  acrescenta CV7 (inserção direta com papel inválido), CV8 (reabertura em arquivo em
  `os.tmpdir()`) e o caso de sincronia CHECK ↔ `messageRoleSchema`.
- `src/store/in-memory-conversation-store.test.ts`.

O arquivo de contrato **não** termina em `.test.ts`, para não ser executado sozinho pelo
glob de `npm test`.
