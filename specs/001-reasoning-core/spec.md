# Feature Specification: Núcleo de Raciocínio do OpsPilot

**Feature Branch**: `001-reasoning-core`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "Núcleo de raciocínio do OpsPilot: interface comum ReasoningStrategy (name + run(input) -> answer, trace, metrics); trace = eventos tipados (thought | action | observation | plan | critique | answer, com action carregando tool e args); metrics = (llmCalls, latencyMs). Fábrica única de modelo lendo OPENROUTER_API_KEY e OPENROUTER_MODEL com temperature 0. Ferramentas mock sobre store pré-populado (5 serviços, 6 alertas: 3 firing, 3 resolved, com script de seed): list_alerts(status), open_incident(title, service, severity), resolve_incident(id). Estratégia ReAct e estratégia Plan-and-Execute (planner, executor um passo por vez, replanner, máximo 8 passos). Toda estratégia respeita limite de iterações e conta chamadas de LLM. Arena mínima que roda 1+ estratégias sobre o mesmo input e imprime traces e métricas (flags --strategies e --max-iterations). Testes de store e formatação de trace, determinísticos e sem rede."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resolver um pedido de plantão com raciocínio auditável (Priority: P1)

Uma pessoa de plantão descreve em linguagem natural o que precisa ("quais alertas estão disparando e abra incidente para os críticos"). O OpsPilot raciocina sobre o pedido, consulta e altera o estado operacional através das ferramentas disponíveis, e devolve uma resposta final acompanhada do registro completo de como chegou nela: cada pensamento, cada ferramenta acionada com seus argumentos, cada resultado observado.

**Why this priority**: É o valor central do produto. Sem uma estratégia de raciocínio capaz de operar as ferramentas e prestar contas do caminho percorrido, não existe copiloto de plantão — apenas um chat. O rastro auditável é requisito de plantão: quem assume o turno precisa saber o que o agente fez e por quê.

**Independent Test**: Executável isoladamente com o estado semeado: envia-se um pedido, e verifica-se que houve resposta final, que o rastro contém a sequência de pensamentos/ações/observações, e que as métricas de execução foram reportadas. Entrega valor mesmo sem nenhuma outra estratégia existir.

**Acceptance Scenarios**:

1. **Given** o estado operacional semeado com 6 alertas (3 disparando, 3 resolvidos), **When** a pessoa pede a lista de alertas disparando, **Then** o sistema devolve os 3 alertas disparando e um rastro que inclui a ação de consulta com seus argumentos e a observação retornada.
2. **Given** um alerta disparando em um serviço conhecido, **When** a pessoa pede a abertura de um incidente para esse alerta, **Then** o incidente é criado com título, serviço e severidade, e o rastro registra a ação de abertura com os argumentos usados.
3. **Given** um incidente aberto, **When** a pessoa pede para resolvê-lo informando o identificador, **Then** o incidente passa a resolvido e o rastro contém a ação e a observação correspondentes.
4. **Given** qualquer pedido concluído, **When** a execução termina, **Then** o resultado reporta quantas chamadas ao modelo foram feitas e quanto tempo a execução levou.

---

### User Story 2 - Planejar antes de agir em pedidos multi-etapa (Priority: P2)

Para pedidos que envolvem várias etapas encadeadas ("levante os alertas disparando, abra incidente para cada serviço afetado e me diga o que sobrou"), a pessoa de plantão pode usar uma estratégia que primeiro monta um plano explícito de passos, executa um passo por vez, e revisa o que resta após cada passo — encerrando quando não há mais nada a fazer.

**Why this priority**: Amplia a cobertura para pedidos que a abordagem reativa resolve mal ou de forma errática, e torna a intenção do agente inspecionável antes da ação. É valiosa, mas o produto já é utilizável só com a estratégia P1.

**Independent Test**: Executável isoladamente enviando um pedido multi-etapa e verificando que o rastro contém um plano explícito, execuções individuais de passos, e revisões de plano entre eles, terminando quando o plano se esgota.

**Acceptance Scenarios**:

1. **Given** um pedido que exige múltiplas etapas, **When** a estratégia inicia, **Then** o rastro registra um plano com a lista de passos antes de qualquer ação de ferramenta.
2. **Given** um plano com passos pendentes, **When** um passo é executado, **Then** apenas aquele passo é executado e o rastro registra sua revisão do que resta antes de seguir.
3. **Given** um plano cujos passos foram todos concluídos, **When** a revisão não encontra nada pendente, **Then** a execução encerra e produz a resposta final.
4. **Given** um pedido que geraria mais de 8 passos, **When** o limite de 8 passos é atingido, **Then** a execução encerra de forma controlada, informando que o limite foi atingido, com o rastro parcial preservado.

---

### User Story 3 - Comparar estratégias sobre o mesmo pedido (Priority: P3)

Quem desenvolve o OpsPilot roda o mesmo pedido através de uma ou mais estratégias em uma única invocação e vê, lado a lado, o rastro completo e as métricas de cada uma — para decidir qual estratégia usar em qual situação.

**Why this priority**: Ferramenta de avaliação para quem constrói o produto, não para quem está de plantão. Depende das estratégias existirem e não entrega valor ao usuário final sozinha.

**Independent Test**: Executável isoladamente informando um pedido e a lista de estratégias; verifica-se que cada estratégia nomeada produziu seu próprio rastro e bloco de métricas na saída.

**Acceptance Scenarios**:

1. **Given** duas estratégias disponíveis, **When** a pessoa roda a arena com ambas sobre o mesmo pedido, **Then** a saída apresenta, para cada estratégia, seu rastro completo e suas métricas identificados pelo nome da estratégia.
2. **Given** uma única estratégia informada, **When** a arena roda, **Then** a execução funciona normalmente com apenas aquela estratégia.
3. **Given** um limite de iterações informado na invocação, **When** as estratégias rodam, **Then** todas respeitam o limite informado em vez do padrão.
4. **Given** um nome de estratégia inexistente, **When** a arena roda, **Then** a execução falha com mensagem clara indicando o nome inválido e quais são os nomes válidos.

---

### Edge Cases

- O limite de iterações é atingido antes de uma resposta final ser produzida: a execução encerra de forma controlada, sinaliza o encerramento por limite e preserva o rastro parcial acumulado.
- O planejador devolve um plano vazio: a execução encerra imediatamente com resposta final, sem executar nenhuma ação.
- O revisor de plano continua acrescentando passos indefinidamente: o teto de 8 passos interrompe o ciclo.
- Uma ferramenta é acionada com argumentos inválidos (serviço inexistente, severidade fora do conjunto aceito, status desconhecido): a validação rejeita a chamada e o erro é devolvido ao agente como observação, permitindo que ele se corrija sem abortar a execução.
- Pedido de resolução de um incidente inexistente ou já resolvido: erro de domínio, tratado e devolvido como observação.
- Credenciais do provedor de modelo ausentes: a execução falha imediatamente com mensagem explícita sobre qual configuração falta, antes de qualquer tentativa de raciocínio.
- Uma ferramenta falha no meio de um plano em andamento: o passo é marcado como falho, a revisão de plano decide como prosseguir, e o rastro preserva o erro.

## Requirements *(mandatory)*

### Functional Requirements

**Contrato comum de estratégia**

- **FR-001**: Toda estratégia de raciocínio MUST expor um nome identificador e uma operação única de execução que recebe o pedido do usuário e devolve três coisas: a resposta final, o rastro e as métricas.
- **FR-002**: O rastro MUST ser uma sequência ordenada de eventos tipados, restritos ao conjunto: pensamento, ação, observação, plano, crítica e resposta.
- **FR-003**: Todo evento do tipo ação MUST carregar a ferramenta acionada e os argumentos passados a ela.
- **FR-004**: As métricas MUST reportar, no mínimo, o número de chamadas ao modelo de linguagem e a duração total da execução em milissegundos.
- **FR-005**: Toda estratégia MUST respeitar um limite máximo de iterações, configurável por execução, e MUST encerrar de forma controlada ao atingi-lo, sinalizando no resultado que o encerramento se deu por limite.
- **FR-006**: Toda estratégia MUST contabilizar cada chamada ao modelo de linguagem, e essa contagem MUST refletir as chamadas efetivamente realizadas na execução.

**Acesso ao modelo**

