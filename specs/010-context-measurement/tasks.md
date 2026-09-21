# Tasks: Medição de Contexto

**Input**: Design documents from `/specs/010-context-measurement/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluídos. O pedido diz "com testes" e a spec os exige (FR-023 a FR-026). Escrever
cada teste antes da implementação correspondente e confirmar que falha.

**Organization**: Foundational (tipos) e depois uma fase por história. US1 (P1) é o consumo
real, `promptTokens`. US2 (P2) é a estimativa e a decomposição, `contextBreakdown`. US3 (P3)
é o roteiro de conversa longa. US1 e US2 não dependem uma da outra.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: arquivos diferentes, sem dependência entre si
- Caminhos exatos em cada tarefa
- Códigos entre parênteses (E1, K3, M6, S2…) são as garantias dos contratos em
  `contracts/token-measurement.md`, `contracts/chat-endpoint.md` e `contracts/conversa-longa.md`

---

## Phase 1: Setup

Nada a instalar ou configurar (R-012): nenhuma dependência nova, nenhum DDL.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: os tipos que as duas primeiras histórias preenchem.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase.

- [x] T001 Em `src/trace/types.ts`: adicionar `interface ContextBreakdown { message: number;
      history: number; memories: number; total: number }` e, em `RunMetrics`, os campos
      opcionais `promptTokens?: number` e `contextBreakdown?: ContextBreakdown`, cada um com
      comentário no estilo dos campos da 007/008. `promptTokens` é "real, soma dos
      `input_tokens` reportados em todas as chamadas contadas em `llmCalls`; ausente se alguma
      não reportou". `contextBreakdown` é "estimativa (caracteres ÷ 4), só no `/chat`". Deixar
      registrado que "ausente" é ausência de chave, não `undefined` como valor (data-model.md,
      R-009)
- [x] T002 Criar `src/context/tokens.ts` com o comentário de módulo (o que é real e o que é
      estimado, com referência a research R-001/R-006) e nenhuma função ainda. Cada história
      acrescenta as suas funções

**Checkpoint**: `npm run typecheck` passa; nenhum comportamento mudou.

---

## Phase 3: User Story 1 - Saber quanto contexto um pedido realmente consumiu (Priority: P1) 🎯 MVP

**Goal**: toda resposta 200 do `/chat` traz `metrics.promptTokens` com a soma real dos tokens
de entrada de todas as chamadas do pedido, crítico incluso. O campo fica ausente se alguma
chamada não reportou.

**Independent Test**: com o contador alimentado por `LLMResult` montados à mão e com
estratégia falsa no `/chat`, a soma é exata; uma chamada sem consumo remove o campo.

### Tests for User Story 1 ⚠️

- [x] T003 [P] [US1] Criar `src/context/tokens.test.ts` com os testes de
      `inputTokensFromResult`. Montar `LLMResult` à mão com
      `{ generations: [[{ text: "", message: new AIMessage({ content: "", usage_metadata: {
      input_tokens, output_tokens, total_tokens } }) }]] }`. Casos: 120 → `120` (U1); `0` →
      `0` (U2); `AIMessage` sem `usage_metadata` → `undefined` (U3); `generations: [[]]` e
      geração sem `message` → `undefined` (U4). Incluir também `sumPromptTokens`: `()` → `0`,
      `(10, 20)` → `30`, `(10, undefined)` → `undefined`, `(0, 0)` → `0`
- [x] T004 [P] [US1] Criar `src/agents/llm-counter.test.ts` disparando os callbacks direto na
      instância: `calls` inalterado (K1); 3 × (start + end com 100, 200, 300) →
      `promptTokens === 600` (K2); 2 starts e 1 end com consumo → `undefined` (K3); start + end
      sem `usage_metadata` → `undefined` (K3); instância nova → `calls === 0` e
      `promptTokens === 0` (K4); duas instâncias alimentadas de forma diferente não se
      misturam (K5)
- [x] T005 [P] [US1] Em `src/agents/reflection.test.ts`: `countingCritic` passa a aceitar um
      consumo opcional por chamada e, quando houver, dispara também `handleLLMEnd` com um
      `LLMResult` com esse `input_tokens`. Novos casos, com tentativas falsas cujo
      `metrics.promptTokens` é conhecido: (R1) tentativa 100 + crítico 40 que aprova →
      `promptTokens === 140`; reprova, regenera 150, aprova com 40 cada → `100+150+40+40 =
      330`; (R2) uma tentativa sem `promptTokens` → a chave está ausente
      (`"promptTokens" in result.metrics === false`); (R3) crítico que dispara
      `handleChatModelStart` e depois lança → chave ausente; `maxReflections: 0` → a tentativa
      volta intacta, com o `promptTokens` dela. Os testes existentes de `llmCalls` continuam
      sem mudança
- [x] T006 [P] [US1] Em `src/http/server.test.ts`, bloco `describe` novo "010 promptTokens":
      estratégia falsa com `metrics: { llmCalls: 3, latencyMs: 5, promptTokens: 4200 }` →
      `body.metrics.promptTokens === 4200`; estratégia falsa sem o campo →
      `"promptTokens" in body.metrics === false` (M2); pedido com `userId` e distiller de
      aprendizado falso contando chamadas → `promptTokens` do corpo igual ao da estratégia,
      sem nada do refletor (M3); corpos 400, 404, 422 e 504 sem a chave `metrics` (M8)

### Implementation for User Story 1

- [x] T007 [US1] Em `src/context/tokens.ts`: `inputTokensFromResult(output: LLMResult): number |
      undefined` lê `output.generations[0]?.[0]`. Só aceita geração com `message` que passe
      em `isAIMessage` e com `usage_metadata.input_tokens` do tipo `number`. Não ler
      `llmOutput` (R-001). Mais `sumPromptTokens(...values: (number | undefined)[]): number |
      undefined`. Importar `LLMResult` de `@langchain/core/outputs` e `isAIMessage` de
      `@langchain/core/messages`. Faz T003 passar
- [x] T008 [US1] Em `src/agents/llm-counter.ts`: campos privados `reportedCalls` e
      `promptTokenSum`; `override handleLLMEnd(output: LLMResult)` soma quando
      `inputTokensFromResult` devolve número; getter `promptTokens` =
      `reportedCalls === calls ? promptTokenSum : undefined`. Atualizar o comentário da classe
      (research R-004: uma falha dispara `handleLLMError`, nunca `handleLLMEnd`, e por isso
      anula o total). Faz T004 passar
- [x] T009 [P] [US1] Em `src/agents/react.ts`: nos dois retornos (`completed` e
      `max-iterations`), `metrics: { llmCalls: counter.calls, latencyMs: …,
      ...promptTokensField(counter.promptTokens) }`. Criar o helper
      `promptTokensField(value) => value === undefined ? {} : { promptTokens: value }` em
      `src/context/tokens.ts`, para que "ausente" seja ausência de chave
- [x] T010 [P] [US1] Em `src/agents/plan-and-execute.ts`: o mesmo spread no único retorno. O
      contador já cobre planejador, passos e replanejador
- [x] T011 [US1] Em `src/agents/reflection.ts`: guardar os `promptTokens` de cada tentativa
      (tentativa 1 e cada regeneração). Em todos os quatro retornos com revisão (crítico
      falhou, aprovou, sinal abortado, reflexões esgotadas), acrescentar
      `...promptTokensField(sumPromptTokens(...tentativas, critiqueCounter.promptTokens))`. O
      atalho `maxReflections <= 0` não muda. Comentário curto citando FR-007 e R-005. Faz
      T005 passar
- [x] T012 [US1] Rodar `npm run typecheck` e `npm test`. T006 deve passar sem mudança em
      `src/http/chat.ts`, porque o handler já espalha `result.metrics` no corpo. Se não
      passar, corrigir no handler sem reconstruir `metrics`

**Checkpoint**: US1 completa. `promptTokens` aparece no `/chat` de ponta a ponta com
estratégia real (verificação manual, quickstart passo 1).

---

## Phase 4: User Story 2 - Saber de onde vem o contexto (Priority: P2)

**Goal**: toda resposta 200 do `/chat` traz `metrics.contextBreakdown` com a estimativa de
mensagem, histórico e memórias, e o total, medidos sobre os blocos efetivamente entregues.

**Independent Test**: com estratégia falsa que registra a entrada recebida, os valores
batem com `estimateTokens` dos blocos, e os três blocos concatenados formam exatamente essa
entrada.

### Tests for User Story 2 ⚠️

- [x] T013 [P] [US2] Em `src/context/tokens.test.ts`, casos de `estimateTokens`: `""` → 0
      (E1); `"a"` e `"abc"` → 1, `"abcde"` → 2 (E2); `"abcd"` → 1 (E3); `"ação"` → 1 (E4,
      4 unidades UTF-16, não 6 bytes); mesma chamada duas vezes com o mesmo texto → igual (E5)
- [x] T014 [P] [US2] Em `src/agents/conversation-history.test.ts`: `formatHistoryBlock([])
      === ""`; com histórico, `formatHistoryInput(h, x) === formatHistoryBlock(h) + x` para
      um `x` qualquer; o bloco termina com `"Mensagem atual do plantonista:\n"`. Os testes
      existentes de `formatHistoryInput` ficam sem mudança (B5)
- [x] T015 [P] [US2] Em `src/memory/with-memory.test.ts`: `formatMemoriesBlock([]) === ""`;
      com memórias, `formatMemoriesInput(m, x) === formatMemoriesBlock(m) + x`; o bloco
      contém cada `[memoryId]`. Os testes existentes ficam sem mudança (B5)
- [x] T016 [P] [US2] Criar `src/context/breakdown.test.ts`: (B1) sem histórico e sem memórias
      → `{ message: estimateTokens(msg), history: 0, memories: 0, total: … }`; (B2) e (B3)
      valores iguais a `estimateTokens` do bloco correspondente; `total === message + history
      + memories` (M7); (B4) para um histórico e memórias fixos,
      `formatHistoryInput(h, formatMemoriesInput(m, msg)) === formatHistoryBlock(h) +
      formatMemoriesBlock(m) + msg`
- [x] T017 [P] [US2] Em `src/http/server.test.ts`, bloco `describe` novo "010
      contextBreakdown", usando estratégia falsa que grava a `input` recebida: (a) sem
      `conversationId` nem `userId` → `history: 0`, `memories: 0`,
      `message === estimateTokens("<mensagem>")` (US2 cenário 2); (b) segundo turno na mesma
      conversa → `history === estimateTokens(formatHistoryBlock(<2 mensagens do turno 1>))`
      (cenário 3); (c) com `userId` e memória semeada no store falso da 008 →
      `memories > 0` e igual a `estimateTokens(formatMemoriesBlock(...))` (cenário 4); (d)
      mensagem com espaços nas pontas → `message` estima o texto depois do `trim` (M6); (e)
      em (b) e (c), comprimentos dos três blocos somados `=== input.length` da entrada
      gravada (M6); (f) as quatro chaves estão sempre presentes (M5); (g) com
      `reflect: true` resolvido para uma estratégia falsa que reconstrói `metrics`, a
      decomposição continua presente (anexada fora dos decoradores)

### Implementation for User Story 2

- [x] T018 [US2] Em `src/context/tokens.ts`: `export function estimateTokens(text: string):
      number { return Math.ceil(text.length / 4); }`, com comentário explicando por que não
      se usa tokenizer e por que `length` e não bytes (R-006). Faz T013 passar
- [x] T019 [P] [US2] Em `src/agents/conversation-history.ts`: extrair `formatHistoryBlock(history):
      string`, que devolve `""` sem histórico e, com histórico, o mesmo texto de hoje até
      "Mensagem atual do plantonista:" inclusive, terminado em `"\n"`. `formatHistoryInput`
      passa a ser `formatHistoryBlock(history) + input`. O texto produzido fica byte a byte
      igual. Faz T014 passar
- [x] T020 [P] [US2] Em `src/memory/with-memory.ts`: extrair `formatMemoriesBlock(memories)`
      do mesmo jeito (cabeçalho, fatos com `[memoryId]`, linha vazia, terminado em `"\n"`);
      `formatMemoriesInput` = bloco + input. Faz T015 passar
- [x] T021 [US2] Criar `src/context/breakdown.ts`: `buildContextBreakdown({ message, history,
      memories }: { message: string; history: ConversationMessage[]; memories:
      RecalledMemory[] }): ContextBreakdown`, puro, usando `estimateTokens`,
      `formatHistoryBlock` e `formatMemoriesBlock`. Faz T016 passar
- [x] T022 [US2] Em `src/http/chat.ts`, dentro de `runChat()`: declarar `memories` fora do
      `if (userId)` (vazio por padrão), guardar o resultado de `finalStrategy.run(...)` e
      devolver `{ ...result, metrics: { ...result.metrics, contextBreakdown:
      buildContextBreakdown({ message, history, memories }) } }`. Comentário curto: anexado
      aqui, depois de todos os decoradores, porque `withReflection` reconstrói `metrics`
      (R-008). Faz T017 passar

**Checkpoint**: US2 completa. `contextBreakdown` em todo 200; US1 intacta.

---

## Phase 5: User Story 3 - Ver o contexto crescer ao longo de uma conversa longa (Priority: P3)

**Goal**: um roteiro que conduz 16 turnos numa conversa e imprime `promptTokens` e a
decomposição por turno.

**Independent Test**: com o servidor no ar, 16 linhas numa única conversa; com o servidor
parado, erro no turno 1 e saída diferente de zero (quickstart passos 3 e 4).

### Implementation for User Story 3

- [x] T023 [US3] Criar `scripts/conversa-longa.sh` (bash, `set -euo pipefail`) conforme
      `contracts/conversa-longa.md`. Checar `curl` e `jq` no início (S5). `BASE_URL` vem de
      `${OPSPILOT_URL:-http://localhost:3000}`. Array com 16 mensagens de plantão sobre o
      seed, incluindo acompanhamentos que dependem do histórico ("e o runbook dele?"). Montar
      o corpo com `jq -n --arg`, nunca por interpolação de string. Turno 1 sem
      `conversationId`; guardar o devolvido e usá-lo nos turnos 2–16 (S1). Cabeçalho e uma
      linha por turno com `printf` em largura fixa: turno, `promptTokens` (ou `n/d`),
      `llmCalls`, `est.msg`, `est.hist`, `est.mem`, `est.total` (S2). Usar `curl -sS
      --fail-with-body`; em falha, `turno N falhou:` mais o corpo ou o erro em stderr, e
      `exit 1` (S3)
- [x] T024 [US3] `chmod +x scripts/conversa-longa.sh` e conferir que o git registra o modo
      executável (`git ls-files -s scripts/conversa-longa.sh` → `100755` depois do add). Se
      `shellcheck` estiver instalado, rodar sem avisos; se não estiver, pular e dizer isso

**Checkpoint**: as três histórias entregues.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Em `src/agents/model.ts`: comentário junto ao `new ChatOpenAI` dizendo que
      `streaming: true` MUST NOT ser ligado, porque nesse modo o `usage_metadata` passa a ser
      uma estimativa tiktoken e `promptTokens` deixaria de ser real (R-002)
- [ ] T026 [P] No `README.md`, na seção do `POST /chat` (onde já estão `historyMessages` e
      `recalledMemories`): documentar `promptTokens` (real, pode faltar) e `contextBreakdown`
      (estimado; por que o total fica abaixo de `promptTokens`). Acrescentar um exemplo com
      `jq '.metrics | {promptTokens, contextBreakdown}'` e uma subseção curta para
      `./scripts/conversa-longa.sh`. Na árvore de diretórios, incluir `src/context/` e
      `scripts/`
- [ ] T027 [P] Em `specs/003-chat-http-api/contracts/chat-endpoint.md`: acrescentar ao bloco
      de emendas no topo o aviso da 010, com o texto de `contracts/chat-endpoint.md` ("Aviso
      na 003")
- [ ] T028 Portões: `npm run typecheck` e `npm test` sem credenciais. Depois, a verificação
      manual do `quickstart.md` (passos 1–5) com `OPENROUTER_API_KEY` de quem roda. Registrar
      os números observados no passo 3 como referência

---

## Dependencies & Execution Order

- **Foundational (T001–T002)** bloqueia tudo.
- **US1 (T003–T012)** e **US2 (T013–T022)** são independentes entre si e podem ir em
  paralelo depois da Foundational. As duas mexem em `src/context/tokens.ts`,
  `src/context/tokens.test.ts` e `src/http/server.test.ts`, mas em funções e blocos
  `describe` distintos; em paralelo, integrar com cuidado nesses arquivos.
- **US3 (T023–T024)** só depende de os campos existirem na resposta para mostrar valores. O
  roteiro pode ser escrito antes, e sem as histórias mostra `n/d` e colunas vazias.
- **Polish** depois das histórias. T025–T027 são independentes entre si.

### Within each story

Teste antes da implementação correspondente, e confirmar que falha. Em US1: T007 → T008 →
T009/T010 → T011. Em US2: T018 → T019/T020 → T021 → T022.

## Parallel Example: início de US1 e US2

```text
T003  src/context/tokens.test.ts        (usage + sumPromptTokens)
T004  src/agents/llm-counter.test.ts
T005  src/agents/reflection.test.ts
T014  src/agents/conversation-history.test.ts
T015  src/memory/with-memory.test.ts
T016  src/context/breakdown.test.ts
```

Seis arquivos distintos, sem dependência entre si. Todos falham até as implementações.

## Implementation Strategy

1. **MVP = Foundational + US1**: o número real no `/chat`. Já responde "quanto custou em
   entrada" e é integrável sozinho (a constituição exige só P1 para integrar).
2. **+ US2**: a composição por fonte.
3. **+ US3**: a demonstração da curva.
4. Polish e portões antes do merge.

## Notes

- Nenhum teste chama modelo nem lê `.env` (Princípio V). `LLMResult` e `AIMessage` montados à
  mão bastam para exercitar o caminho real de leitura.
- Dublês ficam só em arquivos `*.test.ts`, nunca em `src/` de produção.
- Não mudar `formatMetrics`, `bench.ts` nem o servidor MCP (FR-015, R-010).
- Commit por fase, mensagem no padrão do repositório (`feat(context): …`).
