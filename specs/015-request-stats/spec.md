# Feature Specification: Estatísticas de Pedidos

**Feature Branch**: `015-request-stats`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Crie GET /stats?since=24h sobre requests: total, erros, tokens, custo (:free=0), p50/p95, por rota e modelo."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visão geral de uma janela de tempo (Priority: P1)

Quem opera o OpsPilot quer saber, numa consulta só, como o `/chat` se comportou nas últimas horas: quantos pedidos chegaram, quantos falharam e por quê, quantos tokens de entrada foram consumidos, quanto isso custou e quanto tempo os pedidos levaram (mediana e cauda).

**Why this priority**: É o pedido inteiro. Hoje cada pedido é consultável sozinho (014), mas não há visão agregada.

**Independent Test**: Com registros gravados em banco `:memory:` e relógio fixo, `GET /stats?since=24h` devolve contagens, soma de tokens, custo e percentis calculáveis à mão a partir dos registros.

**Acceptance Scenarios**:

1. **Given** registros dentro e fora da janela, **When** se consulta `GET /stats?since=24h`, **Then** só os registros com chegada nas últimas 24 h entram.
2. **Given** pedidos 200 e de erro na janela, **When** se consulta, **Then** `total` conta todos, `errors` conta os não-200, e `errorsByCode` traz a contagem por código.
3. **Given** pedidos 200 com tokens de entrada, **When** se consulta, **Then** `promptTokens` é a soma, e `latencyMs.p50`/`p95` são os percentis da duração dos pedidos 200.
4. **Given** um pedido atendido por um modelo `:free`, **When** se consulta, **Then** seu custo é 0, com ou sem tabela de preços.
5. **Given** um pedido atendido por um modelo sem `:free` e sem preço configurado, **When** se consulta, **Then** ele não entra no custo e é contado em `unpricedRequests`.
6. **Given** nenhum pedido na janela, **When** se consulta, **Then** os totais são 0 e os percentis são `null`.

---

### User Story 2 - Recorte por rota e por modelo (Priority: P1)

A mesma visão quebrada pela estratégia escolhida (`react`, `plan-and-execute`, `reflect`) e pelo modelo que respondeu, para comparar custo e latência entre eles.

**Why this priority**: É parte explícita do pedido e o que torna o agregado acionável (ex.: "reflect custa 3× e tem p95 de 40 s").

**Independent Test**: Com registros de rotas e modelos diferentes, `byRoute` e `byModel` trazem, por grupo, pedidos, tokens, custo e percentis consistentes com o total.

**Acceptance Scenarios**:

1. **Given** pedidos 200 de rotas diferentes, **When** se consulta, **Then** `byRoute` tem um item por rota presente na janela, e a soma de `requests` dos itens é o número de pedidos 200.
2. **Given** pedidos 200 de modelos diferentes, **When** se consulta, **Then** `byModel` tem um item por modelo, com o custo calculado pela regra do modelo.
3. **Given** um pedido 200 sem `modelUsed`, **When** se consulta, **Then** ele aparece em `byModel` sob o modelo `null`.

---

### Edge Cases

- **`since` ausente**: vale `24h`.
- **`since` inválido** (`abc`, `0h`, `-1d`, `24`, `1y`, acima de 90 dias): 400 `invalid_query`, com o formato aceito na mensagem.
- **Pedido 200 sem tokens** (provedor não informou uso): conta nos pedidos, não soma tokens. Se o modelo não for `:free`, conta em `unpricedRequests`.
- **Erros não têm rota nem modelo** (014: só o 200 tem execução registrada): entram em `total`, `errors` e `errorsByCode`, nunca em `byRoute`/`byModel` nem nos percentis.
- **Tabela de preços inválida no ambiente**: o servidor não sobe, com mensagem clara (mesma regra de `PORT`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /stats` MUST aceitar o parâmetro `since` no formato `<inteiro positivo><unidade>`, com unidade `m` (minutos), `h` (horas) ou `d` (dias), até 90 dias; padrão `24h`.
- **FR-002**: A janela MUST ser `[agora − since, agora]`, sobre o instante de chegada do pedido.
- **FR-003**: A resposta MUST trazer: `since`, `from`, `to`, `total`, `errors`, `errorsByCode`, `promptTokens`, `costUsd`, `unpricedRequests`, `latencyMs: { p50, p95 }`, `byRoute` e `byModel`.
- **FR-004**: `errors` MUST contar os pedidos com status diferente de 200.
- **FR-005**: `promptTokens` MUST ser a soma dos tokens de entrada registrados. Pedidos sem tokens registrados não somam.
- **FR-006**: O custo de um pedido MUST ser 0 quando o modelo que respondeu termina em `:free`. Caso contrário, MUST ser `promptTokens × preço de entrada por milhão ÷ 1.000.000`, com o preço vindo de uma tabela configurável por variável de ambiente. Sem preço ou sem tokens, o pedido MUST NOT entrar em `costUsd` e MUST entrar em `unpricedRequests`.
- **FR-007**: Os percentis MUST ser calculados sobre a duração dos pedidos 200, pelo método do posto mais próximo (nearest-rank). Sem pedidos 200, MUST ser `null`.
- **FR-008**: `byRoute` e `byModel` MUST trazer, por grupo de pedidos 200: a chave do grupo, `requests`, `promptTokens`, `costUsd`, `unpricedRequests` e `latencyMs: { p50, p95 }`, ordenados por `requests` decrescente.
- **FR-009**: A consulta MUST ser somente leitura e MUST NOT gerar registro de pedido.
- **FR-010**: O cálculo MUST ser uma função pura, testável sem banco e sem relógio real.

### Key Entities

- **Janela**: intervalo `[from, to]` derivado de `since` e do relógio.
- **Tabela de preços**: mapa de id de modelo → preço em USD por 1 milhão de tokens de entrada.
- **Estatística agregada**: os totais da janela e os grupos por rota e por modelo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma única consulta responde "quantos pedidos, quantos erros, quanto custou e quão lento" para qualquer janela de até 90 dias.
- **SC-002**: Os números conferem com o cálculo manual sobre os registros, em 100% dos cenários de teste.
- **SC-003**: Nenhum custo é inventado: pedido sem preço conhecido aparece em `unpricedRequests`, nunca como custo 0 de um modelo pago.
- **SC-004**: `npm test` cobre a feature sem rede e sem credenciais.

## Assumptions

- **Custo só de entrada**: o registro (014) guarda só os tokens de entrada (`promptTokens`, 010). O custo é, portanto, o custo **estimado de entrada** da estratégia. Tokens de saída e as chamadas do roteador, do sumarizador e do refletor (fora de `promptTokens` por decisão da 010/012) não entram. Registrar tokens de saída fica fora de escopo.
- **Preço por variável de ambiente**: `OPENROUTER_PRICES`, um JSON `{ "<modelo>": <USD por 1M tokens de entrada> }`, opcional. Sem ela, só modelos `:free` têm custo conhecido. Buscar preços na API do OpenRouter fica fora de escopo (rede, Princípio V).
- **"Erros"** são pedidos com status ≠ 200, incluindo 400 e 422 (erro do cliente). `errorsByCode` permite separar.
- **Percentis só de pedidos 200**: erros de validação levam milissegundos e distorceriam a latência de atendimento.
- **Sem autenticação**, como `/chat` e `/requests/:id`.
- **Escala**: o cálculo carrega os registros da janela em memória. Adequado ao uso local do OpsPilot.
- **Dependências**: 014 (tabela `requests`), 010 (`promptTokens`), 012 (rota), 013 (`modelUsed`).
