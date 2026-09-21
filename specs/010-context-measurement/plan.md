# Implementation Plan: Medição de Contexto

**Branch**: `010-context-measurement` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-context-measurement/spec.md`

## Summary

Medir o contexto que cada `/chat` envia ao modelo, de dois jeitos que não se confundem:

- **Real**: `metrics.promptTokens`, a soma dos `input_tokens` que o provedor reporta. O
  `LlmCallCounter` que já está em toda chamada contada em `llmCalls` passa a ler
  `usage_metadata` em `handleLLMEnd`. O `withReflection` soma tentativas e crítico.
- **Estimado**: `metrics.contextBreakdown`, com caracteres ÷ 4 para a mensagem, o bloco de
  histórico (007) e o bloco de memórias (008). O handler calcula a partir dos mesmos blocos que
  os decoradores prefixam.

Um roteiro `scripts/conversa-longa.sh` conduz 16 turnos numa conversa e imprime os dois
números por turno.

Quatro decisões de desenho saíram da Fase 0:

1. **A fonte única é `usage_metadata`, lida no callback existente** (R-001). O conjunto de
   chamadas somadas é, por construção, o mesmo de `llmCalls`. Não há ponto novo de
   instrumentação.
2. **Consumo incompleto é desconhecido, não parcial** (R-004): o contador compara chamadas
   iniciadas com chamadas que reportaram. Uma chamada que falhou ou veio sem consumo anula o
   total sem precisar de mapa por `runId`.
3. **Os blocos medidos são os blocos entregues** (R-007): `formatHistoryBlock` e
   `formatMemoriesBlock` são extraídos das funções existentes e reusados pela decomposição.
   Um teste garante que os três blocos concatenados formam exatamente a entrada da estratégia.
4. **Streaming fica desligado na fábrica** (R-002): com `streaming: true`, o `ChatOpenAI`
   grava em `usage_metadata` uma estimativa tiktoken que pareceria real.

## Technical Context

**Language/Version**: TypeScript em ESM, `strict: true`. Node 22.

**Primary Dependencies**: nenhuma nova. `@langchain/core` 1.2.11 (`BaseCallbackHandler`,
`LLMResult`, `AIMessage.usage_metadata`), `@langchain/openai` 1.5.13 (preenche
`usage_metadata` a partir de `usage.prompt_tokens`).

**Storage**: nenhuma mudança.

**Testing**: `node:test`. Funções puras com tabelas. Contador exercitado disparando os
callbacks com `LLMResult` montados à mão. Reflexão com crítico falso que dispara
`handleLLMEnd` com consumo. `/chat` com estratégia falsa que registra a entrada recebida.
Nenhum teste chama modelo.

**Target Platform**: a mesma das features anteriores (servidor Node local).

**Project Type**: Single project.

**Performance Goals**: custo desprezível. Uma leitura de campo por chamada ao modelo e três
`length` por pedido. Nenhuma chamada extra ao provedor (SC-006).

**Constraints**:
- `npm test` offline (Princípio V).
- Campos novos opcionais; "ausente" é ausência de chave, não `undefined` como valor.
- Arena, bench e MCP com saída idêntica (FR-015). Verificado: nenhum deles imprime `metrics`
  inteiro (R-010).
- Nenhum teste existente muda de expectativa. Os testes do `/chat` verificam campos de
  `metrics` um a um, e o único `deepEqual` sobre `metrics` (`incident-confirmation.test.ts`)
  usa uma estratégia falsa que não passa pelo contador.

**Scale/Scope**: 2 módulos novos em `src/context/` (`tokens.ts`, `breakdown.ts`) com testes;
1 roteiro novo `scripts/conversa-longa.sh`. Alterados: `trace/types.ts`,
`agents/llm-counter.ts` (+ teste novo), `agents/react.ts`, `agents/plan-and-execute.ts`,
`agents/reflection.ts` (+ teste), `agents/model.ts` (comentário),
`agents/conversation-history.ts` e `memory/with-memory.ts` (extração do bloco, + testes),
`http/chat.ts`, `http/server.test.ts`, README, contrato da 003.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `estimateTokens`, `inputTokensFromResult`, `sumPromptTokens`, `buildContextBreakdown` e os `format*Block` são puros. O consumo vem do provedor pelo callback, que já é borda. `ContextBreakdown` é métrica de execução, não entidade, e fica como interface ao lado de `RunMetrics` (R-009). Nada novo em `src/domain/`. | ✅ Passa |
| **II. Persistência Local em SQLite** | Nada é persistido. | ✅ N/A |
| **III. Contrato Antes de Código** | Contratos: [token-measurement.md](./contracts/token-measurement.md), emenda ao [`POST /chat`](./contracts/chat-endpoint.md) com aviso na 003, [conversa-longa.md](./contracts/conversa-longa.md). README atualizado na mesma mudança. | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | Nenhuma ferramenta nova ou alterada. | ✅ N/A |
| **V. Portões Offline e Determinísticos** | Consumo testado com `LLMResult` à mão. O roteiro, que precisa de rede, fica fora de `npm test` e é declarado como verificação manual. | ✅ Passa |
| **Restrições — runtime** | Roteiro em bash + `curl` + `jq`, as mesmas ferramentas do README. Não é dependência de runtime do servidor. | ✅ Passa |
| **Restrições — credenciais** | O roteiro não lê `.env`; fala com o servidor, que já tem as credenciais. | ✅ Passa |

**Governança — nova dependência**: nenhuma. Tokenizer real (tiktoken) foi descartado em
R-006: a spec pede estimativa, e o mais simples vence.

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. O desenho reforça o Princípio I: a decomposição
não reconstrói o texto do prompt noutro lugar, reusa os blocos puros dos decoradores (B4).

## Project Structure

### Documentation (this feature)

```text
specs/010-context-measurement/
├── plan.md
├── spec.md
├── research.md              # Fase 0: 12 decisões
├── data-model.md            # RunMetrics + ContextBreakdown; estado do contador
├── quickstart.md
├── contracts/
│   ├── token-measurement.md   # estimateTokens (E), usage (U), contador (K), reflexão (R), blocos (B)
│   ├── chat-endpoint.md       # emenda ao POST /chat (M1–M8)
│   └── conversa-longa.md      # roteiro (S1–S5)
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── context/
│   ├── tokens.ts                     # NOVO: estimateTokens, inputTokensFromResult, sumPromptTokens
│   ├── tokens.test.ts                # NOVO: E1–E5, U1–U4, sumPromptTokens
│   ├── breakdown.ts                  # NOVO: buildContextBreakdown
│   └── breakdown.test.ts             # NOVO: B1–B4
├── trace/types.ts                    # RunMetrics + promptTokens?, contextBreakdown?; ContextBreakdown
├── agents/
│   ├── llm-counter.ts                # + handleLLMEnd, reportedCalls, promptTokenSum, get promptTokens
│   ├── llm-counter.test.ts           # NOVO: K1–K5
│   ├── react.ts                      # promptTokens nos dois retornos
│   ├── plan-and-execute.ts           # promptTokens no retorno
│   ├── reflection.ts                 # sumPromptTokens em todos os retornos
│   ├── reflection.test.ts            # crítico falso dispara handleLLMEnd; R1–R3
│   ├── model.ts                      # comentário: não ligar streaming (R-002)
│   ├── conversation-history.ts       # + formatHistoryBlock; formatHistoryInput = block + input
│   └── conversation-history.test.ts  # + casos do bloco
├── memory/
│   ├── with-memory.ts                # + formatMemoriesBlock; formatMemoriesInput = block + input
│   └── with-memory.test.ts           # + casos do bloco
└── http/
    ├── chat.ts                       # runChat anexa contextBreakdown depois do run
    └── server.test.ts                # M1–M8 com estratégia falsa

