# Feature Specification: Conversa Persistente

**Feature Branch**: `007-persistent-conversation`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Conversa persistente: ConversationStore (append/lastMessages/create) + tabela messages como no SqliteOpsStore; /chat: conversationId opcional, devolvido na resposta; 12 últimas mensagens no prompt via composição; métrica historyMessages; testes \":memory:\" + fake"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continuar uma conversa com o OpsPilot (Priority: P1)

Quem está de plantão faz uma pergunta ao OpsPilot, recebe a resposta e manda a pergunta seguinte como continuação — "e o runbook dele?", "abre um incidente pra isso" — sem repetir o contexto. Hoje cada pedido ao endpoint de chat começa do zero: o agente não sabe do que se falou no pedido anterior. Com esta feature, o pedido seguinte informa a conversa a que pertence, e o agente responde sabendo o que foi dito antes.

**Why this priority**: É a razão de existir da feature. Plantão é um diálogo, não uma sequência de perguntas isoladas; sem memória entre pedidos, toda referência ("dele", "isso", "o segundo alerta") falha ou obriga a pessoa a reescrever tudo.

**Independent Test**: Testável isoladamente enviando um primeiro pedido sem conversa informada, lendo o identificador de conversa devolvido, e enviando um segundo pedido com esse identificador — verificando que o agente recebeu as mensagens do primeiro turno como histórico.

**Acceptance Scenarios**:

1. **Given** um pedido de chat sem conversa informada, **When** ele é processado com sucesso, **Then** uma conversa nova é criada e seu identificador vem na resposta, junto com resposta final, rastro e métricas.
2. **Given** o identificador devolvido por um pedido anterior, **When** um novo pedido chega com esse identificador, **Then** o agente recebe as mensagens anteriores daquela conversa como histórico antes da mensagem nova, e a resposta devolve o mesmo identificador.
3. **Given** um pedido concluído com sucesso numa conversa, **When** a conversa é consultada depois, **Then** ela contém, ao final, a mensagem enviada por quem pediu seguida da resposta final do agente, nessa ordem.
4. **Given** duas conversas diferentes, **When** pedidos são feitos em cada uma, **Then** o histórico de uma nunca aparece no prompt da outra.
5. **Given** o serviço é reiniciado, **When** um pedido chega com o identificador de uma conversa anterior ao reinício, **Then** o histórico dela continua disponível.

---

### User Story 2 - Histórico limitado e visível nas métricas (Priority: P2)

Quem opera ou avalia o OpsPilot sabe, pela própria resposta, quantas mensagens de histórico o agente recebeu naquele pedido — e sabe que esse número tem teto, de modo que uma conversa longa não faz o custo por pedido crescer sem limite.

**Why this priority**: Sem teto, cada turno de uma conversa longa fica mais caro e mais lento que o anterior; sem a métrica, não há como distinguir "o agente ignorou o histórico" de "o histórico não chegou". Depende da US1, mas a US1 já entrega valor sozinha com conversas curtas.

**Independent Test**: Testável isoladamente criando uma conversa com mais de 12 mensagens armazenadas e enviando um pedido nela, verificando que o agente recebe exatamente as 12 mais recentes, em ordem cronológica, e que a métrica reporta 12.

**Acceptance Scenarios**:

1. **Given** uma conversa com mais de 12 mensagens, **When** um pedido chega nela, **Then** o agente recebe apenas as 12 mensagens mais recentes, da mais antiga para a mais nova, seguidas da mensagem nova.
2. **Given** uma conversa com menos de 12 mensagens, **When** um pedido chega nela, **Then** o agente recebe todas as mensagens anteriores, e a métrica reporta exatamente essa quantidade.
3. **Given** um pedido que cria uma conversa nova, **When** as métricas são lidas, **Then** a métrica de histórico é 0.
4. **Given** qualquer pedido bem-sucedido, **When** as métricas são lidas, **Then** elas incluem a quantidade de mensagens de histórico efetivamente entregues ao agente, além das métricas que já existiam.

