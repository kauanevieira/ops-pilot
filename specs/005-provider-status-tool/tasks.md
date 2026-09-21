---
description: "Task list for 005-provider-status-tool"
---

# Tasks: Status de provedores externos

**Input**: Design documents from `/specs/005-provider-status-tool/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **INCLUÍDOS e obrigatórios.** A spec os exige explicitamente (FR-033 a FR-039) e o
pedido da feature os nomeia ("testes cobrem sucesso, timeout e resposta inválida sem uso de
rede"). O Princípio V da constituição os torna portão.

**Organization**: agrupadas por história de usuário. Cada fase de história é um incremento
completo e testável sozinho.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a história a que a tarefa pertence (US1–US4)
- Todo caminho de arquivo é explícito

## Path Conventions

Projeto único: `src/` na raiz, testes `*.test.ts` **ao lado do código** (convenção do
projeto, não `tests/`).

---

## ⚠️ Antes de começar

**Duas suposições da spec seguem sem confirmação.** Nenhuma bloqueia, e as duas são baratas
de mudar — mas mais baratas agora que depois:

| Suposição | Onde | Custo se mudar depois |
|---|---|---|
| Indicador é conjunto fechado `none\|minor\|major\|critical`; um quinto valor vira "não foi possível confirmar" (R-009) | T005, T009, T031 | 1 arquivo, 1 teste |
| Retorno em **texto** de uma linha, divergindo do idioma JSON das outras cinco ferramentas (R-010) | T010, T022, T032 e todos os testes de formato | 1 arquivo, ~8 asserções |

**E três armadilhas verificadas na Fase 0**, que valem ser lidas antes da primeira linha de
código — cada uma tem a propriedade de deixar a suíte verde enquanto o comportamento está
errado:

1. **O `AbortSignal` criado fora do laço** — bug introduzido em **T025**, pego só por
   **T020** (R-003). Escrito assim, a segunda tentativa falha na hora com o erro da primeira,
   e **todos os testes de retry passam**, porque a contagem de chamadas é 2 como esperado.
2. **O teste do provedor inválido é `assert.rejects`, não `assert.match`** — **T038** (R-006).
   Se você o escrever esperando string, ele fica vermelho, e a correção intuitiva é trocar o
   enum por `z.string()` — violação da Regra 6 do Princípio IV.
3. **`res.json()` falha por duas naturezas opostas** — **T026** (R-004): `TimeoutError`
   retenta, `SyntaxError` não. Classificar pela posição no código em vez de por `error.name`
   erra metade dos casos.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: confirmar a linha de base. Esta fase é curta de propósito: a feature não
adiciona dependência, variável de ambiente nem configuração (R-001, verificado), e qualquer
tarefa de setup além desta seria trabalho inventado.

- [X] T001 Rodar `npm run typecheck && npm test` e confirmar **verde antes de qualquer
      mudança** — é a linha de base contra a qual toda quebra posterior será atribuída.
      Anotar o tempo da suíte: SC-009 exige que continue abaixo de 30 s ao final

**Checkpoint**: linha de base verde, tempo de suíte anotado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: o vocabulário que **todas** as histórias usam — provedores, URLs, esquema da
resposta e a forma do resultado. Tudo em um arquivo novo; nada aqui faz I/O ainda.

**⚠️ CRITICAL**: nenhuma história pode começar antes desta fase fechar.

- [X] T002 Criar `src/agents/provider-status.ts` com o cabeçalho de módulo explicando o que
      ele é (a borda de I/O da feature) e por que não vive em `tools.ts` (R-008)
- [X] T003 Em `src/agents/provider-status.ts`: `export const providerSchema =
      z.enum(["github","cloudflare"])` e `export type ProviderName =
      z.infer<typeof providerSchema>` (FR-002). Tipo **derivado por inferência**, nunca
      escrito à mão em paralelo — Princípio I
- [X] T004 Em `src/agents/provider-status.ts`: a tabela de URLs como constante
      `PROVIDER_STATUS_URLS`, com `as const satisfies Record<ProviderName, string>`
      (FR-005, R-012). O `satisfies` é o que faz o `typecheck` reprovar um provedor
      acrescentado ao enum sem URL correspondente. **Nenhuma URL montada por interpolação**:
      é o equivalente em HTTP do SQL concatenado que o Princípio II proíbe
- [X] T005 Em `src/agents/provider-status.ts`: `statuspageResponseSchema` = `z.object({
      status: z.object({ indicator: z.enum(["none","minor","major","critical"]),
      description: z.string() }) })` (FR-021, R-009 ⚠️). O `z.object` do zod 4 já descarta
      campos não declarados sem configuração extra — é o que cumpre a FR-023 e impede o
      corpo de inflar o contexto
- [X] T006 [P] Em `src/agents/provider-status.ts`: os tipos de resultado `FailureKind =
      "timeout" | "unavailable" | "invalid-response"` e o union `ProviderStatusResult`,
      conforme [data-model.md](./data-model.md). `FailureKind` é exatamente o que a FR-017
      exige distinguir
- [X] T007 [P] Em `src/agents/provider-status.ts`: a tabela de tradução do indicador para
      português (`none` → `operacional`, `minor` → `degradação parcial`, `major` →
      `interrupção grave`, `critical` → `interrupção crítica`), tipada por
      `Record<Indicator, string>` para que um indicador novo no enum reprove no `typecheck`.
      Ela existe para a FR-027: quem está de plantão não conhece a convenção do statuspage.io
- [X] T008 Rodar `npm run typecheck`: verde. Nada foi importado por ninguém ainda

**Checkpoint**: vocabulário pronto e tipado, projeto compila, suíte antiga intocada.

---

## Phase 3: User Story 1 — "É o nosso ou é do provedor?" (P1) 🎯 MVP

**Goal**: perguntar o status de um provedor na conversa e receber, em uma linha, o que ele
publica sobre si.

**Independent Test**: com um `fetch` dublê devolvendo um corpo realista, a ferramenta devolve
o nível e a descrição — [quickstart.md](./quickstart.md), Validação 3, linha 1.

**Escopo deliberado**: esta história é o **caminho feliz, uma tentativa só**. Timeout e
retentativa são a US2. Isso é uma fatia entregável: uma ferramenta que responde quando o
provedor responde já vale, e é o que permite validar formato e descrição antes de acrescentar
resiliência.

### Tests for User Story 1 ⚠️

> Escrever primeiro, confirmar que **falham** antes de implementar.

- [X] T009 [P] [US1] Criar `src/agents/provider-status.test.ts` com o caso de sucesso: dublê
      devolve `new Response(JSON.stringify({ page:{...}, status:{ indicator:"none",
      description:"All Systems Operational" }, components:[...] }))`; afirmar
      `{ ok:true, indicator:"none", description:"All Systems Operational" }` e que **nem
      `page` nem `components` aparecem** no resultado (FR-023, FR-026)
- [X] T010 [P] [US1] Em `src/agents/provider-status.test.ts`: a linha formatada de sucesso é
      exatamente `github: operacional — All Systems Operational` (FR-024), e os quatro
      indicadores traduzem conforme a tabela de T007
- [X] T011 [P] [US1] Em `src/agents/provider-status.test.ts`: o dublê recebe **a URL da
      tabela**, não uma montada — afirmar a URL exata recebida para cada um dos dois
      provedores (FR-005, R-012)
- [X] T012 [P] [US1] Em `src/agents/tools.test.ts`: `invoke({})` aplica o default `github`
      (FR-003) — afirmar pela URL que o dublê recebeu, não só pelo texto de saída

### Implementation for User Story 1

- [X] T013 [US1] Em `src/agents/provider-status.ts`: `checkProviderStatus(provider, deps)`
      numa **única** tentativa — `fetch` na URL da tabela, `res.json()`,
      `statuspageResponseSchema.parse`, devolver `{ ok: true, ... }`. Sem timeout e sem
      retry ainda (US2). `deps.fetchImpl` com default `globalThis.fetch`
- [X] T014 [US1] Em `src/agents/provider-status.ts`: `formatProviderStatus(result)` para o
      caso de sucesso, usando a tabela de T007 (FR-024, FR-025). Uma linha, sem quebra
- [X] T015 [US1] Em `src/agents/tools.ts`: mudar a assinatura para
      `createOpsTools(store: OpsRepository, deps: { fetchImpl?: typeof fetch } = {})`
      (R-007). **Parâmetro opcional com default** — obrigatório quebraria os três call sites
      existentes sem ganho. `react.ts` e `plan-and-execute.ts` **não mudam**, e a cadeia
      `BASE_FACTORIES → createStrategy → resolveStrategy` **não é tocada**: é contrato
      público da 003
- [X] T016 [US1] Em `src/agents/tools.ts`: registrar `check_provider_status` com o esquema
      `z.object({ provider: providerSchema.default("github").describe(...) })` e acrescentá-lo
      ao array devolvido por `createOpsTools`. A descrição completa entra na US4 — aqui basta
      uma provisória, **mas ela já precisa conter as palavras `github` e `cloudflare`**: ver
      T017
- [X] T017 [US1] ⚠️ **Esta tarefa começa com a suíte vermelha, e é o esperado.** Em
      `src/agents/tools.test.ts` já existe a auditoria das 6 regras herdada da 004
      (`describe("as 5 ferramentas — auditoria das 6 regras")`), e ela tem **três tripwires**
      que disparam no instante em que T016 registra a sexta ferramenta:
      (a) `assert.deepEqual` contra a lista literal dos cinco nomes;
      (b) a Regra 5, que exige `.describe()` em todo campo de todo esquema;
      (c) a Regra 6, que exige que **cada valor** de um campo enum apareça no texto da
      descrição daquele campo — é por isso que a descrição provisória de T016 já precisa
      citar `github` e `cloudflare`.
      Acrescentar `"check_provider_status"` à lista literal e renomear o `describe` para
      "as 6 ferramentas". Os tripwires funcionaram: é exatamente o que a 004 os pôs ali para
      fazer
- [X] T018 [US1] Rodar `npm run typecheck && npm test`: verde, e os três call sites existentes
      compilando sem alteração

**Checkpoint**: a ferramenta existe, responde o caminho feliz e está exposta ao agente. É a
MVP: entregável sozinha, ainda que frágil.

---

## Phase 4: User Story 2 — Provedor fora do ar não derruba o plantão (P2)

**Goal**: quando o provedor está lento, instável ou fora, a conversa não trava nem estoura —
o agente recebe uma observação legível e segue.

**Independent Test**: dublês que demoram, falham na rede e devolvem 5xx/4xx; em todos os
casos a consulta termina em tempo limitado, com observação legível e nenhuma exceção
escapando — [quickstart.md](./quickstart.md), Validações 3 e 4.

### Tests for User Story 2 ⚠️

- [X] T019 [US2] Em `src/agents/provider-status.test.ts`: espera esgotada nas duas
      tentativas. O dublê rejeita **na hora** com `new DOMException("...", "TimeoutError")`
      — idêntico ao que o `fetch` real produz (R-002, verificado), o que satisfaz a FR-038
      sem relógio falso e sem suíte lenta. Afirmar `FailureKind === "timeout"` e
      `attempts === 2`
- [X] T020 [US2] **A tarefa que pega o bug do R-003.** Em
      `src/agents/provider-status.test.ts`: o dublê registra o `signal` de **cada** chamada;
      afirmar que nenhum deles chegou com `signal.aborted === true`. Sem este teste, um sinal
      criado fora do laço deixa a suíte inteira verde com a retentativa morta — a contagem
      de tentativas de T019 passa dos dois jeitos. Comentar isso no teste: é a única proteção
      contra uma regressão que não dá sintoma
- [X] T021 [US2] Em `src/agents/provider-status.test.ts`: a matriz de classificação, um caso
      por linha da tabela de [contracts/check-provider-status.md](./contracts/check-provider-status.md)
      § Resiliência — rede→sucesso (2 tentativas, resultado de sucesso), 5xx→sucesso (2),
      5xx→5xx (2, `unavailable`), **4xx (1, sem retentativa, FR-011)**. Afirmar `attempts`
      em todos (FR-037, SC-005)
- [X] T022 [P] [US2] Em `src/agents/provider-status.test.ts`: as linhas de falha começam por
      `<provedor>: não foi possível confirmar o status` e trazem a natureza e a contagem de
      tentativas (FR-016, FR-017, FR-018). Afirmar também que **nenhuma** delas pode ser lida
      como estado válido (FR-019) e que nenhuma contém `at `, `.ts:` ou caminho de arquivo
      (FR-020)
- [X] T023 [P] [US2] Em `src/agents/tools.test.ts`: nenhuma exceção escapa do corpo da
      ferramenta (FR-015, SC-002) — varrer os seis dublês de falha da Validação 4 do
      quickstart (rede, `AbortError`, JSON truncado, 502, corpo vazio, erro exótico) e
      afirmar que **toda** invocação resolve com string

### Implementation for User Story 2

- [X] T024 [US2] Em `src/agents/provider-status.ts`: envolver a tentativa única de T013 num
      laço explícito de no máximo duas — `for (let attempt = 1; attempt <= 2; attempt++)`,
      com saída imediata nos casos não-retentáveis. **Não** uma função recursiva genérica de
      retry: é onde a terceira tentativa entra sem ninguém notar (INV-A, SC-005)
- [X] T025 [US2] ⚠️ Em `src/agents/provider-status.ts`: `AbortSignal.timeout(5000)` criado
      **dentro** do laço, uma vez por tentativa (FR-009, R-003). Um comentário no código
      dizendo por que — a forma "óbvia" é criá-lo fora, e ela mata a retentativa em silêncio.
      O `res.json()` fica **dentro** do mesmo bloco protegido: o limite cobre a leitura do
      corpo, não só os cabeçalhos (R-004, verificado)
- [X] T026 [US2] Em `src/agents/provider-status.ts`: o classificador, por **`error.name`**,
      nunca por `instanceof` nem pela posição no código (R-002, R-004) — `TimeoutError` →
      `timeout` (retenta); `TypeError` → `unavailable` (retenta); `SyntaxError` e falha de
      `parse` → `invalid-response` (**não** retenta); `res.status >= 500` → `unavailable`
      (retenta); `res.status >= 400` → `unavailable` (**não** retenta)
- [X] T027 [US2] Em `src/agents/provider-status.ts`: `formatProviderStatus` para o caso de
      falha, conforme a tabela de retorno do contrato (FR-016 a FR-020). O prefixo
      `não foi possível confirmar o status` é o que garante a FR-019
- [X] T028 [US2] Em `src/agents/tools.ts`: o corpo da ferramenta em `try/catch` que devolve a
      linha de falha em vez de propagar (FR-015) — mesmo idioma das cinco existentes, com uma
      diferença: aqui **nada** reescapa, porque não há erro de domínio a distinguir de falha
      técnica
- [X] T029 [US2] Rodar `npm run typecheck && npm test`: verde. Confirmar que a suíte **não**
      ficou mais lenta — se ficou, algum teste está esperando 5 s de verdade em vez de usar
      o dublê (FR-038)

**Checkpoint**: a ferramenta sobrevive ao provedor fora do ar. US1 e US2 funcionam juntas.

---

## Phase 5: User Story 3 — Resposta confiável e curta (P3)

**Goal**: o que chega ao agente é uma linha, e nada fora do formato esperado vira estado.

**Independent Test**: respostas fora do formato viram falha legível; o retorno é
comprovadamente menor que o corpo recebido — [quickstart.md](./quickstart.md), Validação 3,
linha 5.

> **Sobreposição declarada com a US2**: a política de retentativa (T026) já precisou
> classificar `invalid-response`, porque é ela que decide *não* retentar. Esta fase não
> reimplementa isso — ela cobre as garantias **observáveis** que a US3 promete e que nada na
> US2 verifica: compacidade, ausência do corpo bruto e a impossibilidade de um corpo
> inesperado virar estado. Fingir separação limpa aqui seria inventar tarefa.

### Tests for User Story 3 ⚠️

- [X] T030 [P] [US3] Em `src/agents/provider-status.test.ts`: corpo não-JSON
      (`new Response("<html>oops</html>")`) → `invalid-response`, **1 tentativa** (FR-012).
      É o cenário realista de uma página de erro de CDN durante uma interrupção
- [X] T031 [P] [US3] Em `src/agents/provider-status.test.ts`: JSON válido mas fora do esquema
      — `status` ausente, `description` ausente, `indicator` de tipo errado, e **indicador
      desconhecido** (`"catastrophic"`, R-009 ⚠️) → todos `invalid-response`, nenhum vira
      estado (FR-022, SC-007)
- [X] T032 [P] [US3] Em `src/agents/tools.test.ts`: o retorno é **uma linha**
      (`assert.ok(!out.includes("\n"))`) e é ao menos 10× menor que o corpo recebido do dublê
      (SC-006). Afirmar também que não contém `"page"` nem `"components"` (FR-026)

### Implementation for User Story 3

- [X] T033 [US3] Em `src/agents/provider-status.ts`: conferir que o caminho de sucesso
      constrói o resultado **a partir do valor devolvido pelo `parse`**, e nunca do corpo
      bruto (INV-8). É a diferença entre descartar os campos extras e apenas não os
      mencionar — se o objeto bruto for repassado, T032 pega
- [X] T034 [US3] Rodar `npm run typecheck && npm test`: verde

**Checkpoint**: nada fora do formato vira estado, e o contexto não infla.

---

## Phase 6: User Story 4 — O agente escolhe esta ferramenta na hora certa (P4)

**Goal**: a descrição faz o modelo acertar na primeira tentativa, e não confundir sinal
externo com sinal interno.

**Independent Test**: auditar a descrição contra as 6 regras e verificar a fronteira
recíproca — [quickstart.md](./quickstart.md), Validação 2.

### Implementation for User Story 4

- [X] T035 [US4] Em `src/agents/tools.ts`: substituir a descrição provisória de T016 pela
      descrição final, **copiada de**
      [contracts/check-provider-status.md](./contracts/check-provider-status.md)
      § "Descrição exposta ao modelo" (FR-028 a FR-031). Conferir item a item contra a tabela
      de auditoria do mesmo contrato
- [X] T036 [US4] Em `src/agents/tools.ts`: o `.describe()` do campo `provider`, com os dois
      valores aceitos e o padrão explicitado (FR-032). O campo permanece `z.enum` —
      **nunca** `z.string()` com validação manual dentro, ainda que isso desse uma mensagem
      de erro mais bonita (Regra 6; R-006)
- [X] T037 [US4] ⚠️ **A tarefa fácil de esquecer** (R-015). Em `src/agents/tools.ts`,
      acrescentar à descrição de `list_alerts` a fronteira contra a ferramenta nova — texto
      em [contracts/check-provider-status.md](./contracts/check-provider-status.md)
      § "Fronteira recíproca". A Regra 3 do Princípio IV é recíproca: com uma sexta
      ferramenta que também responde "o que está acontecendo", `list_alerts` precisa dizer
      que trata de sinal **interno**. Nenhuma outra descrição muda
- [X] T038 [US4] Em `src/agents/tools.test.ts`: confirmar que a auditoria herdada da 004,
      já ajustada em T017, **passa com a descrição final** — em especial a Regra 6, que exige
      `github` e `cloudflare` literais na descrição do campo `provider` (FR-032). Nenhum teste
      novo é necessário aqui: o da 004 cobre as seis ferramentas assim que a lista de nomes é
      atualizada
- [X] T039 [US4] ⚠️ Em `src/agents/tools.test.ts`: provedor fora do enum →
      **`await assert.rejects(() => tool.invoke({ provider: "aws" }))`** (FR-004), afirmando
      que a mensagem cita `github` e `cloudflare`, e que o dublê **não foi chamado nenhuma
      vez**. `assert.rejects`, **não** `assert.match`: a validação de esquema do LangChain
      lança antes do corpo da ferramenta (R-006, verificado), e quem converte isso em
      observação para o agente é o `ToolNode`, cujo `handleToolErrors` é `true` por padrão.
      Comentar isso no teste — sem o comentário, o próximo a lê-lo vai "consertar" o enum
- [X] T040 [US4] Rodar `npm run typecheck && npm test`: verde

**Checkpoint**: as seis ferramentas conformes às 6 regras, fronteiras recíprocas declaradas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 [P] Em `README.md` linha ~154: "as 5 ferramentas (list_alerts, list_incidents,
      consultar_runbook, open_incident, resolve_incident)" passa a ser **falso**. Atualizar
      para seis, incluindo `check_provider_status`. Princípio III: comportamento observável
      mudou, a documentação muda no mesmo conjunto de mudanças
- [X] T042 [P] Em `README.md`: uma linha na seção de capacidades dizendo que o OpsPilot
      consulta o status público de GitHub e Cloudflare, **sem chave** — é a pergunta que
      quem clona vai fazer ("preciso configurar alguma coisa?"), e a resposta é não (SC-010)
- [X] T043 Executar [quickstart.md](./quickstart.md) Validações 1 a 4 (offline) e conferir a
      tabela de saídas esperadas linha a linha
- [ ] T044 Executar [quickstart.md](./quickstart.md) Validação 5 (precisa de
      `OPENROUTER_API_KEY`): o pedido sobre deploy/GitHub usa `check_provider_status`, **e**
      "como está o plantão?" **não** usa. A contraprova importa tanto quanto o caso positivo
      — se o status externo for consultado ali, a fronteira de T035/T037 não está clara
- [ ] T045 Executar [quickstart.md](./quickstart.md) Validação 6 (precisa de rede, **fora dos
      portões**): consultar os dois provedores de verdade. É a única verificação que confirma
      o contrato do statuspage.io, porque a suíte deliberadamente não o faz
      ([contracts/statuspage-api.md](./contracts/statuspage-api.md))
- [X] T046 Portões finais: `npm run typecheck && npm test` verdes, suíte abaixo de 30 s
      (SC-009), `git status --short` sem arquivo inesperado, e
      `git diff --stat package.json .env.example tsconfig.json` **vazio** (FR-006, SC-010)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: sem dependências
- **Foundational (T002–T008)**: depende do Setup — **bloqueia todas as histórias**
- **US1 (T009–T018)**: depende da Foundational
- **US2 (T019–T029)**: depende da **US1** — a resiliência envolve a tentativa única de T013.
  Não é independência quebrada: a US1 entrega valor sozinha, a US2 é que precisa dela
- **US3 (T030–T034)**: depende da US2 para T030/T031 (a contagem de tentativas exige o laço),
  mas T032 depende só da US1
- **US4 (T035–T040)**: depende da US1 (a ferramenta precisa existir). Independente de US2/US3
- **Polish (T041–T046)**: depende das histórias desejadas

### Within Each User Story

- Testes escritos e **vermelhos** antes da implementação
- Vocabulário antes de comportamento; comportamento antes de descrição
- História completa antes da próxima prioridade

### Parallel Opportunities

- T006 e T007 em paralelo (partes independentes do mesmo arquivo novo — coordenar a escrita)
- T009 a T012 em paralelo: quatro testes, dois arquivos
- T022 e T023 em paralelo (arquivos diferentes)
- T030, T031 e T032 em paralelo
- T041 e T042 em paralelo com qualquer coisa: só tocam `README.md`

**Sem paralelismo entre T013 → T024 → T025 → T026**: são a mesma função, evoluindo. Tentar
paralelizá-las produz conflito no mesmo trecho.

---

## Parallel Example: User Story 1

```bash
# Os quatro testes da US1, juntos:
Task: "T009 caso de sucesso em src/agents/provider-status.test.ts"
Task: "T010 linha formatada em src/agents/provider-status.test.ts"
Task: "T011 URL da tabela em src/agents/provider-status.test.ts"
Task: "T012 default github em src/agents/tools.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 apenas)

1. T001 → linha de base verde
2. T002–T008 → vocabulário (bloqueia tudo)
3. T009–T017 → US1
4. **PARAR e VALIDAR**: quickstart Validação 3, linha 1
5. A ferramenta já responde "é o nosso ou é do provedor?" quando o provedor coopera

### Incremental Delivery

1. Foundational → base pronta
2. + US1 → valida → **MVP**
3. + US2 → a ferramenta sobrevive ao provedor fora do ar (o caso que mais importa)
4. + US3 → o contexto não infla e nada inesperado vira estado
5. + US4 → o modelo escolhe certo na primeira tentativa

A US2 é a que eu não cortaria: uma ferramenta que consulta um serviço externo e pode travar
a conversa piora o plantão exatamente no momento em que alguém precisa dela.

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- Confirmar que cada teste **falha** antes de implementar — em especial T020, cujo valor
  inteiro está em falhar quando o sinal é compartilhado
- Commit por tarefa ou grupo lógico
- Nenhum teste toca a rede, **inclusive** os de falha (FR-035). Se algum precisar de rede
  para passar, o dublê está no lugar errado
