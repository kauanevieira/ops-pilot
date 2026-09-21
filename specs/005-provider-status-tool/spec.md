# Feature Specification: Status de provedores externos

**Feature Branch**: `005-provider-status-tool`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Tool de status de provedores externos: Tool check_provider_status em src/agents/tools.ts: consulta a statuspage pública do provedor via API statuspage.io (sem chave): github -> https://www.githubstatus.com/api/v2/status.json, cloudflare -> https://www.cloudflarestatus.com/api/v2/status.json. Parâmetro provider (enum: github | cloudflare, default \"github\", .describe explicando). Descrição orientada a quando usar: suspeita de problema externo, \"é o nosso ou do provedor?\", dependência fora do ar. Resiliência: timeout de 5s via AbortSignal.timeout; falha de rede ou 5xx, UMA nova tentativa; resposta validada com zod ({ status: { indicador, description } }); qualquer falha final retorna string de erro legível como resultado da tool (erro é observação - nunca lançar exceção para fora da tool). Retorno compacto (indicador + descrição, uma linha), para não inflar o contexto. Teste: a função de fetch é injetável; testes cobrem sucesso, timeout e resposta inválida sem uso de rede (fake fetch)"

## User Scenarios & Testing *(mandatory)*

<!--
  As histórias estão ordenadas por valor. A P1 já entrega o produto mínimo:
  quem está de plantão consegue separar problema nosso de problema do
  provedor. As seguintes protegem essa resposta (não travar, não mentir,
  não inflar o contexto) e podem ser entregues depois sem invalidar a P1.
-->

### User Story 1 - "É o nosso ou é do provedor?" (Priority: P1)

Quem está de plantão vê o checkout degradado e não sabe se a causa é do sistema ou de uma dependência externa. Pergunta ao OpsPilot "o GitHub está fora?" ou "isso é nosso ou é da Cloudflare?" e recebe, na mesma conversa, o estado publicado pelo próprio provedor — sem abrir outra aba, sem procurar o endereço da página de status e sem precisar de credencial nenhuma.

**Why this priority**: é a razão de existir da feature. Hoje o OpsPilot enxerga apenas o mundo interno — alertas, incidentes e runbooks — e a primeira pergunta de todo plantão ("o problema é nosso?") não tem resposta dentro da ferramenta. Sem esta história, nenhuma das outras tem sobre o que operar.

**Independent Test**: testável isoladamente pedindo o estado de cada provedor suportado com uma fonte de dados controlada e verificando que a resposta reflete o que o provedor publicou. Entrega valor mesmo que nenhuma resiliência adicional exista.

**Acceptance Scenarios**:

1. **Given** um provedor suportado publicando operação normal, **When** o estado dele é consultado, **Then** a resposta declara que está normal, identificando o provedor consultado.
2. **Given** um provedor suportado publicando degradação ou interrupção, **When** o estado dele é consultado, **Then** a resposta declara o nível da ocorrência e a descrição publicada pelo provedor.
3. **Given** nenhum provedor informado no pedido, **When** o estado é consultado, **Then** o provedor padrão é consultado e a resposta identifica qual foi.
4. **Given** um pedido em linguagem natural sobre suspeita de problema externo, **When** o agente decide o que fazer, **Then** ele consulta o status do provedor em vez de listar alertas ou incidentes internos.
5. **Given** a consulta concluída, **When** o resultado é lido, **Then** ele é suficiente para responder "é nosso ou é deles?" sem exigir uma segunda consulta ao mesmo provedor.

---

### User Story 2 - Provedor fora do ar não derruba o plantão (Priority: P2)

O provedor externo está lento, instável ou fora do ar — exatamente a situação em que alguém pergunta por ele. A conversa com o OpsPilot não trava esperando, não estoura, e o agente recebe uma observação legível dizendo que não foi possível confirmar o estado, podendo seguir com o resto do raciocínio.

**Why this priority**: uma consulta a serviço externo é o primeiro ponto do OpsPilot que depende de algo fora do processo. Se ela puder travar a execução ou abortar o agente, a feature piora o plantão justamente no pior momento. Depende da P1 existir, mas a P1 entrega valor sozinha.

