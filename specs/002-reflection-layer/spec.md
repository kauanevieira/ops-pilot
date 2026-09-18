# Feature Specification: Camada de Reflexão

**Feature Branch**: `002-reflection-layer`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Camada Reflection: withReflection(strategy, opts) decora qualquer ReasoningStrategy: executa a base; um crítico (mesmo modelo, saída estruturada { approved, feedback }) avalia a resposta contra as observações do trace; se reprovar, regenera com o feedback no contexto; para em approved ou maxReflections (default 2). Evento \"critique\" no trace; métricas somam as chamadas extras. Arena: reflect:react e reflect:plan-and-execute"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Respostas revisadas antes de chegarem ao plantão (Priority: P1)

Uma pessoa de plantão faz um pedido e recebe uma resposta que já passou por uma revisão automática: antes de ser entregue, a resposta foi confrontada com o que as ferramentas realmente observaram durante a execução. Se a revisão apontar que a resposta contradiz as observações, está incompleta em relação ao que foi pedido, ou afirma algo que nenhuma observação sustenta, o agente tenta de novo levando essa crítica em consideração — até ser aprovado ou até esgotar o número de tentativas permitido.

**Why this priority**: É o valor central da feature. A reflexão existe para reduzir respostas que soam plausíveis mas não correspondem ao estado operacional observado — o tipo de erro mais caro em plantão, porque a pessoa age em cima dele. Sem esse ciclo, nada mais na feature entrega valor.

**Independent Test**: Executável isoladamente com o estado semeado: envia-se um pedido cuja primeira resposta é reprovável, e verifica-se que houve uma segunda tentativa e que a resposta final entregue é a da tentativa mais recente. Entrega valor mesmo sem nenhuma inspeção de rastro ou comparação de estratégias.

**Acceptance Scenarios**:

1. **Given** uma estratégia de raciocínio qualquer já existente, **When** ela é decorada com a camada de reflexão e recebe um pedido, **Then** o resultado devolvido tem a mesma forma de qualquer outra estratégia (resposta final, rastro, métricas, motivo de encerramento) e pode ser usado nos mesmos lugares.
2. **Given** um pedido cuja primeira resposta é considerada adequada pela revisão, **When** a execução roda, **Then** nenhuma regeneração acontece e a resposta da primeira tentativa é a entregue.
3. **Given** um pedido cuja primeira resposta é reprovada pela revisão, **When** a execução roda, **Then** uma nova tentativa é feita com a crítica disponível como contexto, e a resposta entregue é a da nova tentativa.
4. **Given** um pedido cujas respostas são reprovadas repetidamente, **When** o número máximo de reflexões é atingido, **Then** a execução encerra de forma controlada, entrega a última resposta produzida e sinaliza que o encerramento foi por limite de reflexões sem aprovação.
5. **Given** nenhuma configuração explícita de limite, **When** a camada de reflexão é aplicada, **Then** vale o limite padrão de 2 reflexões.

---

### User Story 2 - Auditar a crítica e o custo da reflexão (Priority: P2)

Quem revisa o que o agente fez — seja a pessoa que assume o turno seguinte, seja quem desenvolve o OpsPilot — consegue ver no rastro exatamente o que a revisão julgou e por quê, em que ponto da execução isso aconteceu, e quanto a reflexão custou em chamadas de modelo em relação à estratégia crua.

**Why this priority**: Sem visibilidade, a reflexão vira uma caixa-preta que encarece a execução sem explicar o que mudou. É essencial para confiar na camada e para decidir se ela compensa, mas o ciclo de reflexão da P1 já entrega valor sozinho.

**Independent Test**: Executável isoladamente rodando um pedido que provoca ao menos uma reprovação e verificando que o rastro contém os eventos de crítica com o parecer registrado e que as métricas reportadas são maiores que as da mesma estratégia sem reflexão.

**Acceptance Scenarios**:

1. **Given** uma execução com reflexão, **When** a revisão avalia uma resposta, **Then** o rastro registra um evento de crítica contendo o parecer (aprovado ou não) e a justificativa usada.
2. **Given** uma execução com duas reflexões, **When** a execução termina, **Then** o rastro preserva, em ordem, tudo o que cada tentativa produziu, com o evento de crítica posicionado logo após a resposta que ele avaliou.
3. **Given** uma execução com reflexão, **When** as métricas são reportadas, **Then** a contagem de chamadas ao modelo inclui as chamadas de todas as tentativas da estratégia base mais as chamadas da revisão.
4. **Given** a mesma estratégia rodada com e sem reflexão, **When** ambas as métricas são comparadas, **Then** a versão com reflexão que fez ao menos uma revisão reporta contagem de chamadas estritamente maior.

---

### User Story 3 - Comparar, na arena, com e sem reflexão (Priority: P3)

