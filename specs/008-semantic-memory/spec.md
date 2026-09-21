# Feature Specification: Memória Semântica

**Feature Branch**: `008-semantic-memory`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Memória semântica: MemoryStore por userId - remember (dedup > 0.92), recall top-3 por produto escalar (min 0.3), forget; tabela memories, embedding all-MiniLM-L6-v2 local em BLOB; /chat ganha userId e injeta o recall no prompt; teste: recall acha fato sem palavra em comum. @huggingface/transformers com pooling: mean + normalize: true e lazy singleton; src/memory/embeddings.ts e src/memory/memory-store.ts. Colunas de memories: id, user_id, fact, embedding, created_at"

**Clarifications (2026-09-21)**:
- Quem escreve memórias: **o agente**, por ferramentas próprias (lembrar e esquecer), durante o `/chat`. O usuário dono da memória vem do pedido, nunca do modelo.
- Teste semântico com o modelo real: usa o modelo se ele já estiver disponível localmente e é **pulado** (reportado como pulado, não como aprovado) quando não está. A lógica do armazenamento é coberta com um gerador de vetores falso e determinístico.
- Modelo de vetores (decidido no `/speckit.plan`, com medição): **`paraphrase-multilingual-MiniLM-L12-v2`** em vez de `all-MiniLM-L6-v2`. O modelo pedido é só de inglês; em português, fatos sem relação passaram do corte de 0,3 e paráfrases não chegaram ao limiar de duplicata de 0,92 (ver `research.md`, R-002).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O agente lembra o que a pessoa contou, em outra conversa (Priority: P1)

Quem está de plantão conta ao OpsPilot algo sobre si ou sobre o jeito de trabalhar — "sou responsável pelo checkout", "prefiro que incidentes críticos sejam abertos como high e revistos depois" — e pede para ele lembrar. Dias depois, numa conversa nova, pergunta algo relacionado com outras palavras — "quais serviços são meus?" — e o agente responde levando em conta o que foi lembrado, mesmo sem nenhuma palavra em comum entre a pergunta e o fato guardado.

**Why this priority**: É a razão de existir da feature. A conversa persistente (007) lembra só as últimas mensagens de uma conversa; a memória semântica lembra fatos da pessoa entre conversas, e os encontra pelo sentido, não pela palavra.

**Independent Test**: Testável guardando um fato para um usuário e depois perguntando algo de sentido parecido sem repetir nenhuma palavra do fato, verificando que o fato é recuperado e chega ao agente.

**Acceptance Scenarios**:

1. **Given** um pedido de chat com usuário identificado em que a pessoa pede para o agente lembrar um fato, **When** o agente decide guardá-lo, **Then** o fato fica registrado para aquele usuário e o agente confirma na resposta.
2. **Given** um fato guardado para um usuário, **When** esse usuário faz um pedido cujo sentido é próximo do fato, sem nenhuma palavra em comum com ele, **Then** o fato é recuperado e entregue ao agente junto com o pedido.
3. **Given** um fato guardado numa conversa, **When** o mesmo usuário faz um pedido relacionado em outra conversa, ou sem conversa informada, **Then** o fato é recuperado do mesmo jeito — a memória pertence ao usuário, não à conversa.
4. **Given** um usuário com muitos fatos guardados, **When** ele faz um pedido, **Then** o agente recebe no máximo os 3 fatos mais próximos do sentido do pedido, do mais próximo para o menos próximo.
5. **Given** um usuário cujos fatos guardados não têm relação com o pedido, **When** ele faz o pedido, **Then** nenhum fato é entregue ao agente — fatos pouco relacionados não entram só para completar três.
6. **Given** a pessoa pede para lembrar algo que já está guardado, dito com outras palavras, **When** o agente tenta guardar, **Then** nenhum fato duplicado é criado, e o agente é informado de que aquilo já era lembrado.

---

### User Story 2 - Pedir para o agente esquecer (Priority: P2)

A pessoa percebe que um fato lembrado está errado ou desatualizado — "não sou mais responsável pelo checkout" — e pede para o agente esquecê-lo. A partir dali, o fato não aparece mais em nenhum pedido dela.

**Why this priority**: Memória que não pode ser corrigida vira fonte de resposta errada permanente. Depende de haver o que esquecer (US1), mas é indispensável antes de a memória ser usada de verdade.

**Independent Test**: Testável guardando um fato, pedindo para esquecê-lo e verificando que ele não é mais recuperado nem por um pedido que antes o recuperava.

**Acceptance Scenarios**:

1. **Given** um fato guardado de um usuário, **When** o agente o esquece a pedido desse usuário, **Then** o fato deixa de existir e nunca mais é recuperado.
2. **Given** o identificador de um fato de outro usuário, **When** o agente tenta esquecê-lo num pedido do primeiro usuário, **Then** nada é apagado e o agente é informado de que o fato não foi encontrado.
3. **Given** um fato já esquecido, **When** o agente tenta esquecê-lo de novo, **Then** o agente é informado de que o fato não foi encontrado, sem erro de execução.

---

### User Story 3 - Memória só com usuário identificado (Priority: P3)

Quem integra com a API decide, pedido a pedido, se aquele pedido tem dono. Com usuário informado, a memória daquele usuário é consultada e pode ser alterada; sem usuário, o OpsPilot se comporta exatamente como antes da feature, e a memória de ninguém é lida nem escrita.

**Why this priority**: Garante isolamento entre pessoas e compatibilidade com quem já usa a API. Não bloqueia o caminho principal, mas sem isso a memória de uma pessoa vaza para outra.

**Independent Test**: Testável enviando pedidos com dois usuários diferentes e sem usuário, verificando que cada um só vê a própria memória e que o pedido sem usuário não lê nem grava nada.

**Acceptance Scenarios**:

1. **Given** fatos guardados para o usuário A, **When** o usuário B faz um pedido sobre o mesmo assunto, **Then** nenhum fato de A é entregue ao agente.
2. **Given** um pedido sem usuário, **When** ele é processado, **Then** nenhuma memória é consultada, o agente não recebe as ferramentas de lembrar e esquecer, e a resposta é igual à que seria antes da feature.
3. **Given** um pedido com usuário vazio ou de tipo errado, **When** ele chega, **Then** a resposta é de corpo inválido, no mesmo formato dos demais problemas de validação.

---

### Edge Cases

- Usuário informado que nunca guardou nada → pedido segue normalmente, sem fatos entregues; o usuário não precisa ser "criado" antes.
- Fato quase idêntico a um existente (acima do limiar de duplicata) → não cria outro; o existente permanece com seu texto e data originais.
- Fato relacionado mas distinto de um existente (abaixo do limiar de duplicata) → é guardado como fato novo; os dois podem ser recuperados juntos.
- Dois fatos com exatamente o mesmo grau de proximidade do pedido → ordem de desempate estável (o mais recente primeiro).
- O modelo tenta informar um usuário diferente ao chamar a ferramenta → impossível: o usuário não é argumento da ferramenta, vem do pedido.
- Pedir para esquecer um fato que não está entre os recuperados naquele pedido → o agente só conhece identificadores de fatos que lhe foram entregues; se o fato não foi recuperado, o agente não tem como esquecê-lo e deve dizer isso. Um pedido como "esquece que eu cuido do checkout" tende a recuperar o próprio fato, porque o sentido é próximo.
- Primeiro uso do gerador de vetores no processo → mais lento que os seguintes; os seguintes reaproveitam o mesmo gerador carregado.
- Gerador de vetores indisponível (sem modelo local e sem rede) → a recuperação de fatos falha de forma aberta: o pedido é atendido sem memória e a falha é registrada no servidor; guardar ou esquecer nesse estado é falha técnica e segue a regra do projeto para falhas técnicas.
- Fato muito longo → rejeitado pela validação da ferramenta; memória é para fatos curtos, não para documentos.
- Reflexão ligada → os fatos recuperados chegam à estratégia uma única vez, como a mensagem, e o crítico os vê como parte do pedido.
- Pedido com usuário e conversa → os dois contextos entram: fatos recuperados e histórico da conversa.

## Requirements *(mandatory)*

### Functional Requirements

#### Armazenamento de memórias

- **FR-001**: O sistema MUST manter memórias persistentes, cada uma pertencente a exatamente um usuário, com identificador, texto do fato, representação vetorial do sentido do fato e instante de criação.
- **FR-002**: O armazenamento MUST oferecer três operações por usuário: guardar um fato, recuperar os fatos mais próximos de um texto, e esquecer um fato pelo identificador.
- **FR-003**: Toda operação MUST ser restrita ao usuário informado; nenhuma operação de um usuário pode ler, alterar ou apagar memória de outro.
- **FR-004**: As memórias MUST sobreviver ao reinício do serviço, no mesmo armazenamento durável já usado pelo projeto, com estrutura criada automaticamente, sem passo manual.
- **FR-005**: O armazenamento de memórias MUST ser um contrato próprio, separado do estado operacional e das conversas.

#### Representação do sentido

