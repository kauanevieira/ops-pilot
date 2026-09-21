# Feature Specification: Servidor MCP do OpsPilot

**Feature Branch**: `006-mcp-server`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "MCP server do OpsPilot: src/mcp/server.ts com @modelcontextprotocol/sdk, transport stdio, expondo list_alerts, open_incident e resolve_incident - reutilizando o mesmo OpsStore e os mesmos schemas zod das tools existentes (uma unica fonte de verdade). Nome do server: opspilot. Script npm: mcp = \"tsx src/mcp/server.ts\" (se precisar de env, alterar o script e carregar elas antes). REGRA CRÍTICA: nenhum console.log no server - no stdio o stdout é o canal do protocolo; diagnóstico vai para o stderr. Test: sobe o server e valida o list de tools"

## User Scenarios & Testing *(mandatory)*

<!--
  A P1 já entrega o produto mínimo: um cliente MCP qualquer conecta e enxerga
  as ferramentas do OpsPilot. As seguintes tornam essas ferramentas úteis de
  verdade (executar sobre o mesmo estado) e protegem o que as duas primeiras
  entregam (canal limpo, fonte única de contrato).
-->

### User Story 1 - Um cliente MCP descobre as ferramentas do OpsPilot (Priority: P1)

Quem está de plantão já usa um assistente de código ou de desktop compatível com MCP. Registra o OpsPilot nesse cliente com um único comando do projeto e, ao abrir a sessão, vê um servidor chamado `opspilot` oferecendo as ferramentas de alerta e de incidente — com os mesmos nomes, as mesmas descrições e os mesmos parâmetros que o agente interno do OpsPilot já usa.

**Why this priority**: é a razão de existir da feature. Hoje as ferramentas do OpsPilot só servem ao agente embutido no próprio projeto; qualquer outro assistente que a pessoa já use não tem como enxergá-las. Sem descoberta, nenhuma execução é possível.

**Independent Test**: testável isoladamente subindo o servidor como processo separado, conectando um cliente MCP pelo canal de entrada e saída padrão e pedindo a lista de ferramentas; a lista deve conter exatamente as ferramentas previstas, com descrição e esquema de entrada. Entrega valor mesmo que nenhuma execução seja feita — o cliente já sabe o que o OpsPilot oferece.

**Acceptance Scenarios**:

1. **Given** o servidor iniciado pelo comando do projeto, **When** um cliente MCP se conecta e se identifica, **Then** o servidor se apresenta com o nome `opspilot`.
2. **Given** um cliente conectado, **When** ele pede a lista de ferramentas, **Then** recebe `list_alerts`, `list_incidents`, `open_incident` e `resolve_incident`, e nenhuma outra.
3. **Given** a lista de ferramentas, **When** cada item é inspecionado, **Then** a descrição é idêntica à da ferramenta correspondente do agente interno.
4. **Given** a lista de ferramentas, **When** o esquema de entrada de cada item é inspecionado, **Then** os campos, tipos, valores aceitos, obrigatoriedade, valores padrão e descrições de campo são os mesmos da ferramenta correspondente do agente interno.
5. **Given** um repositório recém-clonado com dependências instaladas, **When** a pessoa registra o servidor no cliente usando o comando do projeto, **Then** nenhum passo manual adicional é necessário para que a lista de ferramentas apareça.

---

### User Story 2 - Executar as ferramentas sobre o mesmo estado do OpsPilot (Priority: P2)

Pelo assistente externo, a pessoa pergunta o que está disparando, abre um incidente a partir de um alerta e depois o resolve. O que ela vê e o que ela altera é o mesmo estado que a API HTTP do OpsPilot vê: um incidente aberto pelo cliente MCP aparece para quem consulta pela API, e vice-versa.

**Why this priority**: descoberta sem execução é vitrine. Esta história transforma a lista em trabalho real, e a exigência de estado único é o que impede o servidor MCP de virar um segundo OpsPilot divergente. Depende da P1, mas a P1 entrega valor sozinha.