scripts/
└── conversa-longa.sh                 # NOVO: S1–S5, executável
```

**Structure Decision**: `src/context/` como o pedido nomeia. Ali ficam só funções puras sobre
texto e consumo, e `tokens.ts` não depende de nada do projeto. `breakdown.ts` importa os
formatadores de `agents/` e `memory/`, porque os blocos têm de ser os mesmos que os
decoradores usam. O callback continua em `agents/llm-counter.ts`, onde já é instanciado por
run. `scripts/` na raiz, separado de `src/scripts/` (TS do seed), porque é shell e não passa
pelo `tsc`.

### Ordem de implementação sugerida

1. `src/context/tokens.ts` + testes (base de tudo).
2. `LlmCallCounter` + testes; `react.ts`, `plan-and-execute.ts`; `RunMetrics.promptTokens`.
3. `withReflection` + testes (US1 completa no nível das estratégias).
4. `format*Block` + testes; `breakdown.ts` + testes; `RunMetrics.contextBreakdown`.
5. `http/chat.ts` + `server.test.ts` (US1 e US2 visíveis no `/chat`); comentário em
   `model.ts`.
6. `scripts/conversa-longa.sh` (US3); README; aviso no contrato da 003.

US1 entregável ao fim do passo 5 (o campo já aparece no `/chat` pelo spread de `metrics`).
US2 no passo 5. US3 no passo 6.

### Riscos

| Risco | Mitigação |
|---|---|
| OpenRouter não devolver `usage` para algum modelo/rota | `promptTokens` fica ausente (FR-006) em vez de errado; o roteiro mostra `n/d`. Verificação manual no quickstart, passo 1 |
| Alguém liga `streaming: true` na fábrica e o número vira estimativa silenciosa | Comentário na fábrica e invariante no contrato (R-002) |
| Extração do bloco muda o texto enviado ao modelo por engano | B4 e B5: os testes existentes de `format*Input` passam sem mudança, e B4 prova que a concatenação dos blocos reproduz a entrada |
| `withStructuredOutput` com `includeRaw: false` esconder o `AIMessage` do callback | Não esconde: o callback recebe o `LLMResult` do modelo interno antes do parser. Verificado em `chat_models.js` (`handleLLMEnd` com as gerações). Coberto manualmente pelo passo 2 do quickstart (planejador/crítico) |
| Chamada que falha e é retentada pelo cliente OpenAI | A retentativa acontece dentro de `completionWithRetry`, numa única chamada do LangChain: um start, um end. Não afeta a regra |

## Complexity Tracking

Nenhuma violação a justificar. Sem dependência nova, sem camada nova, sem mudança em
`RunOptions`, `ReasoningStrategy` ou `ResolveStrategy`.