---

### User Story 3 - Erros claros sobre a conversa (Priority: P3)

Quem integra com a API distingue, pela resposta, entre ter informado um identificador de conversa malformado e ter informado um identificador que não existe — e sabe que um pedido que falhou não deixa rastro pela metade na conversa.

**Why this priority**: Sem isso, um identificador digitado errado viraria silenciosamente uma conversa nova, e a pessoa acharia que o agente "esqueceu" o contexto. Não bloqueia o caminho feliz.

**Independent Test**: Testável isoladamente enviando um identificador vazio, um identificador inexistente, e um pedido que estoura o tempo limite numa conversa existente, verificando o erro de cada um e que a conversa não mudou.

**Acceptance Scenarios**:

1. **Given** um pedido cujo identificador de conversa é vazio ou de tipo errado, **When** ele chega, **Then** a resposta é de corpo inválido, no mesmo formato dos demais problemas de validação.
2. **Given** um pedido com um identificador bem-formado que não corresponde a nenhuma conversa, **When** ele chega, **Then** a resposta é de conversa não encontrada — distinta de corpo inválido e de estratégia desconhecida — e nenhuma execução de agente é iniciada.
3. **Given** um pedido numa conversa existente que falha (tempo esgotado ou erro inesperado), **When** a conversa é consultada depois, **Then** ela está exatamente como antes do pedido: nem a mensagem enviada nem uma resposta parcial foram gravadas.
4. **Given** um pedido que falha sem conversa informada, **When** ele termina, **Then** nenhuma conversa nova fica registrada.

---

### Edge Cases

- Pedido com estratégia desconhecida junto de um identificador de conversa inexistente → vale a ordem de validação existente: corpo, depois estratégia, depois conversa; a primeira falha é a que responde.
- Execução que termina por limite de iterações ou de reflexões → é sucesso (como já é hoje): a resposta parcial entregue é gravada como a resposta do agente naquele turno.
- Reflexão ligada numa conversa com histórico → o histórico entra uma única vez no que a estratégia recebe; as regenerações da reflexão não o duplicam, e o que é gravado é só a mensagem original de quem pediu e a resposta final aprovada (ou a última, se a reflexão se esgotou).
- Dois pedidos concorrentes na mesma conversa → ambos leem o histórico como estava ao começarem; cada turno é gravado inteiro (mensagem e resposta juntas) quando seu pedido conclui, na ordem de conclusão, sem intercalar a mensagem de um com a resposta do outro.
- Cliente que desiste antes de a execução terminar → se a execução concluir, o turno é gravado normalmente; a desistência do cliente não é falha da execução.
- Mensagem de histórico muito longa → entra inteira; o teto é por quantidade de mensagens, não por tamanho.
- Identificador de conversa com espaços em volta → tratado como os demais campos de texto do corpo: espaços das pontas são descartados antes da validação.
- Rastro, chamadas de ferramenta e observações de turnos anteriores → não fazem parte do histórico; só a mensagem de quem pediu e a resposta final de cada turno.

## Requirements *(mandatory)*

### Functional Requirements

#### Armazenamento de conversas

- **FR-001**: O sistema MUST manter conversas persistentes, cada uma identificada por um identificador opaco gerado pelo próprio sistema.
- **FR-002**: O sistema MUST armazenar, para cada conversa, uma sequência ordenada de mensagens, cada uma com seu papel (quem pediu ou o agente), seu conteúdo e o instante em que foi registrada.
- **FR-003**: O papel de uma mensagem MUST pertencer a um conjunto fechado (quem pediu, agente), e o armazenamento MUST rejeitar qualquer outro valor mesmo que a validação de aplicação falhe.
- **FR-004**: O armazenamento MUST oferecer exatamente três operações de conversa: criar uma conversa nova, acrescentar mensagens ao final de uma conversa existente, e obter as N mensagens mais recentes de uma conversa em ordem cronológica.
- **FR-005**: Acrescentar mensagens a uma conversa inexistente MUST falhar, sem criar a conversa implicitamente.
- **FR-006**: A ordem das mensagens de uma conversa MUST ser estável e total, inclusive entre mensagens registradas no mesmo instante.
- **FR-007**: As conversas MUST sobreviver ao reinício do serviço, no mesmo armazenamento durável já usado para o estado operacional, com estrutura criada automaticamente na abertura, sem passo manual.
- **FR-008**: O armazenamento de conversas MUST ser um contrato próprio, separado do contrato de estado operacional, de modo que cada um possa ser substituído independentemente.