- **FR-007**: O sistema MUST concentrar a criação do cliente do modelo de linguagem em um único ponto, usado por todas as estratégias.
- **FR-008**: Esse ponto único MUST obter a credencial de acesso e o identificador do modelo a partir da configuração de ambiente (`OPENROUTER_API_KEY` e `OPENROUTER_MODEL`), apontando para o provedor OpenRouter.
- **FR-009**: O modelo MUST ser configurado com temperatura zero, para maximizar a reprodutibilidade das execuções.
- **FR-010**: Na ausência de qualquer configuração obrigatória, o sistema MUST falhar com mensagem explícita nomeando a configuração ausente.

**Ferramentas operacionais**

- **FR-011**: O sistema MUST oferecer às estratégias uma ferramenta de listagem de alertas filtrada por status.
- **FR-012**: O sistema MUST oferecer uma ferramenta de abertura de incidente que recebe título, serviço e severidade.
- **FR-013**: O sistema MUST oferecer uma ferramenta de resolução de incidente que recebe o identificador do incidente.
- **FR-014**: Toda entrada e toda saída de ferramenta MUST ser validada contra um esquema declarado, e entradas inválidas MUST ser rejeitadas com erro descritivo antes de qualquer efeito sobre o estado.
- **FR-015**: Erros de domínio (serviço inexistente, incidente inexistente, transição de estado inválida) MUST ser distinguíveis de falhas técnicas e MUST ser devolvidos à estratégia como observação, sem abortar a execução.

**Estado operacional e carga inicial**

- **FR-016**: O sistema MUST manter o estado operacional de serviços, alertas e incidentes em um repositório residente em memória no processo, sem I/O externo, durante toda esta feature.
- **FR-017**: O acesso ao estado MUST se dar exclusivamente através de uma interface de repositório declarada, de modo que a troca futura por um armazenamento durável não exija alteração nas ferramentas nem nas estratégias.
- **FR-018**: As transições de estado MUST ser expressas como transformações puras — dado um estado e uma operação, produz-se um novo estado —, sem efeitos colaterais ocultos.
- **FR-019**: O sistema MUST oferecer um comando autônomo de carga inicial que leva o estado à linha de base conhecida.
- **FR-020**: A linha de base MUST conter exatamente 5 serviços e 6 alertas, sendo 3 com status disparando e 3 com status resolvido, cobrindo severidades variadas.
- **FR-021**: A carga inicial MUST ser idempotente: executá-la repetidamente MUST produzir sempre o mesmo estado final, sem duplicar registros.

**Estratégia reativa (ReAct)**

- **FR-022**: O sistema MUST oferecer uma estratégia que alterna raciocínio e ação, decidindo a cada iteração se aciona uma ferramenta ou produz a resposta final.
- **FR-023**: Essa estratégia MUST capturar no rastro todos os pensamentos, ações e observações da execução, sem omitir etapas intermediárias.

**Estratégia com planejamento (Plan-and-Execute)**

- **FR-024**: O sistema MUST oferecer uma estratégia que produz, antes de agir, um plano explícito composto por uma lista ordenada de passos.
- **FR-025**: Essa estratégia MUST executar exatamente um passo por vez, com acesso às mesmas ferramentas.
- **FR-026**: Após cada passo executado, a estratégia MUST revisar os passos restantes, podendo alterá-los à luz do que foi observado.
- **FR-027**: A estratégia MUST encerrar quando a revisão não encontrar passos pendentes, produzindo a resposta final.
- **FR-028**: A estratégia MUST executar no máximo 8 passos por pedido, encerrando de forma controlada ao atingir esse teto.
- **FR-029**: O rastro MUST registrar o plano inicial e cada revisão de plano como eventos distintos, além dos pensamentos, ações e observações.

**Arena de comparação**

- **FR-030**: O sistema MUST oferecer um comando que executa uma ou mais estratégias sobre o mesmo pedido em uma única invocação.
- **FR-031**: O comando MUST imprimir, para cada estratégia executada, seu rastro completo e suas métricas, identificados pelo nome da estratégia.
- **FR-032**: O comando MUST aceitar a seleção das estratégias a executar e o limite de iterações a aplicar, via argumentos de invocação (`--strategies` e `--max-iterations`).
- **FR-033**: Nomes de estratégia desconhecidos MUST produzir erro claro listando os nomes válidos, sem executar nenhuma estratégia.

