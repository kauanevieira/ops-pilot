# Phase 0 — Research: Camada de Reflexão

**Feature**: `002-reflection-layer` | **Date**: 2026-09-18

Decisões técnicas que sustentam o plano. Cada uma foi verificada contra o código já
existente da feature 001 (`src/agents`, `src/trace`), não apenas contra documentação.

---

## R-001 — A reflexão é um decorator, não uma terceira estratégia

**Decision**: `withReflection(strategy: ReasoningStrategy, opts?): ReasoningStrategy` —
uma função que recebe uma estratégia e devolve outra que cumpre o mesmo contrato. Nenhuma
alteração em `react.ts` ou `plan-and-execute.ts`.

**Rationale**: O contrato `ReasoningStrategy` (`name` + `run(input, options)`) já é
fechado e suficiente: a camada só precisa de `run` e da resposta que ele devolve. Um
decorator satisfaz FR-001 e FR-002 por construção — o resultado é intercambiável com
qualquer estratégia crua em qualquer lugar que consuma o contrato, inclusive na arena.

**Alternatives considered**:
- *Um nó de crítica dentro de cada grafo LangGraph*: acoplaria a reflexão ao formato
  interno de cada estratégia (o `PEState` do plan-and-execute não se parece com o estado do
  `createReactAgent`), exigindo duas implementações e alterando código existente.
- *Uma classe base `ReflectiveStrategy` que as estratégias estendem*: herança obriga a
  mexer nas estratégias e impede decorar uma estratégia de terceiros.

---

## R-002 — Regeneração re-executa a base, com o resultado anterior no contexto

**Decision**: A regeneração chama `strategy.run(...)` de novo, com um input enriquecido:
pedido original + resposta reprovada + feedback do crítico + o registro das ações já
executadas na tentativa anterior, acompanhado da instrução explícita de **não repetir ações
que já produziram efeito** (abrir/resolver incidente) e de usar as observações anteriores
como fato consumado.

**Rationale**: Resolve o `[NEEDS CLARIFICATION]` que ficou aberto na spec. Re-executar a
base por completo é a única forma de corrigir uma resposta que foi reprovada *por falta de
evidência* — o agente precisa poder voltar às ferramentas e buscar o que faltou. Mas
re-executar cegamente, sobre o mesmo store, duplicaria incidentes: `open_incident` não é
idempotente. Passar o histórico da tentativa anterior mantém o decorator genérico (não
precisa saber nada sobre quais ferramentas têm efeito colateral) e transforma a duplicação
em algo que o agente tem informação para evitar.

**Limitação assumida, registrada honestamente**: a mitigação é por prompt, não por
garantia. Nada impede o modelo de abrir um incidente duplicado na segunda tentativa. Uma
garantia real exigiria idempotência no domínio (por exemplo, `open_incident` recusando
incidente aberto duplicado para o mesmo alerta/serviço) — isso é uma mudança de domínio,
está **fora do escopo** desta feature, e fica registrada como recomendação para a feature
seguinte. O quickstart inclui uma verificação manual de duplicação para tornar o risco
visível em vez de silencioso.

**Alternatives considered**:
- *Re-executar a base "limpa", sem histórico*: leitura literal de "regenera", mais simples,
  mas duplica efeitos colaterais a cada reflexão sem nenhuma defesa.
- *Só reescrever a resposta final sobre o rastro acumulado, sem novas chamadas de
  ferramenta*: risco zero de efeito duplicado e mais barato, mas incapaz de corrigir a
  reprovação mais importante (afirmação sem evidência) — o agente ficaria preso ao mesmo
  conjunto de observações que já o reprovou. Rejeitada por esvaziar o valor da feature.

---

## R-003 — Crítico com saída estruturada, pelo mesmo caminho do planner

**Decision**: `createModel().withStructuredOutput(critiqueSchema).invoke(...)`, com
`critiqueSchema = z.object({ approved: z.boolean(), feedback: z.string() })`. Mesma fábrica
de modelo (`createModel()`), mesmo `temperature: 0`, mesmo padrão já usado pelo planner e
pelo replanner em `plan-schemas.ts`.

**Rationale**: FR-007 exige o mesmo modelo, sem configuração própria — `createModel()` é a
fábrica única e já lê `OPENROUTER_MODEL`/`OPENROUTER_API_KEY`. `withStructuredOutput` com
zod é o mecanismo já validado no projeto para parecer tipado (R-005 da 001), e satisfaz a
convenção "toda entrada externa é validada com zod": a saída do modelo é entrada externa.