Quem desenvolve o OpsPilot roda na arena, sobre o mesmo pedido, uma estratégia crua e a sua versão refletida, e compara lado a lado a qualidade da resposta, o rastro e o custo — para decidir quando a reflexão vale o gasto extra.

**Why this priority**: Ferramenta de avaliação para quem constrói o produto, não para quem está de plantão. Depende da reflexão existir e não entrega valor ao usuário final sozinha.

**Independent Test**: Executável isoladamente invocando a arena com as versões refletidas nomeadas e verificando que cada uma produziu seu próprio rastro e bloco de métricas identificados pelo nome.

**Acceptance Scenarios**:

1. **Given** a arena disponível, **When** a pessoa lista as estratégias válidas, **Then** as versões refletidas das estratégias existentes aparecem como nomes selecionáveis, derivados do nome da estratégia base.
2. **Given** um pedido e as quatro estratégias (duas cruas e duas refletidas), **When** a arena roda, **Then** cada uma apresenta seu rastro completo e suas métricas identificados pelo seu nome.
3. **Given** um limite de iterações informado na invocação da arena, **When** uma estratégia refletida roda, **Then** a estratégia base honra esse limite em cada tentativa.

---

### Edge Cases

- Limite de reflexões configurado como zero: nenhuma revisão acontece e o resultado é idêntico ao da estratégia base, sem eventos de crítica e sem chamadas extras ao modelo.
- A revisão devolve algo que não corresponde ao formato esperado, ou a chamada de revisão falha: a falha não derruba a execução — a resposta corrente é entregue, o ciclo de reflexão encerra, e o rastro registra que a revisão não pôde ser concluída.
- A tentativa da estratégia base encerra por limite de iterações ou de passos, sem resposta conclusiva: a revisão avalia mesmo assim a resposta parcial produzida, e o motivo de encerramento da tentativa entregue continua visível no resultado.
- Regenerar produz uma resposta pior que a anterior: a resposta entregue é sempre a da última tentativa, e o rastro preserva as anteriores para que a regressão seja auditável.
- Uma estratégia já refletida é decorada novamente: o comportamento é o de aninhamento simples — a camada externa revisa o resultado final da interna —, mas isso não é oferecido na arena.
- O rastro da tentativa não contém nenhuma observação de ferramenta (o agente respondeu sem consultar nada): a revisão avalia a resposta contra um conjunto vazio de evidências e deve tratar afirmações não sustentadas como motivo de reprovação.
- Credenciais do provedor de modelo ausentes: a falha ocorre na estratégia base, antes de qualquer revisão, com a mesma mensagem explícita já existente.

## Requirements *(mandatory)*

### Functional Requirements

**Decoração de estratégias**

- **FR-001**: A camada de reflexão MUST ser aplicável a qualquer estratégia que cumpra o contrato comum de raciocínio, sem que a estratégia base precise ser alterada ou saber que está sendo decorada.
- **FR-002**: O resultado de uma estratégia decorada MUST cumprir o mesmo contrato de qualquer estratégia: nome identificador, resposta final, rastro, métricas e motivo de encerramento.
- **FR-003**: A estratégia decorada MUST ter nome derivado do nome da estratégia base, de forma que a base seja identificável a partir dele.
- **FR-004**: A camada MUST aceitar uma configuração opcional com o número máximo de reflexões, cujo padrão é 2.
- **FR-005**: As opções de execução recebidas pela estratégia decorada (como o limite de iterações) MUST ser repassadas à estratégia base em cada tentativa, valendo integralmente por tentativa.

**Ciclo de crítica e regeneração**

- **FR-006**: A camada MUST executar a estratégia base e, sobre a resposta produzida, acionar uma revisão antes de entregar o resultado.
- **FR-007**: A revisão MUST usar o mesmo modelo configurado para o restante do sistema, sem configuração de modelo própria.
- **FR-008**: A revisão MUST receber, no mínimo, o pedido original, a resposta avaliada e as observações registradas no rastro daquela tentativa.
- **FR-009**: A revisão MUST produzir um parecer estruturado com dois campos: um indicador booleano de aprovação e um texto de justificativa/feedback.
- **FR-010**: A revisão MUST avaliar se a resposta é sustentada pelas observações registradas, se contradiz alguma delas e se atende ao que foi pedido; respostas que afirmem fatos operacionais sem observação que os sustente MUST ser reprovadas.
- **FR-011**: Quando o parecer for de aprovação, a execução MUST encerrar imediatamente e entregar a resposta aprovada, sem novas tentativas.
- **FR-012**: Quando o parecer for de reprovação e ainda houver reflexões disponíveis, a camada MUST executar a estratégia base novamente com o feedback da revisão disponível no contexto do pedido.
- **FR-013**: O ciclo MUST encerrar na primeira aprovação ou ao atingir o número máximo de reflexões, o que ocorrer primeiro.
- **FR-014**: O número máximo de reflexões MUST limitar as regenerações, não as execuções: com limite N, a estratégia base é executada no máximo N+1 vezes.
- **FR-015**: Quando o limite de reflexões for atingido sem aprovação, a camada MUST entregar a resposta da última tentativa e sinalizar, no motivo de encerramento, que o fim se deu por limite de reflexões sem aprovação.
- **FR-016**: Com o limite de reflexões igual a zero, a camada MUST devolver o resultado da estratégia base sem acionar nenhuma revisão.
- **FR-017**: Se a revisão falhar ou devolver um parecer que não corresponda ao formato esperado, a camada MUST encerrar o ciclo entregando a resposta corrente, sem propagar a falha como erro da execução.