- **FR-006**: O sentido de um fato e de um pedido MUST ser representado por um vetor gerado localmente, sem chamar serviço externo a cada operação.
- **FR-007**: Os vetores MUST ser normalizados, de modo que o produto escalar entre dois vetores seja a medida de proximidade de sentido, entre -1 e 1.
- **FR-008**: O gerador de vetores MUST ser carregado no máximo uma vez por processo, só quando for usado pela primeira vez, e reaproveitado em todos os usos seguintes, inclusive quando vários pedidos o pedem ao mesmo tempo antes de terminar de carregar.
- **FR-009**: O gerador de vetores MUST ser substituível, para que testes usem um gerador falso e determinístico.

#### Guardar (remember)

- **FR-010**: Ao guardar um fato, o sistema MUST compará-lo com os fatos já guardados do mesmo usuário e, se algum tiver proximidade estritamente maior que 0,92, MUST NOT criar um fato novo.
- **FR-011**: Guardar MUST informar se o fato foi criado ou se já existia, e o identificador do fato resultante (o novo ou o existente).
- **FR-012**: O texto do fato MUST ser não vazio e limitado em tamanho.

#### Recuperar (recall)

- **FR-013**: Recuperar MUST devolver no máximo 3 fatos do usuário, ordenados da maior para a menor proximidade com o texto consultado.
- **FR-014**: Recuperar MUST excluir todo fato com proximidade menor que 0,3, mesmo que isso deixe menos de 3 fatos ou nenhum.
- **FR-015**: Cada fato recuperado MUST vir com seu identificador, seu texto e sua proximidade.
- **FR-016**: Empates de proximidade MUST ter desempate estável, com o fato mais recente primeiro.

#### Esquecer (forget)

- **FR-017**: Esquecer MUST apagar o fato identificado se ele pertencer ao usuário, e MUST informar se algo foi apagado.
- **FR-018**: Esquecer um identificador inexistente, já esquecido ou de outro usuário MUST NOT apagar nada e MUST ser informado como "não encontrado", não como falha de execução.

#### Endpoint de chat

- **FR-019**: O endpoint de chat MUST aceitar um identificador de usuário opcional no corpo do pedido.
- **FR-020**: Um identificador de usuário vazio ou de tipo errado MUST produzir erro de corpo inválido, no formato e com o código já usados.
- **FR-021**: Com usuário informado, antes de executar a estratégia, o sistema MUST recuperar os fatos daquele usuário mais próximos da mensagem do pedido e entregá-los à estratégia junto com a mensagem, cada um com seu identificador.
- **FR-022**: A entrega dos fatos recuperados MUST ser feita por composição sobre a estratégia resolvida, sem alterar a implementação de cada estratégia e sem que o registro de estratégias conheça memórias — o mesmo princípio da entrega do histórico de conversa.
- **FR-023**: Com usuário informado e nenhum fato recuperado, a mensagem MUST chegar à estratégia sem nenhum acréscimo relativo a memória.
- **FR-024**: Sem usuário informado, o sistema MUST NOT consultar nem alterar memória alguma, e o comportamento observável do endpoint MUST ser idêntico ao de antes da feature.
- **FR-025**: Uma falha do gerador de vetores durante a recuperação MUST NOT impedir a resposta do pedido: o pedido é atendido sem fatos recuperados e a falha é registrada no servidor.
- **FR-026**: As métricas de todo pedido com usuário informado MUST incluir a quantidade de fatos recuperados e entregues à estratégia (0 a 3).

#### Ferramentas do agente

- **FR-027**: Com usuário informado, o agente MUST dispor de uma ferramenta para guardar um fato e uma ferramenta para esquecer um fato pelo identificador, ambas restritas ao usuário do pedido.
- **FR-028**: O usuário MUST NOT ser argumento de nenhuma das duas ferramentas: ele é fixado pelo sistema a partir do pedido.
- **FR-029**: Sem usuário informado, o agente MUST NOT receber essas ferramentas.
- **FR-030**: As duas ferramentas MUST seguir as regras de descrição de ferramentas do projeto — o que faz, quando usar, quando não usar, o que devolve, todo campo descrito.
- **FR-031**: As ferramentas de memória MUST NOT ser expostas pelo servidor MCP, que não tem noção de usuário.
- **FR-032**: As demais entradas (arena, bench, servidor MCP) MUST continuar com o mesmo comportamento observável.

#### Testabilidade

