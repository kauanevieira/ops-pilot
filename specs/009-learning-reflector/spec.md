# Feature Specification: Refletor de Aprendizado

**Feature Branch**: `009-learning-reflector`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Refletor de aprendizado: após cada resposta, um withStructuredOutput({ hasLearning, fact }) lê a última mensagem do usuário e destila fatos duráveis (nunca pedido pontual, nunca segredo) -> memories.remember assíncrono; tool forget_preference"

**Clarifications (2026-09-21)**:
- Relação com a 008: o refletor passa a ser o **único** caminho de escrita de memória. A ferramenta `remember_fact` sai do agente, e `forget_fact` é renomeada para `forget_preference`, com o mesmo comportamento (apagar pelo identificador mostrado entre colchetes).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O OpsPilot aprende sem que a pessoa peça (Priority: P1)

Quem está de plantão comenta algo duradouro sobre si no meio de um pedido qualquer — "sou do time de pagamentos, quais alertas estão abertos?" — sem pedir para ninguém lembrar. O OpsPilot responde ao pedido normalmente e, sem atrasar essa resposta, percebe que ali havia um fato durável e o guarda. Numa conversa futura, "quem cobre faturamento?" já leva esse fato em conta.

**Why this priority**: É a razão da feature. Na 008, o agente só guardava um fato quando decidia chamar uma ferramenta no meio do raciocínio, o que depende de a pessoa dizer "lembra que…" ou de o agente se lembrar de lembrar. O refletor tira isso das mãos do agente: toda mensagem de quem tem usuário identificado é examinada uma vez, por um passo dedicado, depois da resposta.

**Independent Test**: Testável enviando um pedido com usuário identificado cuja mensagem contém um fato durável ao lado de um pedido operacional, verificando que a resposta chega sem esperar o aprendizado e que, depois, o fato está guardado para aquele usuário.

**Acceptance Scenarios**:

1. **Given** um pedido bem-sucedido com usuário identificado cuja mensagem contém um fato durável sobre a pessoa, **When** a resposta é entregue, **Then** o fato é destilado e guardado para aquele usuário depois da resposta.
2. **Given** qualquer pedido com usuário identificado, **When** ele é processado, **Then** o tempo até a resposta não inclui o exame da mensagem nem a gravação do fato.
3. **Given** um fato aprendido num pedido, **When** o mesmo usuário faz, em outra conversa, um pedido de sentido próximo, **Then** o fato é recuperado e entregue ao agente, como qualquer memória da 008.
4. **Given** uma mensagem com um fato que já está guardado, dito com outras palavras, **When** o refletor tenta guardá-lo, **Then** nenhum fato duplicado é criado.
5. **Given** o refletor destila um fato, **When** ele é guardado, **Then** o que é guardado é uma frase curta e autocontida sobre a pessoa, não a mensagem inteira copiada.

---

### User Story 2 - Pedido pontual e segredo nunca viram memória (Priority: P2)

A maior parte do que se diz ao OpsPilot é trabalho do momento — "abre um incidente no checkout", "quais alertas estão disparando?" — e às vezes a mensagem carrega algo que nunca deveria ser guardado: uma senha colada por engano, um token de API, uma credencial. Nenhuma dessas coisas pode entrar na memória de longo prazo.

**Why this priority**: Memória que acumula pedidos do dia vira ruído e passa a atrapalhar a recuperação dos fatos úteis. Memória que guarda um segredo vira um vazamento persistente, recuperado e reenviado ao modelo em todo pedido futuro daquela pessoa. Depende do refletor existir (US1), mas é o que o torna seguro de ligar.

**Independent Test**: Testável enviando mensagens só com pedidos operacionais e mensagens contendo credenciais, verificando que nenhuma memória é criada — inclusive quando o passo de destilação, por erro, propõe guardar o segredo.

**Acceptance Scenarios**:

1. **Given** uma mensagem que é só um pedido pontual (consultar, abrir, resolver algo agora), **When** o refletor a examina, **Then** nada é guardado.
2. **Given** uma mensagem que contém uma senha, token, chave de API ou outra credencial, **When** o refletor a examina, **Then** nada é guardado, nem o segredo nem uma paráfrase dele.
3. **Given** o passo de destilação propõe, por erro, um fato que contém algo com forma de credencial, **When** o sistema vai guardá-lo, **Then** uma verificação independente do modelo barra a gravação.
4. **Given** uma mensagem com um fato durável e um pedido pontual juntos, **When** o refletor a examina, **Then** só o fato durável é guardado.
5. **Given** uma mensagem que descreve o estado atual da operação ("o checkout está fora do ar"), **When** o refletor a examina, **Then** nada é guardado — estado operacional muda e já tem fonte própria.

---

### User Story 3 - Esquecer uma preferência (Priority: P3)

A pessoa percebe que algo aprendido está errado ou mudou e pede para o OpsPilot esquecer. O agente apaga o fato com a ferramenta de esquecer, que agora se chama `forget_preference`. A ferramenta de guardar da 008 não existe mais: aprender é trabalho do refletor.

