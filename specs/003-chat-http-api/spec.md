# Feature Specification: API HTTP de Chat

**Feature Branch**: `003-chat-http-api`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "POST /chat em src/http/server.ts (ou padrão do express) : body { message, strategy?, reflect? } validado com zod; default react. 200 { answer, trace, metrics }; 400 body inválido (issues do zod); 422 estratégia desconhecida; timeout 180s -> 504. Registry em src/agents/index.ts (nome -> estratégia; reflect aplica withReflection). Teste de integração com estratégia fake determinística, sem rede"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pedir ajuda ao OpsPilot por HTTP (Priority: P1)

Quem está de plantão — ou qualquer sistema que queira falar com o OpsPilot sem abrir um terminal — envia um pedido em linguagem natural para um endpoint de chat e recebe de volta a resposta final do agente junto com o rastro do que ele fez e o custo da execução. É a mesma capacidade que hoje só existe pela arena de linha de comando, agora acessível por rede.

**Why this priority**: É a razão de existir da feature. Sem ela, o OpsPilot continua sendo uma ferramenta de quem tem o repositório clonado. Todo o resto (escolha de estratégia, reflexão, tratamento de erro) só faz sentido depois que um pedido simples funciona ponta a ponta.

**Independent Test**: Testável isoladamente enviando um único pedido em linguagem natural ao endpoint, sem informar mais nada, e verificando que a resposta traz resposta final, rastro e métricas. Entrega valor mesmo que nenhuma outra opção do corpo do pedido seja suportada.

**Acceptance Scenarios**:

1. **Given** o serviço no ar, **When** chega um pedido contendo apenas a mensagem, **Then** a resposta é de sucesso e contém a resposta final do agente, o rastro completo da execução e as métricas daquela execução.
2. **Given** um pedido sem estratégia informada, **When** ele é processado, **Then** vale a estratégia padrão do projeto (ReAct) e a resposta é produzida por ela.
3. **Given** um pedido bem-sucedido, **When** a resposta é lida, **Then** o rastro tem a mesma forma e a mesma ordem de eventos que a mesma execução produziria pela arena, sem nenhuma informação a menos.
4. **Given** dois pedidos seguidos, **When** ambos são processados, **Then** cada um recebe sua própria resposta, seu próprio rastro e suas próprias métricas, sem mistura entre eles.

---

### User Story 2 - Escolher a estratégia e ligar a reflexão (Priority: P2)

Quem consome a API decide, pedido a pedido, qual estratégia de raciocínio usar e se a resposta deve passar pela camada de revisão antes de ser entregue — sem precisar de um endpoint diferente para cada combinação.

**Why this priority**: É o que torna a API útil para avaliar o produto, e não só para consumi-lo. Depende da US1 existir, mas o pedido simples já entrega valor sozinho.

**Independent Test**: Testável isoladamente enviando o mesmo pedido com cada estratégia disponível, com e sem reflexão, e verificando que o rastro e as métricas correspondem ao que aquela combinação produz.

**Acceptance Scenarios**:

1. **Given** um nome de estratégia válido no pedido, **When** ele é processado, **Then** a execução usa aquela estratégia.
2. **Given** um pedido com a reflexão ligada, **When** ele é processado, **Then** a estratégia escolhida roda decorada pela camada de reflexão, e o rastro contém os eventos de crítica dela.
3. **Given** um pedido com a reflexão desligada ou omitida, **When** ele é processado, **Then** a estratégia roda crua, sem nenhum evento de crítica no rastro.
4. **Given** a reflexão ligada sobre qualquer estratégia disponível, **When** ela é processada, **Then** a combinação funciona sem que seja preciso ter registrado previamente um nome específico para ela.
5. **Given** um pedido com reflexão ligada, **When** as métricas são lidas, **Then** elas incluem as chamadas extras feitas pela revisão.

---

### User Story 3 - Saber exatamente por que um pedido falhou (Priority: P3)

Quem integra com a API distingue, pela própria resposta de erro, entre ter mandado um corpo malformado, ter pedido uma estratégia que não existe e ter esbarrado no tempo limite de execução — e no primeiro caso sabe qual campo está errado e por quê.

