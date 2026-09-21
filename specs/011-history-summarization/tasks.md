# Tasks: Sumarização de Histórico

**Input**: Design documents from `/specs/011-history-summarization/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos. O pedido diz "com test fake" e a spec os exige (FR-031 a FR-033). Todo
teste usa sumarizador falso: nenhum chama modelo nem lê `.env`. Escrever cada teste antes da
implementação correspondente e confirmar que falha.

**Organization**: Foundational (utilitário de tempo, domínio, tabela, store, tipos e a nova
forma do bloco de histórico) e depois uma fase por história.
- US1 (P1): primeiro resumo, gravado e entregue no contexto.
- US2 (P1): mesclagem com o resumo anterior e cadência (só a cada 8).
- US3 (P2): evento `summarize` visível.

A implementação de `prepareConversationContext` é escrita inteira em US1, conforme o contrato.
US2 é sobretudo a prova de que a mesclagem e a cadência valem ao longo de muitas rodadas e sob
concorrência, com ajustes se algum caso falhar.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (CV12, P1, C4, H3, Z5, SM1…) são as garantias de
  `contracts/conversation-store.md`, `contracts/history-summarization.md` e
  `contracts/chat-endpoint.md`

---

## Phase 1: Setup

Nada a instalar ou configurar: nenhuma dependência nova (plan.md, Technical Context). O DDL
novo entra na Foundational, porque é pré-requisito de código, não de ambiente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tudo que as três histórias usam: `withTimeout` compartilhado, a entidade, a
tabela, o store com leitura por posição e resumo, os tipos do rastro e das métricas, e a
janela de 8 com o bloco de resumo.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

### `withTimeout` compartilhado (R-006)

- [x] T001 [P] Criar `src/lib/with-timeout.test.ts`. Casos: `work` que resolve antes do prazo
      → resolve com o valor; `work` que rejeita → rejeita com o mesmo erro; `work` que nunca
      resolve com `timeoutMs: 20` → rejeita com a mensagem dada e o `signal` passado a `work`
      fica `aborted`; `work` que ignora o `signal` → a promessa ainda assim assenta no prazo;
      `parentSignal` abortado durante `work` → rejeita e o `signal` de `work` fica `aborted`;
      `parentSignal` já abortado antes da chamada → rejeita sem esperar o prazo. Nenhum caso
      pode deixar timer pendente (o arquivo inteiro tem de rodar sem o `node:test` cancelar
      por timer vivo)
- [x] T002 Criar `src/lib/with-timeout.ts`, movendo o `withTimeout` privado de
      `src/memory/learning-reflector.ts` sem mudar o mecanismo (`setTimeout` limpo em todo
      ramo, nunca `AbortSignal.timeout()`, com o comentário original preservado). Nova
      assinatura: `withTimeout<T>(timeoutMs: number, work: (signal: AbortSignal) =>
      Promise<T>, options?: { parentSignal?: AbortSignal; timeoutMessage?: string })`.
      `parentSignal` aborta o controller interno e rejeita. Em
      `src/memory/learning-reflector.ts`, importar daqui passando `timeoutMessage: "Tempo
      limite do refletor de aprendizado excedido."`. Os testes da 009 passam sem mudança

### Domínio, tabela e store (R-001 a R-004, R-008, R-013)

