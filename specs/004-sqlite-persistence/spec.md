# Feature Specification: Persistência real de operações

**Feature Branch**: `004-sqlite-persistence`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Persistência real de operações: SqliteOpsStore (src/store/sqlite-ops-store.ts) implementa a interface OpsStore existente via node:sqlite (DatabaseSync); caminho em OPSPILOT_DB (default ./data/opspilot.db); ':memory:' nos testes; 4 tabelas — services, alerts, incidents, runbooks — espelhando os tipos atuais do domínio (incidents ganha resolved_at e summary, anuláveis); DDL idempotente no construtor; CHECK em todo campo de domínio fechado (tier, severity, status); seed idempotente = cenário Mercadinho do mock (5 serviços, 6 alertas: 3 firing, 3 resolved; runbooks de checkout/payments/auth); prepared statements em toda query, sem SQL concatenado; tools novas: list_incidents(status open | resolved | all, default open) e consultar_runbook(service) — descrições pelas 6 regras; composição injeta o SqliteOpsStore; mock in memory fica para testes e para o bench (cenários possam ser reproduzidos); data/ no .gitignore; revisar descrições de src/agents/tools.ts pelas 6 regras (dívida do open_incident: quando usar; .describe() em todo campo; enums); testes ':memory:' seed, abrir/listar/resolver, filtros e CHECKS; testes das tools existentes passam a rodar sobre ':memory:'"

## User Scenarios & Testing *(mandatory)*

<!--
  As histórias estão ordenadas por valor. Cada uma é entregável e testável
  sozinha: a P1 já resolve o problema central (perder tudo ao reiniciar), e as
  seguintes agregam capacidade sem depender de estar completas entre si.
-->

### User Story 1 - O que aconteceu no plantão não se perde (Priority: P1)

Quem está de plantão abre um incidente conversando com o OpsPilot, o processo é reiniciado — deploy, queda, fim do expediente — e ao voltar o incidente continua lá, com o mesmo id, o mesmo estado e o mesmo horário de abertura. O mesmo vale para os serviços, alertas e runbooks: o mundo operacional é o mesmo antes e depois.

**Why this priority**: é a razão de existir da feature. Hoje todo o estado vive na memória do processo; qualquer reinício apaga o trabalho registrado durante o plantão, o que torna o OpsPilot uma demonstração e não uma ferramenta. Nenhuma das outras histórias tem valor se o que elas leem ou escrevem evapora.

**Independent Test**: testável isoladamente abrindo um incidente, encerrando o processo, subindo outro processo apontado para o mesmo armazenamento e verificando que o incidente é lido de volta idêntico. Entrega valor mesmo que nenhuma ferramenta nova exista.

**Acceptance Scenarios**:

1. **Given** um armazenamento vazio, **When** o sistema é iniciado pela primeira vez, **Then** o armazenamento é criado com a estrutura necessária e semeado com o cenário base, sem nenhum passo manual.
2. **Given** o sistema iniciado, **When** um incidente é aberto por uma ferramenta do agente, **Then** ele é gravado de forma durável antes de a ferramenta responder.
3. **Given** um incidente aberto num processo, **When** o processo é encerrado e outro é iniciado sobre o mesmo armazenamento, **Then** o incidente é listado com id, título, serviço, severidade, status e horário de abertura inalterados.
4. **Given** um incidente resolvido num processo, **When** outro processo o consulta depois, **Then** ele aparece como resolvido e com o horário de resolução preenchido.
5. **Given** um armazenamento já semeado, **When** o seed é executado de novo, **Then** o cenário base permanece exatamente igual — sem itens duplicados e sem perder o que foi registrado durante os plantões.
6. **Given** um armazenamento apontado para um caminho cuja pasta ainda não existe, **When** o sistema é iniciado, **Then** ele passa a funcionar sem exigir que a pessoa crie a pasta na mão.

---

### User Story 2 - Consultar incidentes e runbooks pela conversa (Priority: P2)

Quem está de plantão pergunta ao OpsPilot "o que está aberto?" e recebe a lista dos incidentes em aberto; pergunta "o que eu faço com o checkout?" e recebe o runbook daquele serviço, com os passos na ordem em que devem ser seguidos.

**Why this priority**: é o que transforma o armazenamento durável em valor visível. Sem consultar incidentes, o histórico existe mas ninguém o enxerga; sem runbook, o OpsPilot diz o que está quebrado mas não o que fazer. Depende da P1 existir, mas a P1 entrega valor sozinha.