**Why this priority**: Sem isso a API é utilizável mas frustrante de integrar: todo erro vira tentativa e erro. Não bloqueia o caminho feliz, por isso vem depois.

**Independent Test**: Testável isoladamente enviando um corpo inválido, um nome de estratégia inexistente e uma execução que estoura o tempo limite, e verificando que cada um produz uma resposta de erro distinta e identificável.

**Acceptance Scenarios**:

1. **Given** um corpo sem mensagem, com mensagem vazia, ou com algum campo do tipo errado, **When** ele chega, **Then** a resposta é de erro de requisição inválida e enumera os problemas de validação encontrados, indicando o campo e o motivo de cada um.
2. **Given** um corpo com um nome de estratégia desconhecido, **When** ele chega, **Then** a resposta é de entidade não processável — distinta do erro de corpo inválido — e informa quais nomes são válidos.
3. **Given** uma execução que ultrapassa o tempo limite de 180 segundos, **When** o limite é atingido, **Then** a resposta é de tempo esgotado no servidor e nenhuma resposta parcial é apresentada como se fosse final.
4. **Given** uma falha inesperada durante a execução da estratégia, **When** ela acontece, **Then** o serviço responde com erro de servidor sem derrubar o processo, e continua atendendo pedidos seguintes.
5. **Given** qualquer resposta de erro, **When** ela é lida, **Then** ela tem um formato consistente e reconhecível entre os diferentes tipos de erro.

---

### Edge Cases

- Corpo da requisição ausente, vazio ou que não é JSON válido → tratado como corpo inválido, com o mesmo formato de erro dos demais problemas de validação.
- Campos desconhecidos no corpo (ex.: `maxIterations`) → ignorados; não derrubam a requisição.
- `strategy` presente mas vazia ou só com espaços → erro de corpo inválido, não de estratégia desconhecida (é um problema de formato, não de nome).
- `strategy` informada já no formato composto `reflect:<nome>` → tratada como nome desconhecido, já que a reflexão é controlada pelo campo `reflect`.
- Mensagem muito longa → aceita; o limite de esforço é o de iterações da estratégia e o tempo limite da requisição, não o tamanho do texto.
- Tempo limite atingido enquanto a estratégia ainda está no meio de uma chamada de modelo → o pedido é encerrado com tempo esgotado e o trabalho em andamento é abandonado, sem travar o serviço.
- Execução que termina por limite de iterações ou de reflexões → é sucesso, não erro: a resposta parcial e o motivo de encerramento são entregues normalmente.
- Duas requisições concorrentes que escrevem no mesmo estado operacional (ex.: ambas resolvem o mesmo incidente) → a segunda enxerga o efeito da primeira; a ferramenta falha com o erro de domínio já existente e essa falha vira observação no rastro, não erro HTTP.
- Requisição que aborta por tempo esgotado depois de já ter escrito no estado → as escritas já aplicadas permanecem; não há desfazimento.
- Cliente que desiste antes de a execução terminar → o serviço não quebra nem tenta escrever numa conexão já fechada.

## Requirements *(mandatory)*

### Functional Requirements

#### Endpoint e caminho feliz

- **FR-001**: O sistema MUST expor um serviço HTTP com um endpoint de chat que aceita um pedido em linguagem natural e devolve o resultado de uma execução de estratégia de raciocínio.
- **FR-002**: O endpoint MUST aceitar um corpo com uma mensagem obrigatória, um nome de estratégia opcional e um indicador opcional de reflexão.
- **FR-003**: Em caso de sucesso, o sistema MUST responder com a resposta final, o rastro completo e as métricas da execução.
- **FR-004**: O rastro devolvido MUST preservar o conteúdo e a ordem dos eventos exatamente como a estratégia os produziu, sem filtragem ou reordenação.
- **FR-005**: As métricas devolvidas MUST refletir a execução daquele pedido especificamente, sem acumular valores de pedidos anteriores.
- **FR-006**: O sistema MUST informar, junto ao resultado, o motivo pelo qual a execução encerrou.
- **FR-007**: Quando a estratégia não for informada, o sistema MUST usar a estratégia padrão ReAct.
- **FR-008**: Quando a reflexão não for informada, o sistema MUST executar a estratégia sem reflexão.

