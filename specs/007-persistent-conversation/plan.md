# Implementation Plan: Conversa Persistente

**Branch**: `007-persistent-conversation` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-persistent-conversation/spec.md`

## Summary

Dar memória ao `POST /chat`. Um contrato novo e síncrono — `ConversationStore`, com
`create`/`append`/`lastMessages` — ganha duas implementações: `SqliteConversationStore`
(tabelas `conversations` e `messages` no mesmo arquivo do `SqliteOpsStore`, mesmo padrão
de DDL idempotente, `CHECK` e statements preparados) e `InMemoryConversationStore` como
dublê. O endpoint aceita `conversationId` opcional, devolve-o sempre, e grava cada turno
bem-sucedido (mensagem + resposta final) numa única transação. O histórico — até 12
mensagens — chega à estratégia por um decorador, `withConversationHistory`, que também
preenche a métrica `historyMessages`.

Dois achados da Fase 0 definem a forma da composição:

1. **`withReflection` reconstrói `metrics` do zero** em todo retorno (R-008, verificado no
   código). Um `historyMessages` escrito por uma camada interna seria descartado; por isso
   o decorador de histórico é a camada **mais externa**, aplicada pelo handler sobre o que
   `resolveStrategy` devolve. De bônus, o crítico passa a julgar a pergunta com o contexto
   da conversa — sem isso, "e o runbook dele?" seria reprovado por falta de referente.
2. **O único ponto comum a todas as estratégias é `run(input: string)`** (R-007). Mensagens
   estruturadas exigiriam mudar ReAct e plan-and-execute; o histórico entra como texto
   prefixado, e com histórico vazio a entrada passa intacta — arena, bench e MCP não
   mudam em nada.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM, `strict: true`. Runtime Node 22.22.2.

**Primary Dependencies**: Nenhuma nova. `node:sqlite`, `zod@4`, `express@5`.

**Storage**: SQLite via `DatabaseSync`, mesmo arquivo `OPSPILOT_DB` e mesma conexão do
`SqliteOpsStore`. Duas tabelas novas (`conversations`, `messages`), DDL em
`CONVERSATION_SCHEMA_SQL` aplicado no construtor do store (R-014). Seed não muda.

**Testing**: `node:test` via `tsx`. Bateria de contrato compartilhada rodando contra SQLite
`":memory:"` e contra o fake (R-015); testes do decorador com estratégia falsa; casos novos
em `server.test.ts` com o fake injetado. Um caso de reabertura usa arquivo em
`os.tmpdir()`.

**Target Platform**: Linux/macOS, `npm run dev`.

**Project Type**: Single project (API HTTP + CLIs).

**Performance Goals**: Nenhuma específica. Uma consulta indexada de ≤ 12 linhas por pedido e
uma transação de 2 inserções no fim; latência dominada pelo modelo.

**Constraints**:
- `ConversationStore` **síncrono**, como `OpsRepository` (R-001).
- Registro de estratégias (`src/agents/index.ts`) e as estratégias em si **não mudam**
  (FR-019).
- Entrada sem histórico chega à estratégia byte a byte igual a hoje (R-007).
- Nada é gravado em pedido que não responde 200 (FR-015, R-006, R-012).
- Zero SQL montado em tempo de execução; `LIMIT` é parâmetro ligado (R-004).

**Scale/Scope**: 5 arquivos novos de código (`conversation-store.ts`,
`sqlite-conversation-store.ts`, `in-memory-conversation-store.ts`,
`conversation-history.ts`, `conversation-store.contract.ts`) + 3 de teste novos; 8
existentes alterados (`schemas.ts`, `errors.ts` de domínio, `trace/types.ts`,
`sqlite-schema.ts`, `http/chat.ts`, `http/errors.ts`, `http/server.ts`, `index.ts`), além de
`critic.ts` (só comentário), `server.test.ts`, README e o contrato da 003.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `messageRoleSchema` e `conversationMessageSchema` definidos uma vez em `src/domain/schemas.ts` e inferidos. `formatHistoryInput` é pura. Id (`randomUUID`) e relógio ficam nos stores, que são borda (R-013) — mesmo papel do `SqliteOpsStore`. `ConversationNotFoundError` em `src/domain/errors.ts`. | ✅ Passa |
| **II. Persistência Local em SQLite** | Mesmo arquivo configurado por `OPSPILOT_DB`; testes em `":memory:"`; DDL literal e idempotente no construtor; `CHECK` em `role`, com teste de sincronia contra o enum zod; 100% statements preparados, inclusive `LIMIT`; seed não muda e continua idempotente; nenhum arquivo novo de banco. | ✅ Passa |
| **III. Contrato Antes de Código** | Spec, plano, pesquisa, modelo de dados e três contratos antes da implementação. A mudança observável em `POST /chat` é registrada em `contracts/chat-endpoint.md` como emenda, e o contrato da 003 recebe aviso apontando para ela no mesmo conjunto de mudanças. | ✅ Passa |
| **IV. Ferramentas Descritas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada. O histórico entra pelo texto da entrada, não por uma ferramenta. | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Todos os testes novos sem rede e sem modelo: estratégia falsa, store fake ou `":memory:"`. O fake gera ids com contador (`conv-1`, …) para asserções estáveis. Cada teste cria seu próprio store. Arena e bench não usam conversa, então reprodutibilidade do benchmark não muda. | ✅ Passa |

**Resultado do portão**: nenhuma violação. Complexity Tracking vazio.

**Re-avaliação pós-Fase 1**: sem violações. Dois pontos de desenho reforçam a aderência:

- **Conversa inexistente como erro de domínio** (R-002) em vez de um quarto método
  `exists` — mantém as três operações pedidas e segue o padrão
  `ServiceNotFoundError`/`openIncident` já estabelecido.
- **Atomicidade pelo próprio `append(lista)`** (R-005) em vez de expor transações no
  contrato — o store continua sendo a única coisa que fala SQL.

## Project Structure

### Documentation (this feature)

```text
specs/007-persistent-conversation/
├── plan.md                      # Este arquivo
├── spec.md
├── research.md                  # Fase 0 — 15 decisões
├── data-model.md                # Fase 1 — tipos, esquema físico, ciclo do turno
├── quickstart.md                # Fase 1 — portões e roteiro online
├── contracts/
│   ├── conversation-store.md    # interface, invariantes CV1–CV10, teste de contrato
│   ├── database-schema.md       # DDL de conversations/messages, statements
│   └── chat-endpoint.md         # emenda ao POST /chat da 003
├── checklists/
│   └── requirements.md
└── tasks.md                     # Fase 2 — /speckit.tasks, NÃO este comando
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── schemas.ts                         # + messageRoleSchema, conversationMessageSchema
│   └── errors.ts                          # + ConversationNotFoundError
├── trace/
│   └── types.ts                           # RunMetrics + historyMessages?
├── store/
│   ├── conversation-store.ts              # NOVO — interface
│   ├── sqlite-schema.ts                   # + CONVERSATION_SCHEMA_SQL
│   ├── sqlite-conversation-store.ts       # NOVO
│   ├── sqlite-conversation-store.test.ts  # NOVO — ":memory:"
│   ├── in-memory-conversation-store.ts    # NOVO — fake
│   ├── in-memory-conversation-store.test.ts # NOVO
│   └── conversation-store.contract.ts     # NOVO — bateria compartilhada
├── agents/
│   ├── conversation-history.ts            # NOVO — HISTORY_WINDOW, formatHistoryInput, withConversationHistory
│   ├── conversation-history.test.ts       # NOVO
│   └── critic.ts                          # só comentário de buildCritiqueContext (R-008)
├── http/
│   ├── chat.ts                            # conversationId, 404, composição, gravação do turno
│   ├── errors.ts                          # + "conversation_not_found"
│   ├── server.ts                          # ChatAppDeps.conversationStore
│   └── server.test.ts                     # + casos FR-027
└── index.ts                               # instancia SqliteConversationStore na mesma conexão
```

**Structure Decision**: single project, sem camada nova. O store de conversa entra ao lado
do store operacional em `src/store/`; o decorador de histórico ao lado dos demais
decoradores de estratégia (`reflection.ts`, `incident-confirmation.ts`) em `src/agents/`.

### Ordem de implementação sugerida

1. **Domínio e contrato** — schemas, erro, interface, `RunMetrics`.
2. **Stores** — fake + bateria de contrato; depois SQLite + DDL + casos específicos.
3. **Decorador** — `formatHistoryInput`, `withConversationHistory`, testes (inclui
   composição sobre `withReflection` com crítico falso, verificando que `historyMessages`
   sobrevive).
4. **HTTP** — schema do corpo, 404, composição, gravação do turno, `ChatAppDeps`, testes
   (US1 → US2 → US3).
5. **Composição de produção** — `src/index.ts`; README; aviso no contrato da 003.

US1 (P1) fica entregável ao fim do passo 4 com os casos de criação/continuação; US2 e US3
são casos adicionais sobre o mesmo código.

## Complexity Tracking

Sem violações a justificar.
