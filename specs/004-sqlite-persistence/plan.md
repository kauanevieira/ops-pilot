# Implementation Plan: Persistência real de operações

**Branch**: `004-sqlite-persistence` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-sqlite-persistence/spec.md`

## Summary

Trocar o estado in-memory por persistência durável em SQLite, sem que nada acima da
interface `OpsRepository` perceba. Uma classe nova — `SqliteOpsStore`
(`src/store/sqlite-ops-store.ts`) — implementa a interface existente sobre `node:sqlite`,
com DDL idempotente no construtor, quatro tabelas (`services`, `alerts`, `incidents`,
`runbooks`), `CHECK` em todo campo de conjunto fechado e statements preparados em toda
consulta. A API HTTP passa a montá-la; a arena e o bench ficam no store in-memory, porque
comparar estratégias exige partir sempre do mesmo ponto. Duas ferramentas novas
(`list_incidents`, `consultar_runbook`) e uma revisão das três existentes pelas 6 regras do
Princípio IV completam a feature.

A abordagem técnica central, definida na Fase 0: **a API síncrona do `node:sqlite` é o que
torna a troca barata** (R-001). `OpsRepository` é síncrona e todos os seus consumidores
assumem isso; um driver assíncrono forçaria `async` por toda a cadeia de ferramentas e
estratégias — uma refatoração grande sem ganho para quem usa. Com `DatabaseSync`, a
implementação nova entra por injeção no ponto de composição e nada mais muda.

Dois achados da Fase 0 alteram a leitura ingênua do pedido e estão no caminho crítico:

1. **`node:sqlite` grava `new Date()` como `NULL`, sem lançar** (R-003, verificado). O
   horário de abertura de um incidente sumiria em silêncio. Toda data atravessa a fronteira
   como texto ISO-8601 em UTC, com `NOT NULL` no DDL como rede de segurança e um teste de
   ida-e-volta dedicado.
2. **As ferramentas não têm teste dedicado hoje** (R-015, verificado). Não existe
   `src/agents/tools.test.ts`. O FR-039 — "os testes das tools existentes passam a rodar
   sobre `':memory:'`" — é, na prática, **criar** essa cobertura.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM (`"type": "module"`), `strict: true`, module
NodeNext. Runtime **Node 22.22.2**.

**Primary Dependencies**: Nenhuma nova. `node:sqlite` é módulo nativo. `zod@4.6.5` para a
validação de fronteira — do corpo de `OPSPILOT_DB` (R-011) e dos dados lidos do banco
(FR-023). **Duas dependências saem**: `sequelize` e `mysql2`, instaladas e nunca importadas
por nenhum arquivo de `src/`, agora em contradição direta com o Princípio II (R-019).

**Storage**: SQLite local via `DatabaseSync`. Caminho em `OPSPILOT_DB`, padrão
`./data/opspilot.db`, pasta criada na abertura. `':memory:'` nos testes. Quatro tabelas,
DDL idempotente aplicado no construtor. `src/store/seed.json` continua sendo a fonte única
do cenário base para os dois caminhos — in-memory e SQLite (R-005).

**Testing**: `node:test` via `tsx`, arquivos `*.test.ts` ao lado do código. Três alvos
novos: `src/store/sqlite-ops-store.test.ts` (o grosso — seed, CRUD, filtros, `CHECK`,
ida-e-volta de datas), `src/agents/tools.test.ts` (as cinco ferramentas sobre `':memory:'`)
e o caso de persistência entre aberturas, único que usa arquivo — em `os.tmpdir()`, nunca
na árvore do projeto (R-016).

**Target Platform**: Linux/macOS, via `npm run dev`, `npm run arena`, `npm run seed`.

**Project Type**: Single project. A camada Model ganha uma segunda implementação de
repositório; nenhuma camada nova.

**Performance Goals**: Nenhuma. Tabelas com dezenas de linhas e latência dominada por
chamadas de modelo. Statements preparados no construtor são feitos pela garantia estrutural
contra SQL dinâmico (R-012), não por desempenho.

**Constraints**:
- Interface `OpsRepository` **permanece síncrona**. Qualquer proposta de torná-la `async`
  invalida o plano inteiro.
- Datas nunca chegam a um parâmetro ligado como `Date` (R-003).
- Zero SQL construído em tempo de execução — inclusive o filtro opcional de status, que
  usa dois statements fixos em vez de um `WHERE` condicional (R-013).
- Arena e bench **não** migram para SQLite: reprodutibilidade é requisito (FR-030, FR-031,
  R-014).
- `npm test` não pode criar nem alterar arquivo de dados no projeto (FR-032).
- Os mesmos erros de domínio, nas mesmas situações, sobre a nova implementação (FR-012).
- ⚠️ **Três suposições herdadas da spec seguem abertas** (R-017, R-018, R-020): valores e
  atribuição de `tier`; propósito do `summary`; nome `consultar_runbook`. Nenhuma bloqueia
  a modelagem — cada uma é uma linha em poucos arquivos se mudar —, mas confirmá-las antes
  de implementar é mais barato que depois.

**Scale/Scope**: 3 arquivos novos de código + 2 de teste novos; 10 arquivos existentes
alterados; 2 dependências removidas; 1 entrada nova no `.gitignore`; 4 scripts do
`package.json` ganham a flag de supressão do aviso experimental.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> ✅ A constituição foi **ratificada em v1.0.0** nesta mesma leva de mudanças
> ([`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)). Esta é a
> primeira feature avaliada contra portões constitucionais reais, e não contra o
> `.github/copilot-instructions.md` como substituto — como fizeram os planos 001, 002 e 003.

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | As transições puras de `src/store/state.ts` continuam sendo a regra de negócio do store in-memory. O `SqliteOpsStore` é borda: é ele que lê o relógio, gera o id e fala com o banco — exatamente o papel que o `InMemoryOpsRepository` já tem. `tier` e `summary` entram como campos dos esquemas zod em `src/domain/schemas.ts`, definidos uma vez e inferidos (R-017, R-018); nenhum tipo paralelo escrito à mão. | ✅ Passa |
| **II. Persistência Local em SQLite** | É a feature que implementa o princípio. Todos os seis itens atendidos: caminho por env var com default (FR-003), `':memory:'` nos testes (FR-038), DDL idempotente no construtor (FR-004/005), `CHECK` em `tier`, `severity` e ambos os `status` (FR-018), prepared statements em 100% das consultas (FR-021), seed idempotente (FR-026), `data/` gitignorado (FR-007). Sem ORM e sem servidor de banco — e as duas dependências que contradiziam isso saem (R-019). | ✅ Passa |
| **III. Contrato Antes de Código** | Spec, plano, pesquisa, modelo de dados e três contratos escritos antes da implementação. Os contratos de ferramenta da 001 (`specs/001-reasoning-core/contracts/tools.md`) descrevem três ferramentas que esta feature altera e amplia para cinco — `contracts/ops-tools.md` os substitui e declara isso explicitamente. | ✅ Passa |
| **IV. Ferramentas Descritas pelas 6 Regras** | As duas novas nascem conformes e as três existentes são auditadas item a item em [`contracts/ops-tools.md`](./contracts/ops-tools.md), com a dívida nomeada: `open_incident` não diz quando usar nem quando não usar, `resolve_incident` tem uma frase e nenhum `.describe()`, e nenhum campo de nenhuma ferramenta tem descrição hoje. | ✅ Passa |
| **V. Portões Offline e Determinísticos** | Testes em `':memory:'`, sem rede, sem credencial, sem chamada de modelo. O único caso com arquivo vive em `os.tmpdir()` (R-016). O bench continua verificando acerto pelo estado final e continua partindo do mesmo ponto a cada execução, porque não migra para SQLite (R-014). | ✅ Passa |