**Independent Test**: testável isoladamente chamando cada ferramenta pelo cliente MCP contra um estado controlado e verificando o estado resultante — não o texto — tal como os testes das ferramentas internas já fazem.

**Acceptance Scenarios**:

1. **Given** alertas disparando no estado, **When** o cliente chama `list_alerts` sem argumentos, **Then** recebe os alertas disparando, aplicando o mesmo filtro padrão da ferramenta interna.
2. **Given** um serviço existente, **When** o cliente chama `open_incident` com título, serviço e gravidade válidos, **Then** um incidente é criado no estado e o resultado traz o incidente criado com seu id e status aberto.
3. **Given** incidentes abertos e resolvidos no estado, **When** o cliente chama `list_incidents` sem argumentos, **Then** recebe apenas os abertos, aplicando o mesmo filtro padrão da ferramenta interna.
4. **Given** um incidente aberto, **When** o cliente chama `resolve_incident` com o id dele, **Then** o incidente passa a resolvido no estado e o resultado traz o horário da resolução.
5. **Given** um incidente aberto pelo cliente MCP, **When** o mesmo estado é consultado por outro ponto de entrada do OpsPilot, **Then** o incidente está lá.
6. **Given** um serviço inexistente ou um id de incidente inexistente, **When** a ferramenta correspondente é chamada, **Then** o resultado é uma mensagem legível sinalizada como erro da ferramenta, o estado não muda, e o servidor segue atendendo.
7. **Given** argumentos que violam o esquema (gravidade fora do conjunto, campo obrigatório ausente), **When** a ferramenta é chamada, **Then** a chamada é recusada antes de tocar o estado, com mensagem legível.

---

### User Story 3 - O canal do protocolo nunca é corrompido (Priority: P3)

O servidor funciona durante toda a sessão sem que o cliente MCP desconecte por mensagem malformada. Tudo o que o processo tem a dizer que não é protocolo — início, falha de configuração, erro inesperado, aviso do runtime — vai para o canal de diagnóstico, onde o cliente registra como log sem interpretar.

**Why this priority**: no transporte por entrada e saída padrão, o canal de saída **é** o protocolo. Uma única linha de texto solta nele corrompe a sessão, e o sintoma aparece no cliente como falha opaca, longe da causa. Não é caminho feliz, mas qualquer violação invalida as duas histórias anteriores.

**Independent Test**: testável isoladamente capturando tudo o que o processo escreve no canal de saída durante uma sessão completa (inicialização, listagem, execuções com sucesso e com erro, encerramento) e verificando que cada linha é mensagem válida do protocolo; e verificando, por inspeção do código do servidor, que não há escrita direta no canal de saída.

**Acceptance Scenarios**:

1. **Given** uma sessão completa, **When** o canal de saída é capturado, **Then** 100% do que foi escrito nele são mensagens do protocolo.
2. **Given** o servidor iniciando, **When** ele quer informar que está pronto, **Then** a informação vai para o canal de diagnóstico.
3. **Given** uma configuração inválida (por exemplo, caminho de banco inutilizável), **When** o servidor inicia, **Then** a causa é escrita no canal de diagnóstico, o processo termina com código de falha, e o canal de saída permanece sem texto solto.
4. **Given** avisos emitidos pelo próprio runtime ao carregar módulos, **When** o servidor inicia, **Then** eles não aparecem no canal de saída.
5. **Given** o código do servidor, **When** ele é inspecionado, **Then** não há nenhuma escrita direta no canal de saída fora do transporte do protocolo.

---

### User Story 4 - Uma única fonte de contrato para as ferramentas (Priority: P4)

Quem mantém o OpsPilot altera a descrição ou o esquema de uma ferramenta em um único lugar, e a mudança vale tanto para o agente interno quanto para o servidor MCP. Não existe uma segunda cópia do contrato que possa ficar para trás.

**Why this priority**: o Princípio IV trata descrição de ferramenta como interface. Duas cópias da mesma interface divergem com o tempo, e a divergência não quebra compilação — vira o modelo externo escolhendo ferramenta com base em texto desatualizado. Preserva a qualidade da P1 ao longo do tempo, por isso vem por último, mas não é opcional.