- **FR-033**: O projeto MUST incluir testes do armazenamento sobre banco efêmero em memória com gerador de vetores falso e determinístico, cobrindo no mínimo: guardar, duplicata acima do limiar, fato próximo mas abaixo do limiar, recuperação com teto de 3, corte abaixo de 0,3, ordem por proximidade, desempate, esquecer, esquecer de outro usuário, isolamento entre usuários e reabertura sem perda.
- **FR-034**: O projeto MUST incluir um teste que usa o gerador de vetores real e verifica que um fato é recuperado por um pedido sem nenhuma palavra em comum com ele. Esse teste MUST rodar quando o modelo estiver disponível localmente e MUST ser reportado como pulado — nunca como aprovado — quando não estiver, sem acessar a rede.
- **FR-035**: O projeto MUST incluir testes das ferramentas de memória e da composição no endpoint com gerador falso, sem chamadas a modelo de linguagem, cobrindo: usuário informado recebe fatos e ferramentas; sem usuário não recebe nenhum dos dois; usuário inválido é corpo inválido; falha do gerador na recuperação não derruba o pedido.
- **FR-036**: `npm test` MUST continuar passando sem rede e sem credenciais.

### Key Entities

- **Usuário**: identificador opaco informado no pedido; não tem cadastro nem autenticação. Existe na medida em que tem memórias.
- **Memória (fato)**: uma afirmação curta sobre o usuário ou seu trabalho — identificador, usuário dono, texto, vetor de sentido e instante de criação. Imutável: corrigir é esquecer e guardar de novo.
- **Fato recuperado**: uma memória somada à sua proximidade com o pedido atual; existe só durante aquele pedido.
- **Gerador de vetores**: transforma texto em vetor normalizado de sentido; carregado uma vez por processo, sob demanda.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um fato guardado é recuperado por um pedido de mesmo sentido sem nenhuma palavra em comum com ele.
- **SC-002**: Um pedido nunca recebe mais de 3 fatos, e nunca recebe fato com proximidade menor que 0,3.
- **SC-003**: Pedir para lembrar a mesma coisa com palavras diferentes não aumenta a quantidade de fatos guardados.
- **SC-004**: 0 fatos de um usuário aparecem em pedidos de outro usuário.
- **SC-005**: Um fato esquecido não é recuperado em nenhum pedido posterior.
- **SC-006**: Pedidos sem usuário produzem exatamente o mesmo resultado que antes da feature.
- **SC-007**: A partir do segundo uso no mesmo processo, recuperar fatos não recarrega o gerador de vetores.
- **SC-008**: A suíte de testes roda por completo sem rede e sem credenciais; o teste com modelo real roda quando o modelo está em cache e aparece como pulado quando não está.

## Assumptions

- **Nomes e formas dados pelo pedido**: o contrato chama-se `MemoryStore`, com operações `remember`, `recall` e `forget` por `userId`; código em `src/memory/embeddings.ts` e `src/memory/memory-store.ts`. Tabela `memories` com as colunas `id`, `user_id`, `fact`, `embedding` (BLOB) e `created_at`, no mesmo arquivo `OPSPILOT_DB`, seguindo o padrão de `SqliteOpsStore`. Vetores gerados localmente via `@huggingface/transformers`, com `pooling: "mean"` e `normalize: true`, em singleton carregado sob demanda. O pedido citava `all-MiniLM-L6-v2`; por decisão registrada nas clarificações, o modelo é `paraphrase-multilingual-MiniLM-L12-v2` (mesma dimensão, 384). O campo do corpo chama-se `userId`.
- **Nova dependência de runtime**: `@huggingface/transformers` é a primeira dependência que baixa um artefato (o modelo quantizado, ~113 MB) na primeira execução. A justificativa exigida pela constituição fica no plano.
- **Limiares**: duplicata é proximidade **estritamente maior** que 0,92; recuperação exige proximidade **maior ou igual** a 0,3; teto de 3 fatos. Valores fixos e nomeados, não configuráveis por ambiente.
- **Busca por varredura**: a recuperação compara o pedido com todos os fatos do usuário, sem índice vetorial. Adequado para dezenas a centenas de fatos por usuário, que é a escala de um copiloto de plantão.
- **Tamanho do fato**: até 500 caracteres. O modelo trunca entradas longas, e um fato longo dilui o sentido do vetor.
- **Métrica**: a quantidade de fatos recuperados entra nas métricas como `recalledMemories`, no mesmo molde de `historyMessages` (007). Não pedida explicitamente, mas é o que permite distinguir "o agente ignorou a memória" de "a memória não chegou".
- **Nomes das ferramentas**: `remember_fact` e `forget_fact`.
- **Sem retenção, listagem ou endpoint de leitura**: memórias ficam até serem esquecidas; listar todas as memórias de um usuário e endpoints HTTP de memória estão fora de escopo.
- **Sem autenticação**: `userId` é confiado como informado, coerente com `conversationId` e o resto da API hoje.