**Alternatives considered**:
- *Pedir JSON no prompt e fazer `JSON.parse`*: reintroduz o parsing frágil que
  `withStructuredOutput` existe para eliminar.
- *Um segundo modelo, mais barato, para o crítico*: contraria FR-007 e criaria uma segunda
  fonte de configuração de modelo, quebrando a fábrica única da 001.

---

## R-004 — O crítico é injetável; é isso que torna o ciclo testável offline

**Decision**: `withReflection(strategy, { maxReflections?, critic? })`, onde
`critic: (ctx: CritiqueContext) => Promise<Critique>`. O padrão é o crítico baseado em LLM
(`createLlmCritic()`); os testes passam um crítico falso e uma estratégia base falsa.

**Rationale**: Este é o ponto em que a 002 corrige a maior fraqueza da 001. Lá, as
estratégias ficaram sem teste próprio porque testá-las exigiria rede (ver Complexity
Tracking do plano 001). Aqui, **toda a lógica que a feature acrescenta é lógica de
controle** — contar tentativas, decidir quando parar, montar o rastro, somar métricas — e
nada disso precisa de um LLM. Injetar o crítico e receber a estratégia base por parâmetro
(que o decorator já faz) deixa o ciclo inteiro coberto por testes determinísticos e
offline, cumprindo "lógica nova nasce com teste" sem ressalva.

**Alternatives considered**:
- *Instanciar o crítico dentro do decorator*: obrigaria a testar com rede, ou a mockar o
  módulo de modelo — validando o mock, não o ciclo.

---

## R-005 — `stoppedReason` ganha `"max-reflections"`

**Decision**: Estender a união em `src/trace/types.ts` para
`"completed" | "max-iterations" | "max-steps" | "max-reflections"`. O valor é usado apenas
quando o ciclo esgota as reflexões sem aprovação (FR-015); nos demais casos prevalece o
`stoppedReason` da última tentativa.

**Rationale**: A alternativa seria espremer essa informação em `answer` ou no rastro, o que
a tornaria não verificável programaticamente — e SC-003/FR-015 precisam dela verificável. A
extensão é **aditiva**: `formatMetrics` imprime `stoppedReason` por interpolação, sem
`switch`, então nada em `src/trace/format.ts` quebra. O único ponto que exige atenção é
qualquer `switch` exaustivo sobre `StoppedReason` — hoje não existe nenhum (verificado).

**Alternatives considered**:
- *Reaproveitar `"max-iterations"`*: confunde dois limites diferentes e torna impossível
  distinguir "o agente ficou em loop" de "o crítico nunca aprovou".

---

## R-006 — O parecer cabe no evento `critique` já existente

**Decision**: Reusar `{ type: "critique"; content: string }`, que já existe na união
`TraceEvent` desde a 001 e já é renderizado por `format.ts`. O `content` carrega veredito e
justificativa com prefixo estável: `aprovado: <feedback>`, `reprovado: <feedback>`,
`indisponível: <motivo>`.

**Rationale**: O evento foi reservado na 001 exatamente para isto. Um prefixo textual
estável satisfaz FR-018 (parecer + justificativa) e FR-020 (falha distinguível de
reprovação) sem alterar o tipo `TraceEvent`, sem alterar `format.ts`, e sem invalidar os
testes de formatação existentes.

**Alternatives considered**:
- *Acrescentar campos `approved`/`attempt` ao evento `critique`*: mais tipado, mas altera
  um tipo do contrato da 001 e obriga a mexer em `format.ts` e nos seus testes. O ganho não
  paga a mudança de contrato nesta feature.

---

## R-007 — A fronteira entre tentativas é o próprio evento de crítica

**Decision**: O rastro final é a concatenação, em ordem: eventos da tentativa 1, crítica 1,
eventos da tentativa 2, crítica 2, … A tentativa *k* é o trecho entre a crítica *k-1* e a
crítica *k*. Nenhum evento novo de delimitação é introduzido.

**Rationale**: Satisfaz FR-019 e FR-021 com o material que já existe. Como toda tentativa
avaliada é seguida de exatamente um evento `critique` (FR-018), as críticas já particionam
o rastro sem ambiguidade — e a única tentativa que pode não ser seguida de crítica é a
última, quando `maxReflections` é 0 ou a crítica falhou, casos em que o trecho final é o
resto do rastro.

