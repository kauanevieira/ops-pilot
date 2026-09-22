# Feature Specification: Resiliência de Modelo

**Feature Branch**: `013-model-resilience`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Resiliência de modelo: .env: OPENROUTER_MODEL_FALLBACK; fábrica model.ts: withRetry no primário; withFallbacks([reserva]); Trace: evento \"fallback\"; metrics.modelUsed. Caso nada funcione, 503"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O pedido sobrevive a uma falha passageira ou à queda do modelo principal (Priority: P1)

Um plantonista pergunta ao OpsPilot quais alertas estão disparando, justamente num momento em que o modelo principal está instável: devolve erro de limite de uso, demora demais ou responde com erro do provedor. Hoje, qualquer uma dessas falhas derruba o pedido com um 500 genérico, e o plantonista fica sem resposta no pior momento. Com esta feature, uma falha passageira do modelo principal é tentada de novo algumas vezes, e, se ele continuar falhando, a mesma chamada passa para um modelo reserva configurado. O plantonista recebe a resposta normalmente.

**Why this priority**: É o motivo da feature. Modelos gratuitos e compartilhados do OpenRouter falham com frequência (limite de uso, fila, indisponibilidade), e o OpsPilot é usado exatamente durante incidentes, quando menos pode ficar sem resposta.

**Independent Test**: Testável com modelos falsos e determinísticos, sem rede: um principal que falha de forma passageira uma vez e depois responde (a resposta sai do principal), e um principal que falha sempre com um reserva que responde (a resposta sai do reserva). Em ambos os casos o pedido termina com 200.

**Acceptance Scenarios**:

1. **Given** um modelo principal que falha de forma passageira na primeira tentativa e responde na segunda, **When** o pedido chega, **Then** a resposta é 200, produzida pelo principal, sem passar pelo reserva.
2. **Given** um modelo principal que falha em todas as tentativas e um reserva configurado que responde, **When** o pedido chega, **Then** a resposta é 200, e as chamadas que o principal não atendeu são atendidas pelo reserva.
3. **Given** um modelo principal que falha com um erro que não é passageiro (modelo inexistente, pedido recusado pelo provedor), **When** o pedido chega, **Then** o principal não é tentado de novo e a chamada passa direto para o reserva.
4. **Given** nenhum reserva configurado, **When** o principal falha em todas as tentativas, **Then** o comportamento é o da User Story 3 (503).

---

### User Story 2 - Saber qual modelo respondeu e quando houve troca (Priority: P1)

Quem opera ou estuda o OpsPilot precisa saber, pela própria resposta, qual modelo produziu aquela resposta e se houve troca para o reserva. Uma resposta do reserva pode ter qualidade diferente, e comparações entre estratégias só fazem sentido quando se sabe qual modelo rodou. A resposta passa a trazer `metrics.modelUsed`, e o rastro ganha um evento `fallback` a cada troca.

**Why this priority**: Sem isso, o reserva mascara a falha do principal: a resposta chega, mas ninguém percebe que o modelo principal está fora, nem que a qualidade pode ter mudado. Também é P1, porque a troca silenciosa torna o comportamento do OpsPilot impossível de explicar.

**Independent Test**: Testável com os mesmos modelos falsos da US1, verificando `metrics.modelUsed` e a presença, quantidade e conteúdo dos eventos `fallback`.

**Acceptance Scenarios**:

1. **Given** um pedido atendido só pelo principal, **When** a resposta é entregue, **Then** `metrics.modelUsed` é o identificador do principal e o rastro não traz nenhum evento `fallback`, mesmo que tenha havido nova tentativa no principal.
2. **Given** um pedido em que alguma chamada passou para o reserva, **When** a resposta é entregue, **Then** o rastro traz um evento `fallback` para cada troca, com o modelo que falhou, o modelo que assumiu e o tipo de falha, no ponto do rastro em que a troca aconteceu e com o nó (`nodeName`) em que ela aconteceu.
3. **Given** um pedido em que alguma chamada passou para o reserva, **When** a resposta é entregue, **Then** `metrics.modelUsed` reflete o reserva, conforme a regra do FR-015.

---

### User Story 3 - Quando nenhum modelo responde, um erro claro de indisponibilidade (Priority: P2)

Quando o principal e o reserva estão fora, não há resposta possível. Hoje o cliente recebe um 500 `internal`, indistinguível de um bug do OpsPilot. Com esta feature, recebe um 503 com código próprio, que diz que o problema é a indisponibilidade dos modelos, não um defeito, e que vale tentar de novo mais tarde.

**Why this priority**: Deixa o erro acionável: um 503 diz "tente de novo depois", e um 500 diz "há um defeito". Mas o 503 não salva nenhum pedido; quem salva são a nova tentativa e o reserva (US1). Por isso P2.

