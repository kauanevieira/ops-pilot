# Research: Medição de Contexto

**Feature**: 010-context-measurement | **Date**: 2026-09-21

Versões verificadas em `node_modules`: `@langchain/core` 1.2.11, `@langchain/openai` 1.5.13.

---

## R-001 — De onde vem o consumo real

**Decision**: ler `usage_metadata.input_tokens` do `AIMessage` em
`output.generations[0][0].message`, dentro de `handleLLMEnd(output: LLMResult)` do callback
que já conta chamadas. Consumo "reportado" ⇔ `typeof input_tokens === "number"`.

**Rationale**: `usage_metadata` é o campo padronizado do `@langchain/core` (tipo
`UsageMetadata`, exportado de `@langchain/core/messages`), o mesmo para qualquer provedor. O
`ChatOpenAI` o preenche a partir de `data.usage.prompt_tokens` no caminho sem streaming
(`completions.js`, `_generate`). O callback já está plugado em toda chamada que entra em
`llmCalls` — ReAct, os três nós do plan-and-execute e o crítico — então a soma cobre
exatamente o mesmo conjunto (FR-005) sem nenhum ponto novo de instrumentação.

**Alternatives considered**:
- `llmOutput.tokenUsage.promptTokens`: específico do adaptador OpenAI; no caminho de
  streaming o mesmo adaptador usa a chave `estimatedTokenUsage`, que seria lida como ausente.
- Ler `usage_metadata` das mensagens do rastro final (`lastMessages`): não cobre chamadas com
  `withStructuredOutput` (planejador, replanejador, crítico), cujo `AIMessage` não fica em
  estado nenhum, e perde as tentativas descartadas pela reflexão.

## R-002 — Streaming devolve estimativa, não consumo real

**Decision**: registrar como invariante que `createModel()` MUST NOT ligar `streaming: true`.
Nenhuma mudança de código; comentário no ponto da fábrica e no contrato.

**Rationale**: com `this.streaming`, o `ChatOpenAI._generate` calcula `input_tokens` com
`_getEstimatedTokenCountFromPrompt` (tiktoken local) e escreve o resultado no mesmo
`usage_metadata`. O número pareceria real sem ser. Hoje a fábrica não liga streaming, e o
`stream()` do LangGraph com `streamMode: "values"` chama o modelo sem streaming. Se um dia
for usado `streamMode: "messages"`, o core roteia por `_streamResponseChunks`, que pede
`stream_options.include_usage` (`streamUsage` é `true` por padrão) e devolve o consumo real no
último chunk. O caminho que falsifica é só a flag `streaming` na fábrica.

## R-003 — Zero reportado vira "não reportado" no adaptador OpenAI

**Decision**: a extração trata `0` como reportado (conforme a spec). Registrar que, com o
`ChatOpenAI` atual, um `prompt_tokens: 0` do provedor chega como ausente: o adaptador faz
`if (promptTokens) usageMetadata.input_tokens = …`.

**Rationale**: `prompt_tokens: 0` não acontece numa chamada real (há sempre pelo menos a
mensagem). A extração fica correta para qualquer provedor que passe o zero; o caso de borda
da spec é garantido no nosso código e testado com dublê.

## R-004 — Contagem por chamada, não por `runId`

**Decision**: o `LlmCallCounter` guarda três números: `calls` (em `handleChatModelStart`,
como hoje), `reportedCalls` e `promptTokenSum` (em `handleLLMEnd`). O getter
`promptTokens` devolve `promptTokenSum` quando `reportedCalls === calls`, senão `undefined`.
Com `calls === 0`, devolve `0`.

**Rationale**: uma chamada que falha dispara `handleLLMError` e nunca `handleLLMEnd`, então
fica contada sem consumo e anula o total (FR-006). Isso vale sem guardar mapa por `runId`.
O isolamento entre pedidos (FR-008) já vem da regra existente de uma instância por `run()`.
`0` com zero chamadas é "soma vazia", não "desconhecido": um run que não chamou o modelo
consumiu 0.

**Alternatives considered**: mapa `runId → tokens`. Mais estado sem ganho: o callback de fim
nunca chega sem o de início.

## R-005 — Somar entre camadas (reflexão)

**Decision**: função pura `sumPromptTokens(...values: (number | undefined)[])` em
`src/context/tokens.ts`: `undefined` se algum valor for `undefined`, senão a soma. O
`withReflection` a usa em todos os retornos, somando cada tentativa e o `critiqueCounter`.
O atalho `maxReflections <= 0` devolve a tentativa intacta, então herda o `promptTokens`
dela.

**Rationale**: o `withReflection` reconstrói `metrics` do zero em cada retorno (motivo pelo
qual 007 e 008 ficam do lado de fora). Sem somar ali, o `promptTokens` da base se perderia e
FR-007 falharia. O crítico já recebe o `critiqueCounter` como callback (002, R-008), então o
consumo do crítico vem de graça.

**Consequência**: uma estratégia falsa de teste que não declara `promptTokens` leva o total
refletido a `undefined`. É o comportamento correto (desconhecido é desconhecido) e os testes
existentes não verificam o campo.