**Independent Test**: testável isoladamente por um teste que compara, para cada ferramenta exposta, a descrição e o esquema anunciados pelo servidor MCP com os da ferramenta interna, e por inspeção verificando que nenhum texto de descrição ou esquema foi duplicado.

**Acceptance Scenarios**:

1. **Given** a descrição de uma ferramenta alterada no ponto único de definição, **When** o servidor MCP lista as ferramentas, **Then** a nova descrição aparece sem nenhuma outra alteração.
2. **Given** um campo novo adicionado ao esquema no ponto único de definição, **When** o servidor MCP lista as ferramentas, **Then** o campo aparece no esquema anunciado.
3. **Given** o código do servidor MCP, **When** ele é inspecionado, **Then** não contém literal de descrição de ferramenta, de descrição de campo, nem declaração própria de esquema de entrada.
4. **Given** a lógica de execução de cada ferramenta, **When** ela é inspecionada, **Then** servidor MCP e agente interno chamam o mesmo repositório com o mesmo tratamento de erro de domínio.

---

### Edge Cases

- **Cliente chama ferramenta não exposta** (por exemplo, `consultar_runbook`): recusada com resultado sinalizado como erro, informando ferramenta desconhecida; nada é executado.
- **Descrições que citam ferramentas vizinhas não expostas**: as descrições reutilizadas mencionam `consultar_runbook` e `check_provider_status` como fronteira. Aceito: as menções são de fronteira ("não use para X, isso é Y") e continuam corretas como orientação; o cliente apenas não terá Y disponível. Reescrever as descrições por canal violaria a fonte única (FR-008).
- **Incidente já resolvido passado para `resolve_incident`**: mesmo comportamento da ferramenta interna — o erro de domínio vira mensagem legível sinalizada como erro, sem derrubar o servidor.
- **Falha técnica** (banco corrompido, disco cheio durante escrita): o cliente recebe erro da chamada, a causa vai para o canal de diagnóstico; o servidor não escreve nada fora do protocolo no canal de saída.
- **Banco inexistente no primeiro uso**: criado e semeado na inicialização, como na API HTTP — sem passo manual.
- **Banco compartilhado com a API HTTP rodando ao mesmo tempo**: ambos os processos leem e escrevem o mesmo arquivo; uma escrita de um é visível para o outro na leitura seguinte.
- **Cliente encerra a sessão ou fecha o canal de entrada**: o servidor encerra de forma limpa, liberando a conexão com o banco, sem escrever no canal de saída.
- **Variáveis de ambiente ausentes**: as mesmas regras de default da API HTTP se aplicam; o servidor não exige credencial de modelo, porque não chama modelo nenhum.
- **Execução da suíte de testes**: o servidor sobe contra um banco isolado em memória, sem rede e sem credenciais.

## Requirements *(mandatory)*

### Functional Requirements

#### Capacidade

- **FR-001**: O projeto MUST oferecer um servidor MCP que se identifica com o nome `opspilot`.
- **FR-002**: O servidor MUST usar o transporte por entrada e saída padrão (stdio), de modo que o cliente o inicie como processo filho.
- **FR-003**: O servidor MUST ser iniciável por um único comando npm do projeto, `mcp`, sem passo manual prévio além da instalação de dependências.
- **FR-004**: O servidor MUST expor as ferramentas `list_alerts`, `list_incidents`, `open_incident` e `resolve_incident`. `list_incidents` entra além das três do pedido porque a descrição reutilizada de `resolve_incident` manda descobrir o id com ela; sem ela, um cliente MCP só resolveria incidentes cujo id recebeu de `open_incident` na mesma sessão (decisão de clarificação, 2026-09-21).
- **FR-005**: Ferramentas não listadas em FR-004 MUST NOT ser expostas pelo servidor.
- **FR-006**: O comando MUST carregar as mesmas variáveis de ambiente opcionais que a API HTTP carrega (arquivo `.env` quando existir), antes de iniciar o servidor, sem tornar o arquivo obrigatório.
- **FR-007**: O servidor MUST NOT exigir credencial de provedor de modelo, porque não executa nenhum agente nem chama modelo.

