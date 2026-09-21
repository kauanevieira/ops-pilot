# Implementation Plan: Sumarização de Histórico

**Branch**: `011-history-summarization` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-history-summarization/spec.md`

## Summary

A janela de histórico do `/chat` cai de 12 para 8 mensagens. O que sai dela é condensado num
resumo cumulativo de ~150 tokens, gravado em `conversation_summaries` e entregue ao agente
antes das mensagens. O resumo só é refeito quando 8 mensagens novas saíram da janela; os
pedidos no meio do caminho só leem o resumo gravado. O pedido que resume traz o evento
`summarize` no rastro.

Cinco decisões de desenho saíram da Fase 0:

1. **A cobertura é um contador de posição, não um id** (R-001). Como `messages` só recebe
   acréscimos, "o resumo cobre as N primeiras" basta. O store ganha leitura por posição, e o
   fake em memória fica idêntico ao SQLite.
2. **O resumo mora no `ConversationStore`** (R-002): dois métodos a mais, com o mesmo contrato
   compartilhado, em vez de um store novo.
3. **A gravação é condicional num statement só** (R-003): um upsert com
   `WHERE excluded.covered_messages > atual`, verificado no SQLite do Node 22. Dois pedidos
   simultâneos gravam uma vez, sem erro.
4. **O pedido trabalha sobre uma fotografia** (R-004): o total de mensagens é lido uma vez, e
   o resto é lido por posição. Um turno gravado por outro pedido durante o `await` do
   sumarizador não entra.
5. **Decidir é puro, orquestrar é borda** (Princípio I): `planConversationContext` decide
   quando resumir e o quê entregar. `prepareConversationContext` faz o I/O, com falha tolerada,
   tempo limite próprio e o sinal do pedido.

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22.22.2.

**Primary Dependencies**: nenhuma nova. `@langchain/core` 1.2.11 (`AIMessage.text`) e
`node:sqlite` (SQLite 3.51.2: `ON CONFLICT … DO UPDATE … WHERE`, `changes`).

**Storage**: SQLite local, com uma tabela nova, `conversation_summaries`, no
`CONVERSATION_SCHEMA_SQL` existente (idempotente, criada ao abrir).

**Testing**: `node:test`. Plano puro em tabela. Preparação com `InMemoryConversationStore` e
sumarizadores falsos (que gravam as entradas, que rejeitam, que nunca resolvem). Contrato do
store nas duas implementações. `/chat` de ponta a ponta com `withServer`, que passa a ter um
sumarizador falso por padrão. Nenhum teste chama modelo.

**Target Platform**: servidor Node local, como antes.

**Project Type**: Single project.

**Performance Goals**: uma chamada extra ao modelo a cada 8 mensagens (4 turnos), e zero nos
outros pedidos. Nos pedidos sem sumarização, o custo é duas consultas indexadas a mais
(`COUNT` e resumo pela PK).

**Constraints**:
- `npm test` offline (Princípio V); o default `createModelSummarizer()` só é construído.
- A sumarização roda dentro do prazo de 180 s do pedido e tem limite próprio de 30 s.
- Arena, bench e MCP inalterados (FR-020): nenhum deles passa por `withConversationHistory` nem
  pelo handler.
- Campos novos opcionais e aditivos. `contextBreakdown` ganha uma quinta chave, `summary`, uma
  emenda explícita à M5 da 010.
- **Um** teste existente muda de expectativa: o "teto de 12" da 007 em `server.test.ts`
  (R-015), por causa da emenda FR-001. Os testes de contrato que usam `12` como limite
  arbitrário de `lastMessages` continuam válidos.

**Scale/Scope**: 3 módulos novos (`context/summarizer.ts`, `context/conversation-context.ts`,
`lib/with-timeout.ts`) com testes. Alterados: `domain/schemas.ts`, `store/sqlite-schema.ts`,
`store/conversation-store.ts`, as duas implementações e o contrato compartilhado,
`agents/conversation-history.ts`, `memory/learning-reflector.ts` (passa a importar
`withTimeout`), `memory/with-memory.test.ts` (nova assinatura), `context/breakdown.ts`, `trace/types.ts`, `trace/format.ts`, `http/chat.ts`,
`http/server.ts`, `index.ts`, `scripts/conversa-longa.sh`, README, avisos na 003 e 007.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `ConversationSummary` é definido uma vez como esquema zod em `src/domain/schemas.ts`, com o teto `SUMMARY_MAX_CHARS`. `planConversationContext`, `verbatimStart`, `capSummary`, `formatSummarizerInput` e os `format*Block` são puros. Relógio (`updatedAt`) só no store; modelo só no sumarizador injetado. | ✅ Passa |
| **II. Persistência Local em SQLite** | Tabela nova no mesmo arquivo, com `CREATE TABLE IF NOT EXISTS` aplicado no construtor, `CHECK` de tamanho e de cobertura, statements preparados sem interpolação. Testes em `:memory:`. | ✅ Passa |
| **III. Contrato Antes de Código** | [conversation-store.md](./contracts/conversation-store.md), [database-schema.md](./contracts/database-schema.md), [history-summarization.md](./contracts/history-summarization.md), [chat-endpoint.md](./contracts/chat-endpoint.md) e [conversa-longa.md](./contracts/conversa-longa.md). Avisos na 003 e na 007 e README na mesma mudança. | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada. O sumarizador é uma chamada direta, não uma ferramenta do agente. | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Sumarizador injetável; `withServer` usa um falso por padrão; o tempo limite é testado com valor curto e sumarizador que nunca resolve, usando o `withTimeout` já seguro com `node:test` (009). | ✅ Passa |
| **Restrições: validação na borda** | Resumo lido do banco passa por `summaryRowSchema`. A saída do modelo passa por `capSummary` e pelo esquema antes de gravar. | ✅ Passa |
| **Restrições: credenciais** | O default não lê env ao ser construído (R-007, como a 009). | ✅ Passa |

**Governança: complexidade adicional**:
- Nenhuma dependência nova.
- Diretório novo `src/lib/`, com um arquivo (`with-timeout.ts`). A alternativa mais simples
  (copiar o `withTimeout` da 009) foi descartada por duplicar a correção sutil do
  `AbortSignal.timeout()` com `node:test`. Importá-lo de `memory/` faria `context/` depender da
  memória só por um utilitário genérico (R-006).
- Um store separado para resumos foi descartado (R-002).

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. O desenho mantém a regra da 010 de que o bloco
medido é o bloco entregue: `formatSummaryBlock` é usado tanto por `withConversationHistory`
quanto por `buildContextBreakdown` (SM5).

## Project Structure

### Documentation (this feature)

```text
specs/011-history-summarization/
├── plan.md
├── spec.md
├── research.md              # Fase 0: 16 decisões
├── data-model.md            # ConversationSummary, tabela, plano puro, transições, métricas
├── quickstart.md
├── contracts/
│   ├── conversation-store.md      # emenda à 007: CV11–CV19
│   ├── database-schema.md         # conversation_summaries
│   ├── history-summarization.md   # sumarizador (Z), plano (P), preparação (C), blocos (H), rastro (T)
│   ├── chat-endpoint.md           # emenda ao POST /chat (SM1–SM8), ChatAppDeps
│   └── conversa-longa.md          # emenda ao roteiro da 010
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── lib/
│   ├── with-timeout.ts                  # NOVO: extraído de learning-reflector.ts, + parentSignal
│   └── with-timeout.test.ts             # NOVO
├── domain/schemas.ts                    # + SUMMARY_MAX_CHARS, summaryContentSchema, conversationSummarySchema, newConversationSummarySchema
├── store/
│   ├── sqlite-schema.ts                 # + conversation_summaries em CONVERSATION_SCHEMA_SQL
│   ├── conversation-store.ts            # + countMessages, messagesRange, getSummary, saveSummary
│   ├── sqlite-conversation-store.ts     # + 4 statements, summaryRowSchema
│   ├── in-memory-conversation-store.ts  # + Map de resumos
│   ├── conversation-store.contract.ts   # + CV11–CV18
│   └── sqlite-conversation-store.test.ts# + CV19, sincronia CHECK ↔ SUMMARY_MAX_CHARS
├── context/
│   ├── summarizer.ts                    # NOVO: Summarizer, SUMMARIZER_PROMPT, formatSummarizerInput, capSummary, createModelSummarizer
│   ├── summarizer.test.ts               # NOVO: Z1–Z5
│   ├── conversation-context.ts          # NOVO: constantes, planConversationContext, verbatimStart, prepareConversationContext
│   ├── conversation-context.test.ts     # NOVO: P1–P3, C1–C8
│   ├── breakdown.ts                     # + fonte summary
│   └── breakdown.test.ts                # + casos com resumo; SM5
├── agents/
│   ├── conversation-history.ts          # HISTORY_WINDOW = 8; formatTranscript, formatSummaryBlock; ConversationHistory
│   └── conversation-history.test.ts     # + H1–H6; chamadas adaptadas à nova assinatura
├── memory/
│   ├── learning-reflector.ts            # importa withTimeout de lib/
│   └── with-memory.test.ts              # chamadas adaptadas à nova assinatura de withConversationHistory
├── trace/
│   ├── types.ts                         # + evento summarize; RunMetrics.summaryCoveredMessages; ContextBreakdown.summary
│   ├── format.ts                        # + case "summarize"
│   └── format.test.ts                   # + T2
├── http/
│   ├── chat.ts                          # 404 por countMessages; prepara contexto ‖ recall; evento no rastro; breakdown com summary
│   ├── server.ts                        # ChatAppDeps.summarizer, summaryTimeoutMs
│   └── server.test.ts                   # withServer com echoSummarizer; SM1–SM8; teste "teto de 12" reescrito
└── index.ts                             # passa createModelSummarizer()

