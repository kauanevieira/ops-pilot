# Research: Persistência real de operações

**Feature**: `004-sqlite-persistence` | **Fase**: 0 | **Data**: 2026-09-18

Decisões técnicas tomadas antes do desenho. Cada uma fecha uma incógnita do Technical
Context do [plan.md](./plan.md). Verificações marcadas com ✅ foram executadas contra o
runtime real deste repositório (Node 22.22.2), não presumidas da documentação.

---

## R-001 — `node:sqlite` (`DatabaseSync`) como acesso a dados

**Decisão**: usar o módulo nativo `node:sqlite`, classe `DatabaseSync`, sem nenhuma
dependência de terceiros.

**Rationale**: a API é **síncrona**, e é exatamente isso que torna a feature barata. A
interface `OpsRepository` existente é síncrona (`listAlerts(): Alert[]`, não
`Promise<Alert[]>`), e todos os seus consumidores — as tools, a arena, o bench — assumem
isso. Qualquer driver assíncrono forçaria `async` na interface inteira e propagaria `await`
por `src/agents/tools.ts`, `react.ts`, `plan-and-execute.ts` e pelo bench: uma refatoração
grande, arriscada e sem nenhum ganho para o usuário. Com `DatabaseSync`, a troca de
implementação é invisível acima da interface.

✅ **Verificado**: `require('node:sqlite')` funciona sem flag no Node 22.22.2;
`prepare()/run()/all()/get()` e `exec()` para DDL operam como documentado.

**Alternativas consideradas**:
- `better-sqlite3` — mesma ergonomia síncrona, mas é dependência nativa com passo de
  compilação. Viola o Princípio II (sem dependência de runtime para acesso a dados) sem
  oferecer nada que o módulo nativo não ofereça.
- `sequelize` + `mysql2` (a stack declarada no `.github/copilot-instructions.md`) — ORM
  assíncrono e servidor de banco externo. Proibido pelo Princípio II; ver R-019.

---

## R-002 — O aviso de recurso experimental

**Decisão**: adicionar `--disable-warning=ExperimentalWarning` **apenas** aos scripts do
`package.json` que abrem o banco (`dev`, `arena`, `seed`, `test`), nunca via
`--no-warnings` global.

**Rationale**: no Node 22, abrir um `DatabaseSync` imprime
`ExperimentalWarning: SQLite is an experimental feature` em stderr a cada execução. Sem
tratamento, todo `npm test` e todo `npm run dev` nascem com ruído que ensina quem usa o
projeto a ignorar stderr — e é em stderr que os erros de verdade aparecem. Silenciar
**só esta categoria** mantém todos os outros avisos visíveis; `--no-warnings` silenciaria
depreciações reais junto.

✅ **Verificado**: `node --disable-warning=ExperimentalWarning` suprime exatamente esse
aviso no 22.22.2.

**Risco aceito**: sendo experimental, a API pode mudar entre versões do Node. A superfície
usada é mínima (`DatabaseSync`, `prepare`, `run`, `all`, `get`, `exec`, `close`) e está
confinada a um arquivo — o custo de uma eventual adaptação é local.

**Alternativas consideradas**: fixar `process.removeAllListeners('warning')` — esconde o
aviso de dentro do código, o que é pior: passa a valer para bibliotecas também, e some da
vista de quem lê o `package.json`.

---

## R-003 — `Date` NÃO pode ser passado a um parâmetro ligado ⚠️

**Decisão**: gravar datas como **texto ISO-8601 em UTC** (`date.toISOString()`), converter
na borda do store, e validar na leitura com `z.coerce.date()`. Nenhum objeto `Date` chega
a um `.run()`/`.get()`.

**Rationale**: este é o achado mais perigoso da Fase 0. `node:sqlite` aceita apenas
`null`, `number`, `bigint`, `string` e `Uint8Array`. Passar um `boolean` **lança**
`ERR_INVALID_ARG_TYPE` — falha alta e visível. Mas passar um `Date`:

✅ **Verificado**: `db.prepare('insert into s values(?)').run(new Date())` **não lança** e
grava `NULL`. O horário de abertura de um incidente desapareceria silenciosamente.

Texto ISO-8601 em UTC é ordenável lexicograficamente (`ORDER BY fired_at` funciona), legível
ao inspecionar o arquivo com qualquer ferramenta, e sem ambiguidade de fuso — a mesma
representação que o `seed.json` já usa, o que mantém uma única convenção no projeto.