#### Endpoint de chat

- **FR-009**: O endpoint de chat MUST aceitar um identificador de conversa opcional no corpo do pedido, em adição aos campos que já aceita.
- **FR-010**: Quando o identificador não for informado, o sistema MUST iniciar uma conversa nova para aquele pedido.
- **FR-011**: Toda resposta de sucesso MUST incluir o identificador da conversa a que o pedido pertence — o informado, ou o da conversa nova.
- **FR-012**: Um identificador informado vazio ou de tipo errado MUST produzir erro de corpo inválido, no formato e com o código já usados para os demais problemas de validação.
- **FR-013**: Um identificador bem-formado que não corresponde a nenhuma conversa MUST produzir erro de conversa não encontrada, com código distinto dos erros existentes, no formato de erro consistente já usado pelo serviço, sem iniciar a execução.
- **FR-014**: Ao concluir um pedido com sucesso, o sistema MUST gravar na conversa, numa única operação atômica, a mensagem de quem pediu seguida da resposta final do agente.
- **FR-015**: Um pedido que não conclui com sucesso (tempo esgotado, falha inesperada, ou qualquer erro de validação) MUST NOT gravar nenhuma mensagem, e MUST NOT deixar registrada uma conversa nova.
- **FR-016**: Os campos de sucesso já existentes (resposta final, rastro, métricas, motivo de encerramento) MUST continuar presentes e com o mesmo significado.

#### Histórico no prompt

- **FR-017**: Antes de executar a estratégia, o sistema MUST obter as até 12 mensagens mais recentes da conversa e entregá-las à estratégia como histórico, em ordem cronológica, antes da mensagem nova.
- **FR-018**: O teto de 12 mensagens MUST ser um valor único e nomeado, aplicado a qualquer estratégia e a qualquer combinação com reflexão.
- **FR-019**: A inclusão do histórico MUST ser feita por composição sobre a estratégia resolvida — um envoltório aplicável a qualquer estratégia — sem alterar a implementação de cada estratégia e sem exigir que o registro de estratégias conheça conversas.
- **FR-020**: Com a reflexão ligada, o histórico MUST ser entregue uma única vez por pedido, e o conteúdo gravado como mensagem de quem pediu MUST ser a mensagem original, nunca o texto enriquecido com histórico ou com feedback de revisão.
- **FR-021**: O histórico MUST conter apenas mensagens de quem pediu e respostas finais do agente; rastros, ações e observações de turnos anteriores MUST NOT ser incluídos.

#### Métrica

- **FR-022**: As métricas de todo pedido bem-sucedido MUST incluir a quantidade de mensagens de histórico efetivamente entregues à estratégia naquele pedido — um inteiro entre 0 e 12.
- **FR-023**: As entradas que não usam conversa (arena, bench, servidor MCP) MUST continuar funcionando com o mesmo comportamento observável; se reportarem essa métrica, ela MUST ser 0.

#### Testabilidade

- **FR-024**: O endpoint MUST receber o armazenamento de conversas por injeção, de modo que os testes do endpoint usem uma implementação falsa, em memória e determinística.
- **FR-025**: O projeto MUST incluir testes da implementação durável do armazenamento de conversas contra um banco efêmero em memória, cobrindo no mínimo: criar, acrescentar, obter as N mais recentes em ordem, teto maior que o total, conversa inexistente, papel inválido rejeitado pelo banco, e reabertura sem perda nem erro de estrutura.
- **FR-026**: O projeto MUST incluir testes do envoltório de histórico com estratégia falsa, verificando o que a estratégia recebeu e o valor da métrica, sem chamadas a modelo.
- **FR-027**: O projeto MUST incluir testes de integração do endpoint cobrindo no mínimo: pedido sem conversa (cria e devolve identificador), continuação com histórico, teto de 12, identificador inválido (corpo inválido), identificador inexistente (não encontrada), e falha que não grava nada.