**Rastro**

- **FR-018**: Cada avaliação concluída MUST gerar um evento de crítica no rastro, contendo o parecer e a justificativa.
- **FR-019**: O rastro da execução decorada MUST conter, em ordem cronológica, os eventos de todas as tentativas da estratégia base, com o evento de crítica imediatamente após a resposta que avaliou.
- **FR-020**: Quando a revisão não puder ser concluída (FR-017), o rastro MUST registrar essa ocorrência de forma distinguível de uma reprovação.
- **FR-021**: O rastro MUST permitir identificar a qual tentativa cada trecho pertence.

**Métricas**

- **FR-022**: A contagem de chamadas ao modelo MUST somar as chamadas de todas as tentativas da estratégia base e todas as chamadas de revisão.
- **FR-023**: A latência reportada MUST cobrir a execução decorada inteira, do início da primeira tentativa ao fim da última revisão.

**Arena**

- **FR-024**: A arena MUST oferecer as versões refletidas das estratégias existentes como nomes selecionáveis: a versão refletida da estratégia reativa e a da estratégia de planejar-e-executar.
- **FR-025**: Os nomes inválidos informados à arena MUST continuar falhando com mensagem clara, e a lista de nomes válidos apresentada MUST incluir as versões refletidas.
- **FR-026**: As versões refletidas MUST ser executáveis na arena junto com as cruas, na mesma invocação e sobre o mesmo pedido.

### Key Entities

- **Parecer de revisão**: julgamento produzido sobre uma resposta; tem um indicador de aprovação e uma justificativa textual. É o que alimenta a regeneração e o que fica registrado no rastro.
- **Tentativa**: uma execução completa da estratégia base dentro do ciclo de reflexão; produz sua própria resposta, seu próprio trecho de rastro e suas próprias chamadas de modelo, todas incorporadas ao resultado final.
- **Configuração de reflexão**: parâmetros da camada; no escopo atual, o número máximo de reflexões.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Qualquer estratégia existente pode ser envolvida pela camada de reflexão sem nenhuma alteração no seu próprio código.
- **SC-002**: Em um pedido cuja primeira resposta contradiz as observações do rastro, a resposta entregue ao final é diferente da primeira e deixa de conter a contradição, em execução reprodutível.
- **SC-003**: O número de execuções da estratégia base nunca ultrapassa o limite de reflexões mais um, em 100% das execuções.
- **SC-004**: Para toda execução em que houve ao menos uma revisão, a contagem de chamadas ao modelo é estritamente maior que a da mesma estratégia sem reflexão sobre o mesmo pedido.
- **SC-005**: Toda avaliação concluída aparece no rastro como exatamente um evento de crítica com justificativa não vazia.
- **SC-006**: Uma falha da revisão nunca faz a execução terminar em erro: 100% das execuções com revisão falha entregam a resposta corrente.
- **SC-007**: A arena roda as quatro estratégias (duas cruas e duas refletidas) sobre o mesmo pedido em uma única invocação e apresenta rastro e métricas separados para cada uma.

## Assumptions

- A regeneração re-executa a estratégia base completa — não é apenas uma reescrita da resposta final sobre o rastro anterior —, e recebe no contexto o feedback da revisão, a resposta reprovada e o registro das ações já executadas, com a instrução de não repetir ações que já tiveram efeito. A mitigação de duplicação é por contexto, não por garantia do domínio: tornar a abertura de incidente idempotente fica fora do escopo desta feature. (Decidido em [research.md](./research.md) R-002.)
- Cada tentativa recebe o orçamento de iterações/passos integral: o limite não é dividido entre tentativas.
- A revisão consome uma chamada de modelo por avaliação e não usa ferramentas — julga apenas com o que está no rastro.
- O parecer de reprovação sempre traz justificativa; um parecer de aprovação pode trazer justificativa vazia, e isso não é erro.
- O motivo de encerramento entregue é o da última tentativa, exceto quando o ciclo termina por limite de reflexões sem aprovação, caso em que prevalece esse motivo.
- A camada não é exposta como estratégia autônoma na arena: só aparecem os pares base+reflexão previstos em FR-024.
- O estado operacional e as ferramentas permanecem os já existentes; esta feature não introduz ferramentas nem altera o domínio.