**Independent Test**: testável isoladamente pedindo a lista de incidentes com cada filtro disponível e pedindo o runbook de um serviço que tem um e de outro que não tem, verificando o conteúdo devolvido em cada caso.

**Acceptance Scenarios**:

1. **Given** incidentes em aberto e incidentes resolvidos, **When** a lista é pedida sem filtro, **Then** apenas os em aberto são devolvidos.
2. **Given** o mesmo estado, **When** a lista é pedida com o filtro de resolvidos, **Then** apenas os resolvidos são devolvidos.
3. **Given** o mesmo estado, **When** a lista é pedida sem restrição de status, **Then** todos os incidentes são devolvidos.
4. **Given** nenhum incidente no estado pedido, **When** a lista é pedida, **Then** a resposta é uma lista vazia e não um erro.
5. **Given** um serviço que tem runbook, **When** o runbook é pedido para ele, **Then** os passos são devolvidos na ordem definida.
6. **Given** um serviço existente que não tem runbook, **When** o runbook é pedido para ele, **Then** a resposta declara explicitamente que não há runbook para aquele serviço, de modo distinguível de serviço inexistente.
7. **Given** um identificador de serviço que não existe, **When** o runbook é pedido para ele, **Then** a resposta é um erro de domínio legível, e a execução do agente continua.

---

### User Story 3 - O agente escolhe a ferramenta certa na primeira tentativa (Priority: P3)

Quem consome o OpsPilot faz um pedido ambíguo — "como está o plantão?", "registra isso aí", "o que já foi resolvido?" — e o agente escolhe a ferramenta certa sem tentar a errada antes, porque cada descrição diz o que a ferramenta faz, quando usá-la, quando não usá-la e o que ela devolve.

**Why this priority**: com cinco ferramentas em vez de três, a chance de o modelo confundir `list_alerts` com `list_incidents`, ou abrir incidente quando era para só consultar, cresce — e cada escolha errada é uma chamada de modelo paga e um passo a mais no rastro. Não bloqueia o caminho feliz, por isso vem depois.

**Independent Test**: testável isoladamente auditando cada ferramenta exposta contra as 6 regras de descrição da constituição e verificando que todo campo de esquema tem descrição própria e que todo conjunto fechado é enumerado.

**Acceptance Scenarios**:

1. **Given** o conjunto de ferramentas exposto ao modelo, **When** cada descrição é auditada, **Then** todas declaram o que fazem, quando usar e o que devolvem.
2. **Given** duas ferramentas com propósito próximo (alertas × incidentes; abrir × consultar), **When** suas descrições são lidas, **Then** cada uma declara explicitamente a fronteira contra a outra.
3. **Given** qualquer ferramenta, **When** seu esquema de entrada é inspecionado, **Then** todo campo tem descrição própria, com o valor padrão explicitado quando houver.
4. **Given** qualquer campo de conjunto fechado, **When** seu esquema é inspecionado, **Then** ele é um enumerado com os valores aceitos, nunca texto livre.

---

### User Story 4 - Comparar estratégias sobre o mesmo cenário, sempre (Priority: P4)

Quem avalia as estratégias roda a arena e o benchmark quantas vezes quiser e cada execução parte exatamente do mesmo cenário, sem herdar incidentes abertos pela execução anterior e sem depender de limpar arquivo nenhum.

**Why this priority**: a durabilidade da P1 é exatamente o que quebraria a comparação entre estratégias, que depende de partir sempre do mesmo ponto. Preserva uma capacidade que o projeto já tem, em vez de criar uma nova — por isso vem por último, mas não é opcional.

**Independent Test**: testável isoladamente rodando o benchmark duas vezes seguidas e verificando que a verificação de acerto de cada cenário dá o mesmo resultado nas duas, e que nada foi gravado de forma durável.

**Acceptance Scenarios**:

1. **Given** o benchmark executado uma vez, **When** ele é executado de novo em seguida, **Then** cada cenário parte do mesmo estado inicial que partiu na primeira vez.
2. **Given** duas estratégias comparadas no mesmo cenário, **When** ambas rodam, **Then** cada uma opera sobre seu próprio estado, sem que as escritas de uma sejam vistas pela outra.
3. **Given** a suíte de testes, **When** ela é executada, **Then** nenhum arquivo de banco é criado no projeto e nenhum teste depende do estado deixado por outro.
4. **Given** a suíte de testes, **When** ela é executada sem rede e sem credenciais, **Then** ela passa por completo.

---

### Edge Cases

