# Feature Specification: Medição de Contexto

**Feature Branch**: `010-context-measurement`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Instrumente a medição de contexto: src/context/tokens.ts com estimateTokens (chars/4) e o usage real do LangChain; métricas do /chat com promptTokens real e contextBreakdown estimado por fontes; conversa-longa.sh imprime o promptTokens por turno. Com testes"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saber quanto contexto um pedido realmente consumiu (Priority: P1)

Quem opera ou estuda o OpsPilot manda um pedido ao `/chat` e quer saber, na própria resposta, quantos tokens de entrada o modelo de fato processou para produzi-la. Hoje as métricas dizem quantas chamadas ao modelo houve e quanto tempo levou, mas não quanto texto foi enviado — e desde a 007 (histórico) e a 008 (memória) cada pedido carrega bem mais do que a mensagem digitada.

**Why this priority**: É a medição que não se consegue estimar de fora. Histórico, memórias, descrições de ferramentas e o rastro que cresce a cada iteração do agente somam-se de forma que só o provedor sabe o total. Sem esse número, qualquer discussão sobre janela de contexto ou custo é chute.

**Independent Test**: Testável enviando um pedido cujo modelo falso reporta um consumo conhecido por chamada, e verificando que a resposta traz a soma exata desses valores.

**Acceptance Scenarios**:

1. **Given** um pedido bem-sucedido em que o provedor reporta os tokens de entrada de cada chamada, **When** a resposta é entregue, **Then** as métricas trazem `promptTokens` igual à soma dos tokens de entrada de todas as chamadas do pedido.
2. **Given** um pedido com reflexão ligada (002), **When** a resposta é entregue, **Then** `promptTokens` inclui também as chamadas do crítico — cobre exatamente as mesmas chamadas contadas em `llmCalls`.
3. **Given** um pedido em que alguma chamada contada não trouxe o consumo reportado pelo provedor, **When** a resposta é entregue, **Then** `promptTokens` fica ausente das métricas, em vez de trazer uma soma parcial apresentada como total.
4. **Given** um pedido com usuário identificado, **When** o refletor de aprendizado (009) roda depois da resposta, **Then** a chamada dele não entra em `promptTokens`, pelo mesmo motivo que não entra em `llmCalls`.

---

### User Story 2 - Saber de onde vem o contexto (Priority: P2)

Além do total, a pessoa quer entender a composição: quanto do que foi enviado veio das memórias recuperadas, quanto do histórico da conversa e quanto da mensagem em si. A resposta passa a trazer uma decomposição estimada por fonte, calculada localmente, sem depender do provedor.

**Why this priority**: O total (US1) diz que o contexto cresceu; a decomposição diz por quê. É o que permite ver, por exemplo, que o histórico domina o pedido depois de alguns turnos. Depende de as fontes já existirem (007, 008), mas não depende da US1 para funcionar.

**Independent Test**: Testável enviando pedidos com e sem histórico, com e sem memórias, e verificando que cada fonte recebe a estimativa correspondente ao texto que ela de fato contribuiu — com um modelo falso, sem rede.

**Acceptance Scenarios**:

1. **Given** um pedido bem-sucedido, **When** a resposta é entregue, **Then** as métricas trazem `contextBreakdown` com a estimativa de tokens da mensagem, do histórico e das memórias, e o total dessas estimativas.
2. **Given** um pedido sem conversa anterior e sem usuário identificado, **When** a resposta é entregue, **Then** histórico e memórias aparecem com estimativa 0 e a mensagem com a estimativa do seu texto.
3. **Given** um pedido numa conversa com histórico, **When** a resposta é entregue, **Then** a estimativa do histórico corresponde ao texto do histórico efetivamente entregue ao agente (limitado à janela da 007), incluindo os rótulos e o cabeçalho que o acompanham.
4. **Given** um pedido com memórias recuperadas, **When** a resposta é entregue, **Then** a estimativa das memórias corresponde ao bloco de fatos efetivamente entregue ao agente, incluindo identificadores e cabeçalho.
5. **Given** o mesmo texto, **When** ele é estimado duas vezes, **Then** a estimativa é idêntica — a estimativa é determinística e não consulta o provedor.

---

### User Story 3 - Ver o contexto crescer ao longo de uma conversa longa (Priority: P3)

Para demonstrar e estudar o efeito do histórico, a pessoa roda um roteiro que conduz uma conversa de vários turnos contra o servidor local e imprime, turno a turno, quantos tokens de entrada cada resposta consumiu, ao lado da decomposição estimada.

**Why this priority**: Transforma as métricas das US1/US2 numa observação direta — a curva de crescimento do contexto até a janela do histórico estabilizar. Útil, mas só existe em cima das duas histórias anteriores.