**Independent Test**: Testável com principal e reserva falsos que falham sempre, verificando o status 503, o código de erro e que o turno não foi gravado.

**Acceptance Scenarios**:

1. **Given** principal e reserva falhando em todas as tentativas, **When** o pedido chega, **Then** a resposta é 503 com o código `model_unavailable`, e o turno não é gravado na conversa.
2. **Given** um erro técnico que não é do modelo (falha no banco, defeito de código), **When** o pedido chega, **Then** a resposta continua 500 `internal`, como hoje.
3. **Given** um pedido cujo prazo de 180 s se esgota enquanto o OpsPilot ainda tenta modelos, **When** o prazo vence, **Then** a resposta continua 504 `timeout`, como hoje, e nenhuma tentativa nova começa depois disso.

---

### Edge Cases

- **Reserva não configurado ou vazio**: o principal ainda ganha as novas tentativas, mas não há troca. Esgotadas as tentativas, vale a US3 (503).
- **Reserva igual ao principal**: tratado como reserva não configurado. Trocar para o mesmo modelo só repetiria a falha.
- **Principal responde depois de uma nova tentativa**: não é troca. Nenhum evento `fallback`, e `modelUsed` é o principal.
- **Pedido cancelado ou prazo esgotado durante as tentativas**: cancelamento nunca provoca nova tentativa nem troca. As tentativas em curso são interrompidas, e vale o 504 de hoje.
- **Falha do roteador, do sumarizador, do crítico ou do refletor de aprendizado**: essas chamadas também ganham nova tentativa e reserva. Se ainda assim falharem, continuam valendo as regras de falha aberta de cada uma (roteador recua para `react`, sumarizador segue sem resumo novo, crítico entrega a resposta corrente, refletor só registra no log). Só uma falha que impede a estratégia de produzir a resposta vira 503.
- **Erro de credencial** (chave inválida): o reserva usa a mesma credencial e falharia do mesmo jeito. Não há nova tentativa, a troca é tentada uma vez e, falhando, vale o 503.
- **Reserva também falha de forma passageira**: o reserva não ganha novas tentativas próprias (ver Assumptions). Se falhar, a chamada falha.
- **Muitas chamadas no mesmo pedido** (ReAct com várias iterações, Plan-and-Execute com vários passos) com o principal fora: depois da primeira troca num pedido do `/chat`, as chamadas seguintes do mesmo pedido vão direto para o reserva, sem novas tentativas no principal e sem novo evento `fallback`. O pedido seguinte volta a tentar o principal (FR-011a).
- **Mensagem de erro do provedor**: nunca chega ao cliente, nem no 503, nem no evento `fallback`, que traz só o tipo de falha. O detalhe vai para o log.

## Requirements *(mandatory)*

### Functional Requirements

#### Configuração

- **FR-001**: O modelo reserva MUST ser configurado pela variável de ambiente `OPENROUTER_MODEL_FALLBACK`, opcional, documentada em `.env.example`, com a mesma credencial e o mesmo provedor do principal.
- **FR-002**: Sem `OPENROUTER_MODEL_FALLBACK`, com valor vazio ou só com espaços, ou com valor igual a `OPENROUTER_MODEL`, o OpsPilot MUST funcionar sem reserva, exatamente como hoje, somado só às novas tentativas do principal.
- **FR-003**: Construir a fábrica de modelos MUST continuar sem ler variáveis de ambiente. Elas são lidas só quando uma chamada ao modelo é de fato feita, como hoje (009, 011, 012).

#### Novas tentativas no principal

- **FR-004**: Uma chamada ao modelo principal que falha de forma passageira MUST ser tentada de novo, até 3 tentativas no total, com espera crescente entre elas.
- **FR-005**: São tentadas de novo: limite de uso excedido, erro do lado do provedor e falha de rede. Tempo esgotado da chamada MUST NOT ser tentado de novo e passa direto ao reserva: cada tentativa pode levar até 60 s, e três delas consumiriam o prazo inteiro do pedido. Os demais erros (modelo inexistente, pedido recusado, credencial inválida, resposta fora do formato) MUST NOT ser tentados de novo.
- **FR-006**: Nenhuma nova tentativa MUST começar depois que o pedido foi cancelado ou teve o prazo esgotado, e a espera entre tentativas MUST ser interrompida pelo cancelamento.
- **FR-007**: As novas tentativas MUST substituir, e não somar-se, a qualquer mecanismo de nova tentativa que já exista por baixo, para que o número de tentativas seja o do FR-004 e não um múltiplo dele.

#### Troca para o reserva