**Alternatives considered**:
- *Um evento `thought` sintético "— tentativa 2 —"*: polui o rastro com algo que o agente
  não pensou, misturando registro e apresentação.

---

## R-008 — Contagem de chamadas por soma, latência por relógio

**Decision**: `llmCalls` = soma dos `metrics.llmCalls` de cada tentativa + as chamadas do
crítico, contadas por uma instância própria de `LlmCallCounter` passada em `callbacks` na
invocação do crítico. `latencyMs` = relógio de parede do `run` decorado inteiro.

**Rationale**: O decorator não tem acesso ao contador interno da base — mas não precisa: a
base já reporta o que gastou em `metrics.llmCalls`, e somar é exatamente o que FR-022 pede.
`LlmCallCounter` já existe e sua documentação exige uma instância por execução; o crítico
ganha a sua. A latência **não** é soma: FR-023 pede a execução decorada inteira, o que
inclui o tempo entre tentativas.

**Alternatives considered**:
- *Um contador único compartilhado, injetado na base*: exigiria mudar a assinatura de
  `run` para receber callbacks — mudança de contrato da 001 para nenhum ganho.

---

## R-009 — Falha do crítico é fail-open, e fica no rastro

**Decision**: A invocação do crítico é envolvida em `try/catch`. Em erro (rede, timeout,
saída que não valida contra o schema), registra-se
`{ type: "critique", content: "indisponível: <motivo>" }`, o ciclo encerra, e a resposta
corrente é entregue com o `stoppedReason` da última tentativa.

**Rationale**: FR-017 é explícito: a falha da revisão não pode derrubar a execução. A
reflexão é uma melhoria opcional sobre um resultado que já é válido — degradar para "sem
revisão" preserva a disponibilidade do plantão. O registro no rastro (FR-020) impede que a
degradação passe despercebida, que é o risco real do fail-open.

**Alternatives considered**:
- *Propagar o erro*: tornaria a estratégia refletida menos confiável que a crua, exatamente
  o oposto do propósito da feature.
- *Tentar o crítico de novo*: multiplica o custo em cima de um caminho de falha, e o
  `timeout: 60s` de `createModel()` já cobre o caso de rota travada.

---

## R-010 — `maxReflections: 0` é atalho, não caso degenerado

**Decision**: Com `maxReflections = 0`, o decorator devolve o resultado da base **sem
tocá-lo** — sem evento de crítica, sem chamada extra, `stoppedReason` intacto. Só o `name`
difere.

**Rationale**: FR-016 pede equivalência com a base. Tratar isso como atalho explícito, em
vez de deixar o laço "naturalmente" não iterar, torna a garantia verificável em teste e
elimina qualquer chance de uma chamada de crítico vazar no caminho zero.

---

## R-011 — Registro deriva os nomes, em vez de repeti-los

**Decision**: `registry.ts` gera as entradas refletidas a partir do mapa de fábricas base,
compondo `withReflection(baseFactory(store))`. O nome vem de `reflect:${strategy.name}`
(FR-003), não de uma string literal escrita à mão no registro.

**Rationale**: Derivar impede a divergência entre o nome registrado e o `name` reportado
pela estratégia — divergência que quebraria a arena de forma sutil (a estratégia aparece na
lista de válidas mas se identifica com outro nome na saída). Também faz com que qualquer
estratégia futura ganhe sua versão refletida sem edição manual.

**Alternatives considered**:
- *Duas entradas literais no mapa `FACTORIES`*: funciona, mas duplica o prefixo `reflect:`
  em três lugares (registro, decorator, documentação).

---

## R-012 — Ambiente: o bloqueio da 001 está resolvido

**Decision**: Nenhuma mudança de dependência, de `package.json` ou de ambiente. Esta
feature não acrescenta pacote algum.

**Rationale**: O plano da 001 registrava o Node 20.6.0 como bloqueio de implementação. O
ambiente atual roda **Node 22.22.2**, compatível com `engines.node: ">=22"` e com `.nvmrc`.
`npm run typecheck` e `npm test` estão destravados. Tudo que a 002 precisa — `zod`,
`withStructuredOutput`, `LlmCallCounter`, `node:test` — já está instalado e em uso.