**Governança de facto (`.github/copilot-instructions.md`)**: a linha de stack
"Express com MySQL como banco (Sequelize + mysql2)" passa a **contradizer** o Princípio II.
Pela regra de precedência da constituição — em conflito, a constituição vence e o documento
subordinado é corrigido —, essa linha é atualizada nesta feature. Não é divergência a
justificar; é correção a executar.

**Resultado do portão**: nenhuma violação. A tabela de Complexity Tracking está vazia por
não haver o que justificar.

**Re-avaliação pós-Fase 1**: os artefatos de desenho não introduziram violações, e dois
pontos ficaram *mais* aderentes do que o esboço inicial:

- **`CHECK` literal + teste de sincronia com os enums zod** (R-007) em vez de DDL gerado a
  partir dos enums. Gerar seria mais DRY, mas produziria SQL por interpolação — a exceção
  "aqui os valores são confiáveis" é justamente a porta que o Princípio II fecha. O teste
  dá a garantia sem abrir a porta.
- **Dois statements fixos para o filtro de status** (R-013) em vez de um `WHERE`
  condicional. O `WHERE` montado condicionalmente é a forma mais inocente de SQL
  concatenado entrar num projeto, e a função que o aceita uma vez vira o lugar onde o
  próximo filtro entra por interpolação.