- **FR-008**: Quando o principal esgota as tentativas, ou falha com um erro que não é passageiro, a mesma chamada MUST ser feita uma vez no reserva, com as mesmas mensagens e opções (ferramentas, saída estruturada, cancelamento).
- **FR-009**: Cancelamento ou prazo esgotado MUST NOT provocar troca para o reserva.
- **FR-010**: A resiliência (novas tentativas e troca) MUST valer para toda chamada feita pela fábrica de modelos: estratégias, crítico, roteador, sumarizador e destilador do refletor de aprendizado.
- **FR-011**: Quando o reserva também falha, ou quando não há reserva e o principal não atende, a chamada MUST falhar com um erro que identifica a indisponibilidade de todos os modelos tentados, distinguível de qualquer outro erro.
- **FR-011a**: Num pedido do `/chat`, depois da primeira troca para o reserva, as chamadas seguintes do mesmo pedido MUST ir direto para o reserva. A troca não passa de um pedido para o outro. Fora do `/chat` (arena, bench), cada chamada decide sozinha.

#### Observabilidade

- **FR-012**: O rastro MUST ganhar o tipo de evento `fallback`, com: o modelo que falhou, o modelo que assumiu e o tipo de falha, um conjunto fechado: `timeout`, `rate_limit`, `provider_error`, `network`, `non_transient` (erro não passageiro). A mensagem do provedor MUST NOT entrar no evento.
- **FR-013**: Cada troca para o reserva, ocorrida em qualquer chamada feita durante um pedido do `/chat` antes da resposta, MUST gerar um evento `fallback`, no início do trecho do rastro do nó em que aconteceu, com o `nodeName` desse nó (012). Com a troca valendo para o resto do pedido (FR-011a), há no máximo um evento `fallback` por pedido do `/chat`.
- **FR-014**: Nova tentativa bem-sucedida no principal MUST NOT gerar evento `fallback`. Tentativas ficam só no log.
- **FR-015**: As métricas MUST ganhar `modelUsed`: o identificador do modelo que atendeu a última chamada da estratégia, a que produziu a resposta final. Presente sempre que ao menos uma chamada da estratégia foi atendida. Quando parte das chamadas foi para o principal e parte para o reserva, os eventos `fallback` mostram onde mudou.
- **FR-016**: Troca, nova tentativa e falha definitiva MUST ser registradas no log do servidor, com o detalhe do erro do provedor.
- **FR-017**: A exibição legível do rastro MUST mostrar o evento `fallback` com rótulo próprio.

#### Resposta de indisponibilidade

- **FR-018**: Quando a estratégia não consegue produzir a resposta porque nenhum modelo tentado respondeu (FR-011), o `/chat` MUST responder 503 com o código de erro `model_unavailable`, no mesmo formato de corpo de erro de hoje, sem detalhe do provedor.
- **FR-019**: No 503, o turno MUST NOT ser gravado, e o refletor de aprendizado MUST NOT ser acionado, como em qualquer outra falha (007, 009).
- **FR-020**: Qualquer outro erro técnico MUST continuar 500 `internal`. Prazo esgotado MUST continuar 504 `timeout`, mesmo que o esgotamento aconteça durante tentativas ou troca.
- **FR-021**: Falhas de modelo nas chamadas de falha aberta (roteador, sumarizador, crítico, refletor) MUST continuar tratadas como hoje e MUST NOT virar 503 por si só.

#### Compatibilidade

- **FR-022**: Campos existentes da resposta, das métricas, do rastro e dos erros MUST continuar como estão. `modelUsed`, o evento `fallback` e o código `model_unavailable` são aditivos.
- **FR-023**: Arena, bench e servidor MCP MUST ganhar a mesma resiliência, porque usam a mesma fábrica. A saída deles MUST continuar igual quando não há troca.
- **FR-024**: `llmCalls` e `promptTokens` MUST contar só as chamadas que responderam, seja no principal, seja no reserva. Tentativas que falharam não entram. É uma emenda à 010, em que uma chamada iniciada e não concluída contava em `llmCalls` e tornava `promptTokens` ausente.
- **FR-025**: Os contratos do `/chat`, do formato do rastro e do `.env.example` MUST ser atualizados no mesmo conjunto de mudanças, e o README MUST documentar a variável nova, o 503 e os campos novos.

#### Testabilidade

