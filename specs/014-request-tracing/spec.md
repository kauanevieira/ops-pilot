# Feature Specification: Rastro Persistido e Logs Estruturados

**Feature Branch**: `014-request-tracing`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Trace persistido + logs JSON: /chat: requestId no corpo e no header X-Request-Id. SQLite: requests (métricas) e trace_events (node, payloads). src/obs/logger.ts: 1 linha JSON por evento, só metadados. GET /requests/:id registro + trace ordenado."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Todo pedido ganha um identificador (Priority: P1)

Um plantonista recebe uma resposta estranha do OpsPilot e quer entender o que aconteceu. Hoje, o rastro só existe dentro da resposta que ele recebeu. Se a resposta foi um erro, um tempo esgotado ou já se perdeu no terminal, não há como apontar para aquele pedido. Com esta feature, toda resposta do `/chat`, de sucesso ou de erro, traz um identificador único do pedido no corpo e no cabeçalho `X-Request-Id`. É esse identificador que o plantonista cola numa conversa, num chamado ou na busca dos logs.

**Why this priority**: O identificador é a chave de todo o resto. Sem ele, o registro persistido não tem como ser consultado e as linhas de log não têm como ser correlacionadas a um pedido.

**Independent Test**: Testável pelo `/chat` com dublês determinísticos: enviar pedidos que terminam em 200, 400, 404, 422, 503 e 504 e verificar que todos trazem o cabeçalho `X-Request-Id`, que o corpo traz `requestId` com o mesmo valor e que dois pedidos nunca recebem o mesmo identificador.

**Acceptance Scenarios**:

1. **Given** um pedido válido ao `/chat`, **When** a resposta 200 é entregue, **Then** o corpo traz `requestId` e o cabeçalho `X-Request-Id` traz o mesmo valor.
2. **Given** um pedido que termina em erro (400, 404, 422, 500, 503 ou 504), **When** a resposta é entregue, **Then** o cabeçalho `X-Request-Id` está presente e o corpo de erro traz `requestId` com o mesmo valor, sem alterar os demais campos do erro.
3. **Given** dois pedidos quaisquer, inclusive simultâneos, **When** são atendidos, **Then** seus identificadores são diferentes.
4. **Given** um pedido que já traz um cabeçalho `X-Request-Id`, **When** ele é atendido, **Then** o identificador da resposta é gerado pelo servidor, e não copiado do pedido.

---

### User Story 2 - Consultar depois o que um pedido fez (Priority: P1)

Com o identificador em mãos, quem investiga um pedido consulta `GET /requests/:id` e recebe o registro do pedido (quando chegou, como terminou, qual estratégia rodou, quanto tempo levou, quantas chamadas ao modelo fez, qual modelo respondeu) e o rastro completo, na ordem em que os eventos aconteceram, com o nó de origem e o conteúdo de cada evento. Isso funciona depois de o servidor ter sido reiniciado.

**Why this priority**: É a entrega central da feature: transformar o rastro, hoje efêmero, em algo que sobrevive à resposta e pode ser revisitado para diagnóstico e estudo.

**Independent Test**: Testável com banco em memória e dublês determinísticos: fazer um pedido ao `/chat`, consultar `GET /requests/:id` com o identificador devolvido e verificar que o registro e o rastro batem com a resposta original, evento por evento e na mesma ordem.

**Acceptance Scenarios**:

1. **Given** um pedido ao `/chat` que terminou em 200, **When** se consulta `GET /requests/:id` com seu identificador, **Then** a resposta traz o registro do pedido e o rastro com os mesmos eventos, na mesma ordem e com o mesmo conteúdo e nó de origem do rastro entregue pelo `/chat`.
2. **Given** um pedido que terminou em erro (400, 404, 422, 500, 503 ou 504), **When** se consulta seu identificador, **Then** a resposta traz o registro com o status e o código de erro com que terminou, e um rastro vazio.
3. **Given** um identificador que nunca foi emitido, **When** se consulta `GET /requests/:id`, **Then** a resposta é 404 com código `request_not_found`, no mesmo formato de erro do `/chat`.
4. **Given** um pedido registrado antes de o servidor reiniciar, **When** se consulta seu identificador depois do reinício, **Then** o registro e o rastro continuam disponíveis.
5. **Given** a resposta do `/chat` acabou de ser entregue, **When** o cliente consulta imediatamente o identificador, **Then** o registro já está disponível.

---

### User Story 3 - Logs que uma máquina consegue ler (Priority: P2)

Quem opera o servidor quer filtrar e agregar o que acontece no `/chat` com ferramentas comuns de linha de comando ou de coleta de logs. Hoje, os logs do caminho do `/chat` são frases livres em português, misturadas com objetos de erro. Com esta feature, cada acontecimento relevante do pedido vira exatamente uma linha JSON, com o identificador do pedido, e nenhuma linha carrega conteúdo do usuário ou do modelo.