## Project Structure

### Documentation (this feature)

```text
specs/004-sqlite-persistence/
├── plan.md                      # Este arquivo
├── spec.md                      # Especificação da feature
├── research.md                  # Fase 0 — 20 decisões técnicas
├── data-model.md                # Fase 1 — esquema físico, tipos de domínio, mapeamento
├── quickstart.md                # Fase 1 — 7 validações, offline e online
├── contracts/                   # Fase 1
│   ├── ops-store.md             # OpsRepository: interface, invariantes, erros, ciclo de vida
│   ├── ops-tools.md             # As 5 ferramentas + auditoria pelas 6 regras
│   └── database-schema.md       # DDL, CHECKs, índices, seed idempotente
├── checklists/
│   └── requirements.md
└── tasks.md                     # Fase 2 — criado por /speckit-tasks, NÃO por este comando
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── schemas.ts            # ALTERADO — serviceSchema += tier; incidentSchema += summary;
│   │                         #   runbookSchema NOVO (R-017, R-018)
│   └── errors.ts             # ALTERADO — RunbookNotFoundError (serviço existe, runbook não)
├── store/
│   ├── sqlite-ops-store.ts   # NOVO — SqliteOpsStore: DDL no construtor, statements
│   │                         #   preparados, conversão de data na borda (R-001, R-003)
│   ├── sqlite-schema.ts      # NOVO — DDL literal e seedDatabase(db, state) (R-006, R-010)
│   ├── db.ts                 # NOVO — openDatabase(): resolve OPSPILOT_DB com zod,
│   │                         #   cria a pasta, liga o pragma (R-008, R-011)
│   ├── repository.ts         # ALTERADO — += listIncidents, findRunbook (R-004)
│   ├── types.ts              # ALTERADO — WorldState += runbooks (R-014)
│   ├── seed.ts               # ALTERADO — seedFileSchema += runbooks, tier
│   ├── seed.json             # ALTERADO — tier nos 5 serviços; 3 runbooks
│   ├── in-memory.ts          # ALTERADO — implementa os 2 métodos novos
│   ├── state.ts              # inalterado — transições puras seguem valendo
│   └── sqlite-ops-store.test.ts  # NOVO — seed idempotente, CRUD, filtros, CHECK,
│                             #   ida-e-volta de datas, persistência entre aberturas
├── agents/
│   ├── tools.ts              # ALTERADO — 3 ferramentas revisadas pelas 6 regras
│   │                         #   + list_incidents + consultar_runbook (FR-028, FR-029)
│   └── tools.test.ts         # NOVO — as 5 ferramentas sobre ':memory:' (R-015)
├── bench/
│   └── scenarios.ts          # ALTERADO — CATALOG_SERVICE ganha tier; benchBaselineState
│                             #   repassa runbooks
├── scripts/
│   └── seed.ts               # ALTERADO — passa a semear o banco durável
├── index.ts                  # ALTERADO — composição: abre o banco, injeta SqliteOpsStore
├── http/server.ts            # ALTERADO — default do store deixa de ser in-memory;
│                             #   a injeção por deps continua igual (testes intocados)
├── arena.ts                  # inalterado — in-memory por decisão (R-014)
└── bench.ts                  # inalterado — in-memory por decisão (R-014)

data/                         # NOVO, gitignorado — opspilot.db
```