- **Pasta de dados ausente**: o caminho configurado aponta para uma pasta que não existe — o sistema a cria em vez de falhar na subida.
- **Armazenamento pré-existente com dados de plantão**: o seed roda de novo sobre um armazenamento que já tem incidentes abertos — o cenário base é reafirmado sem apagar nem duplicar nada.
- **Valor de domínio inválido chegando ao armazenamento**: uma severidade, status ou tier fora do conjunto aceito é rejeitada pelo próprio armazenamento, ainda que a validação de aplicação tivesse deixado passar.
- **Serviço inexistente na abertura de incidente**: continua sendo um erro de domínio legível devolvido ao modelo como observação, não uma falha técnica que aborta a execução.
- **Incidente já resolvido sendo resolvido de novo**: continua sendo erro de domínio, e o horário de resolução original não é sobrescrito.
- **Texto com aspas, acentos ou caracteres especiais** num título de incidente ou num passo de runbook: gravado e lido de volta idêntico, sem qualquer possibilidade de alterar o sentido da consulta.
- **Consulta sem resultado**: lista vazia de incidentes e serviço sem runbook são respostas normais, nunca erro.
- **Dois pedidos concorrentes escrevendo**: ambas as escritas sobrevivem; nenhuma é perdida silenciosamente.
- **Arquivo de banco corrompido ou sem permissão de escrita**: falha na subida com mensagem que identifica o caminho e o motivo, em vez de o sistema subir e falhar no primeiro pedido.

## Requirements *(mandatory)*

### Functional Requirements

#### Armazenamento durável

- **FR-001**: O sistema MUST persistir serviços, alertas, incidentes e runbooks de forma durável, sobrevivendo ao encerramento e reinício do processo.
- **FR-002**: O armazenamento durável MUST ser um arquivo local, sem depender de nenhum serviço de banco de dados externo em execução (Constituição, Princípio II).
- **FR-003**: O caminho do arquivo MUST ser configurável por variável de ambiente, com um padrão dentro do projeto quando ela não for informada.
- **FR-004**: O sistema MUST criar a estrutura do armazenamento na abertura, se ela ainda não existir, sem exigir nenhum passo manual de migração ou preparação.
- **FR-005**: A criação da estrutura MUST ser idempotente: abrir um armazenamento já estruturado não altera nada e não falha.
- **FR-006**: O sistema MUST criar a pasta do arquivo de dados quando ela não existir.
- **FR-007**: O arquivo de dados e sua pasta MUST NOT ser versionados.
- **FR-008**: O sistema MUST falhar na inicialização, com mensagem que identifica o caminho e a causa, quando o armazenamento não puder ser aberto ou estruturado.

#### Substituição do armazenamento atual

- **FR-009**: O armazenamento durável MUST satisfazer a mesma interface de repositório que as ferramentas do agente já consomem, sem que as ferramentas conheçam qual implementação está em uso.
- **FR-010**: A montagem da aplicação MUST injetar o armazenamento durável na entrada de uso real que atende requisições externas (API HTTP). ⚠️ **Correção feita durante o planejamento** (R-014, `specs/004-sqlite-persistence/research.md`): a arena e o benchmark ficam deliberadamente **fora** desta obrigação — ver FR-011, que a decide.
- **FR-011**: O armazenamento em memória MUST continuar sendo o armazenamento usado pela arena e pelo benchmark — não apenas "como alternativa para testes": comparar estratégias exige que cada execução parta do mesmo estado inicial (FR-030, FR-031), o que um armazenamento durável e compartilhado impediria. O armazenamento em memória também segue suportado nos testes.
- **FR-012**: As capacidades já existentes — listar alertas, abrir incidente, resolver incidente — MUST manter o mesmo comportamento observável sobre o armazenamento durável, incluindo os mesmos erros de domínio nas mesmas situações.
- **FR-013**: O projeto MUST NOT passar a depender de um ORM nem de bibliotecas de terceiros para acesso a dados.

#### Modelo de dados

- **FR-014**: O armazenamento MUST guardar quatro coleções — serviços, alertas, incidentes e runbooks — espelhando os tipos de domínio já definidos no projeto.
- **FR-015**: Um serviço MUST ter identificador, nome e criticidade (tier).
- **FR-016**: Um incidente MUST guardar, além dos campos atuais, o horário de resolução e um resumo, ambos podendo estar ausentes.
- **FR-017**: Um runbook MUST estar associado a exatamente um serviço e MUST guardar seus passos numa ordem definida e estável entre leituras.
- **FR-018**: Todo campo de domínio de conjunto fechado — criticidade de serviço, severidade e status de alerta e de incidente — MUST ser restringido pelo próprio armazenamento, que MUST rejeitar valor fora do conjunto.
- **FR-019**: Alertas, incidentes e runbooks MUST referenciar um serviço existente; a referência MUST ser verificável.
- **FR-020**: Datas MUST ser gravadas e lidas de volta sem perda de precisão nem ambiguidade de fuso.