**Why this priority**: Torna o servidor operável e correlacionável, mas o rastro persistido (US2) já resolve o diagnóstico de um pedido específico sem isso.

**Independent Test**: Testável com um destino de log injetável que captura as linhas: conduzir pedidos de sucesso e de falha e verificar que cada linha é um JSON válido e completo, que toda linha de um pedido traz o seu `requestId` e que nenhuma linha contém o texto da mensagem, da resposta, de argumentos de ferramenta ou de observações.

**Acceptance Scenarios**:

1. **Given** um pedido ao `/chat`, **When** ele começa e termina, **Then** o log recebe uma linha de início e uma linha de fim, cada uma um objeto JSON numa única linha, ambas com o `requestId`; a de fim traz o status, a duração e, no sucesso, as métricas do pedido.
2. **Given** um pedido bem-sucedido, **When** seu rastro é produzido, **Then** o log recebe uma linha por evento do rastro, com o tipo do evento, o nó de origem e a posição, sem o conteúdo do evento.
3. **Given** uma falha tratada sem erro para o cliente (roteador, memória semântica, sumarização, refletor de aprendizado, troca para o modelo reserva), **When** ela acontece, **Then** o log recebe uma linha com o `requestId`, o componente e a classe da falha, sem a mensagem de erro do provedor e sem conteúdo do pedido.
4. **Given** uma mensagem de usuário com quebras de linha, aspas ou caracteres especiais, **When** o pedido é registrado no log, **Then** cada linha continua sendo exatamente um JSON válido, e o texto da mensagem não aparece em nenhuma linha.

---

### Edge Cases

- **Falha ao gravar o registro ou o rastro** (banco indisponível, erro de escrita): o `/chat` responde exatamente como responderia sem esta feature. A falha vai para o log com o `requestId`, e o pedido simplesmente não fica consultável (`GET /requests/:id` devolve 404).
- **Gravação parcial**: o registro e o rastro de um pedido são gravados juntos ou não são gravados. Nunca existe um registro com parte do rastro.
- **Tempo esgotado (504)**: o pedido é registrado com status 504, código `timeout` e rastro vazio. A execução que continua depois do prazo não altera o registro nem acrescenta eventos.
- **Corpo inválido ou JSON malformado (400)**: o pedido também ganha identificador e registro, com status 400 e código `invalid_body`.
- **Identificador consultado com formato estranho** (vazio, muito longo, caracteres fora do padrão): 404 `request_not_found`, sem erro interno e sem distinguir "formato inválido" de "não existe".
- **Rastro grande** (muitas iterações, observações longas): todos os eventos são gravados e devolvidos inteiros, na ordem. A feature não corta nem resume eventos.
- **Evento sem nó de origem**: o `/chat` sempre entrega eventos com nó (012). Se algum chegar sem, é gravado e devolvido sem nó, sem falhar o pedido.
- **Falha de escrita no próprio log**: nunca derruba o pedido nem altera a resposta.
- **Arena, bench e servidor MCP**: continuam sem identificador, sem registro e sem as linhas de log desta feature. O MCP, em particular, continua sem escrever nada fora do seu canal de protocolo.

## Requirements *(mandatory)*

### Functional Requirements

#### Identificador do pedido

- **FR-001**: Todo pedido ao `/chat` MUST receber um identificador único, gerado pelo servidor no início do atendimento, antes de qualquer validação.
- **FR-002**: Toda resposta do `/chat`, de sucesso ou de erro, inclusive JSON malformado e erro interno, MUST trazer o cabeçalho `X-Request-Id` com esse identificador.
- **FR-003**: O corpo da resposta 200 MUST trazer o campo `requestId`. O corpo de toda resposta de erro do `/chat` MUST trazer o campo `requestId`, sem alterar os campos de erro já existentes.
- **FR-004**: Um cabeçalho `X-Request-Id` enviado pelo cliente MUST ser ignorado: o identificador é sempre o gerado pelo servidor.
- **FR-005**: Identificadores MUST ser únicos entre pedidos, inclusive entre reinícios do servidor, e MUST NOT ser previsíveis a partir dos anteriores.

#### Registro persistido