**Why this priority**: Com o aprendizado automático, a pessoa não controla mais o que é guardado no momento em que fala; poder corrigir depois é o contrapeso. O comportamento já existia na 008; o que muda é o nome e o fato de ser a única ferramenta de memória do agente.

**Independent Test**: Testável guardando um fato para um usuário, pedindo para esquecê-lo e verificando que o agente dispõe de `forget_preference` (e não de `remember_fact` nem `forget_fact`) e que o fato deixa de ser recuperado.

**Acceptance Scenarios**:

1. **Given** um pedido com usuário identificado, **When** o agente recebe suas ferramentas, **Then** a única ferramenta de memória disponível é `forget_preference`.
2. **Given** um fato recuperado e entregue ao agente com seu identificador, **When** o agente o esquece com `forget_preference` a pedido da pessoa, **Then** o fato deixa de existir e não é mais recuperado.
3. **Given** a pessoa diz que uma preferência mudou ("não sou mais do time de pagamentos, agora sou de identidade"), **When** o pedido é processado, **Then** o agente pode esquecer o fato antigo, e o refletor, examinando essa mesma mensagem, pode aprender o novo.
4. **Given** um identificador de fato de outro usuário, inexistente ou já esquecido, **When** o agente tenta esquecê-lo, **Then** nada é apagado e o agente é informado de que o fato não foi encontrado.

---

### Edge Cases

- Pedido sem usuário identificado → o refletor não roda; nenhuma chamada extra ao modelo, nenhuma gravação.
- Pedido que falha (corpo inválido, estratégia desconhecida, conversa não encontrada, tempo esgotado, erro inesperado) → o refletor não roda, coerente com a 007: pedido que falha não deixa rastro.
- Pedido que encerra por limite de iterações ou de reflexões → é sucesso; o refletor roda.
- O passo de destilação falha (modelo indisponível, resposta fora do formato, tempo esgotado) → nada é guardado, a falha é registrada no servidor, e a resposta, já entregue, não é afetada.
- O gerador de vetores falha ao guardar → mesma coisa: registrado, nada guardado, resposta não afetada.
- O passo de destilação responde que há aprendizado mas não traz fato, ou traz fato vazio, ou longo demais → nada é guardado.
- Mensagem com dois fatos duráveis → no máximo um é guardado por mensagem (o formato de saída tem um único fato); o outro pode ser aprendido numa próxima menção.
- O agente esquece um fato e o refletor, examinando a mesma mensagem, aprende outro → as duas coisas acontecem; o refletor roda depois da resposta, então nunca "desfaz" um esquecimento feito no mesmo pedido, a menos que a própria mensagem afirme de novo o fato esquecido.
- Mensagem que pede explicitamente "lembra que…" → tratada como qualquer outra: se o conteúdo é durável e seguro, o refletor guarda. O agente não precisa (e não pode mais) guardar por conta própria.
- Pedidos rápidos em sequência do mesmo usuário → cada um é examinado por conta própria; a deduplicação existente evita fatos repetidos.
- Processo encerrado enquanto um exame está em andamento → aquele aprendizado se perde; aceitável, porque a mesma informação tende a reaparecer.
- O refletor examina só a mensagem atual de quem pediu: não a resposta do agente, não o histórico da conversa, não os fatos recuperados. Um fato só é aprendido se a própria pessoa o disse.

## Requirements *(mandatory)*

### Functional Requirements

#### Quando o refletor roda

- **FR-001**: Depois de cada pedido de chat bem-sucedido com usuário identificado, o sistema MUST examinar a mensagem de quem pediu para decidir se ela contém um fato durável sobre a pessoa.
- **FR-002**: O exame MUST acontecer depois que a resposta foi enviada e MUST NOT atrasá-la nem alterar seu conteúdo.
- **FR-003**: O refletor MUST NOT rodar para pedidos sem usuário identificado nem para pedidos que não terminaram com sucesso.
- **FR-004**: O refletor MUST examinar apenas a mensagem atual de quem pediu — nem a resposta do agente, nem o histórico da conversa, nem os fatos recuperados.

#### O que é aprendido

- **FR-005**: O exame MUST produzir uma decisão estruturada com dois campos: se há aprendizado, e o fato destilado.
- **FR-006**: Um fato destilado MUST ser uma frase curta e autocontida sobre a pessoa ou seu jeito de trabalhar, reescrita a partir da mensagem, e MUST respeitar os mesmos limites de tamanho de fato da 008.
- **FR-007**: Pedidos pontuais — consultar, abrir, resolver ou fazer algo agora — MUST NOT ser aprendidos.
- **FR-008**: Descrições de estado operacional atual — alertas, incidentes, disponibilidade de serviços — MUST NOT ser aprendidas.
- **FR-009**: Segredos — senhas, tokens, chaves de API, credenciais de qualquer tipo — MUST NOT ser aprendidos, nem literalmente nem parafraseados.
- **FR-010**: Antes de guardar, o sistema MUST aplicar uma verificação determinística, independente do modelo, que rejeita fatos com forma de credencial. A instrução ao modelo é a primeira barreira; esta é a segunda.
- **FR-011**: No máximo um fato MUST ser guardado por mensagem.
- **FR-012**: Um fato aprendido MUST ser guardado pelo mesmo caminho da 008 — sujeito à mesma deduplicação, ao mesmo usuário e à mesma recuperação.