**Consequência obrigatória**: um teste dedicado que grava um instante e o lê de volta
comparando `getTime()`, mais um que afirma que a coluna nunca é `NULL` para campos
obrigatórios (`NOT NULL` no DDL transforma o modo de falha silencioso em erro imediato).

**Alternativas consideradas**: inteiro epoch em milissegundos — igualmente correto e um
pouco mais compacto, rejeitado por ser ilegível na inspeção manual do banco e por divergir
do `seed.json`.

---

## R-004 — `OpsStore` é a `OpsRepository` que já existe

**Decisão**: manter o nome `OpsRepository` (`src/store/repository.ts`) e **estender** a
interface com os dois métodos de leitura novos. Nenhum renomeio.

**Rationale**: o pedido cita "a interface OpsStore existente"; a interface que existe
chama-se `OpsRepository`. Renomear tocaria seis arquivos para mudar zero comportamento —
custo de revisão sem valor, e o nome atual é o correto para o padrão (é um repositório:
coleção de agregados, não um armazenamento chave-valor). A classe nova, essa sim, usa o
nome pedido: `SqliteOpsStore` em `src/store/sqlite-ops-store.ts`.

**Extensão da interface** (aditiva, ambas as implementações a satisfazem):

```ts
listIncidents(status?: IncidentStatus): Incident[];   // ausente ⇒ todos
findRunbook(serviceId: string): Runbook | undefined;
```

**Alternativa considerada**: renomear `OpsRepository` → `OpsStore` para casar com o pedido
ao pé da letra. Rejeitada: mudança de nome em massa não é o que a feature entrega.

---

## R-005 — `seed.json` continua sendo a fonte única do cenário base

**Decisão**: o cenário "Mercadinho" permanece declarado em `src/store/seed.json`, agora
com `tier` nos serviços e uma coleção `runbooks`. O seed do SQLite **lê esse arquivo** e o
escreve no banco; ele não redeclara os dados em SQL.

**Rationale**: sem isso o projeto passaria a ter duas cópias do mesmo cenário — o JSON que
alimenta o store in-memory (testes, bench) e um SQL literal que alimenta o banco. Elas
divergiriam na primeira mudança, e o bench passaria a comparar estratégias sobre um mundo
diferente do que a API atende. Uma fonte, dois destinos.

**Consequência**: `baselineState()` (que já valida o arquivo com zod) segue sendo o
carregador do cenário para ambos os caminhos. `seedDatabase(db, state)` recebe um
`WorldState` já validado, e não um caminho de arquivo — o que a torna testável com um
cenário mínimo inventado no próprio teste.

---

## R-006 — Seed idempotente por upsert, incidentes intocados

**Decisão**: `INSERT INTO ... ON CONFLICT(id) DO UPDATE SET ...` para serviços, alertas e
runbooks. A tabela de incidentes **não é tocada** pelo seed.

**Rationale**: FR-026 exige idempotência e FR-027 exige preservar o trabalho do plantão. O
upsert dá as duas: rodar o seed N vezes reafirma o cenário base (e corrige uma linha que
tenha sido editada à mão), sem duplicar nada, sem apagar nada. Incidentes são dados de uso,
não cenário — o seed não tem o que dizer sobre eles.

✅ **Verificado**: `INSERT OR IGNORE` sobre chave existente devolve `changes: 0` — funciona
para não duplicar, mas **não** reaplica uma mudança no `seed.json` a um banco já semeado,
o que faria o arquivo e o banco divergirem silenciosamente. Por isso upsert, não ignore.

**Nota sobre alertas**: nenhuma ferramenta atual escreve em alertas, então reafirmá-los não
descarta trabalho. Se algum dia uma ferramenta puder alterar o status de um alerta, esta
decisão precisa ser revista — registrado aqui para quem chegar depois.

---

## R-007 — `CHECK` no banco, `enum` no zod, e um teste que impede a divergência

**Decisão**: escrever os `CHECK` literalmente no DDL **e** adicionar um teste que compara
o conjunto de valores aceito por cada `CHECK` com `.options` do enum zod correspondente.