#### Segurança e integridade das consultas

- **FR-021**: Toda consulta ao armazenamento MUST usar parâmetros ligados; MUST NOT haver consulta montada por concatenação ou interpolação de valores (Constituição, Princípio II).
- **FR-022**: Nenhum conteúdo fornecido pelo modelo ou por quem usa o sistema MUST ser capaz de alterar a estrutura de uma consulta.
- **FR-023**: Dados lidos do armazenamento MUST ser validados contra os esquemas de domínio antes de chegarem às ferramentas.

#### Cenário base (seed)

- **FR-024**: O sistema MUST oferecer um comando de seed que estabelece o cenário base — o mesmo cenário "Mercadinho" já usado hoje: 5 serviços e 6 alertas, sendo 3 disparando e 3 resolvidos.
- **FR-025**: O seed MUST incluir runbooks para os serviços de checkout, pagamentos e autenticação.
- **FR-026**: O seed MUST ser idempotente: executá-lo repetidamente deixa o cenário base no mesmo estado, sem duplicar itens.
- **FR-027**: O seed MUST NOT apagar nem alterar incidentes registrados durante o uso.

#### Novas ferramentas

- **FR-028**: O sistema MUST oferecer uma ferramenta que lista incidentes filtrados por status, aceitando "em aberto", "resolvidos" ou "todos", e MUST usar "em aberto" quando o filtro não for informado.
- **FR-029**: O sistema MUST oferecer uma ferramenta que devolve o runbook de um serviço, com os passos na ordem definida.
- **FR-029a**: A ferramenta de runbook MUST distinguir, na resposta, o caso de serviço existente sem runbook do caso de serviço inexistente.
- **FR-029b**: Consultas que não encontram nada MUST devolver resultado vazio como resposta normal, não como erro.

#### Reprodutibilidade de testes e benchmark

- **FR-030**: O benchmark MUST partir do mesmo estado inicial a cada execução, independentemente de execuções anteriores.
- **FR-031**: Cada estratégia comparada no benchmark MUST operar sobre um estado próprio e isolado.
- **FR-032**: A execução da suíte de testes MUST NOT criar nem alterar arquivos de dados no projeto.
- **FR-033**: A suíte de testes MUST continuar passando sem rede e sem credenciais (Constituição, Princípio V).

#### Descrições das ferramentas

- **FR-034**: Toda ferramenta exposta ao modelo — as três existentes e as duas novas — MUST satisfazer as 6 regras de descrição da constituição (Princípio IV).
- **FR-035**: A ferramenta de abertura de incidente MUST passar a declarar quando usá-la e quando não usá-la, fronteira hoje ausente.
- **FR-036**: Todo campo de todo esquema de ferramenta MUST ter descrição própria, com o valor padrão explicitado quando houver.
- **FR-037**: Todo campo de conjunto fechado MUST ser um enumerado com os valores aceitos explicitados, nunca texto livre.

#### Cobertura de teste

- **FR-038**: O projeto MUST ter testes do armazenamento durável executados sobre um armazenamento efêmero, cobrindo no mínimo: seed idempotente, abrir incidente, listar incidentes com cada filtro, resolver incidente, consultar runbook (com e sem resultado) e rejeição de valor fora de conjunto fechado.
- **FR-039**: Os testes das ferramentas existentes MUST passar a rodar sobre o armazenamento durável efêmero, e não apenas sobre o armazenamento em memória.
- **FR-040**: Os testes MUST cobrir a persistência entre aberturas: o que foi gravado numa conexão é lido de volta por outra sobre o mesmo armazenamento.

### Key Entities