#### Falhas

- **FR-013**: Qualquer falha no exame ou na gravação MUST ser registrada no servidor e MUST NOT afetar a resposta, outro pedido ou o processo.
- **FR-014**: Uma decisão que diz haver aprendizado mas não traz fato válido MUST ser tratada como "nada a aprender".
- **FR-015**: O exame MUST ter tempo limite próprio, para que um passo travado não segure recursos indefinidamente.

#### Ferramentas do agente

- **FR-016**: Com usuário identificado, a única ferramenta de memória disponível ao agente MUST ser `forget_preference`, com o comportamento de esquecer da 008: apagar pelo identificador, restrito ao usuário do pedido, informando "não encontrado" sem erro de execução.
- **FR-017**: `remember_fact` e `forget_fact` MUST deixar de existir como ferramentas do agente.
- **FR-018**: A descrição de `forget_preference` MUST seguir as 6 regras de ferramentas do projeto e MUST refletir que guardar é automático — a ferramenta não deve sugerir que o agente guarda fatos.
- **FR-019**: As ferramentas de memória continuam MUST NOT ser expostas pelo servidor MCP.

#### Compatibilidade

- **FR-020**: Recuperação de memória, injeção dos fatos no que o agente recebe, métrica de fatos recuperados e isolamento por usuário da 008 MUST continuar como estão.
- **FR-021**: Arena, bench e servidor MCP MUST continuar com o mesmo comportamento observável.

#### Testabilidade

- **FR-022**: O passo de destilação MUST ser substituível, para que testes usem uma versão falsa e determinística, sem chamar modelo.
- **FR-023**: Os testes MUST conseguir aguardar a conclusão do refletor de um pedido de forma determinística, sem depender de espera por tempo.
- **FR-024**: O projeto MUST incluir testes cobrindo no mínimo: fato durável é guardado depois da resposta; resposta não espera o refletor; sem usuário ou pedido que falhou não dispara o refletor; "sem aprendizado" não grava; fato com forma de credencial é barrado mesmo quando o passo de destilação o propõe; falha do passo de destilação e do gerador de vetores não afeta nada; agente recebe só `forget_preference`.
- **FR-025**: A verificação determinística de credenciais MUST ter testes próprios com exemplos positivos e negativos.

### Key Entities

- **Decisão de aprendizado**: o resultado estruturado do exame de uma mensagem — se há aprendizado, e o fato destilado quando há. Existe só durante o exame.
- **Fato aprendido**: uma memória da 008 cuja origem foi o refletor. Não há distinção de origem no armazenamento: todo fato novo vem do refletor.
- **Refletor**: o passo que, depois da resposta, examina a mensagem, aplica a verificação de credenciais e grava. Um por pedido elegível.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um fato durável dito de passagem num pedido é recuperado num pedido futuro de sentido próximo, sem que a pessoa tenha pedido para lembrar.
- **SC-002**: O tempo de resposta de um pedido com usuário identificado não aumenta por causa do refletor.
- **SC-003**: 0 memórias criadas a partir de mensagens que são só pedidos pontuais ou descrições de estado operacional, no conjunto de exemplos dos testes.
- **SC-004**: 0 memórias contendo algo com forma de credencial, mesmo quando o passo de destilação propõe guardá-lo.
- **SC-005**: 0 respostas afetadas por falha do refletor.
- **SC-006**: Com usuário identificado, o agente recebe exatamente uma ferramenta de memória, `forget_preference`.
- **SC-007**: Pedidos sem usuário não fazem nenhuma chamada extra ao modelo.

## Assumptions

- **Nomes e formas dados pelo pedido**: a decisão é obtida com `withStructuredOutput` sobre um esquema `{ hasLearning, fact }`, usando a mesma fábrica de modelo do resto do sistema; a gravação usa `MemoryStore.remember` da 008, de forma assíncrona; a ferramenta chama-se `forget_preference`.
- **Custo**: uma chamada extra ao modelo por pedido bem-sucedido com usuário identificado. Essa chamada **não entra** em `metrics.llmCalls` da resposta, porque acontece depois dela.
- **Verificação de credenciais**: por padrões (prefixos conhecidos de tokens, pares "senha/token/chave" seguidos de valor, sequências longas de alta entropia). Não pretende ser completa; é a segunda barreira, atrás da instrução ao modelo, e erra para o lado de não guardar.
- **Tempo limite do refletor**: 30 segundos, independente dos 180 s do pedido.
- **Sem métrica na resposta**: o resultado do refletor não aparece na resposta, que já foi enviada. Fica registrado no servidor.
- **Mensagem examinada**: a `message` crua do corpo do pedido, a mesma gravada na conversa (007) e usada na recuperação (008).
- **Emenda à 008**: FR-027 da 008 (ferramentas de guardar e esquecer) é substituído pelo FR-016/FR-017 desta spec; o contrato de ferramentas de memória da 008 ganha aviso apontando para cá.