**Independent Test**: Testável subindo o servidor local, rodando o roteiro e verificando que cada turno imprime uma linha com o número do turno e o `promptTokens` daquele turno, todos na mesma conversa.

**Acceptance Scenarios**:

1. **Given** o servidor local no ar, **When** o roteiro é executado, **Then** ele envia uma sequência fixa de mensagens na mesma conversa e imprime, por turno, o número do turno, `promptTokens` e a decomposição estimada.
2. **Given** um turno cuja resposta não traz `promptTokens`, **When** o roteiro imprime aquele turno, **Then** a linha indica explicitamente que o valor não foi reportado, e o roteiro segue para o próximo turno.
3. **Given** um turno que falha (erro HTTP ou servidor fora do ar), **When** o roteiro o encontra, **Then** ele informa o erro do turno e termina com código de saída diferente de zero.
4. **Given** o servidor em outro endereço, **When** o roteiro é executado com o endereço configurado, **Then** ele usa esse endereço.

---

### Edge Cases

- **Texto vazio**: a estimativa de um texto vazio é 0; fonte ausente é 0, nunca omitida da decomposição.
- **Arredondamento**: um texto de 1 a 3 caracteres estima 1 token, não 0 — a estimativa arredonda para cima.
- **Caracteres fora do ASCII**: a estimativa conta caracteres como o texto os apresenta, não bytes; acentos do português não inflam a estimativa.
- **Consumo reportado como zero**: um provedor que reporta 0 tokens de entrada numa chamada é consumo reportado (conta 0), diferente de consumo não reportado (anula o total, US1 cenário 3).
- **Execução interrompida por limite de iterações**: `promptTokens` soma as chamadas que chegaram a acontecer, como `llmCalls` já faz.
- **Pedido que falha (400/404/422/504/500)**: não há métricas na resposta de erro; nada muda nos corpos de erro.
- **Estimativa diverge do real**: esperado. A decomposição cobre só as fontes que o pedido compõe; instruções da estratégia, descrições de ferramentas, o rastro das iterações e as chamadas repetidas ficam fora dela e explicam a diferença para `promptTokens`.
- **Conversa longa além da janela**: depois que o histórico atinge a janela da 007, a estimativa do histórico para de crescer em quantidade de mensagens (pode variar pelo tamanho delas).

## Requirements *(mandatory)*

### Functional Requirements

#### Estimativa

- **FR-001**: O sistema MUST oferecer uma estimativa de tokens para um texto, calculada como número de caracteres dividido por 4, arredondado para cima.
- **FR-002**: A estimativa MUST ser pura e determinística: não consulta o provedor, não lê relógio, não depende de estado.
- **FR-003**: A estimativa de texto vazio MUST ser 0.

#### Consumo real

- **FR-004**: O sistema MUST extrair os tokens de entrada reportados pelo provedor em cada chamada ao modelo, a partir do consumo que a biblioteca de orquestração já expõe na resposta da chamada.
- **FR-005**: As métricas de uma execução MUST trazer `promptTokens` igual à soma dos tokens de entrada de todas as chamadas contadas em `llmCalls` naquela execução — nem mais, nem menos chamadas.
- **FR-006**: Se alguma chamada contada não trouxer o consumo reportado, `promptTokens` MUST ficar ausente das métricas daquela execução.
- **FR-007**: Com reflexão ligada, `promptTokens` MUST incluir as chamadas do crítico e de todas as tentativas, do mesmo modo que `llmCalls`.
- **FR-008**: A contagem MUST ser por execução: consumo de um pedido MUST NOT vazar para outro, inclusive com pedidos simultâneos.
- **FR-009**: A chamada do refletor de aprendizado (009), que acontece depois da resposta, MUST NOT entrar em `promptTokens`.

#### Decomposição por fonte

- **FR-010**: As métricas de uma resposta bem-sucedida do `/chat` MUST trazer `contextBreakdown` com as estimativas (FR-001) de três fontes — mensagem, histórico e memórias — e o total delas.
- **FR-011**: Cada fonte MUST ser estimada sobre o texto que ela efetivamente acrescentou ao que o agente recebe, incluindo cabeçalhos, rótulos e separadores que ela introduz; fonte ausente MUST aparecer com 0.
- **FR-012**: O total da decomposição MUST ser a soma das três fontes.
- **FR-013**: A decomposição MUST ser rotulada como estimativa no contrato, e MUST NOT ser comparada ou ajustada contra `promptTokens` pelo sistema.

#### Compatibilidade

- **FR-014**: `promptTokens` e `contextBreakdown` MUST ser campos opcionais e aditivos das métricas; campos existentes (`llmCalls`, `latencyMs`, `historyMessages`, `recalledMemories`) MUST continuar como estão.
- **FR-015**: A saída observável de arena, bench e servidor MCP MUST continuar a mesma.
- **FR-016**: Corpos de erro do `/chat` MUST continuar os mesmos.
- **FR-017**: O contrato do endpoint `/chat` MUST ser atualizado com os dois campos novos no mesmo conjunto de mudanças.