#### Fonte única de verdade

- **FR-008**: Nome, descrição e esquema de entrada de cada ferramenta exposta MUST vir da mesma definição usada pelo agente interno; o servidor MUST NOT declarar cópia própria de descrição, descrição de campo ou esquema.
- **FR-009**: A execução de cada ferramenta exposta MUST usar a mesma lógica da ferramenta interna — mesmo repositório, mesmos valores padrão, mesmo tratamento de erro de domínio.
- **FR-010**: O servidor MUST operar sobre o mesmo armazenamento durável da API HTTP, resolvido pela mesma configuração de caminho de banco, com as mesmas regras de criação e semeadura idempotente na abertura (Constituição, Princípio II).
- **FR-011**: Qualquer alteração de descrição ou esquema no ponto único de definição MUST se refletir no servidor MCP sem alteração no código do servidor.

#### Execução e erros

- **FR-012**: Argumentos que violem o esquema MUST ser recusados antes de qualquer acesso ao estado, com mensagem legível.
- **FR-013**: Erros de domínio (serviço inexistente, incidente inexistente, incidente já resolvido) MUST ser devolvidos como resultado legível sinalizado como erro da ferramenta, e o servidor MUST continuar atendendo (Constituição, "Erros de domínio").
- **FR-014**: Falhas técnicas MUST ser relatadas ao cliente como resultado sinalizado como erro e MUST ter a causa escrita no canal de diagnóstico; o servidor MUST continuar atendendo.
- **FR-015**: Chamada a ferramenta desconhecida MUST ser recusada sem executar nada.
- **FR-016**: O resultado de sucesso MUST conter o mesmo conteúdo que a ferramenta interna devolve ao agente para os mesmos argumentos e o mesmo estado.

#### Integridade do canal

- **FR-017**: O canal de saída padrão MUST conter exclusivamente mensagens do protocolo MCP durante toda a vida do processo.
- **FR-018**: O código do servidor MUST NOT escrever no canal de saída padrão por nenhum meio além do transporte do protocolo — incluindo `console.log`, `console.info` e escrita direta.
- **FR-019**: Todo diagnóstico — início, prontidão, configuração inválida, falha técnica, encerramento — MUST ir para o canal de erro padrão.
- **FR-020**: Avisos emitidos pelo runtime durante a inicialização MUST NOT chegar ao canal de saída padrão.
- **FR-021**: Configuração inválida na inicialização MUST encerrar o processo com código de falha e causa legível no canal de diagnóstico.
- **FR-022**: O encerramento do canal de entrada pelo cliente MUST encerrar o servidor de forma limpa, liberando a conexão com o banco.

#### Testabilidade

- **FR-023**: Os testes MUST subir o servidor como processo real e se comunicar com ele pelo transporte stdio, como um cliente MCP faria.
- **FR-024**: Os testes MUST verificar que a listagem de ferramentas devolve exatamente o conjunto de FR-004, com o nome do servidor de FR-001.
- **FR-025**: Os testes MUST verificar que descrição e esquema anunciados de cada ferramenta correspondem aos da definição interna.
- **FR-026**: Os testes MUST usar banco isolado em memória, sem rede e sem credenciais (Constituição, Princípio V).
- **FR-027**: Os testes MUST encerrar o processo do servidor ao final, mesmo em caso de falha, sem deixar processo órfão.
- **FR-028**: `npm run typecheck` e `npm test` MUST continuar passando sem rede e sem credenciais.

### Key Entities