#### Registro de estratégias

- **FR-009**: O sistema MUST manter um ponto único que resolve um nome de estratégia para a estratégia correspondente, usado tanto pelo endpoint quanto pelas demais entradas do projeto.
- **FR-010**: O registro MUST aplicar a camada de reflexão sobre a estratégia resolvida quando a reflexão for pedida, sem exigir uma entrada registrada separadamente para cada combinação de estratégia e reflexão.
- **FR-011**: O registro MUST ser capaz de listar os nomes de estratégia válidos, e essa lista MUST ser a mesma usada para validar os pedidos e para compor a mensagem de erro de estratégia desconhecida.
- **FR-012**: As entradas existentes que já consomem o registro (arena e bench) MUST continuar funcionando com o mesmo comportamento observável após a mudança.

#### Estado operacional

- **FR-012a**: O estado operacional (serviços, alertas, incidentes) MUST ser compartilhado por todas as requisições atendidas pelo mesmo processo: o serviço parte do estado semeado ao subir, e as escritas feitas pelas ferramentas do agente durante um pedido MUST ficar visíveis para os pedidos seguintes.
- **FR-012b**: O sistema MUST manter o estado compartilhado consistente diante de requisições concorrentes, sem perder escritas nem expor estado intermediário de um pedido a outro.
- **FR-012c**: O estado compartilhado MUST viver apenas na memória do processo: reiniciar o serviço MUST devolvê-lo ao estado semeado.

#### Validação e erros

- **FR-013**: O sistema MUST validar o corpo do pedido antes de iniciar qualquer execução.
- **FR-014**: Diante de um corpo que não satisfaz a validação, o sistema MUST responder com erro de requisição inválida e enumerar os problemas encontrados, identificando para cada um o campo afetado e a razão.
- **FR-015**: Diante de um corpo válido cujo nome de estratégia não existe, o sistema MUST responder com erro de entidade não processável — um código distinto do usado para corpo inválido — e listar os nomes válidos.
- **FR-016**: O sistema MUST usar um formato de corpo de erro consistente entre todos os tipos de erro que responde.
- **FR-017**: O sistema MUST tratar falhas inesperadas durante a execução respondendo com erro de servidor, sem encerrar o processo e sem vazar detalhes internos de implementação na resposta.

#### Tempo limite

- **FR-018**: O sistema MUST impor um tempo limite de 180 segundos para o processamento de um pedido de chat.
- **FR-019**: Ao atingir o tempo limite, o sistema MUST responder com erro de tempo esgotado no servidor e MUST NOT apresentar resultado parcial como se fosse a resposta final.
- **FR-020**: Ao atingir o tempo limite, o sistema MUST abandonar o trabalho em andamento daquele pedido e permanecer disponível para atender os pedidos seguintes.
- **FR-021**: O sistema MUST enviar exatamente uma resposta por pedido, mesmo quando a execução termina logo depois de o tempo limite ter disparado.

#### Testabilidade

- **FR-022**: O sistema MUST permitir que a resolução de estratégias seja substituída em teste, de modo que o endpoint possa ser exercitado com uma estratégia controlada.
- **FR-023**: O projeto MUST incluir um teste de integração que exercite o endpoint ponta a ponta usando uma estratégia falsa e determinística, sem acesso à rede e sem chamadas a modelo.
- **FR-024**: O teste de integração MUST cobrir, no mínimo: caminho feliz com estratégia padrão, escolha explícita de estratégia, reflexão ligada, corpo inválido, estratégia desconhecida e tempo esgotado.
- **FR-025**: O teste de integração MUST ser determinístico e não depender de espera por tempo real equivalente ao tempo limite de produção.
- **FR-026**: A criação do serviço MUST ser separável de colocá-lo para escutar numa porta, para que o teste possa exercitá-lo sem depender de uma porta fixa.