**Rationale**: FR-018 quer a restrição no banco; o Princípio I quer o domínio definido uma
vez só em zod. Gerar o DDL a partir dos enums resolveria por construção, mas produziria SQL
montado por interpolação de strings — exatamente o que o Princípio II proíbe, e a exceção
"mas aqui os valores são confiáveis" é a porta que nunca deveria abrir. A saída é DDL
literal (auditável, sem construção dinâmica) com um teste que falha no instante em que
alguém acrescenta uma severidade ao enum e esquece da tabela.

✅ **Verificado**: violação de `CHECK` lança `Error` com `code: 'ERR_SQLITE_ERROR'` e
mensagem `CHECK constraint failed: ...` — capturável e assertável em teste.

---

## R-008 — Chaves estrangeiras já vêm ligadas, mas são declaradas explicitamente

**Decisão**: declarar `REFERENCES services(id)` nas três tabelas dependentes e executar
`PRAGMA foreign_keys = ON` explicitamente na abertura.

**Rationale**: no SQLite via CLI, chaves estrangeiras são **desligadas** por padrão — uma
armadilha clássica em que a restrição existe no DDL e não é aplicada.

✅ **Verificado**: `DatabaseSync` liga o pragma por padrão (`pragma foreign_keys` devolve
`1` sem nenhuma configuração), e a violação lança `FOREIGN KEY constraint failed`. Ainda
assim o pragma é executado explicitamente: custa uma linha e torna a garantia independente
de um default de biblioteca experimental que pode mudar.

---

## R-009 — Resolver incidente sem janela de corrida

**Decisão**: `UPDATE incidents SET status='resolved', resolved_at=? WHERE id=? AND
status='open'`, e decidir o erro pelo `changes` devolvido mais um `SELECT` de
desambiguação.

**Rationale**: a alternativa óbvia — `SELECT` para checar, depois `UPDATE` — é um
read-modify-write com janela entre os dois. Aqui ela não chega a causar bug (a API é
síncrona e o Node é monothread, então nada roda entre as duas chamadas), mas o `UPDATE`
condicional é mais curto, atômico por construção e não depende desse argumento para estar
correto. `changes === 1` ⇒ resolvido; `changes === 0` ⇒ consultar a linha para distinguir
`IncidentNotFoundError` de `IncidentAlreadyResolvedError`, preservando os mesmos erros de
domínio que o store in-memory levanta hoje (FR-012).

**Efeito colateral desejado**: `resolved_at` original nunca é sobrescrito por uma segunda
resolução — o `WHERE status='open'` impede.

---

## R-010 — Transações: só onde há mais de uma escrita

**Decisão**: envolver **o seed** numa transação (`BEGIN`/`COMMIT` via `exec`). As operações
de ferramenta — abrir e resolver incidente — são uma única instrução cada e não precisam.

**Rationale**: transação é proteção contra estado meio-escrito. O seed escreve 5 serviços,
6 alertas e 3 runbooks: falhar no meio deixaria o cenário base incompleto, e o `data/`
gitignorado significa que ninguém vai perceber até o primeiro pedido estranho. Abrir um
incidente é um `INSERT`; envolvê-lo numa transação seria cerimônia sem conteúdo.

---

## R-011 — `OPSPILOT_DB` é entrada externa e é validada com zod

**Decisão**: resolver o caminho num único ponto, validado com zod
(`z.string().min(1).default('./data/opspilot.db')`), e criar a pasta com
`mkdirSync(dirname, { recursive: true })` antes de abrir — exceto quando o valor é
`":memory:"`.

**Rationale**: a convenção do projeto é que toda entrada externa passa por zod (mesmo
movimento que `PORT` recebeu na 003). `OPSPILOT_DB=""` precisa falhar dizendo o porquê, não
virar um caminho vazio. A criação da pasta atende FR-006: quem clona o repositório não tem
`data/`, e exigir um `mkdir` manual antes do primeiro `npm run dev` seria um passo de
preparação — proibido pelo Princípio II.

**Caso especial**: `":memory:"` não tem diretório. O tratamento é uma comparação explícita,
não uma heurística sobre o formato do caminho.

---

## R-012 — Sem WAL, sem pool, sem cache

**Decisão**: uma conexão `DatabaseSync` por instância de store, `journal_mode` no padrão,
nenhum pool e nenhum cache de leitura.