**Independent Test**: testável isoladamente substituindo a fonte de dados por uma que demora demais, uma que falha na rede e uma que responde com erro do lado do provedor, verificando em cada caso que a consulta termina em tempo limitado e devolve uma observação legível em vez de interromper a execução.

**Acceptance Scenarios**:

1. **Given** um provedor que não responde dentro do limite de espera, **When** o estado é consultado, **Then** a consulta é abandonada ao atingir o limite e devolve uma observação legível informando que o estado não pôde ser obtido.
2. **Given** uma falha de rede na primeira tentativa e sucesso na seguinte, **When** o estado é consultado, **Then** a resposta é a do provedor, e a pessoa não vê nenhum erro.
3. **Given** uma falha do lado do provedor na primeira tentativa e sucesso na seguinte, **When** o estado é consultado, **Then** a resposta é a do provedor.
4. **Given** falhas em ambas as tentativas, **When** o estado é consultado, **Then** a resposta é uma observação legível de erro, e a execução do agente continua.
5. **Given** um erro atribuível ao pedido, e não ao provedor, **When** o estado é consultado, **Then** não há nova tentativa e a resposta é uma observação legível de erro.
6. **Given** qualquer falha possível nesta consulta, **When** ela ocorre, **Then** nenhuma exceção escapa da ferramenta para a execução do agente.

---

### User Story 3 - Resposta confiável e curta (Priority: P3)

O que chega ao agente é uma linha: o nível do estado e a descrição publicada. Nada do corpo bruto do provedor — que traz página, componentes, histórico e metadados — entra no contexto, e nada que não tenha a forma esperada é apresentado como se fosse um estado válido.

**Why this priority**: o corpo publicado por uma página de status é muito maior que a informação útil, e cada consulta dessas fica no histórico da conversa até o fim da execução. Além disso, uma resposta inesperada do provedor não pode virar uma afirmação falsa sobre o estado dele. Não bloqueia o caminho feliz, por isso vem depois.

**Independent Test**: testável isoladamente comparando o tamanho do que a ferramenta devolve com o corpo recebido, e fornecendo respostas fora do formato esperado para verificar que são tratadas como falha em vez de virarem estado.

**Acceptance Scenarios**:

1. **Given** uma resposta completa do provedor, **When** ela é convertida em resultado da ferramenta, **Then** o resultado contém apenas o nível do estado e a descrição, em uma única linha.
2. **Given** uma resposta cujo formato não corresponde ao esperado, **When** ela é recebida, **Then** é tratada como falha e devolve observação legível de erro, sem inventar um estado.
3. **Given** uma resposta que não é sequer interpretável como dado estruturado, **When** ela é recebida, **Then** o comportamento é o mesmo do caso anterior.
4. **Given** uma resposta com campos extras além dos esperados, **When** ela é recebida, **Then** os campos extras são descartados e o resultado segue tendo apenas o nível e a descrição.
5. **Given** qualquer resultado da ferramenta — sucesso ou erro, **When** ele é lido, **Then** é texto legível por quem está de plantão, sem exigir interpretação de estrutura.

---

### User Story 4 - O agente escolhe esta ferramenta na hora certa (Priority: P4)

Diante de "o deploy falhou, é o GitHub?", "nosso login parou, será a Cloudflare?" ou "a dependência tá fora?", o agente consulta o status do provedor na primeira tentativa, em vez de listar alertas internos antes; e diante de "como está o plantão?", não consulta provedor externo nenhum.

**Why this priority**: com uma sexta ferramenta — e a primeira que olha para fora — a chance de o modelo confundir sinal interno com sinal externo cresce, e cada escolha errada é uma chamada paga e um passo a mais no rastro. Preserva uma qualidade que o projeto já exige, por isso vem por último, mas não é opcional.

**Independent Test**: testável isoladamente auditando a descrição da ferramenta contra as 6 regras da constituição e verificando que ela declara a fronteira contra as ferramentas de alerta e de incidente.

**Acceptance Scenarios**:

1. **Given** a descrição da ferramenta, **When** ela é auditada, **Then** declara o que faz, quando usar, quando não usar e o que devolve, incluindo o caso de falha.
2. **Given** a ferramenta de status externo e as ferramentas de sinal interno, **When** suas descrições são lidas, **Then** cada uma declara explicitamente a fronteira contra a outra.
3. **Given** o esquema de entrada da ferramenta, **When** ele é inspecionado, **Then** o único campo tem descrição própria, com os valores aceitos e o valor padrão explicitados.
4. **Given** o campo de provedor, **When** ele é inspecionado, **Then** é um enumerado, nunca texto livre.

---

### Edge Cases

- **Provedor lento**: responde, mas depois do limite de espera — a consulta é abandonada no limite, e o tempo total permanece limitado mesmo contando a segunda tentativa.
- **Provedor responde erro do próprio lado**: tratado como falha transitória, com uma nova tentativa antes de desistir.
- **Provedor responde erro atribuível ao pedido** (endereço inválido, recurso ausente): tratado como falha definitiva, sem nova tentativa — repetir não mudaria o resultado.
- **Provedor responde com sucesso mas corpo vazio, truncado ou em formato inesperado**: falha de validação, nunca um estado inventado.
- **Provedor responde com sucesso mas com campos ausentes ou de tipo errado**: mesmo tratamento do caso anterior.
- **Falha na primeira tentativa e sucesso na segunda**: a pessoa vê apenas a resposta bem-sucedida; a tentativa perdida não polui o resultado.
- **Provedor não suportado pedido pelo agente**: recusado na validação de entrada, com observação legível listando os provedores disponíveis, sem nenhuma chamada externa.
- **Ausência de conectividade** no ambiente onde o OpsPilot roda: observação legível de erro; o restante das ferramentas segue funcionando normalmente.
- **Execução da suíte de testes**: nenhuma chamada externa acontece, em nenhum cenário de teste, inclusive nos de falha.

## Requirements *(mandatory)*

### Functional Requirements

#### Capacidade

- **FR-001**: O sistema MUST oferecer ao agente uma ferramenta que devolve o estado operacional publicado por um provedor externo.
- **FR-002**: A ferramenta MUST aceitar um parâmetro de provedor restrito a um conjunto fechado, contendo ao menos `github` e `cloudflare`.
- **FR-003**: O parâmetro de provedor MUST ter valor padrão, aplicado quando o agente não o informa; o padrão é `github`.
- **FR-004**: Um provedor fora do conjunto aceito MUST ser rejeitado antes de qualquer chamada externa, com observação legível que informe os provedores disponíveis.
- **FR-005**: Cada provedor suportado MUST ter uma origem de consulta fixa e versionada no projeto; a origem MUST NOT ser derivada de conteúdo fornecido pelo modelo.
- **FR-006**: A consulta MUST NOT exigir credencial, chave de API ou qualquer segredo, e a feature MUST NOT introduzir nova variável de ambiente obrigatória.
- **FR-007**: A ferramenta MUST ser somente leitura: MUST NOT alterar estado interno do OpsPilot nem enviar dado nenhum ao provedor além do necessário para a consulta.
- **FR-008**: Nenhum dado interno do OpsPilot — incidentes, alertas, serviços, conteúdo de conversa — MUST ser enviado ao provedor externo.

#### Resiliência

- **FR-009**: Toda tentativa de consulta MUST ter limite de espera de 5 segundos, após o qual é abandonada.
- **FR-010**: Uma falha de rede ou uma falha atribuível ao provedor MUST gerar exatamente UMA nova tentativa; MUST NOT haver uma terceira.
- **FR-011**: Uma falha atribuível ao pedido MUST NOT gerar nova tentativa.
- **FR-012**: Uma falha de validação da resposta MUST NOT gerar nova tentativa.
- **FR-013**: O tempo total gasto pela ferramenta MUST ser limitado, mesmo no pior caso de duas tentativas expiradas.
- **FR-014**: Recursos da tentativa abandonada MUST ser liberados; uma resposta que chegue após o abandono MUST NOT ser usada.

#### Erro como observação