#### Roteiro de conversa longa

- **FR-018**: O projeto MUST incluir o roteiro `conversa-longa.sh`, que conduz uma sequência fixa de mensagens de plantão numa única conversa contra o servidor local, reaproveitando o identificador de conversa devolvido no primeiro turno.
- **FR-019**: Por turno, o roteiro MUST imprimir uma linha com o número do turno, `promptTokens` e a decomposição estimada; quando `promptTokens` não vier, a linha MUST dizer que não foi reportado.
- **FR-020**: A sequência MUST ter turnos suficientes para ultrapassar a janela de histórico da 007, de modo que a estabilização fique visível.
- **FR-021**: O endereço do servidor MUST ser configurável, com default no endereço local usado no README.
- **FR-022**: Falha de um turno MUST interromper o roteiro com mensagem do erro e código de saída diferente de zero.

#### Testabilidade

- **FR-023**: Os testes MUST cobrir a estimativa com no mínimo: texto vazio, arredondamento para cima, texto com acentos.
- **FR-024**: Os testes MUST cobrir a extração do consumo real com respostas de chamada com consumo reportado, com consumo zero e sem consumo, usando dublês — sem chamar o provedor.
- **FR-025**: Os testes MUST cobrir a soma por execução: várias chamadas somadas; uma chamada sem consumo anula o total; reflexão soma o crítico; duas execuções não se misturam.
- **FR-026**: Os testes do `/chat` MUST cobrir a decomposição sem histórico nem memórias, com histórico e com memórias, verificando os valores esperados para os textos conhecidos.

### Key Entities

- **Estimativa de tokens**: número derivado só do texto (caracteres ÷ 4, para cima). Barata, local, aproximada.
- **Consumo real de entrada (`promptTokens`)**: soma dos tokens de entrada que o provedor reportou para as chamadas de uma execução. Exato, mas só existe se o provedor reportar.
- **Decomposição do contexto (`contextBreakdown`)**: estimativas por fonte composta pelo pedido — mensagem, histórico, memórias — e o total delas. Explica a composição, não o total real.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das respostas bem-sucedidas do `/chat` cujo provedor reporta consumo trazem `promptTokens` igual à soma reportada, conferido com modelo falso nos testes.
- **SC-002**: 0 respostas com `promptTokens` calculado a partir de consumo incompleto.
- **SC-003**: 100% das respostas bem-sucedidas do `/chat` trazem a decomposição com as três fontes e o total.
- **SC-004**: Numa conversa de mais turnos que a janela de histórico, o roteiro mostra o consumo por turno crescendo nos primeiros turnos e deixando de crescer de forma sistemática depois que a janela enche.
- **SC-005**: Nenhuma mudança observável na saída de arena, bench e servidor MCP.
- **SC-006**: Nenhuma chamada extra ao provedor para medir: a medição usa só o que as chamadas existentes já devolvem.

## Assumptions

- **Nomes e formas dados pelo pedido**: a estimativa e a extração do consumo real vivem em `src/context/tokens.ts`, com a função de estimativa chamada `estimateTokens`; o consumo real vem do `usage` que o LangChain anexa à resposta de cada chamada; os campos novos das métricas chamam-se `promptTokens` e `contextBreakdown`; o roteiro chama-se `conversa-longa.sh`.
- **O roteiro não existe ainda**: `conversa-longa.sh` é criado por esta feature, em `scripts/`, usando `curl` e `jq`, as mesmas ferramentas que o README já usa nos exemplos. Precisa do servidor rodando com credenciais reais; não faz parte dos portões offline (`npm test`), é um roteiro de demonstração.
- **Por que somar em vez de pegar a maior chamada**: `promptTokens` mede o que o pedido custou em entrada, na mesma base de `llmCalls`. O tamanho de uma chamada isolada não é exposto nesta feature.
- **Fontes da decomposição**: só as três que o pedido compõe no `/chat` (mensagem, histórico da 007, memórias da 008). Instruções internas das estratégias, descrições de ferramentas e o rastro que cresce a cada iteração ficam fora; estimá-los exigiria que cada estratégia expusesse seus prompts, o que é escopo maior.
- **Onde a decomposição aparece**: só no `/chat`. Arena, bench e MCP não compõem histórico nem memórias.
- **Tokens de saída**: fora de escopo. Só entrada é medida.
- **Divisor 4**: aproximação usual para texto em inglês; em português tende a subestimar um pouco. Aceito — o papel da estimativa é mostrar proporções entre fontes, não prever o total.