- [x] T003 [P] Em `src/domain/schemas.ts`, numa seção `// --- 011-history-summarization`:
      `export const SUMMARY_MAX_CHARS = 800;` (comentário: "= 200 tokens pela estimativa da
      010; MUST ficar em sincronia com o CHECK de conversation_summaries.content");
      `summaryContentSchema = z.string().trim().min(1).max(SUMMARY_MAX_CHARS)`;
      `conversationSummarySchema = z.object({ content: summaryContentSchema, coveredMessages:
      z.number().int().positive(), updatedAt: z.date() })`;
      `newConversationSummarySchema = conversationSummarySchema.omit({ updatedAt: true })`; e
      os tipos inferidos `ConversationSummary` e `NewConversationSummary`
- [x] T004 [P] Em `src/store/sqlite-schema.ts`, acrescentar ao fim de
      `CONVERSATION_SCHEMA_SQL`, literal:
      `CREATE TABLE IF NOT EXISTS conversation_summaries (conversation_id TEXT PRIMARY KEY
      REFERENCES conversations(id), content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND
      800), covered_messages INTEGER NOT NULL CHECK (covered_messages > 0), updated_at TEXT NOT
      NULL);`. Estender o comentário do bloco com as regras de
      `contracts/database-schema.md` (PK = um por conversa e alvo do `ON CONFLICT`; `CHECK` em
      sincronia com `SUMMARY_MAX_CHARS`)
- [x] T005 Em `src/store/conversation-store.ts`, acrescentar à interface, com comentários no
      estilo existente: `countMessages(conversationId): number`;
      `messagesRange(conversationId, offset, limit): ConversationMessage[]`;
      `getSummary(conversationId): ConversationSummary | null`;
      `saveSummary(conversationId, summary: NewConversationSummary): boolean` ("grava só se
      `coveredMessages` for maior que o vigente; `false` ao descartar, nunca lança por isso").
      Todos lançam `ConversationNotFoundError` para id inexistente
- [x] T006 [P] Em `src/store/conversation-store.contract.ts`, acrescentar ao
      `describe` do contrato: CV11 (os 4 métodos com id inexistente lançam
      `ConversationNotFoundError`; `saveSummary` não grava); CV12 (`countMessages` 0 numa
      conversa nova, 3 depois de `append` de 2 e de 1, inalterado depois de um `append` que
      falhou); CV13 (15 mensagens `m0..m14`: `messagesRange(id, 3, 4)` → `m3..m6`;
      `(id, 13, 10)` → `m13, m14`; `(id, 15, 5)` → `[]`; `offset < 0` ou `limit ≤ 0` → `[]`);
      CV14 (`getSummary` sem resumo → `null`); CV15 (grava cobertura 8 → `true`; `getSummary`
      devolve o texto, 8 e um `updatedAt` do tipo `Date`; depois grava 16 → `true` e o texto
      novo substitui); CV16 (com 16 vigente, gravar 16 ou 8 → `false`, e o resumo de 16
      continua intacto); CV17 (conteúdo `"   "`, conteúdo com 801 caracteres, cobertura 0 e
      cobertura 2.5 → lança, e nada é gravado); CV18 (resumos de duas conversas não se
      misturam)
- [x] T007 [P] Em `src/store/sqlite-conversation-store.test.ts`: CV19 (gravar resumo, abrir um
      novo `SqliteConversationStore` sobre a mesma `DatabaseSync`, como a CV8 já faz →
      `getSummary` igual e construtor sem erro). Teste de sincronia: o DDL em
      `CONVERSATION_SCHEMA_SQL` contém `BETWEEN 1 AND ${SUMMARY_MAX_CHARS}`, e um `INSERT`
      direto com 801 caracteres, contornando o store, é rejeitado pelo `CHECK`
- [x] T008 Implementar em `src/store/sqlite-conversation-store.ts`: 4 statements preparados no
      construtor, exatamente os de `contracts/conversation-store.md` (`COUNT(*)`,
      `ORDER BY id LIMIT ? OFFSET ?`, `SELECT … FROM conversation_summaries`, e o upsert com
      `WHERE excluded.covered_messages > conversation_summaries.covered_messages`).
      `saveSummary` valida com `newConversationSummarySchema.parse` antes de gravar, grava
      `updated_at = new Date().toISOString()` e devolve `changes === 1`. Leitura por
      `summaryRowSchema` (mesmo padrão de `messageRowSchema`: `covered_messages` →
      `coveredMessages`, `updated_at` via `z.coerce.date()`). `messagesRange` com `offset < 0`
      ou `limit ≤ 0` devolve `[]` sem consultar
- [x] T009 Implementar em `src/store/in-memory-conversation-store.ts`: `#summaries = new
      Map<string, ConversationSummary>()`; os mesmos 4 métodos; `saveSummary` valida com o
      esquema antes de comparar (o equivalente do `CHECK`) e compara com o vigente. Contrato
      CV11–CV18 verde nas duas implementações

### Tipos do rastro e das métricas

- [x] T010 Em `src/trace/types.ts`: acrescentar a `TraceEvent` o membro `{ type: "summarize";
      content: string; absorbedMessages: number }`, com comentário ("só o handler do `/chat`
      produz; nunca estratégias, arena, bench ou MCP"); e a `RunMetrics`, o campo
      `summaryCoveredMessages?: number` ("mensagens cobertas pelo resumo entregue; 0 sem
      resumo; só `withConversationHistory` seta"). Em `src/trace/format.ts`, acrescentar
      `case "summarize": return \`[summarize]   (+${event.absorbedMessages} mensagens)
      ${event.content}\`;`. O `switch` precisa continuar exaustivo para o `typecheck` passar

### Janela de 8 e bloco de resumo (FR-001, R-010)

- [x] T011 [P] Em `src/agents/conversation-history.test.ts`: adaptar as chamadas existentes à
      nova assinatura (`withConversationHistory(base, { summary: null, summaryCoveredMessages:
      0, messages: h })`, `formatHistoryInput({ summary: null, … }, input)`); os textos
      esperados não mudam (H4). Novos casos: H1 (`formatSummaryBlock(null) === ""`); H2
      (cabeçalho exato `Resumo da conversa até aqui (mensagens anteriores ao histórico
      recente):`, seguido do texto e de uma linha em branco); H3 (`formatHistoryInput` é igual
      a `formatSummaryBlock + formatHistoryBlock + input`, com resumo e mensagens); H5
      (`metrics.historyMessages === messages.length` e `metrics.summaryCoveredMessages ===` o
      valor passado, inclusive 0); H6 (`withReflection` por dentro não apaga os dois campos);
      `formatTranscript` produz as mesmas linhas rotuladas que `formatHistoryBlock` já usava.
      Ajustar o caso "caps at HISTORY_WINDOW" ao valor 8
- [x] T012 [P] Em `src/memory/with-memory.test.ts` (linhas ~173 e ~190): adaptar as duas
      chamadas a `withConversationHistory` à nova assinatura. As expectativas de ordem
      (memórias antes do histórico) não mudam
- [x] T013 Em `src/agents/conversation-history.ts`: `HISTORY_WINDOW = 8`, atualizando o
      comentário com "reduzido de 12 por 011 (FR-001); o que sai da janela é resumido";
      extrair `formatTranscript(messages)` (as linhas `[plantonista] …`/`[OpsPilot] …`) e
      fazer `formatHistoryBlock` usá-la, com saída idêntica; `export interface
      ConversationHistory { summary: string | null; summaryCoveredMessages: number; messages:
      ConversationMessage[] }`; `formatSummaryBlock(summary)`; `formatHistoryInput(context,
      input)` = bloco do resumo + bloco do histórico + input; `withConversationHistory(strategy,
      context)` seta `historyMessages` e `summaryCoveredMessages`
- [x] T014 Em `src/http/chat.ts`, provisoriamente: chamar `withConversationHistory(strategyToRun,
      { summary: null, summaryCoveredMessages: 0, messages: history })`. Em
      `src/context/breakdown.test.ts`, trocar `formatHistoryInput(h, …)` pela nova forma. Em
      `src/http/server.test.ts`, reescrever o teste "teto de 12" da 007 para a janela de 8:
      16 mensagens gravadas → `historyMessages === 8`, entrada com `pergunta 4..7` e sem
      `resposta 3`. US1 volta a mexer nele quando o resumo entrar

**Checkpoint**: `npm run typecheck` e `npm test` verdes. Comportamento observável: janela de 8
e `summaryCoveredMessages: 0` em todo 200. Ainda não há resumo.

---

## Phase 3: User Story 1 - Não esquecer o começo de uma conversa longa (Priority: P1) 🎯 MVP

**Goal**: quando 8 mensagens saem da janela, elas viram um resumo gravado em
`conversation_summaries`, que o agente recebe antes das 8 recentes, inclusive depois de um
reinício. `contextBreakdown` ganha a fonte `summary`. Uma falha do sumarizador nunca vira erro.

**Independent Test**: com sumarizador falso, uma conversa de 16 mensagens gravadas → o próximo
pedido chama o falso uma vez, grava o resumo e entrega `resumo + 8 mensagens` à estratégia
falsa; um app novo sobre o mesmo banco reutiliza o resumo sem chamar o falso.

### Tests for User Story 1 ⚠️

- [x] T015 [P] [US1] Criar `src/context/summarizer.test.ts`. Z1: com
      `OPENROUTER_API_KEY` removida de `process.env` (restaurar no fim),
      `createModelSummarizer()` não lança e devolve uma função. Z3: `formatSummarizerInput({
      previousSummary: null, messages })` contém `(nenhum)` e as mensagens rotuladas, na ordem;
      com `previousSummary: "X"`, contém `X` antes das mensagens. Z2/Z4: `SUMMARIZER_PROMPT`
      não contém nenhum trecho das mensagens de teste, e menciona decisões, fatos, pendências,
      ~150 tokens, credenciais e "dado". Z5: `capSummary("  abc  ") === "abc"`; texto de
      exatamente 800 caracteres volta igual; 801 caracteres → 800 caracteres terminando em
      `…`; `"   "` → `""`
- [x] T016 [P] [US1] Criar `src/context/conversation-context.test.ts`, parte "plano": P1/P2 em
      tabela, `{ total, covered } → { summarize, verbatimStart }`: `{0,0}` → `null`, 0;
      `{8,0}` → `null`, 0; `{14,0}` → `null`, 0; `{16,0}` → `{offset:0,count:8}`, 1; `{18,8}`
      → `null`, 8; `{24,8}` → `{offset:8,count:8}`, 9; `{40,0}` → `{offset:0,count:32}`, 25.
      Nenhum caso muta a entrada (P3)
- [x] T017 [P] [US1] Em `src/context/conversation-context.test.ts`, parte "preparação", com
      `InMemoryConversationStore` e um `recordingSummarizer` (grava cada `SummarizerInput` e
      devolve `resumo#${n}`): C1 (14 mensagens → 0 chamadas; `summary: null`; 14 mensagens na
      íntegra; sem evento); C3 (16 mensagens → 1 chamada com `previousSummary: null` e as
      mensagens 0..7; `getSummary` com cobertura 8; devolve `summary: "resumo#1"`,
      `summaryCoveredMessages: 8`, as 8 mais recentes e `summarizeEvent` com
      `absorbedMessages: 8`); C4 com três dublês (rejeita; devolve `"  "`; nunca resolve, com
      `timeoutMs: 20`) → a função resolve, `getSummary` continua `null`, sem evento, 15
      mensagens de 16; C4 com resumo anterior de cobertura 8 e 24 mensagens, com dublê que
      rejeita → o resumo anterior é devolvido intacto e as mensagens na íntegra são 9..23
      (`verbatimStart = max(8, 24 − 15) = 9`, 15 mensagens); C6 (`AbortController` do pedido abortado durante um sumarizador
      pendente → resolve sem resumo novo); C7 (40 mensagens e dublê que rejeita → exatamente
      as 15 últimas); saída acima de 800 caracteres é gravada cortada (Z5 aplicado)
- [x] T018 [P] [US1] Em `src/context/breakdown.test.ts`: `summary` é `0` sem resumo e é
      `estimateTokens(formatSummaryBlock(s))` com resumo; `total === message + history +
      summary + memories` (SM4); SM5: a soma dos comprimentos dos blocos de memórias, resumo e
      histórico mais a mensagem é igual ao comprimento do texto que uma estratégia falsa recebe
      de `withConversationHistory(withMemory(base, …), { summary, messages, … })`
- [x] T019 [US1] Em `src/http/server.test.ts`: acrescentar `summarizer` e `summaryTimeoutMs`
      ao que `withServer` repassa, com default `echoSummarizer` (`async ({ previousSummary,
      messages }) => \`resumo(${messages.length} msgs; anterior=${previousSummary ?? "-"})\``),
      documentado como o `noLearningDistiller` da 009 (R-015). Novo `describe("POST /chat —
      resumo (011, US1)")`: conversa com 16 mensagens gravadas → a entrada da estratégia falsa
      contém o bloco `Resumo da conversa até aqui` **antes** de `Histórico recente`, e não
      contém `pergunta 0`; `metrics.historyMessages === 8`; `metrics.summaryCoveredMessages ===
      8`; `contextBreakdown.summary > 0` e `total` soma as quatro fontes; o store tem o resumo.
      Persistência (FR-013): `SqliteConversationStore` sobre uma `DatabaseSync(":memory:")`
      compartilhada; primeiro app resume; segundo `createApp` com um **novo**
      `SqliteConversationStore` sobre a mesma conexão e com sumarizador que falha o teste se for
      chamado → a entrada tem o mesmo resumo. Falha (SC-006): sumarizador que rejeita → 200,
      `summaryCoveredMessages: 0`, 15 mensagens na íntegra. Sem `conversationId` →
      `summaryCoveredMessages: 0` e `contextBreakdown.summary: 0` (SM6). Completar o teste
      reescrito em T014: com 16 mensagens gravadas, agora espera também o resumo

### Implementation for User Story 1

- [x] T020 [P] [US1] Criar `src/context/summarizer.ts` conforme o contrato (seção 1):
      `SummarizerInput`, `Summarizer`, `SUMMARY_TARGET_TOKENS = 150`, `SUMMARIZER_PROMPT` em
      português com os itens de R-009, `formatSummarizerInput` (usa `formatTranscript`; seções
      `Resumo anterior:` e `Mensagens a incorporar:`), `capSummary` (trim; acima de
      `SUMMARY_MAX_CHARS`, `slice(0, SUMMARY_MAX_CHARS - 1).trimEnd() + "…"`) e
      `createModelSummarizer()`, que chama `createModel()` **dentro** da função devolvida,
      `.invoke([["system", SUMMARIZER_PROMPT], ["human", formatSummarizerInput(input)]], {
      signal })` e devolve `.text`. Sem `LlmCallCounter` (Z6). Comentário de módulo citando
      R-007/R-009 e o precedente do distiller da 009
- [x] T021 [US1] Criar `src/context/conversation-context.ts` conforme o contrato (seções 2 e
      3): `SUMMARY_BATCH = 8`, `MAX_VERBATIM_MESSAGES = HISTORY_WINDOW + SUMMARY_BATCH - 1`,
      `SUMMARY_TIMEOUT_MS = 30_000`, `planConversationContext`, `verbatimStart`, `interface
      ConversationContext` (data-model.md), `EMPTY_CONVERSATION_CONTEXT` e
      `prepareConversationContext(deps, conversationId, signal)` seguindo o algoritmo linha a
      linha: total lido uma vez (R-004); `withTimeout(deps.timeoutMs, s => summarizer(…, s), {
      parentSignal: signal, timeoutMessage: "Tempo limite da sumarização excedido." })`;
      `capSummary`, com vazio tratado como falha; `saveSummary` e evento só se `true`; todo erro
      da sumarização vai para `console.error("Falha ao resumir histórico da conversa:", error)`
      e segue; releitura de `getSummary`; mensagens na íntegra por `messagesRange` a partir de
      `verbatimStart`
- [x] T022 [US1] Em `src/trace/types.ts`, `ContextBreakdown` ganha `summary: number` (comentário:
      "estimativa do bloco do resumo; 0 sem resumo"; `total` soma as quatro). Em
      `src/context/breakdown.ts`, `BuildContextBreakdownInput` ganha `summary: string | null`,
      e a função estima `formatSummaryBlock(summary)` e soma no `total`
- [x] T023 [US1] Em `src/http/server.ts`: `ChatAppDeps.summarizer?: Summarizer` (comentário no
      estilo do `distiller`: só construído, não lê env) e `summaryTimeoutMs?: number` (default
      `SUMMARY_TIMEOUT_MS`); repassar ambos a `createChatHandler`. Em `src/index.ts`, passar
      `summarizer: createModelSummarizer()` junto do `distiller`
- [x] T024 [US1] Em `src/http/chat.ts`: `CreateChatHandlerOptions` ganha `summarizer` e
      `summaryTimeoutMs`; o passo do 404 passa a usar `conversationStore.countMessages(
      conversationId)` só para verificar existência (R-013), sem mais ler histórico ali; em
      `runChat()`, rodar em `Promise.all` a preparação do contexto de conversa (com
      `conversationId` → `prepareConversationContext(…, controller.signal)`; sem ele →
      `EMPTY_CONVERSATION_CONTEXT`) e o recall da 008, com o mesmo fail-open de hoje (R-005);
      `withConversationHistory(strategyToRun, { summary, summaryCoveredMessages, messages })`;
      `buildContextBreakdown({ message, history: messages, summary, memories })`. Atualizar o
      comentário de ordem do handler. Remover o import de `HISTORY_WINDOW` se ficar sem uso

**Checkpoint**: T015–T019 verdes. US1 é integrável sozinha: o resumo entra no contexto e
persiste.

---

## Phase 4: User Story 2 - Resumo cumulativo, refeito raramente (Priority: P1)

**Goal**: cada resumo novo parte do anterior mais só as mensagens recém-saídas e o substitui.
Entre rodadas, zero chamadas ao sumarizador. Concorrência não duplica nem sobrescreve.

**Independent Test**: com um sumarizador falso que grava as entradas, conduzir 20 turnos e
conferir as entradas de cada chamada e a contagem exata; com dois pedidos simultâneos,
conferir uma gravação só.

### Tests for User Story 2 ⚠️

- [x] T025 [P] [US2] Em `src/context/conversation-context.test.ts`, parte "cadência e
      mesclagem": C2 (resumo vigente `"R1"` com cobertura 8 e 24 mensagens → 1 chamada com
      `previousSummary: "R1"` e exatamente as mensagens 8..15, em ordem; o resumo gravado passa
      a cobrir 16 e substitui `"R1"`). SC-001: laço de 1 a 20 turnos em que cada turno faz
      `prepareConversationContext` e depois `append` de 2 mensagens. Depois de cada turno, o
      total de chamadas é `Math.max(0, Math.floor((mensagensAntesDoPedido - 8) / 8))`, e as
      chamadas acontecem exatamente nos turnos 9, 13 e 17. SC-003: toda chamada depois da
      primeira recebe como `previousSummary` a saída da anterior
- [x] T026 [P] [US2] Em `src/context/conversation-context.test.ts`, parte "concorrência": C5
      (sumarizador com promessa controlada pelo teste; dois `prepareConversationContext`
      simultâneos na mesma conversa de 16 mensagens; resolver os dois; exatamente um dos dois
      resultados traz `summarizeEvent`, os dois devolvem o mesmo `summary`, que é o que está
      gravado, e nenhum rejeita); C8 (sumarizador que, antes de resolver, faz `append` de 2
      mensagens novas no store → as mensagens devolvidas não incluem as novas, e
      `messages.length === 8`)
- [x] T027 [US2] Em `src/http/server.test.ts`, `describe("POST /chat — resumo cumulativo (011,
      US2)")`: 20 turnos via HTTP numa conversa, com sumarizador que grava as entradas → 3
      chamadas (turnos 9, 13 e 17); a 2ª recebe como `previousSummary` a saída da 1ª e a 3ª a
      da 2ª; cada uma recebe 8 mensagens, e as da 2ª começam onde terminaram as da 1ª; nos
      turnos sem chamada, `summaryCoveredMessages` repete o valor anterior e `historyMessages`
      fica entre 8 e 14

### Implementation for User Story 2

- [x] T028 [US2] Rodar T025–T027 contra a implementação de T021. Corrigir em
      `src/context/conversation-context.ts` qualquer desvio do contrato que apareça. Os pontos
      mais prováveis são a releitura de `getSummary` depois de `saveSummary` devolver `false`
      (C5) e usar `lastMessages` em vez de `messagesRange` sobre a fotografia (C8). Não
      acrescentar lock nem estado de processo: a garantia vem do upsert condicional (R-003)

**Checkpoint**: US1 e US2 verdes. Feature integrável (as duas P1 completas).

---

## Phase 5: User Story 3 - Ver quando a sumarização aconteceu (Priority: P2)

**Goal**: o pedido que gravou um resumo novo traz `{ type: "summarize", content,
absorbedMessages }` na posição 0 do rastro, e nenhum outro pedido traz. O rastro legível e o
roteiro de conversa longa o mostram.

**Independent Test**: com sumarizador falso, só o pedido do turno 9 de uma conversa traz o
evento, e `formatTrace` o exibe com rótulo próprio.

### Tests for User Story 3 ⚠️

- [x] T029 [P] [US3] Em `src/trace/format.test.ts`: T2, `formatTrace([{ type: "summarize",
      content: "R", absorbedMessages: 8 }])` é `[summarize]   (+8 mensagens) R`
- [x] T030 [P] [US3] Em `src/http/server.test.ts`, `describe("POST /chat — evento summarize
      (011, US3)")`: SM1 (conversa de 16 mensagens → `trace[0]` é o evento com
      `absorbedMessages: 8` e o `content` igual ao resumo gravado; exatamente 1 evento
      `summarize` no rastro; os eventos seguintes são os do `FIXED_TRACE`, na ordem); pedido
      seguinte na mesma conversa → nenhum evento `summarize`; conversa sem resumo e pedido sem
      `conversationId` → nenhum; SM2 (sumarizador que rejeita → nenhum evento e o rastro igual
      ao `FIXED_TRACE`)

### Implementation for User Story 3

- [x] T031 [US3] Em `src/http/chat.ts`, dentro de `runChat()`, depois do `run` e no mesmo
      ponto do `contextBreakdown` (R-011): `trace: summarizeEvent ? [summarizeEvent,
      ...result.trace] : result.trace`. Comentário explicando por que é aqui, fora dos
      decoradores
- [x] T032 [US3] Em `scripts/conversa-longa.sh` (contracts/conversa-longa.md): cabeçalho e
      `printf` com as colunas `est.sum` (`.metrics.contextBreakdown.summary`) e `resumo` (`+N`
      a partir de `[.trace[] | select(.type == "summarize") | .absorbedMessages] | first`, ou
      vazio); atualizar o comentário da lista de mensagens para a janela de 8 e as
      sumarizações esperadas nos turnos 9 e 13 (S4, S6). Conferir com `bash -n`

**Checkpoint**: todas as histórias verdes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T033 [P] No `README.md`: na seção do `POST /chat`, trocar "as até 12 mensagens mais
      recentes" (linha ~137) pela janela de 8 mais o resumo cumulativo; documentar o evento
      `summarize`, `metrics.summaryCoveredMessages` e `contextBreakdown.summary`, e que o
      sumarizador não entra em `llmCalls`/`promptTokens`; na subseção de
      `conversa-longa.sh`, as colunas novas; na árvore de diretórios, `src/lib/` e os arquivos
      novos de `src/context/`
- [x] T034 [P] Em `specs/003-chat-http-api/contracts/chat-endpoint.md`: acrescentar ao bloco
      de emendas o aviso da 011, com o texto de `contracts/chat-endpoint.md` ("Aviso na 003 e
      na 007")
- [x] T035 [P] Em `specs/007-persistent-conversation/spec.md` (FR-018) e
      `specs/007-persistent-conversation/contracts/conversation-store.md` (topo): nota da
      emenda da janela para 8 e dos métodos novos, com link para os contratos da 011. Em
      `specs/010-context-measurement/contracts/chat-endpoint.md` (M5/M7): nota de que a 011
      acrescenta a chave `summary`
- [x] T036 Portões: `npm run typecheck` e `npm test` sem credenciais e sem rede. Confirmar que
      o único teste pré-existente com expectativa alterada é o "teto de 12" (R-015). Depois, a
      verificação manual do `quickstart.md` (etapas 1–4) com a `OPENROUTER_API_KEY` de quem
      roda, anotando os números observados na etapa 1

---

## Dependencies & Execution Order

- **Foundational (T001–T014)** bloqueia tudo. Dentro dela:
  - T001 → T002.
  - T003 e T004 → T005 → (T006, T007) → T008 e T009.
  - T010 é independente.
  - (T011, T012) → T013 → T014.
- **US1 (T015–T024)** depende da Foundational.
- **US2 (T025–T028)** depende de T021 (a preparação) e, para T027, de T024. Os testes T025 e
  T026 podem ser escritos em paralelo com a implementação de US1.
- **US3 (T029–T032)** depende de T010 (o tipo, já na Foundational) e, para T030/T031, de T024.
  T029 e T032 podem ser feitos a qualquer momento depois da Foundational.
- **Polish** depois das histórias. T033–T035 são independentes entre si.

### Within each story

Teste antes da implementação correspondente, e confirmar que falha.
- US1: T015–T018 → T020 → T021 → T022 → T023 → T024 → T019 verde.
- US2: T025/T026 → T027 → T028.
- US3: T029/T030 → T031; T032 à parte.

### Arquivos tocados por mais de uma história

`src/http/server.test.ts` (US1, US2, US3), `src/context/conversation-context.test.ts` (US1,
US2) e `src/http/chat.ts` (US1, US3). Cada história usa o seu próprio bloco `describe` ou
trecho; em paralelo, integrar com cuidado nesses arquivos.

## Parallel Example: Foundational

```text
T001  src/lib/with-timeout.test.ts
T003  src/domain/schemas.ts
T004  src/store/sqlite-schema.ts
T010  src/trace/types.ts + src/trace/format.ts
T011  src/agents/conversation-history.test.ts
T012  src/memory/with-memory.test.ts
```

## Parallel Example: início de US1

```text
T015  src/context/summarizer.test.ts
T016  src/context/conversation-context.test.ts   (plano)
T018  src/context/breakdown.test.ts
T020  src/context/summarizer.ts
```

T017 fica no mesmo arquivo que T016 e vai logo depois dele.

## Implementation Strategy

1. **MVP = Foundational + US1**: o resumo existe, é gravado, sobrevive a reinício e entra no
   contexto. A conversa já não perde o que sai da janela.
2. **+ US2**: prova (e, se preciso, corrige) mesclagem, cadência e concorrência. Com US1 e US2
   a feature é integrável, porque as duas são P1.
3. **+ US3**: o evento e as colunas do roteiro.
4. Polish e portões antes do merge.

## Notes

- Nenhum teste chama modelo nem lê `.env` (Princípio V). Todos os sumarizadores são dublês
  definidos em arquivos `*.test.ts`, nunca em `src/` de produção.
- Nada muda em `bench.ts`, `arena.ts`, no servidor MCP, nas estratégias ou em
  `withReflection` (FR-020).
- Os testes de contrato da 007 que usam `12` como limite de `lastMessages` são independentes
  da janela e ficam como estão.
- Commit por fase, mensagem no padrão do repositório (`feat(context): …`,
  `feat(store): …`).