**Qualidade e verificação**

- **FR-034**: O sistema MUST possuir testes automatizados cobrindo o comportamento do repositório de estado e a formatação do rastro.
- **FR-035**: Esses testes MUST ser determinísticos e MUST executar sem qualquer acesso de rede, sem depender de credenciais e sem chamar o modelo de linguagem.

### Key Entities

- **Serviço**: unidade operacional monitorada. Possui identificador e nome. É o alvo ao qual alertas e incidentes se referem.
- **Alerta**: sinal emitido sobre um serviço. Possui identificador, serviço de origem, severidade, status (disparando ou resolvido) e momento de emissão.
- **Incidente**: registro de trabalho aberto em resposta a uma situação. Possui identificador, título, serviço afetado, severidade, status (aberto ou resolvido) e momentos de abertura e resolução.
- **Evento de rastro**: passo individual do raciocínio. Possui um tipo dentre pensamento, ação, observação, plano, crítica e resposta, e um conteúdo cuja forma depende do tipo — eventos de ação carregam a ferramenta acionada e seus argumentos.
- **Métricas de execução**: resumo quantitativo de uma execução. Inclui número de chamadas ao modelo e duração total.
- **Resultado de execução**: agregado devolvido por uma estratégia, reunindo resposta final, rastro e métricas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A partir do estado de linha de base, uma pessoa de plantão obtém resposta e rastro completo para um pedido operacional em uma única invocação de comando, sem nenhum passo manual adicional.
- **SC-002**: 100% das execuções concluídas reportam número de chamadas ao modelo e duração, sem exceção.
- **SC-003**: 100% das execuções respeitam o limite de iterações configurado; nenhuma execução com planejamento ultrapassa 8 passos.
- **SC-004**: Toda ação registrada no rastro identifica a ferramenta acionada e os argumentos usados, permitindo reconstruir a sequência de mudanças de estado sem consultar o código.
- **SC-005**: Uma única invocação da arena compara duas estratégias sobre o mesmo pedido e apresenta rastro e métricas de ambas em uma saída.
- **SC-006**: A suíte de testes roda sem rede e sem credenciais, e execuções repetidas produzem resultados idênticos em 100% das vezes.
- **SC-007**: Um ambiente recém-preparado atinge a linha de base (5 serviços, 6 alertas, 3 disparando e 3 resolvidos) com um único comando, e repetir o comando mantém exatamente esse estado.
- **SC-009**: Trocar o mecanismo de armazenamento por um durável não exige nenhuma alteração no código das ferramentas nem das estratégias — apenas uma nova implementação da interface de repositório.
- **SC-008**: Entradas inválidas de ferramenta são rejeitadas em 100% dos casos antes de alterar qualquer estado.

## Assumptions

- Os usuários desta feature são pessoas de plantão e quem desenvolve o OpsPilot, operando por linha de comando; não há interface gráfica no escopo.
- As ferramentas operam sobre dados simulados: não há integração com sistemas reais de alerta, paginação ou ticketing nesta feature.
- O estado é mantido em memória e não sobrevive ao término do processo. A persistência durável (MySQL) é escopo de uma feature seguinte, que entrará por trás da interface de repositório definida aqui (FR-017) sem alterar ferramentas ou estratégias. Por consequência, a carga inicial roda a cada processo que precise da linha de base.
- A severidade de alertas e incidentes usa um conjunto fechado de valores (por exemplo crítica, alta, média, baixa), definido na implementação.
- O status de alerta usa o conjunto fechado disparando/resolvido; o status de incidente usa aberto/resolvido.
- A configuração sensível vem do ambiente do processo; o agente de desenvolvimento nunca lê o arquivo de variáveis de ambiente diretamente, conforme as convenções do projeto.
- A temperatura zero é adotada para reprodutibilidade, aceitando-se que ainda pode haver variação residual do provedor.
- A execução é monoprocesso e de usuário único; não há requisitos de concorrência ou isolamento multiusuário nesta feature.
- A arena é ferramenta de desenvolvimento, sem requisitos de formato de saída legível por máquina nesta versão.
- O limite padrão de iterações, quando não informado, é definido na implementação e documentado.
- Não há requisito de persistir rastros entre execuções nesta feature; eles são produzidos e exibidos na própria invocação.