**Rationale**: o cenário de uso é um processo, tabelas com dezenas de linhas, e latência
dominada por chamadas de modelo que levam segundos. WAL resolve concorrência de leitura sob
escrita — problema que não existe aqui — e traz arquivos `-wal`/`-shm` junto. Pool não faz
sentido com API síncrona. Cache seria uma segunda fonte de verdade sobre o estado. O
Princípio de simplicidade da governança pede que cada um deles só entre com um problema
medido para justificar.

**Statements preparados**: preparados **uma vez no construtor** e reutilizados, que é o
ganho real de desempenho aqui e, mais importante, a garantia estrutural de que nenhuma
consulta é montada por concatenação (FR-021) — não há caminho no código que produza SQL em
tempo de execução.

---

## R-013 — O filtro de status sem SQL dinâmico

**Decisão**: dois statements preparados distintos (um com `WHERE status = ?`, um sem
`WHERE`), escolhidos por `if`. Nunca um statement montado com o `WHERE` concatenado
condicionalmente.

**Rationale**: "montar o `WHERE` só quando tem filtro" é a forma mais comum e mais inocente
de SQL concatenado entrar num projeto — e depois de aberta, a mesma função vira o lugar
onde o próximo filtro entra por interpolação. Dois statements fixos custam três linhas e
fecham a porta (FR-021, FR-022, SC-005).

---

## R-014 — O bench e a arena continuam no store in-memory

**Decisão**: `src/bench.ts` e `src/arena.ts` continuam instanciando
`InMemoryOpsRepository`. Só a API HTTP (`src/index.ts` → `createApp`) recebe o
`SqliteOpsStore`.

**Rationale**: FR-030 e FR-031 exigem que cada cenário e cada estratégia partam do mesmo
estado inicial e isolado — que é precisamente o que a persistência quebra. Além disso, o
contrato de verificação de acerto do bench (`Scenario.check(initial, final)`) opera sobre
`WorldState`, um snapshot que só o store in-memory expõe; fazer o SQLite produzi-lo
exigiria um método de snapshot na interface que ninguém mais usa.

**Decisão sobre a arena**: fica in-memory. Ela é uma bancada de comparação — duas
estratégias no mesmo pedido, partindo do mesmo ponto —, e persistir suas escritas faria a
segunda estratégia enxergar os incidentes abertos pela primeira. É o mesmo argumento do
bench, e o pedido menciona a composição de uso real ("composição injeta o SqliteOpsStore"),
não a bancada.

**Consequência de escopo**: `WorldState` ganha `runbooks` para que a ferramenta de runbook
funcione igual nas duas implementações.

---

## R-015 — As ferramentas existentes não têm teste dedicado hoje ⚠️

**Decisão**: criar `src/agents/tools.test.ts`, rodando sobre `SqliteOpsStore(':memory:')`.

**Rationale**: FR-039 fala em "os testes das ferramentas existentes passam a rodar sobre
`':memory:'`". A verificação do repositório mostra que **esses testes não existem**: não há
`src/agents/tools.test.ts`. O que existe hoje que toca o store é `src/store/state.test.ts`
(transições puras, sem store) e as construções de `InMemoryOpsRepository` dentro de
`src/agents/index.test.ts` e `src/http/server.test.ts`, que testam outra coisa.

Então o requisito, lido honestamente, é **criar** a cobertura das cinco ferramentas sobre um
banco efêmero — incluindo o que hoje não é verificado em lugar nenhum: que
`open_incident` com serviço inexistente devolve observação de erro em vez de estourar, e
que os erros de domínio viram observação legível sem abortar a execução.

---

## R-016 — Os testes não deixam rastro no disco

**Decisão**: todo teste abre `':memory:'`; nenhum teste escreve em `data/`. Cada caso de
teste cria seu próprio banco e o fecha no fim.

**Rationale**: FR-032 e o Princípio V. Bancos em memória também tornam os testes rápidos e
independentes de ordem por construção, sem nenhuma limpeza entre casos. A persistência
entre aberturas (FR-040) é o único caso que precisa de arquivo: ele usa um caminho dentro
de `os.tmpdir()`, removido no fim — fora da árvore do projeto.

---

## R-017 — `tier` entra no domínio pelo esquema, não só pela tabela

**Decisão**: `serviceSchema` ganha `tier: z.enum(['tier-1','tier-2','tier-3'])`, o
`seed.json` ganha o campo nos cinco serviços, e o serviço `catalog` do bench
(`src/bench/scenarios.ts`) ganha o seu.