- **FR-015**: A ferramenta MUST NOT propagar exceção para fora de si, em nenhuma circunstância (Constituição, "Erros de domínio").
- **FR-016**: Qualquer falha final — espera esgotada, rede, provedor, formato inválido, provedor não suportado — MUST ser devolvida como resultado em texto legível, e a execução do agente MUST continuar.
- **FR-017**: A mensagem de erro MUST permitir distinguir a natureza da falha: espera esgotada, indisponibilidade do provedor ou resposta fora do formato esperado.
- **FR-018**: A mensagem de erro MUST identificar qual provedor foi consultado.
- **FR-019**: A mensagem de erro MUST ser distinguível de um estado válido, de modo que o agente não a interprete como "provedor operando normalmente".
- **FR-020**: Nenhuma mensagem de erro MUST expor detalhe interno sem valor para quem está de plantão (rastro de pilha, estrutura interna do projeto).

#### Validação da resposta

- **FR-021**: A resposta do provedor MUST ser validada contra um esquema antes de ser usada, exigindo ao menos um indicador de nível e uma descrição (Constituição, "Validação").
- **FR-022**: Uma resposta que não satisfaça o esquema MUST ser tratada como falha, nunca convertida em estado parcial ou presumido.
- **FR-023**: Campos presentes na resposta e não previstos no esquema MUST ser descartados.

#### Formato do retorno

- **FR-024**: O resultado de sucesso MUST conter o indicador de nível e a descrição publicada pelo provedor, e MUST identificar o provedor consultado.
- **FR-025**: O resultado MUST caber em uma única linha.
- **FR-026**: O corpo bruto recebido do provedor MUST NOT ser devolvido como resultado da ferramenta.
- **FR-027**: O resultado MUST ser compreensível por quem está de plantão sem conhecimento do formato do provedor.

#### Descrição da ferramenta

- **FR-028**: A ferramenta MUST satisfazer as 6 regras de descrição da constituição (Princípio IV).
- **FR-029**: A descrição MUST declarar como gatilho de uso a suspeita de problema externo — "é o nosso ou do provedor?", dependência fora do ar — na linguagem de quem está de plantão.
- **FR-030**: A descrição MUST declarar a fronteira contra as ferramentas de sinal interno: estado do provedor não é alerta nem incidente do OpsPilot.
- **FR-031**: A descrição MUST declarar o que a ferramenta devolve, incluindo o caso em que o estado não pôde ser obtido.
- **FR-032**: O campo de provedor MUST ter descrição própria, com os valores aceitos e o valor padrão explicitados, e MUST ser um enumerado.

#### Testabilidade

- **FR-033**: O mecanismo de consulta externa MUST ser injetável, de modo que os testes o substituam por um dublê determinístico.
- **FR-034**: A composição real da aplicação MUST usar o mecanismo padrão sem configuração adicional.
- **FR-035**: Os testes MUST NOT realizar nenhuma chamada de rede (Constituição, Princípio V).
- **FR-036**: Os testes MUST cobrir, no mínimo: sucesso, espera esgotada, resposta fora do formato esperado, falha seguida de sucesso na nova tentativa, falha nas duas tentativas, ausência de nova tentativa quando ela não se aplica, provedor padrão aplicado, e provedor não suportado.
- **FR-037**: Os testes MUST verificar o número de tentativas efetivamente realizadas em cada cenário.
- **FR-038**: Os testes de espera esgotada MUST ser determinísticos e MUST NOT depender de aguardar 5 segundos reais.
- **FR-039**: `npm run typecheck` e `npm test` MUST continuar passando sem rede e sem credenciais.

### Key Entities

