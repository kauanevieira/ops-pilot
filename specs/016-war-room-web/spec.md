# Feature Specification: War Room Web

**Feature Branch**: `016-war-room-web`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "War room web/ (Vite+react+TS) com as instructions de design: chat -> /chat, com "ver raciocínio" abrindo o trace tipado. 202 vira cartão aprovar/negar; engrenagem com URL da API; base /opspilot/; CORS"

## Clarifications

### Session 2026-10-07

- Q: O lado servidor do fluxo de aprovação (202 + decisão) entra nesta feature? → A: Não. Esta feature publica o contrato e implementa só a war room, testada contra um dublê. A API passa a responder 202 numa feature separada. (Default adotado quando o `/speckit.plan` foi chamado sem resposta.)
- Q: Onde estão as instruções de design? → A: Não existem no repositório. O plano propõe a direção visual. (Default adotado quando o `/speckit.plan` foi chamado sem resposta.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar com o OpsPilot pelo navegador (Priority: P1)

Quem está de plantão abre a war room no navegador, escreve um pedido ("quais alertas críticos estão abertos?") e recebe a resposta do OpsPilot na mesma tela, numa conversa que continua turno a turno, sem precisar de `curl` nem de terminal.

**Why this priority**: É a razão de existir da war room. Sem ela, nenhuma outra história tem onde aparecer.

**Independent Test**: Com a API rodando e a war room apontada para ela, enviar duas mensagens seguidas; a segunda resposta usa o contexto da primeira (mesma conversa), e cada resposta aparece abaixo da mensagem que a originou.

**Acceptance Scenarios**:

1. **Given** a war room aberta e a API disponível, **When** a pessoa envia uma mensagem, **Then** a mensagem aparece imediatamente na conversa, um indicador de "pensando" fica visível até a resposta chegar, e a resposta do OpsPilot aparece em seguida.
2. **Given** uma conversa com pelo menos uma resposta, **When** a pessoa envia outra mensagem, **Then** ela é enviada como continuação da mesma conversa.
3. **Given** uma conversa em andamento, **When** a pessoa escolhe "nova conversa", **Then** a tela é limpa e a próxima mensagem inicia uma conversa nova.
4. **Given** a API responde com erro (corpo inválido, conversa inexistente, tempo esgotado, modelo indisponível, erro interno), **When** a resposta chega, **Then** a conversa mostra uma mensagem de erro legível, que diz o que aconteceu e traz o identificador do pedido quando a API o devolveu, e a pessoa pode tentar de novo sem perder o que já estava na tela.
5. **Given** um pedido em andamento, **When** a pessoa tenta enviar outra mensagem, **Then** o envio fica bloqueado até a resposta (ou o erro) chegar.

---

### User Story 2 - Ver o raciocínio de uma resposta (Priority: P1)

Ao lado de cada resposta há um "ver raciocínio". Ao acioná-lo, a pessoa vê o rastro daquele pedido, evento por evento e na ordem em que aconteceu, cada tipo com sua própria apresentação: a rota escolhida e o motivo, os pensamentos, as ferramentas chamadas com seus argumentos, as observações (com erro destacado), o plano e suas revisões, as críticas, o resumo da conversa, a troca de modelo e a resposta final. Junto vêm as métricas do pedido.

**Why this priority**: É o diferencial pedido explicitamente. Num incidente, confiar na resposta depende de ver de onde ela veio.

**Independent Test**: Com uma resposta que tenha rota, ações, observações e resposta final, acionar "ver raciocínio" mostra cada evento na ordem do rastro, cada tipo distinguível dos demais sem ler o conteúdo.

**Acceptance Scenarios**:

1. **Given** uma resposta exibida, **When** a pessoa aciona "ver raciocínio", **Then** o rastro daquele pedido abre sem sair da conversa, e pode ser fechado voltando ao mesmo ponto.
2. **Given** um rastro com eventos de todos os tipos conhecidos (`summarize`, `route`, `thought`, `action`, `observation`, `plan`, `critique`, `answer`, `fallback`), **When** ele é exibido, **Then** cada tipo tem rótulo e apresentação próprios, com todos os seus campos visíveis: rota, estratégia, motivo e origem para `route`; ferramenta e argumentos estruturados para `action`; ferramenta e indicação de erro para `observation`; passos numerados e número da revisão para `plan`; modelo de origem, destino e motivo para `fallback`; mensagens absorvidas para `summarize`.
3. **Given** um evento com o nó do grafo que o produziu, **When** ele é exibido, **Then** o nó aparece junto ao evento.
4. **Given** um rastro aberto, **When** a pessoa olha o cabeçalho, **Then** vê o motivo de parada e as métricas disponíveis (chamadas ao modelo, latência, tokens de entrada, modelo que respondeu, mensagens de histórico, memórias lembradas), e as ausentes não aparecem como zero.
5. **Given** um evento de tipo desconhecido (versão futura da API), **When** o rastro é exibido, **Then** o evento aparece de forma genérica, com seu tipo e conteúdo brutos, e os demais eventos continuam exibidos normalmente.

---

### User Story 3 - Aprovar ou negar uma ação pendente (Priority: P2)

Quando o OpsPilot precisa de autorização humana antes de executar uma ação, a API responde com 202 (aceito, aguardando decisão) em vez de uma resposta final. A war room transforma essa resposta num cartão na conversa que diz qual ação o agente quer executar e com quais argumentos, com os botões **Aprovar** e **Negar**. A decisão é enviada à API, e o resultado (a resposta final após aprovar, ou a confirmação da negação) aparece na conversa.

**Why this priority**: É o que transforma a war room de painel de leitura em ferramenta de operação segura. Fica depois de P1 porque depende de a API expor o fluxo de aprovação.

**Independent Test**: Com uma API (real ou dublê) que responde 202 com uma ação pendente, enviar uma mensagem mostra o cartão; aprovar mostra a resposta final; repetir e negar mostra a negação, e em nenhum dos casos o cartão aceita uma segunda decisão.

**Acceptance Scenarios**:

1. **Given** a API responde 202 com uma ação pendente, **When** a resposta chega, **Then** a conversa mostra um cartão com a descrição da ação, a ferramenta e seus argumentos, e os botões Aprovar e Negar.
2. **Given** um cartão pendente, **When** a pessoa aprova, **Then** a decisão é enviada, os botões ficam indisponíveis enquanto a API responde, e a resposta final aparece na conversa com o seu próprio "ver raciocínio".
3. **Given** um cartão pendente, **When** a pessoa nega, **Then** a decisão é enviada e o cartão passa a mostrar "negado", sem executar a ação.
4. **Given** um cartão já decidido, **When** a pessoa olha para ele, **Then** ele mostra a decisão tomada e não oferece mais os botões.
5. **Given** a API recusa a decisão (pendência expirada ou já decidida), **When** a resposta chega, **Then** o cartão mostra o motivo e fica fechado.
6. **Given** um cartão pendente, **When** a pessoa tenta enviar outra mensagem na mesma conversa, **Then** o envio fica bloqueado até a decisão.

**Escopo** (decidido em Clarifications): esta feature define o contrato do fluxo de aprovação e implementa só o lado da war room, verificado contra um dublê. O lado servidor (quais ações pedem aprovação, emitir o 202, receber a decisão e retomar o grafo) é uma feature separada.

---

### User Story 4 - Apontar a war room para outra API (Priority: P2)

Um ícone de engrenagem abre as configurações, onde a pessoa informa a URL da API do OpsPilot. A escolha vale para os próximos pedidos e continua valendo quando a página é recarregada.

**Why this priority**: A war room publicada sob `/opspilot/` precisa falar com uma API que pode estar em outro endereço (local, staging, máquina de colega). Sem isso, só funciona numa configuração fixa.

**Independent Test**: Trocar a URL pela engrenagem, recarregar a página e enviar uma mensagem; o pedido vai para a URL nova.

**Acceptance Scenarios**:

1. **Given** a war room aberta pela primeira vez, **When** a pessoa abre a engrenagem, **Then** vê a URL padrão em uso.
2. **Given** a pessoa informa uma URL válida e salva, **When** envia a próxima mensagem, **Then** o pedido vai para essa URL, e a escolha sobrevive a recarregar a página.
3. **Given** a pessoa informa um texto que não é URL `http`/`https`, **When** tenta salvar, **Then** o valor é recusado com mensagem clara e a URL anterior continua valendo.
4. **Given** uma URL salva, **When** a pessoa usa "restaurar padrão", **Then** a URL padrão volta a valer.
5. **Given** a URL configurada não responde ou recusa o navegador por origem, **When** a pessoa envia uma mensagem, **Then** a conversa mostra que a API não pôde ser alcançada naquele endereço e sugere conferir a URL na engrenagem.

---

### User Story 5 - A API aceitar a war room de outra origem (Priority: P1)

A war room é servida de um endereço diferente da API. A API passa a aceitar chamadas vindas do navegador a partir das origens autorizadas, e só delas.

**Why this priority**: Sem isso, o navegador bloqueia toda chamada da war room para a API, e nada das histórias acima funciona fora de um proxy.

**Independent Test**: Uma chamada à API com origem autorizada recebe os cabeçalhos que liberam o navegador (inclusive na verificação prévia); uma com origem não autorizada não recebe.

**Acceptance Scenarios**:

1. **Given** uma origem na lista de autorizadas, **When** o navegador faz a verificação prévia e depois a chamada a `/chat`, **Then** ambas são liberadas, inclusive o envio de corpo JSON.
2. **Given** uma origem fora da lista, **When** o navegador chama a API, **Then** a API não a libera.
3. **Given** uma resposta liberada, **When** a war room lê os cabeçalhos, **Then** consegue ler o identificador do pedido (`X-Request-Id`).
4. **Given** nenhuma lista configurada, **When** a API sobe, **Then** só a origem padrão de desenvolvimento local da war room é autorizada.
5. **Given** uma chamada sem origem (ex.: `curl`, testes, servidor MCP), **When** ela chega, **Then** o comportamento é exatamente o de antes desta feature.

---

### Edge Cases

- **Resposta lenta**: o `/chat` pode levar até 180 s. O indicador de "pensando" continua visível durante todo esse tempo, e a war room não desiste antes da API.
- **Conversa que deixou de existir** (404 do `/chat` com `conversationId`): a war room avisa e oferece começar uma conversa nova.
- **Rastro muito longo** (dezenas de eventos, observações com milhares de caracteres): o rastro continua navegável, com conteúdo longo recolhido e expansível.
- **Argumentos de ferramenta aninhados**: exibidos estruturados e legíveis, nunca como `[object Object]`.
- **Recarregar a página no meio da conversa**: a conversa visível se perde (assumido abaixo), mas a URL da API configurada não.
- **URL da API com barra final ou caminho** (`http://host:3000/`, `https://host/api`): os pedidos são montados corretamente nos dois casos.
- **Página aberta direto num endereço interno sob `/opspilot/`**: carrega a war room, não um erro de página inexistente.
- **Armazenamento do navegador indisponível** (janela privada, bloqueado): a war room funciona com a URL padrão e avisa que a escolha não será lembrada.
- **Resposta 202 com corpo fora do formato esperado**: tratada como erro legível, nunca como cartão quebrado.

## Requirements *(mandatory)*

### Functional Requirements

**Conversa**

- **FR-001**: A war room MUST enviar cada mensagem ao `POST /chat` da API configurada e exibir a resposta (`answer`) na conversa, abaixo da mensagem que a originou.
- **FR-002**: A war room MUST reaproveitar o `conversationId` devolvido pela primeira resposta em todos os turnos seguintes da mesma conversa, e MUST oferecer "nova conversa", que descarta esse id.
- **FR-003**: A war room MUST bloquear um novo envio enquanto houver pedido em andamento ou cartão de aprovação pendente na conversa, e MUST mostrar um indicador de andamento até a resposta chegar.
- **FR-004**: A war room MUST NOT impor prazo menor que o da API (180 s) a um pedido do `/chat`.
- **FR-005**: Toda resposta de erro da API (`invalid_body`, `unknown_strategy`, `conversation_not_found`, `timeout`, `model_unavailable`, `internal`) MUST virar uma mensagem legível na conversa, com o `requestId` quando presente. Falha de rede ou bloqueio por origem MUST virar uma mensagem que aponte a URL tentada e sugira conferir a engrenagem.

**Raciocínio**

- **FR-006**: Toda resposta exibida MUST ter um "ver raciocínio" que abre o rastro daquele pedido sem sair da conversa.
- **FR-007**: O rastro MUST exibir os eventos na ordem recebida, cada tipo conhecido (`summarize`, `route`, `thought`, `action`, `observation`, `plan`, `critique`, `answer`, `fallback`) com rótulo, apresentação visual distinta e todos os seus campos, e o `nodeName` quando presente.
- **FR-008**: Um evento de tipo desconhecido MUST ser exibido de forma genérica (tipo + conteúdo bruto) sem impedir a exibição dos demais.
- **FR-009**: O rastro MUST mostrar o motivo de parada e as métricas presentes no resultado. Métrica ausente MUST NOT aparecer como 0.
- **FR-010**: Conteúdo longo (observações, argumentos) MUST ser recolhido por padrão e expansível.
- **FR-011**: As formas dos dados recebidos da API (resposta do `/chat`, rastro, erro, ação pendente) MUST ser validadas na chegada. Dado fora da forma esperada MUST virar erro legível, nunca tela quebrada.

**Aprovação**

- **FR-012**: Uma resposta 202 do `/chat` MUST virar, na conversa, um cartão com a descrição da ação pendente, a ferramenta, os argumentos e os botões Aprovar e Negar.
- **FR-013**: Aprovar ou negar MUST enviar a decisão à API uma única vez. Os botões MUST ficar indisponíveis durante o envio e depois da decisão, e o cartão MUST passar a mostrar a decisão tomada.
- **FR-014**: Após aprovação, a resposta final MUST aparecer na conversa como qualquer outra resposta, com seu "ver raciocínio". Após negação, o cartão MUST mostrar "negado".
- **FR-015**: A recusa da decisão pela API MUST aparecer no cartão, com o motivo, e o cartão MUST ficar fechado.
- **FR-016**: A war room MUST implementar o fluxo de aprovação contra o contrato publicado por esta feature (`contracts/approval-flow.md`). Implementar esse contrato na API fica fora de escopo (feature separada).

**Configuração**

- **FR-017**: Um controle de engrenagem MUST permitir ver, alterar e restaurar a URL da API. Só URLs `http`/`https` absolutas MUST ser aceitas.
- **FR-018**: A URL escolhida MUST persistir entre recarregamentos no mesmo navegador. Sem armazenamento disponível, a war room MUST funcionar com a URL padrão e avisar que a escolha não será lembrada.
- **FR-019**: A URL padrão MUST ser definida no momento da publicação da war room, com `http://localhost:3000` quando nada for definido.

**Publicação**

- **FR-020**: A war room MUST funcionar servida sob o caminho base `/opspilot/`: todos os recursos e endereços internos resolvidos a partir dele, e o acesso direto a um endereço interno sob esse caminho MUST carregar a war room.
- **FR-021**: A war room MUST viver em `web/` no repositório, com seus próprios portões de tipos e testes, que MUST passar offline e sem a API rodando (Princípio V).
- **FR-022**: A aparência MUST seguir a direção visual registrada no plano desta feature (sala de guerra: tema escuro por padrão, denso, leitura rápida, cor por tipo de evento e por severidade), já que não há instruções de design no repositório.

**CORS (API)**

- **FR-023**: A API MUST responder à verificação prévia do navegador e às chamadas de `/chat`, `/requests/:id` e `/stats` liberando apenas as origens de uma lista configurável por variável de ambiente, aceitando corpo JSON e expondo o cabeçalho `X-Request-Id`.
- **FR-024**: Sem a variável configurada, a única origem autorizada MUST ser a do servidor de desenvolvimento local da war room. Lista inválida MUST impedir o servidor de subir, com mensagem clara (mesma regra de `PORT` e `OPENROUTER_PRICES`).
- **FR-025**: Chamadas sem origem MUST se comportar exatamente como antes desta feature, e a verificação prévia MUST NOT gerar registro de pedido (014) nem linha de log de pedido.

### Key Entities

- **Mensagem da conversa**: quem falou (pessoa ou OpsPilot), o texto, e, nas respostas, o resultado completo (rastro, métricas, motivo de parada, `requestId`).
- **Rastro**: sequência ordenada de eventos tipados, como já definida pela API (003, 011–014).
- **Ação pendente**: o que o agente quer executar e aguarda decisão: identificador, descrição, ferramenta, argumentos, estado (pendente, aprovada, negada, recusada).
- **Configuração da war room**: URL da API em uso e se ela é a padrão.
- **Origem autorizada**: endereço de onde o navegador pode chamar a API.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Quem nunca usou a war room envia a primeira pergunta e lê a resposta em menos de 1 minuto, sem instrução.
- **SC-002**: A partir de uma resposta, a pessoa chega ao rastro completo com uma única ação, e identifica a rota escolhida e as ferramentas chamadas em menos de 30 segundos.
- **SC-003**: 100% dos tipos de evento de rastro conhecidos têm apresentação própria, e um tipo desconhecido nunca quebra a tela.
- **SC-004**: Nenhuma ação pendente é executada sem um clique em Aprovar, e nenhum cartão aceita duas decisões.
- **SC-005**: Trocar a API pela engrenagem leva menos de 15 segundos e sobrevive a recarregar a página.
- **SC-006**: Publicada sob `/opspilot/` e apontada para uma API em outra origem autorizada, a war room completa uma conversa de 3 turnos sem erro de origem.
- **SC-007**: Os portões da API (`npm run typecheck`, `npm test`) continuam verdes, e os da war room passam sem rede e sem a API.

## Assumptions

- **Stack definida pelo pedido**: Vite + React + TypeScript em `web/`, com dependências próprias, separadas das da API. A war room não adiciona dependência de runtime à API além do necessário para CORS.
- **Uma pessoa, sem login**: a API não tem autenticação (003–015), e a war room também não. Controle de acesso fica fora de escopo; a lista de origens limita só o navegador, não `curl`.
- **Conversa não sobrevive a recarregar a página**: só a URL da API é lembrada. Reabrir conversas antigas e listar conversas ficam fora de escopo (a API não tem endpoint de listagem).
- **Sem `userId`**: a war room não envia `userId`, então a memória semântica (008/009) não entra. Escolher usuário fica fora de escopo.
- **Sem escolha de estratégia**: a war room não envia `strategy` nem `reflect`; o roteador (012) decide. O rastro mostra o que foi escolhido.
- **Rastro vem da própria resposta**: a resposta do `/chat` já traz o rastro completo; `GET /requests/:id` (014) fica como alternativa, não como requisito.
- **Sem streaming**: a resposta chega inteira no fim do pedido, como a API faz hoje.
- **Origem padrão de desenvolvimento**: a do servidor de desenvolvimento da war room em `localhost`, na porta padrão da ferramenta.
- **Publicação**: hospedagem estática sob `/opspilot/` (ex.: proxy reverso ou página estática). O processo de deploy fica fora de escopo; a feature entrega o build pronto para esse caminho.
- **Dependências**: 003 (`POST /chat`), 007 (`conversationId`), 012 (`route`, `nodeName`), 013 (`fallback`, `model_unavailable`, `modelUsed`), 014 (`requestId`, `X-Request-Id`), e, para a US3 funcionar contra a API real, a feature separada que implementa `contracts/approval-flow.md` no servidor.