### Key Entities

- **Conversa**: um diálogo entre quem está de plantão e o OpsPilot; tem um identificador opaco e o instante de criação. Não pertence a nenhum usuário — quem tem o identificador continua a conversa.
- **Mensagem**: uma fala dentro de uma conversa — papel (quem pediu ou agente), conteúdo em texto, instante de registro e posição na ordem da conversa.
- **Turno**: o par mensagem de quem pediu + resposta final do agente produzido por um pedido bem-sucedido; é a unidade gravada atomicamente.
- **Histórico**: a janela das até 12 mensagens mais recentes de uma conversa, entregue à estratégia antes da mensagem nova.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa consegue fazer uma pergunta de continuação que depende do turno anterior enviando apenas a mensagem nova e o identificador devolvido pelo pedido anterior.
- **SC-002**: 100% das respostas de sucesso trazem um identificador de conversa e a quantidade de mensagens de histórico usadas.
- **SC-003**: Em uma conversa de qualquer tamanho, o histórico entregue ao agente nunca passa de 12 mensagens.
- **SC-004**: 0% dos pedidos que falham deixam mensagens gravadas ou conversas novas registradas.
- **SC-005**: Uma conversa iniciada antes de um reinício do serviço pode ser continuada depois dele, com o histórico intacto.
- **SC-006**: A suíte de testes cobre armazenamento, envoltório de histórico e endpoint, e roda por completo sem rede e sem credenciais.
- **SC-007**: Arena, bench e servidor MCP produzem os mesmos resultados de antes da feature.

## Assumptions

- **Nomes e formas dados pelo pedido**: o contrato de armazenamento chama-se `ConversationStore`, com as operações `create`, `append` e `lastMessages`; a implementação durável segue o padrão de `SqliteOpsStore` (`node:sqlite`, DDL idempotente aplicado no construtor, `CHECK` no papel, prepared statements, datas como texto ISO-8601), com uma tabela `messages` e, para dar existência própria à conversa (FR-005, FR-013), uma tabela `conversations` referenciada por chave estrangeira. O campo do corpo e da resposta chama-se `conversationId`; a métrica chama-se `historyMessages`. Testes da implementação durável usam `":memory:"`; testes do endpoint usam um fake em memória.
- **Mesmo arquivo de banco**: as tabelas de conversa vivem no mesmo arquivo configurado por `OPSPILOT_DB`, abertas pela mesma conexão da raiz de composição da API (`src/index.ts`). O seed não toca nas tabelas de conversa.
- **Conversa não encontrada responde 404**, com código de erro `conversation_not_found`. Alternativa descartada: tratar identificador desconhecido como pedido de conversa nova — esconderia erros de digitação e faria o agente "esquecer" contexto em silêncio.
- **"12 últimas mensagens" conta mensagens, não turnos** (12 mensagens ≈ 6 turnos) e não inclui a mensagem nova do pedido atual.
- **Forma de entrega do histórico** (texto prefixado à entrada ou mensagens estruturadas antes da mensagem nova) é decisão de plano; a spec exige apenas que chegue à estratégia antes da mensagem nova, em ordem, por composição.
- **Sem retenção nem exclusão**: conversas e mensagens são mantidas indefinidamente; listar, apagar ou renomear conversas está fora de escopo, assim como qualquer endpoint de leitura de conversa.
- **Sem autenticação**: o identificador opaco é a única chave de acesso, coerente com o resto da API hoje.
- **Arena, bench e MCP não usam conversa**: continuam com uma execução por entrada, sem histórico.