- **FR-026**: O modelo principal e o reserva MUST ser substituíveis nos testes por modelos falsos e determinísticos, sem rede e sem credenciais. A espera entre tentativas é a da biblioteca e não é configurável, então os testes que esgotam as tentativas são poucos e os demais usam erros que não são tentados de novo.
- **FR-027**: Os testes MUST cobrir no mínimo: falha passageira seguida de sucesso no principal (sem troca, sem evento); principal sempre falhando com reserva respondendo (troca, evento, `modelUsed`); erro não passageiro indo direto ao reserva; sem reserva configurado; reserva igual ao principal; principal e reserva falhando (503 no `/chat`, turno não gravado); cancelamento durante a espera entre tentativas (sem nova tentativa, sem troca, 504); número exato de tentativas; `llmCalls` sem as tentativas falhas; falha de modelo no roteador ou no sumarizador sem virar 503.

### Key Entities

- **Modelo principal**: o modelo configurado em `OPENROUTER_MODEL`, tentado primeiro em toda chamada.
- **Modelo reserva**: o modelo opcional de `OPENROUTER_MODEL_FALLBACK`, tentado uma vez quando o principal não atende.
- **Tipo de falha**: conjunto fechado que classifica por que o principal não atendeu (`timeout`, `rate_limit`, `provider_error`, `network`, `non_transient`). Decide se há nova tentativa e aparece no evento `fallback`.
- **Evento `fallback`**: registro, no rastro, de uma troca do principal para o reserva: modelo que falhou, modelo que assumiu, tipo de falha e nó.
- **`modelUsed`**: o modelo que atendeu as chamadas da estratégia no pedido.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o principal fora e o reserva disponível, 100% dos pedidos que terminariam em erro terminam com 200.
- **SC-002**: Com uma falha passageira isolada do principal, 100% dos pedidos terminam com 200 atendidos pelo próprio principal, sem evento `fallback`.
- **SC-003**: 100% das trocas para o reserva durante um pedido do `/chat` aparecem no rastro como evento `fallback`, e 100% das respostas 200 com ao menos uma chamada da estratégia atendida trazem `metrics.modelUsed`.
- **SC-004**: Com todos os modelos fora, 100% dos pedidos terminam com 503 `model_unavailable`, e nenhum com 500.
- **SC-005**: Nenhuma chamada ao modelo passa de 3 tentativas no principal mais 1 no reserva.
- **SC-006**: Sem reserva configurado e sem falha do modelo, nenhuma mudança observável na saída da arena, do bench, do servidor MCP ou do `/chat`, além de `metrics.modelUsed`.
- **SC-007**: `npm test` cobre a feature inteira sem rede e sem credenciais.

## Assumptions

- **Nomes dados pelo pedido**: a variável chama-se `OPENROUTER_MODEL_FALLBACK`, o evento de rastro chama-se `fallback`, o campo de métrica chama-se `modelUsed`, e a resiliência é montada na fábrica única de modelos (`model.ts`) com nova tentativa no principal e troca para uma lista de reservas de um elemento.
- **Um reserva só.** O pedido fala em um reserva. A lista de reservas fica com um elemento, e mais de um reserva fica fora de escopo.
- **O reserva não ganha novas tentativas próprias.** O pedido põe as novas tentativas só no principal. Um reserva que falha, falha a chamada.
- **3 tentativas no total no principal**, com a espera crescente da própria biblioteca (cerca de 1 s e depois 2 s, com variação aleatória), só para limite de uso, erro do provedor e falha de rede.
- **Decisões tomadas no plano, sem resposta às perguntas da spec** (2026-09-22): a troca vale para o resto do pedido (FR-011a), para que um principal fora não cobre as novas tentativas em cada iteração; e `modelUsed` é o modelo da resposta final (FR-015), uma string, como o nome no singular sugere. Ambas podem ser revistas em `/speckit-clarify`.
- **Código `model_unavailable` e status 503.** O pedido diz 503. O código segue o padrão dos existentes (`timeout`, `internal`). Um cabeçalho `Retry-After` fica fora de escopo.
- **Tudo que usa a fábrica ganha resiliência**, porque ela é única. Os refletores e o roteador continuam com a falha aberta de hoje depois de esgotados principal e reserva.
- **Evento `fallback` e o evento `route` com `source: "fallback"` (012) são coisas diferentes.** O primeiro é troca de modelo, o segundo é o roteador recuando de estratégia. Os nomes coincidem por vir do pedido, e a documentação deixa a distinção clara.
- **O refletor de aprendizado roda depois da resposta** (009), então uma troca nele não pode aparecer no rastro já entregue. Fica só no log.
- **Arena e bench** passam a registrar `modelUsed`, o que mantém a comparação entre estratégias honesta quando uma execução usou o reserva. Não é previsto desligar o reserva no bench.
- **Dependências**: 001/002 (estratégias, crítico), 003 (formato de erro do `/chat`), 007/009 (turno gravado só no sucesso, refletor), 010 (`llmCalls`, `promptTokens`), 011 (sumarizador), 012 (roteador, `nodeName`).