- **Serviço**: um sistema monitorado. Identificador em formato de slug, nome legível e criticidade (tier) de conjunto fechado. É a âncora de alertas, incidentes e runbooks.
- **Alerta**: um sinal de monitoramento sobre um serviço — resumo, severidade, status (disparando ou resolvido) e horário em que disparou.
- **Incidente**: um registro de trabalho aberto por quem está de plantão sobre um serviço — título, severidade, status (aberto ou resolvido), horário de abertura, horário de resolução (ausente enquanto aberto) e resumo (opcional).
- **Runbook**: o procedimento de resposta associado a um serviço — título e passos ordenados. Somente leitura para o agente.
- **Cenário base**: o conjunto conhecido de serviços, alertas e runbooks a partir do qual o sistema começa a vida; reafirmável a qualquer momento sem efeito colateral.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um incidente aberto pelo OpsPilot continua consultável depois de o processo ser reiniciado, em 100% das vezes.
- **SC-002**: Quem clona o repositório coloca o sistema no ar com estado persistente sem instalar nem configurar nenhum serviço de banco de dados, e sem executar nenhum passo de migração.
- **SC-003**: Executar o seed cinco vezes seguidas deixa o cenário base idêntico às cinco vezes — mesma quantidade de serviços, alertas e runbooks — e preserva 100% dos incidentes registrados antes.
- **SC-004**: 100% das tentativas de gravar um valor fora dos conjuntos aceitos (criticidade, severidade, status) são rejeitadas, mesmo quando a validação de aplicação é contornada.
- **SC-005**: Nenhuma consulta ao armazenamento é montada por concatenação de valores — verificável por inspeção de 100% das consultas do projeto.
- **SC-006**: Quem está de plantão obtém a lista de incidentes em aberto e o runbook de um serviço em um único pedido em linguagem natural cada, sem precisar nomear a ferramenta.
- **SC-007**: 100% das ferramentas expostas ao modelo satisfazem as 6 regras de descrição, verificado por auditoria da lista de ferramentas.
- **SC-008**: Duas execuções seguidas do benchmark produzem a mesma verificação de acerto por cenário.
- **SC-009**: A suíte de testes roda por completo sem rede, sem credenciais e sem deixar nenhum arquivo de dados para trás, em menos de 30 segundos.
- **SC-010**: Todo comportamento hoje coberto por testes das ferramentas continua coberto e passando depois da troca de armazenamento.

## Assumptions

- **Restrições prescritas pelo pedido são tratadas como dadas**: armazenamento em SQLite acessado pelo módulo nativo do Node, implementação em `src/store/sqlite-ops-store.ts`, caminho em `OPSPILOT_DB` com padrão `./data/opspilot.db`, armazenamento `":memory:"` nos testes e `data/` no `.gitignore`. Elas são coerentes com o Princípio II da constituição; a spec descreve o comportamento exigido, o plano detalha a forma.
- **A interface citada como `OpsStore` é a `OpsRepository` existente** (`src/store/repository.ts`). A feature implementa a interface que já existe; um eventual renomeio é decisão de planejamento e não altera comportamento observável.
- **`resolvedAt` já existe no domínio** (`Incident.resolvedAt`); a novidade em incidentes é o campo de resumo. Ambos permanecem anuláveis.
- **O campo de resumo do incidente nasce sem produtor**: nenhuma ferramenta atual o preenche. Ele é gravado como ausente, devolvido nas leituras e reservado para uma feature posterior de encerramento com relato. Se a intenção era que `resolve_incident` passasse a aceitar um resumo, isso é escopo adicional e precisa ser dito.
- **A criticidade (tier) de serviço é nova no domínio**. Assume-se o conjunto fechado `tier-1 | tier-2 | tier-3`, com o cenário base atribuindo `tier-1` a checkout, pagamentos e autenticação, `tier-2` a busca e `tier-3` a notificações — coerente com quais serviços têm runbook. Conjunto e atribuição são confirmáveis sem mudar nenhuma outra parte da spec.
- **Os runbooks do cenário base são conteúdo fixo do projeto**, escrito junto com a feature; não há origem externa nem ferramenta de escrita de runbook. O agente só lê.
- **As 6 regras de descrição são as do Princípio IV da constituição**, ratificadas nesta mesma leva de mudanças.
- **A concorrência relevante é a de um único processo** atendendo pedidos HTTP simultâneos. Múltiplos processos sobre o mesmo arquivo não são um cenário de uso previsto nesta fase.
- **Não há migração de dados a fazer**: o estado atual vive apenas em memória e num arquivo de seed versionado. A primeira subida cria o armazenamento e o semeia.
- **O comando de seed continua sendo o mesmo ponto de entrada já existente** (`npm run seed`), agora atuando sobre o armazenamento durável.
- **Autenticação, multi-tenancy e retenção/expurgo de dados estão fora de escopo**, como nas features anteriores.