- **FR-006**: Todo pedido ao `/chat` MUST gerar um registro durável com: identificador, instante de chegada, duração, status HTTP final, código de erro (quando houver) e, quando conhecidos, a conversa, o usuário, a estratégia executada e a origem da escolha (012), o motivo de parada, o número de chamadas ao modelo, os tokens de entrada (010), o modelo que respondeu (013) e as contagens de contexto já expostas nas métricas (histórico, resumo, memórias).
- **FR-007**: O registro MUST NOT guardar o texto da mensagem nem da resposta. O conteúdo do pedido continua morando na conversa (007), e o da resposta, no rastro.
- **FR-008**: Num pedido bem-sucedido, cada evento do rastro entregue pelo `/chat` MUST ser gravado com: o identificador do pedido, a posição no rastro, o tipo, o nó de origem (012) e o conteúdo completo do evento, tal como foi entregue ao cliente.
- **FR-009**: Num pedido que terminou em erro, o registro MUST ser gravado com rastro vazio.
- **FR-010**: O registro e o rastro de um pedido MUST ser gravados de forma atômica: ou tudo, ou nada.
- **FR-011**: O registro de um pedido bem-sucedido MUST estar gravado antes de a resposta ser entregue ao cliente, de modo que uma consulta logo em seguida o encontre.
- **FR-012**: Qualquer falha ao gravar o registro ou o rastro MUST NOT alterar a resposta do `/chat` (status, corpo, cabeçalhos), MUST NOT impedir a gravação do turno da conversa (007) nem o refletor de aprendizado (009), e MUST ser registrada no log.
- **FR-013**: Os campos de conjunto fechado do registro e do rastro (status final, tipo de evento, nó de origem, estratégia, origem da escolha, motivo de parada) MUST ser rejeitados pelo próprio armazenamento quando fora do conjunto válido.
- **FR-014**: O registro e o rastro MUST morar no mesmo arquivo de banco local das conversas e da memória, com estrutura criada automaticamente na abertura, sem passo manual.

#### Consulta

- **FR-015**: `GET /requests/:id` MUST devolver 200 com o registro do pedido e seu rastro, ordenado pela posição original.
- **FR-016**: Cada evento devolvido pela consulta MUST ser idêntico, em tipo, nó de origem e conteúdo, ao evento correspondente entregue pelo `/chat` naquele pedido.
- **FR-017**: Um identificador inexistente ou malformado MUST resultar em 404 com código `request_not_found`, no formato de erro já usado pelo `/chat`.
- **FR-018**: A consulta MUST ser somente leitura: consultar não altera o registro nem gera outro registro.

#### Logs estruturados

- **FR-019**: Os logs do servidor HTTP MUST ser emitidos como exatamente uma linha JSON por acontecimento, cada linha um objeto completo e válido por si só.
- **FR-020**: Toda linha MUST trazer, no mínimo, o instante, o nível (conjunto fechado: `info`, `warn`, `error`) e o nome do acontecimento. Toda linha produzida durante o atendimento de um pedido MUST trazer também o `requestId`.
- **FR-021**: Por pedido ao `/chat`, o log MUST receber: uma linha de início; uma linha de fim, com status, duração e, no sucesso, estratégia, motivo de parada, chamadas ao modelo, tokens de entrada e modelo que respondeu; e, no sucesso, uma linha por evento do rastro, com tipo, nó de origem e posição.
- **FR-022**: As falhas tratadas sem erro para o cliente que hoje vão para o log em texto livre (roteador, memória semântica, sumarização, refletor de aprendizado), a troca para o modelo reserva (013), a falha de gravação do registro (FR-012) e o erro interno (500) MUST virar linhas JSON com o `requestId`, o componente e a classe ou tipo da falha.
- **FR-023**: Nenhuma linha de log MUST conter conteúdo: nem o texto da mensagem, da resposta, do resumo ou de memórias, nem pensamentos, argumentos de ferramenta, observações, críticas ou planos, nem a mensagem de erro do provedor, nem pilha de chamadas. Só metadados: identificadores, tipos, nomes, contagens, durações, status e classes de falha.
- **FR-024**: O destino dos logs MUST ser injetável, e uma falha ao escrever no log MUST NOT afetar o atendimento do pedido.
- **FR-025**: Arena, bench e servidor MCP MUST continuar com a saída de hoje, sem as linhas desta feature.

#### Compatibilidade e contratos

- **FR-026**: Os campos existentes da resposta, das métricas, dos eventos e dos erros do `/chat` MUST continuar como estão. `requestId` e `X-Request-Id` são aditivos.
- **FR-027**: O contrato do `/chat`, o contrato da nova consulta, o esquema do banco e o formato dos logs MUST ser documentados no mesmo conjunto de mudanças, e o README MUST explicar como obter o identificador e consultar um pedido.

#### Testabilidade