### Key Entities

- **Pedido de chat**: o que o cliente envia — a mensagem em linguagem natural (obrigatória, não vazia), o nome da estratégia (opcional) e se a reflexão deve ser aplicada (opcional).
- **Resultado de chat**: o que o serviço devolve em caso de sucesso — resposta final, rastro, métricas e motivo de encerramento; é o mesmo resultado que uma estratégia já produz hoje, exposto por HTTP.
- **Erro de chat**: o que o serviço devolve em caso de falha — um tipo de erro identificável e os detalhes correspondentes (problemas de validação, nomes válidos, ou a informação de que o tempo esgotou).
- **Registro de estratégias**: a correspondência entre nome e estratégia, mais a regra de aplicar a camada de reflexão por cima quando pedido; é a fonte única da lista de nomes válidos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa consegue obter uma resposta do OpsPilot enviando um único pedido com apenas a mensagem, sem configurar nada além do endereço do serviço.
- **SC-002**: Todas as combinações de estratégia disponível com e sem reflexão são alcançáveis pela API, e 100% delas produzem resposta, rastro e métricas.
- **SC-003**: 100% dos pedidos malformados recebem resposta identificando os campos problemáticos, sem que nenhuma execução de agente chegue a ser iniciada.
- **SC-004**: Os três tipos de falha previstos (corpo inválido, estratégia desconhecida, tempo esgotado) são distinguíveis entre si pela resposta, sem inspecionar logs do servidor.
- **SC-005**: Nenhum pedido ocupa o serviço por mais de 180 segundos.
- **SC-006**: O serviço continua atendendo pedidos normalmente depois de um pedido que falhou por qualquer um dos motivos previstos.
- **SC-009**: Uma sequência de pedidos consegue evoluir o estado operacional — um pedido que abre um incidente é observável por um pedido posterior que o consulta.
- **SC-007**: A suíte de testes cobre o endpoint ponta a ponta e roda por completo sem acesso à rede, em menos de 30 segundos.
- **SC-008**: Adicionar uma nova estratégia ao projeto a torna acessível pela API sem nenhuma alteração no endpoint.

## Assumptions

- **Autenticação e autorização estão fora de escopo**: o serviço é de uso interno/local nesta fase, assim como a arena.
- **A estratégia padrão é ReAct**, conforme indicado no pedido e coerente com o padrão já adotado no projeto.
- **A reflexão é controlada exclusivamente pelo campo `reflect`**: o cliente informa o nome da estratégia base; nomes compostos com prefixo de reflexão não são aceitos como entrada da API.
- **O limite de iterações da estratégia não é exposto no corpo do pedido** nesta versão; vale o padrão do projeto. O tempo limite de 180 segundos é o único controle de esforço exposto.
- **O formato de rastro e métricas devolvido é o mesmo já produzido pelas estratégias**, serializado como JSON; a feature não inventa um formato novo nem uma versão resumida.
- **Não há streaming nem execução assíncrona com consulta posterior**: o pedido é síncrono e a resposta só sai quando a execução termina ou o tempo limite dispara.
- **Não há persistência de histórico de conversa**: cada pedido é independente e carrega sozinho todo o contexto necessário. O que persiste entre pedidos é o estado operacional (FR-012a), não o diálogo.
- **O estado compartilhado não é durável**: não há banco nem escrita de volta no arquivo de seed; o processo é a fronteira de persistência.
- **O endereço/porta de escuta vem de configuração de ambiente**, com um padrão razoável para desenvolvimento local.
- **O registro de estratégias passa a viver em `src/agents/index.ts`**, conforme pedido, absorvendo o papel do registro atual em `src/agents/registry.ts`. A forma como as entradas existentes (arena, bench) passam a consultá-lo é decisão de implementação, desde que o comportamento observável delas não mude (FR-012).
- **Os nomes registrados hoje com prefixo de reflexão deixam de ser necessários como entradas próprias**, já que a reflexão passa a ser um modificador aplicável a qualquer estratégia. Se a arena continua aceitando esses nomes é decisão de planejamento, não desta especificação.