scripts/conversa-longa.sh                # colunas est.sum e resumo; comentário da janela
```

**Structure Decision**: tudo o que decide ou compõe o contexto do pedido fica em
`src/context/`, ao lado de `tokens.ts` e `breakdown.ts` da 010. O formato do texto entregue
continua em `agents/conversation-history.ts`, dono dos blocos desde a 007. O resumo é
persistido pelo store de conversa (R-002), e a entidade fica em `src/domain/` (Princípio I).
`src/lib/` recebe só utilitários sem domínio.

### Ordem de implementação sugerida

1. `lib/with-timeout.ts` + testes; `learning-reflector.ts` passa a importá-lo (testes da 009
   continuam verdes, sem mudança).
2. Domínio + tabela + store (as duas implementações) + contrato CV11–CV19.
3. `conversation-history.ts`: janela 8, `formatSummaryBlock`, nova assinatura; `trace/types.ts`
   (`summaryCoveredMessages`, `ContextBreakdown.summary`); `breakdown.ts`.
4. `summarizer.ts` + testes; `conversation-context.ts` + testes (US1 e US2 no nível da
   função).
5. `chat.ts`, `server.ts`, `index.ts`, `server.test.ts` (US1 e US2 visíveis no `/chat`).
6. Evento: `TraceEvent`, `format.ts`, anexação no handler e testes (US3).
7. `conversa-longa.sh`, README, avisos na 003 e na 007.

US1 e US2 (ambas P1) ficam entregáveis ao fim do passo 5. Nesse ponto o resumo já entra no
contexto; o evento é só observabilidade. US3 fica pronta no passo 6.

### Riscos

| Risco | Mitigação |
|---|---|
| O modelo ignora o alvo de ~150 tokens | O teto de 800 caracteres é aplicado por `capSummary`, pelo esquema e pelo `CHECK`. O corte pode perder o fim do resumo; a ordem de prioridade no prompt (decisões primeiro) põe o mais importante no começo |
| Mesclagem sucessiva degrada o resumo (fatos antigos vão se perdendo a cada rodada) | Aceito como limite inerente do resumo cumulativo pedido. O prompt manda preservar o anterior. A verificação manual do quickstart (etapa 2) confere um fato do turno 4 depois de três rodadas |
| Mensagem com injeção muda o comportamento do sumarizador | Dados só no turno `human`, com instrução explícita (R-009). O resumo é contexto para o agente, não comando, e passa pelas mesmas proteções que qualquer mensagem do histórico já tinha |
| Sumarizador falha sempre (credencial, provedor fora) | Fail-open: a conversa segue com até 15 mensagens na íntegra, como uma janela de 15, sem resumo novo e sem erro para o cliente. O log registra a falha |
| Conversa legada muito longa gera uma primeira chamada grande | Aceito (R-016); conversas do projeto são pequenas |
| Mudar a assinatura de `withConversationHistory` quebra chamadas | Só o handler e testes a chamam (verificado: `conversation-history.test.ts`, `with-memory.test.ts`, `breakdown.test.ts` via `formatHistoryInput`). Todos entram nesta mudança; o `typecheck` pega qualquer chamada esquecida |

## Complexity Tracking

Nenhuma violação a justificar. O diretório `src/lib/` está justificado acima, em Governança.