## R-006 — Estimativa: `Math.ceil(texto.length / 4)`

**Decision**: `estimateTokens(text: string): number` = `Math.ceil(text.length / 4)`.

**Rationale**: `length` conta unidades UTF-16. Para português, com caracteres acentuados
pré-compostos (NFC, o normal em entrada de teclado e JSON), um acento é 1 unidade, não os
2 bytes do UTF-8. Isso atende ao caso de borda da spec. `ceil` atende a "1–3 caracteres → 1"
e "vazio → 0". Emoji conta 2, o que é aceitável para uma estimativa.

**Alternatives considered**:
- `[...text].length` (code points): diferença só fora do BMP; não vale o custo de alocação.
- `Buffer.byteLength`: infla português, contra a spec.
- tokenizer real (tiktoken): dependência nova para um número que a spec declara aproximado.
  A constituição manda preferir o mais simples.

## R-007 — A decomposição mede os blocos que cada decorador acrescenta

**Decision**: extrair de `formatHistoryInput` e `formatMemoriesInput` as funções puras
`formatHistoryBlock(history)` e `formatMemoriesBlock(memories)`. Cada uma devolve o prefixo
que o decorador põe antes do `input`, ou `""` quando não há nada. As funções `format*Input`
passam a ser `block + input`. `buildContextBreakdown({ message, history, memories })`
estima cada bloco e a mensagem.

**Rationale**: o texto final entregue à estratégia é
`historyBlock + memoriesBlock + message`, sem sobreposição, porque os dois decoradores só
prefixam. Estimar os mesmos blocos que os decoradores usam garante FR-011 por construção,
inclusive cabeçalhos e separadores. Reconstruir o texto noutro lugar poderia divergir em
silêncio. Isso dá um invariante testável: a soma dos comprimentos dos três blocos é igual ao
comprimento da entrada que a estratégia recebeu.

**Alternatives considered**: estimar `formatMemoriesInput(m, x) − x` por subtração de
comprimentos. Funciona, mas esconde a regra; a extração deixa o bloco nomeado e testável.

## R-008 — Onde a decomposição é calculada

**Decision**: dentro de `runChat()` no handler, depois de `finalStrategy.run`, anexada a
`metrics` do resultado. Função pura em `src/context/breakdown.ts`.

**Rationale**: só o handler conhece as três fontes ao mesmo tempo, e as memórias são
recuperadas dentro de `runChat`. Anexar fora dos decoradores evita o problema do
`withReflection` apagar campos. O `/chat` é o único produtor (a spec restringe a ele), então
arena, bench e MCP não mudam (FR-015).

**Alternatives considered**: um decorador `withContextBreakdown`. É mais uma camada para algo
que é uma linha no único lugar que tem os dados.

## R-009 — Por que `ContextBreakdown` não vai para `src/domain/`

**Decision**: interface TypeScript em `src/trace/types.ts`, ao lado de `RunMetrics`.

**Rationale**: o Princípio I trata de entidades de domínio (serviço, alerta, incidente,
memória), definidas como esquemas zod porque são validadas na borda ou persistidas. Métrica
de execução não é validada nem persistida. `RunMetrics` já vive como interface em
`trace/types.ts` desde a 001, e a decomposição é um campo dela.

## R-010 — Arena, bench e MCP

**Decision**: nenhuma mudança neles. `promptTokens` passa a existir no `metrics` que ReAct e
plan-and-execute devolvem, mas nenhum desses consumidores imprime `metrics` inteiro.

**Rationale**: verificado. `formatMetrics` imprime campos fixos (`llmCalls`, `latencyMs`,
`stoppedReason`). O bench copia `llmCalls` e `latencyMs` explicitamente. O servidor MCP expõe
ferramentas de operação, não resultados de estratégia. Mostrar `promptTokens` na arena seria
útil, mas muda saída observável contra FR-015; fica como ideia para uma próxima feature.

## R-011 — Roteiro `conversa-longa.sh`

**Decision**: `scripts/conversa-longa.sh`, bash com `set -euo pipefail`, `curl` + `jq`.
Endereço em `OPSPILOT_URL` (default `http://localhost:3000`). 16 mensagens fixas de plantão
num array, sem `userId` para manter as memórias fora da curva. O `conversationId` vem da
primeira resposta. Uma linha por turno em largura fixa. `curl --fail-with-body` para
transformar 4xx/5xx em saída não zero, imprimindo o corpo de erro.

**Rationale**: `curl` e `jq` são o que o README já pede nos exemplos. 16 turnos passam da
janela de 12 mensagens da 007 (6 turnos já enchem a janela, pois cada turno grava 2
mensagens), então a estabilização aparece com folga. Fica fora de `src/` porque não é
TypeScript e não entra no `npm test`. `src/scripts/` guarda o seed em TS; `scripts/` na raiz
guarda roteiros de shell.

**Alternatives considered**: roteiro em TS com `fetch`. Evitaria o `jq`, mas o pedido nomeia
um `.sh` e o README já depende de `jq`.

## R-012 — Dependências

**Decision**: nenhuma nova. Tudo com `@langchain/core` já instalado e `node:test`.
