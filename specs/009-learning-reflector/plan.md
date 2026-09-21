# Implementation Plan: Refletor de Aprendizado

**Branch**: `009-learning-reflector` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-learning-reflector/spec.md`

## Summary

Tirar do agente a decisão de guardar memória. Depois de cada `/chat` bem-sucedido com `userId`,
o handler dispara — sem esperar — um refletor que examina a `message` crua: um distiller
(`withStructuredOutput` sobre `{ hasLearning, fact }`) decide se há fato durável, uma
verificação de credenciais determinística barra segredos antes e depois do modelo, e o fato
validado vai para `MemoryStore.remember` da 008, com a mesma deduplicação. O agente perde
`remember_fact` e recebe `forget_fact` renomeada para `forget_preference`.

Quatro decisões de desenho saíram da Fase 0:

1. **O disparo fica no handler, depois de `res.json()`** (R-004), não num decorador de
   estratégia: só ali "depois da resposta" e "só em sucesso" são verdade ao mesmo tempo, e o
   passo fica fora do prazo de 180 s.
2. **Um gancho `onLearning(outcome)` é o log de produção e o seam de teste** (R-006): os testes
   aguardam o desfecho sem `sleep`, e provam que a resposta não espera usando um distiller que
   só resolve quando o teste libera.
3. **A verificação de credenciais roda também na mensagem** (R-008), antes do modelo: um
   segredo parafraseado pelo modelo escaparia de qualquer padrão aplicado só ao fato.
4. **Nomes com "learning", não "reflect"** (R-001): `reflect` já é o campo do crítico da 002 no
   mesmo handler.

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22.22.2.

**Primary Dependencies**: nenhuma nova. `@langchain/openai` (`withStructuredOutput`, já usado
pelo crítico e pelo planejador), `zod@4`, `express@5`, e a memória da 008
(`@huggingface/transformers` via `MemoryStore`).

**Storage**: nenhuma mudança. Fatos aprendidos são linhas comuns de `memories` (008).

**Testing**: `node:test`. Guarda de credenciais pura, com tabelas de positivos e negativos.
Refletor sobre `SqliteMemoryStore(":memory:")` + gerador por tabela (008) + distiller falso.
Endpoint com distiller falso e sonda `onLearning`. Nenhum teste chama modelo de linguagem.

**Target Platform**: a mesma da 008.

**Project Type**: Single project.

**Performance Goals**: latência do `/chat` inalterada (SC-002) — o refletor roda depois do
envio. Custo: +1 chamada de modelo por pedido bem-sucedido com `userId`, fora de
`metrics.llmCalls` (R-010).

**Constraints**:
- `npm test` offline e sem credenciais (Princípio V): o default `createModelDistiller()` não
  pode ser alcançado por nenhum teste — o helper do servidor injeta um distiller falso.
- Resposta byte a byte igual à da 008 (nenhum campo novo).
- Nenhuma rejeição não tratada: `learn` nunca rejeita (R-007).
- Registro de estratégias, arena, bench e MCP intocados (FR-021).

**Scale/Scope**: 3 módulos novos em `src/memory/` (`secret-guard.ts`, `distiller.ts`,
`learning-reflector.ts`) + 3 arquivos de teste. Alterados: `schemas.ts`, `memory-tools.ts`
(+ teste), `with-memory.ts` (comentário) e `with-memory.test.ts` (nome da ferramenta falsa),
`http/chat.ts`, `http/server.ts`, `server.test.ts`, `index.ts`, `ops-mcp-server.test.ts`,
comentários em `agents/types.ts`/`react.ts`, README, `.github/copilot-instructions.md`,
contratos da 003 e da 008.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `learningDecisionSchema` em `src/domain/schemas.ts`, tipo inferido. `looksLikeSecret` pura. O modelo (distiller) e o relógio (`AbortSignal.timeout`) ficam no refletor e no handler — bordas. `LearningOutcome` é tipo de orquestração, não entidade: não é validado nem persistido. | ✅ Passa |
| **II. Persistência Local em SQLite** | Sem DDL novo; grava pelo `SqliteMemoryStore` da 008 (statements preparados, `CHECK` de dimensão). Testes em `":memory:"`. | ✅ Passa |
| **III. Contrato Antes de Código** | Três contratos: refletor (com prompt integral e tabela de padrões), emenda às ferramentas da 008, emenda ao `POST /chat`. Avisos nas specs 003 e 008 atualizados. | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | `forget_preference` auditada em [contracts/memory-tools.md](./contracts/memory-tools.md). O refletor não é ferramenta; seu esquema de saída tem `.describe()` nos dois campos. | ✅ Passa |
| **V. Portões Offline e Determinísticos** | Distiller injetável (FR-022), sonda de conclusão (FR-023), prazo injetável. O default real só é construído, nunca invocado, nos testes; e construí-lo não lê ambiente (R-002). | ✅ Passa |
| **Restrições Técnicas — erros** | "Falhas técnicas propagam e encerram a execução": o refletor captura e registra, porque roda depois que a execução terminou e a resposta foi entregue — não há execução a encerrar nem cliente a quem propagar. Mesmo precedente do recall fail-open da 008 e do crítico da 002 (R-007). | ✅ Passa, com justificativa registrada |
| **Restrições — credenciais** | Nenhum teste lê `.env`; a verificação manual do quickstart usa a chave do ambiente de quem roda, nunca lida pelo agente de codificação. | ✅ Passa |

**Governança — nova dependência**: nenhuma (R-012).

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. Dois pontos reforçam:

- **Segunda barreira independente do modelo** (FR-010), agora aplicada nos dois lados do
  distiller (R-008) — o princípio V vale também para a segurança: SC-004 é provado com
  distiller falso que *propõe* o segredo.
- **`forget_preference` continua fora de `defineOpsTools`**: FR-019 segue garantido por tipo.

## Project Structure

### Documentation (this feature)

```text
specs/009-learning-reflector/
├── plan.md
├── spec.md
├── research.md              # Fase 0 — 12 decisões
├── data-model.md            # LearningDecision, LearningOutcome; sem mudança de banco
├── quickstart.md
├── contracts/
│   ├── learning-reflector.md  # Distiller (D1–D4, prompt), secret guard (G1–G6), reflector (L1–L6)
│   ├── memory-tools.md        # forget_preference + auditoria; emenda à 008
│   └── chat-endpoint.md       # emenda ao POST /chat (C1–C6), ChatAppDeps
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── domain/schemas.ts              # + learningDecisionSchema, LearningDecision
├── memory/
│   ├── secret-guard.ts            # NOVO — looksLikeSecret (pura)
│   ├── secret-guard.test.ts       # NOVO — G1–G6, negativos, falso positivo aceito
│   ├── distiller.ts               # NOVO — Distiller, DISTILLER_PROMPT, createModelDistiller
│   ├── distiller.test.ts          # NOVO — construção sem ambiente, prompt
│   ├── learning-reflector.ts      # NOVO — createLearningReflector, LearningOutcome, logLearningOutcome
│   ├── learning-reflector.test.ts # NOVO — passos 1–7, L1–L6
│   ├── memory-tools.ts            # só forget_preference
│   ├── memory-tools.test.ts       # reescrito
│   ├── with-memory.ts             # comentário: forget_preference
│   └── with-memory.test.ts        # nome da ferramenta falsa
├── http/
│   ├── chat.ts                    # learn(userId, message).then(onLearning) depois do 200
│   ├── server.ts                  # ChatAppDeps: distiller, learningTimeoutMs, onLearning
│   └── server.test.ts             # helper com distiller falso; casos 009; 008 migrado
├── mcp/ops-mcp-server.test.ts     # + forget_preference fora da lista
└── index.ts                       # createModelDistiller() explícito
```

**Structure Decision**: tudo em `src/memory/`, ao lado do store que o refletor alimenta.
`distiller.ts` separado de `learning-reflector.ts` para que o módulo do refletor não importe
`agents/model.ts` — os testes do refletor não carregam `@langchain/openai`.

### Ordem de implementação sugerida

1. `learningDecisionSchema`; `secret-guard.ts` + testes.
2. `distiller.ts` + teste; `learning-reflector.ts` + testes (US1 e US2 no nível do módulo).
3. `memory-tools.ts` → `forget_preference`; testes de ferramentas, `with-memory`, MCP (US3).
4. HTTP: disparo depois do 200, `ChatAppDeps`, helper de teste com distiller falso; migrar o
   teste da 008 que chamava `remember_fact` para o fluxo do refletor; casos novos (C1–C6).
5. `index.ts`, README, copilot-instructions, avisos nas specs 003 e 008.

US1 entregável ao fim do passo 4; US2 já coberta no nível do módulo no passo 2; US3 no passo 3.

### Riscos

| Risco | Mitigação |
|---|---|
| Teste da 007/008 com `userId` alcança o distiller real e tenta a rede | Helper `withServer` injeta distiller "sem aprendizado" por padrão; sem `.env` nos testes, o real falharia em `requireEnv` antes da rede de qualquer forma |
| Processo de teste não encerra por timer pendente do refletor | `AbortSignal.timeout` não segura o event loop; distillers falsos resolvem na hora |
| Modelo real ignora a instrução e guarda pedido pontual | Não verificável offline; é a razão do prompt com exemplos negativos. Registrado como verificação manual no quickstart (passo 3) |
| Falso positivo da guarda descarta fato legítimo | Aceito por desenho (spec, Assumptions); documentado no contrato com o exemplo |

## Complexity Tracking

Nenhuma violação a justificar. Sem dependência nova, sem tabela nova, sem mudança no contrato
público de `ResolveStrategy` ou `RunOptions`.