Fora de `src/`:

```text
.gitignore                        # ALTERADO — += data/
package.json                      # ALTERADO — -sequelize, -mysql2; 4 scripts ganham
                                  #   --disable-warning=ExperimentalWarning (R-002)
.env.example                      # ALTERADO — += OPSPILOT_DB
.github/copilot-instructions.md   # ALTERADO — linha de stack corrigida (MySQL → SQLite)
README.md                         # ALTERADO — a seção que afirma "não há persistência
                                  #   em disco nem em banco" deixa de ser verdade
```

**Structure Decision**: projeto único, testes ao lado do código, como nas features
anteriores. A implementação nova fica em `src/store/` junto da que ela substitui — são duas
implementações da mesma interface, e separá-las em diretórios diferentes esconderia
justamente o fato de serem intercambiáveis. A divisão em três arquivos
(`sqlite-ops-store.ts`, `sqlite-schema.ts`, `db.ts`) segue a fronteira entre o que é
*repositório* (traduz domínio ↔ linhas), o que é *esquema* (DDL e seed, dados literais) e o
que é *configuração* (resolver caminho, abrir conexão) — a terceira é a que os testes mais
precisam contornar, e isolá-la é o que permite abrir `':memory:'` sem passar por ela.

Quatro pontos de atenção na implementação:

1. **A conversão de datas é o ponto de falha silenciosa da feature** (R-003). `Date` ligado
   a um parâmetro grava `NULL` sem erro. Toda escrita passa por `toISOString()` e toda
   leitura por `z.coerce.date()`; o `NOT NULL` do DDL existe para que um esquecimento vire
   exceção em vez de dado perdido. O teste de ida-e-volta não é opcional.
2. **⚠️ Correção feita durante a implementação — `src/http/server.ts` NÃO muda de default.**
   O plano original presumia que os testes de integração da 003 injetam `store`. Verificado
   contra `src/http/server.test.ts`: apenas **1 dos ~15** casos injeta; os demais dependem
   do default de `createApp()`. Trocar esse default por `SqliteOpsStore` abriria
   `./data/opspilot.db` de verdade a cada um desses testes — violação direta de FR-032. O
   default de `createApp()` **permanece** `InMemoryOpsRepository(baselineState())`; a
   injeção do store durável fica só em `src/index.ts` (a composição real, FR-010) e nos
   testes que optarem por injetar `SqliteOpsStore(':memory:')` explicitamente.
3. **`WorldState` ganhar `runbooks` toca o bench de raspão.** `benchBaselineState()`
   espalha `...base` e sobrescreve `services`; com um campo novo, o espalhamento já o
   carrega — mas vale conferir, porque um `WorldState` montado campo a campo em algum teste
   passaria a faltar uma propriedade e quebrar o `typecheck`.
4. **Ordem de implementação importa.** `tier` no `serviceSchema` quebra o `typecheck` de
   todo lugar que constrói um `Service` literal — `seed.json` (validado em runtime, não em
   tipo) e `CATALOG_SERVICE` no bench. Fazer domínio → seed → bench → store → tools numa
   sequência evita um estado intermediário com dezenas de erros de tipo.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação a justificar. A feature não introduz dependência, camada, serviço externo
nem abstração além do mínimo: uma segunda implementação de uma interface que já existia
exatamente para receber esta implementação, e duas ferramentas de leitura.

Registrado o movimento na direção oposta: a feature **remove** duas dependências
(`sequelize`, `mysql2`) que estavam declaradas, nunca usadas, e agora proibidas pelo
Princípio II (R-019).

---

## Próxima fase

`/speckit.tasks` para gerar `tasks.md`. Este comando encerra após a Fase 1.

**Antes de implementar**, confirmar as três suposições abertas (R-017, R-018, R-020) — ou
aceitá-las explicitamente como estão.