- **FR-028**: Os testes MUST rodar sem rede e sem credenciais, com banco em memória, gerador de identificadores e relógio controláveis, e destino de log que captura as linhas.
- **FR-029**: Os testes MUST cobrir no mínimo: identificador no corpo e no cabeçalho em 200, 400 (inclusive JSON malformado), 404, 422, 500, 503 e 504; cabeçalho do cliente ignorado; consulta devolvendo registro e rastro idênticos e ordenados; registro de erro com rastro vazio; 404 na consulta de identificador inexistente; resposta inalterada com falha de gravação; atomicidade; rejeição de valor fora do conjunto pelo armazenamento; uma linha JSON válida por acontecimento; `requestId` em toda linha de pedido; ausência do texto da mensagem e da resposta em todas as linhas.

### Key Entities

- **Identificador do pedido (`requestId`)**: valor único, gerado pelo servidor, que liga a resposta, o registro, o rastro e as linhas de log de um mesmo pedido.
- **Registro do pedido**: uma entrada por pedido ao `/chat`, com instante, duração, status final, código de erro e as métricas do atendimento. Não guarda o texto da mensagem nem da resposta.
- **Evento de rastro persistido**: um evento do rastro de um pedido, com posição, tipo, nó de origem e conteúdo completo. Pertence a exatamente um registro.
- **Linha de log**: um acontecimento do servidor em um objeto JSON numa única linha, com instante, nível, nome e, quando aplicável, o `requestId`. Só metadados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das respostas do `/chat`, de qualquer status, trazem o identificador no cabeçalho e no corpo, com o mesmo valor.
- **SC-002**: 100% dos pedidos bem-sucedidos podem ser consultados logo após a resposta, com rastro idêntico, evento a evento e na mesma ordem, ao entregue pelo `/chat`.
- **SC-003**: Um pedido consultado depois de reiniciar o servidor devolve o mesmo registro e o mesmo rastro de antes do reinício.
- **SC-004**: 0 respostas do `/chat` alteradas por falha de gravação do registro ou do log.
- **SC-005**: 100% das linhas de log do servidor HTTP são JSON válido, uma por linha, e 100% das linhas emitidas durante um pedido trazem o seu `requestId`.
- **SC-006**: 0 ocorrências do texto da mensagem ou da resposta nos logs, conferido nos testes com mensagens marcadas.
- **SC-007**: Dado um identificador, quem investiga encontra o resultado, a estratégia, a duração e o rastro completo do pedido com uma única consulta.
- **SC-008**: Nenhuma mudança observável na saída de arena, bench e servidor MCP, e `npm test` cobre a feature inteira sem rede e sem credenciais.

## Assumptions

- **Nomes dados pelo pedido**: o cabeçalho é `X-Request-Id`, o campo é `requestId`, as tabelas chamam-se `requests` e `trace_events`, o módulo de log é `src/obs/logger.ts` e a consulta é `GET /requests/:id`. São interface observável, no mesmo critério das specs 007–013.
- **O servidor sempre gera o identificador** e ignora o que vier do cliente. Aceitar o valor do cliente exigiria validar formato e tratar colisão e abuso, e o pedido não pede correlação com sistemas externos. Fica fora de escopo.
- **Pedidos com erro também são registrados**, com rastro vazio. Um 504 ou 503 é justamente o tipo de pedido que alguém quer investigar depois, e o registro dele é barato. Rastro parcial de pedido que falhou fica fora de escopo: hoje o rastro só existe quando a execução termina.
- **O registro guarda métricas, não conteúdo** ("requests (métricas)"). O texto da mensagem já está na conversa (007), e a resposta aparece no rastro como evento `answer`.
- **O rastro persistido guarda o conteúdo completo dos eventos** ("trace_events (node, payloads)"). É dado local, no mesmo arquivo de banco que já guarda conversas e memórias, e é o que torna a consulta útil. A restrição "só metadados" vale para os logs, que costumam sair da máquina.
- **Sem autenticação na consulta**, como no `/chat`. O OpsPilot é uma ferramenta local de estudo. Proteção de acesso fica fora de escopo.
- **Sem expiração nem limpeza** de registros nesta feature. Retenção fica fora de escopo, como nas conversas (007).
- **Os logs saem na saída padrão do processo**, uma linha por acontecimento. Mensagens de arranque (porta, seed) também passam a ser JSON, para que toda a saída do servidor HTTP seja legível por máquina.
- **Fora de escopo**: listar ou buscar pedidos (só consulta por identificador), registrar pedidos da arena, do bench e do MCP, propagar o identificador para o provedor de modelo, níveis de log configuráveis e exportação para serviços externos de observabilidade.
- **Dependências**: 003 (contrato e erros do `/chat`), 004 (persistência SQLite), 007 (conversas), 009 (refletor de aprendizado), 010 (métricas), 011 (sumarização), 012 (`nodeName`, evento `route`) e 013 (`modelUsed`, evento `fallback`, erro `model_unavailable`).