- **Provedor suportado**: uma dependência externa cujo estado o OpsPilot sabe consultar. Conjunto fechado e versionado no projeto; cada item associa um identificador estável a uma origem de consulta fixa.
- **Estado do provedor**: o que o provedor publica sobre si em um instante — um indicador de nível (de normal a interrupção) e uma descrição legível. Somente leitura, sem persistência.
- **Observação de falha**: o resultado devolvido quando o estado não pôde ser obtido. Texto legível que identifica o provedor e a natureza da falha, e que não pode ser confundido com estado válido.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Quem está de plantão obtém o estado publicado por um provedor suportado em um único pedido em linguagem natural, sem nomear a ferramenta e sem sair da conversa.
- **SC-002**: 100% das falhas possíveis da consulta externa — espera esgotada, rede, erro do provedor, formato inválido, provedor não suportado — chegam ao agente como observação legível, e 0% delas interrompe a execução.
- **SC-003**: Nenhuma consulta ocupa a execução por mais do que o dobro do limite de espera de uma tentativa.
- **SC-004**: Uma falha transitória isolada é absorvida sem que a pessoa perceba, em 100% dos casos em que a nova tentativa tem sucesso.
- **SC-005**: Nenhuma consulta produz mais de duas tentativas, verificável por contagem em 100% dos cenários testados.
- **SC-006**: O resultado da ferramenta cabe em uma linha e é ao menos 10 vezes menor que o corpo recebido do provedor.
- **SC-007**: 0% das respostas fora do formato esperado é apresentado ao agente como estado válido do provedor.
- **SC-008**: A ferramenta satisfaz as 6 regras de descrição, verificado por auditoria.
- **SC-009**: A suíte de testes cobre sucesso, espera esgotada e resposta inválida sem realizar nenhuma chamada de rede, e continua rodando por completo em menos de 30 segundos.
- **SC-010**: Nenhuma configuração nova é exigida de quem clona o repositório para usar a ferramenta.

## Assumptions

- **Restrições prescritas pelo pedido são tratadas como dadas**: ferramenta chamada `check_provider_status` definida em `src/agents/tools.ts`, consulta às páginas de status públicas no padrão statuspage.io (`https://www.githubstatus.com/api/v2/status.json` e `https://www.cloudflarestatus.com/api/v2/status.json`), limite de espera de 5 segundos via `AbortSignal.timeout`, uma nova tentativa, validação com zod e mecanismo de busca injetável. A spec descreve o comportamento exigido; o plano detalha a forma.
- **O campo de indicador citado como `indicador` no pedido é o campo `indicator` do payload statuspage.io** (`{ status: { indicator, description } }`). O nome em português no pedido é descrição do conceito, não do campo recebido; o esquema valida o nome real.
- **Os valores de indicador do padrão statuspage.io são `none`, `minor`, `major` e `critical`**. Assume-se que o esquema os aceita como conjunto conhecido e que qualquer outro valor é tratado como resposta fora do formato esperado. Se a intenção era aceitar qualquer texto no indicador, isso é confirmável sem alterar nenhuma outra parte da spec.
- **"Falha atribuível ao provedor" são as respostas 5xx**; "falha atribuível ao pedido" são as 4xx. Essa é a leitura do "falha de rede ou 5xx" do pedido, e é o que determina quando há nova tentativa (FR-010, FR-011).
- **A nova tentativa é imediata**, sem espera entre tentativas. O pedido não menciona recuo progressivo, e com uma única retentativa ele agregaria latência sem ganho de confiabilidade relevante.
- **O resultado não é persistido nem cacheado**. Cada chamada consulta o provedor; o estado é volátil por natureza, e cache introduziria a possibilidade de responder um estado já desatualizado durante um incidente — exatamente o pior momento.
- **A ferramenta é exposta a todas as estratégias de agente** já existentes, como as demais ferramentas, e entra na mesma composição que hoje injeta o repositório.
- **Nenhuma alteração de domínio ou de persistência é necessária**: a feature não lê nem escreve no armazenamento, e não adiciona entidade ao domínio.
- **A dependência de rede é do runtime, não dos portões**: o Princípio V exige portões offline, e a feature o respeita porque toda a cobertura de teste usa dublê. A chamada real só acontece em uso efetivo.
- **Não há orçamento de chamadas nem limitação de taxa nesta fase**: as páginas de status consultadas são públicas e de leitura livre. Se o uso passar a exigir contenção, é escopo de uma feature posterior.
- **Adicionar novos provedores depois é mudança de dados, não de estrutura**: a spec não fixa o conjunto além do mínimo exigido pela FR-002.
- **Autenticação, multi-tenancy e histórico de status estão fora de escopo**, como nas features anteriores.