- **Servidor MCP `opspilot`**: novo ponto de entrada do OpsPilot, ao lado da API HTTP e da CLI. Não tem estado próprio: compõe o armazenamento durável existente com as definições de ferramenta existentes.
- **Ferramenta exposta**: uma das ferramentas do agente interno, publicada ao cliente MCP com o mesmo nome, descrição, esquema e comportamento. Não é uma entidade nova — é a mesma ferramenta vista por outro canal.
- **Canal de saída / canal de diagnóstico**: o canal de saída padrão é reservado ao protocolo; o canal de erro padrão recebe tudo o mais. A separação é invariante do processo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Quem clona o repositório registra o OpsPilot em um cliente MCP com um único comando e vê as ferramentas listadas, sem nenhum passo manual adicional.
- **SC-002**: A lista de ferramentas anunciada contém exatamente as ferramentas previstas, verificado por teste automatizado em 100% das execuções da suíte.
- **SC-003**: 100% das ferramentas expostas anunciam descrição e esquema idênticos aos do agente interno, verificado por teste.
- **SC-004**: Em uma sessão completa — inicialização, listagem, execuções com sucesso, execuções com erro e encerramento — 100% do conteúdo do canal de saída é mensagem válida do protocolo.
- **SC-005**: 0 ocorrências de escrita direta no canal de saída no código do servidor, verificável por inspeção.
- **SC-006**: 100% dos erros de domínio chegam ao cliente como resultado legível, e 0% deles encerram o servidor.
- **SC-007**: Um incidente aberto pelo cliente MCP é visível pela API HTTP na consulta seguinte ao mesmo armazenamento.
- **SC-008**: Alterar a descrição de uma ferramenta exige mudança em exatamente um lugar do código.
- **SC-009**: A suíte de testes, incluindo o teste que sobe o servidor, roda sem rede e sem credenciais e completa em menos de 30 segundos.

## Assumptions

- **Restrições prescritas pelo pedido são tratadas como dadas**: arquivo `src/mcp/server.ts`, SDK oficial `@modelcontextprotocol/sdk` (nova dependência de runtime, a ser justificada no plano conforme a Governança), transporte stdio, nome `opspilot`, script npm `mcp` baseado em `tsx src/mcp/server.ts`. A spec descreve o comportamento; o plano detalha a forma.
- **"OpsStore" no pedido é o armazenamento durável já usado pela API HTTP** (`SqliteOpsStore` sobre a interface `OpsRepository`), aberto pela mesma função de abertura de banco e semeado da mesma forma. Não é o store in-memory, que a constituição reserva a testes e benchmark.
- **O script precisa carregar o ambiente**: o caminho do banco (`OPSPILOT_DB`) vem de variável de ambiente, então o script `mcp` segue o padrão de `dev` — carregar `.env` quando existir e silenciar o aviso experimental do `node:sqlite`, que de outro modo poluiria o diagnóstico. O aviso já vai para o canal de erro, não para o de saída; silenciá-lo é higiene, não correção.
- **"Mesmos schemas zod das tools existentes" inclui descrição e lógica de execução**: a fonte única cobre o contrato inteiro da ferramenta, não só a forma dos argumentos, porque duplicar a descrição quebraria o Princípio IV do mesmo jeito que duplicar o esquema. Como as ferramentas internas hoje são construídas dentro de uma fábrica, o plano decide como extrair ou reaproveitar essa definição sem cópia.
- **Erro de domínio no MCP usa a sinalização de erro de resultado de ferramenta do protocolo**, mantendo o texto legível que a ferramenta interna já produz. Falha técnica vira erro da chamada, espelhando a regra da constituição de que falhas técnicas propagam.
- **O resultado de sucesso é o mesmo texto que a ferramenta interna devolve** (JSON serializado), entregue como conteúdo textual. Resultado estruturado adicional fica fora de escopo nesta fase.
- **Concorrência com a API HTTP no mesmo arquivo de banco** é aceita sem coordenação adicional além da oferecida pelo próprio SQLite; o volume de uso é o de uma pessoa de plantão.
- **O teste de listagem é o portão mínimo exigido pelo pedido**; os testes de execução (US2) e de integridade do canal (US3) acompanham suas histórias.
- **Fora de escopo**: transportes de rede (HTTP/SSE), autenticação do cliente MCP, recursos e prompts MCP, exposição das estratégias de agente ou do endpoint de chat via MCP, e notificações de mudança de lista de ferramentas.