**Rationale**: o Princípio I exige uma definição única por entidade. Um `CHECK(tier IN ...)`
no banco sem campo correspondente no zod criaria um atributo que existe no armazenamento e
não no domínio — invisível para as ferramentas e impossível de validar na leitura (FR-023).

**⚠️ Suposição a confirmar** (herdada da spec): o conjunto de valores e a atribuição
(checkout/payments/auth = `tier-1`, search = `tier-2`, notifications = `tier-3`). Confirmar
antes de implementar; é uma linha em cada um de três arquivos se mudar.

---

## R-018 — `summary` do incidente: coluna e campo, sem produtor

**Decisão**: `incidentSchema` ganha `summary: z.string().nullable()`, a coluna é
`summary TEXT` (anulável), e nenhuma ferramenta a preenche nesta feature.

**Rationale**: está no pedido, e criar a coluna agora evita uma alteração de estrutura
depois. Mas inventar um produtor — por exemplo, `resolve_incident` passando a aceitar um
resumo — mudaria o esquema de uma ferramenta existente sem que a spec pedisse, e mexer no
esquema de ferramenta é mexer na interface que o modelo enxerga.

**⚠️ Suposição a confirmar**: se a intenção era que `resolve_incident` aceitasse um resumo
no encerramento, é escopo adicional e precisa ser dito — a mudança é pequena, mas não é
esta feature.

---

## R-019 — `sequelize` e `mysql2` saem do `package.json`

**Decisão**: remover as duas dependências e corrigir a linha de stack em
`.github/copilot-instructions.md`.

**Rationale**: ✅ **verificado** que nenhum arquivo de `src/` as importa — estão instaladas
e nunca foram usadas. Com o Princípio II ratificado, elas passam de "peso morto" a
"contradição com a governança": um ORM e um driver de banco externo declarados num projeto
que proíbe os dois. O plano da 003 já as tinha registrado como divergência pendente; esta é
a feature em que a pendência se resolve, porque é ela que decide a persistência.

**Alternativa considerada**: deixá-las e só corrigir a documentação. Rejeitada — a próxima
pessoa a ler o `package.json` acredita no `package.json`, não no comentário.

---

## R-020 — Nomes das ferramentas novas

**Decisão**: usar os nomes pedidos, `list_incidents` e `consultar_runbook`.

**Rationale**: são os nomes do pedido e nomes de ferramenta são interface com o modelo —
trocá-los por conta própria é mudar o contrato que a spec fixou.

**⚠️ Observação registrada, não decidida aqui**: as três ferramentas atuais têm nome em
inglês (`list_alerts`, `open_incident`, `resolve_incident`) e as descrições em português.
`consultar_runbook` quebra esse padrão. Não há efeito funcional — o modelo lida bem com
qualquer um dos dois —, mas se a preferência for consistência, `get_runbook` é o nome
equivalente. Uma palavra a trocar, se for o caso.

---

## Resumo das incógnitas resolvidas

| # | Incógnita | Resolvida em |
|---|---|---|
| 1 | Driver de acesso a SQLite compatível com a interface síncrona | R-001 |
| 2 | Ruído do aviso experimental em toda execução | R-002 |
| 3 | Como datas atravessam a fronteira sem se perderem | R-003 ⚠️ |
| 4 | Nome e forma da interface a implementar | R-004 |
| 5 | Onde o cenário base passa a viver | R-005, R-006 |
| 6 | Como manter `CHECK` e enum zod em sincronia | R-007 |
| 7 | Integridade referencial de fato aplicada | R-008 |
| 8 | Atomicidade de resolver incidente | R-009, R-010 |
| 9 | Configuração e criação do caminho de dados | R-011 |
| 10 | Quanto de infraestrutura de banco é justificável | R-012, R-013 |
| 11 | Como preservar a reprodutibilidade de arena e bench | R-014 |
| 12 | O que exatamente FR-039 pede | R-015 ⚠️ |
| 13 | Testes sem rastro no disco | R-016 |
| 14 | Campos novos de domínio (`tier`, `summary`) | R-017 ⚠️, R-018 ⚠️ |
| 15 | Dependências que a constituição passou a proibir | R-019 |
| 16 | Nomenclatura das ferramentas novas | R-020 ⚠️ |

⚠️ = contém suposição a confirmar ou achado que altera a leitura ingênua do pedido.
