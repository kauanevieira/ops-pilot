# Contract: `ConversationStore` (emenda)

**Feature**: `011-history-summarization` | Satisfaz FR-012 a FR-016, FR-033

Emenda [`007-persistent-conversation/contracts/conversation-store.md`](../../007-persistent-conversation/contracts/conversation-store.md).
`create`, `append` e `lastMessages` não mudam. Continua **síncrono**.

## Métodos novos

```ts
import type { ConversationSummary, NewConversationSummary } from "../domain/schemas.ts";

export interface ConversationStore {
  // …create, append, lastMessages (007)

  /** Total de mensagens gravadas na conversa. */
  countMessages(conversationId: string): number;

  /**
   * Até `limit` mensagens a partir da posição cronológica `offset` (0 = a
   * primeira da conversa), em ordem cronológica. Posição além do fim ⇒ [].
   */
  messagesRange(conversationId: string, offset: number, limit: number): ConversationMessage[];

  /** O resumo vigente da conversa, ou null se ainda não há. */
  getSummary(conversationId: string): ConversationSummary | null;

  /**
   * Grava `summary` como o resumo da conversa SE `summary.coveredMessages`
   * for maior que o do resumo vigente (ou se não houver). Devolve true se
   * gravou, false se descartou. Nunca lança por "não avançou".
   */
  saveSummary(conversationId: string, summary: NewConversationSummary): boolean;
}
```

## Invariantes novas

| # | Invariante | Requisito |
|---|---|---|
| CV11 | Os quatro métodos novos, com id inexistente, lançam `ConversationNotFoundError`, e `saveSummary` não grava nada | R-013 |
| CV12 | `countMessages` é igual ao número de mensagens acrescentadas por todos os `append` bem-sucedidos; 0 numa conversa nova | R-001 |
| CV13 | `messagesRange(id, o, l)` devolve as mensagens das posições `o..o+l−1` que existirem, em ordem cronológica. `offset < 0` ou `limit ≤ 0` ⇒ `[]` | R-001, R-004 |
| CV14 | `getSummary` numa conversa sem resumo ⇒ `null` | FR-012 |
| CV15 | `saveSummary` com cobertura maior que a vigente (ou sem resumo) grava, devolve `true`, e `getSummary` devolve o texto novo, a cobertura nova e `updatedAt` atribuído pelo store | FR-012 |
| CV16 | `saveSummary` com cobertura igual ou menor que a vigente devolve `false`, e `getSummary` continua devolvendo o resumo anterior, intocado | FR-014, R-003 |
| CV17 | `saveSummary` valida `summary` contra `newConversationSummarySchema` (conteúdo com 1–800 caracteres depois do `trim`, cobertura inteira > 0) e lança se inválido, sem gravar | FR-007 |
| CV18 | Resumos de conversas distintas são independentes | — |
| CV19 | Reabrir o mesmo banco devolve o mesmo resumo (DDL idempotente; só SQLite) | FR-013, FR-015 |

CV11–CV18 entram em `runConversationStoreContract` e rodam contra as duas implementações.
CV19 fica em `sqlite-conversation-store.test.ts`, junto da CV8.

## Implementação SQLite

Statements preparados no construtor:

```sql
-- countMessages
SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?
-- messagesRange (posição = ordem por rowid; R-001)
SELECT role, content, created_at FROM messages
  WHERE conversation_id = ? ORDER BY id LIMIT ? OFFSET ?
-- getSummary
SELECT content, covered_messages, updated_at FROM conversation_summaries WHERE conversation_id = ?
-- saveSummary (R-003) — changes === 1 ⇔ gravou
INSERT INTO conversation_summaries (conversation_id, content, covered_messages, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(conversation_id) DO UPDATE SET
  content = excluded.content,
  covered_messages = excluded.covered_messages,
  updated_at = excluded.updated_at
WHERE excluded.covered_messages > conversation_summaries.covered_messages
```

As linhas lidas passam por esquema zod de linha (`summaryRowSchema`), no mesmo padrão de
`messageRowSchema`. Nenhum valor é interpolado (Princípio II).

## Implementação em memória

`Map<string, ConversationSummary>` ao lado do mapa de mensagens. `saveSummary` valida com o
esquema antes de comparar e gravar, o equivalente do `CHECK`, como `append` já faz com o
papel.
