# Contract: `OpsRepository` e `SqliteOpsStore`

**Feature**: `004-sqlite-persistence` | Satisfaz FR-009 a FR-013, FR-028, FR-029

Amplia o contrato de repositório estabelecido na 001. A interface **permanece síncrona** —
ver R-001; é a premissa que torna a feature barata, e abandoná-la invalida o plano.

---

## A interface

```ts
export interface AlertRepository {
  listAlerts(status?: AlertStatus): Alert[];
  findService(id: string): Service | undefined;
}

export interface IncidentRepository {
  openIncident(input: { title; serviceId; severity }): Incident;
  resolveIncident(id: string): Incident;
  getIncident(id: string): Incident | undefined;
  listIncidents(status?: IncidentStatus): Incident[];        // NOVO — FR-028
}

export interface RunbookRepository {                          // NOVO
  findRunbook(serviceId: string): Runbook | undefined;        // NOVO — FR-029
}

export type OpsRepository = AlertRepository & IncidentRepository & RunbookRepository;
```

**Sobre o nome** (R-004): o pedido fala em `OpsStore`; a interface existente chama-se
`OpsRepository` e mantém o nome — é um repositório, e renomear tocaria seis arquivos para
mudar zero comportamento. A classe nova usa o nome pedido: `SqliteOpsStore`.

**Duas implementações, mesmas garantias**: `InMemoryOpsRepository` e `SqliteOpsStore`
satisfazem este contrato por inteiro. As ferramentas não sabem qual está em uso, e essa
indistinguibilidade é testável: a mesma bateria de asserções roda contra as duas.

---

## Invariantes do contrato

| # | Invariante | Requisito |
|---|---|---|
| C1 | `listAlerts()` sem argumento devolve todos; com argumento, filtra | FR-012 |
| C2 | `listIncidents()` sem argumento devolve **todos** — o default "em aberto" é da ferramenta, não do repositório | FR-028 |
| C3 | Consulta sem resultado devolve `[]` ou `undefined`, nunca lança | FR-029b |
| C4 | `openIncident` com serviço inexistente lança `ServiceNotFoundError` e **não grava nada** | FR-012 |
| C5 | `resolveIncident` inexistente ⇒ `IncidentNotFoundError`; já resolvido ⇒ `IncidentAlreadyResolvedError` | FR-012 |
| C6 | `resolved_at` da primeira resolução nunca é sobrescrito | Edge case da spec |
| C7 | Id de incidente é gerado pelo repositório (`inc-<uuid>`), nunca pelo chamador | Princípio I |
| C8 | Relógio é lido pelo repositório, nunca pelas transições puras | Princípio I |
| C9 | O objeto devolvido por `openIncident`/`resolveIncident` é o estado **gravado**, relido e validado — não o objeto que o chamador montou | FR-023 |
| C10 | Ordem de listagem é determinística (cronológica) | Testabilidade |

**C2 merece atenção**: é o tipo de default que, colocado na camada errada, vira um bug
difícil de enxergar. `listIncidents()` no repositório devolve tudo, como `listAlerts()`;
quem aplica o default "em aberto" é o esquema da ferramenta (FR-028). Um repositório que
escondesse os resolvidos por padrão mentiria para todos os outros consumidores.

**C9 merece atenção**: devolver o objeto relido, e não o montado em memória, é o que faz um
`CHECK` violado ou uma data perdida virar falha visível no ponto da escrita — em vez de um
retorno bonito sobre um banco com dado errado.

---

## `SqliteOpsStore` — obrigações específicas

```ts
class SqliteOpsStore implements OpsRepository {
  constructor(db: DatabaseSync);      // recebe a conexão; não a abre
  close(): void;
}
```

| # | Obrigação | Onde |
|---|---|---|
| Q1 | DDL idempotente aplicado no construtor | FR-004, FR-005 |
| Q2 | Todos os statements preparados no construtor, reutilizados | FR-021, R-012 |
| Q3 | Nenhum SQL montado em tempo de execução, nem para filtro opcional | FR-021, FR-022, R-013 |
| Q4 | Datas convertidas na borda; nenhum `Date` chega a um parâmetro ligado | FR-020, R-003 ⚠️ |
| Q5 | Toda linha lida validada pelo esquema zod correspondente | FR-023 |
| Q6 | Erros de domínio idênticos aos do store in-memory, nas mesmas situações | FR-012 |
| Q7 | `close()` libera a conexão; testes fecham o que abrem | R-016 |

**Recebe a conexão, não a abre** (Q-construtor): é o que permite ao teste passar um
`DatabaseSync(':memory:')` direto, sem tocar em `OPSPILOT_DB` nem no sistema de arquivos.
A resolução de caminho vive em `openDatabase()`, separada de propósito — ver
[database-schema.md](./database-schema.md).

---

## Tradução de erro técnico

Erro do SQLite (`ERR_SQLITE_ERROR`) **não** é erro de domínio e **não** é traduzido em
observação para o modelo. Violação de `CHECK` ou de chave estrangeira significa que a
validação de aplicação falhou em deixar passar — um bug, não uma situação prevista — e
deve propagar e encerrar a execução, como manda a convenção de erros do projeto.

O caminho normal é que o erro de domínio seja levantado **antes** do SQL: `openIncident`
verifica o serviço e lança `ServiceNotFoundError` sem chegar ao banco. O `CHECK` e a chave
estrangeira são a segunda linha de defesa (FR-018, SC-004), não a primeira.

---

## Composição

| Entrada | Store | Motivo |
|---|---|---|
| `src/index.ts` → `createApp` | `SqliteOpsStore` | Uso real; estado durável (FR-010) |
| `src/arena.ts` | `InMemoryOpsRepository` | Comparação exige o mesmo ponto de partida (R-014) |
| `src/bench.ts` | `InMemoryOpsRepository` | FR-030, FR-031; `Scenario.check` opera sobre `WorldState` |
| `src/scripts/seed.ts` | banco durável | Semear é escrever no que persiste (FR-024) |
| Testes | `SqliteOpsStore(':memory:')` | FR-038, FR-039, FR-032 |

**`src/http/server.ts` NÃO muda de default** (⚠️ correção feita durante a implementação).
`createApp()` continua com `deps.store ?? new InMemoryOpsRepository(baselineState())`.
Verificado contra `src/http/server.test.ts`: apenas 1 dos ~15 casos injeta `store`
explicitamente; os demais dependem desse default. Trocá-lo por `SqliteOpsStore` abriria
`./data/opspilot.db` de verdade em cada um dos outros, violando FR-032. A injeção durável
fica restrita a `src/index.ts` (a composição real de uso, FR-010) — que é o que a tabela
acima já descreve.

**Ciclo de vida**: uma conexão por processo, aberta no bootstrap, viva enquanto o processo
vive. Sem pool (a API é síncrona), sem reconexão (é um arquivo local).

---

## Concorrência

O `DatabaseSync` é síncrono e o Node é monothread: **nenhum outro trabalho roda entre o
início e o fim de uma operação do repositório**. Não há intercalação possível dentro de um
processo, e por isso não há lock, fila nem transação nas operações de ferramenta (R-010).

`resolveIncident` ainda assim usa `UPDATE ... WHERE id=? AND status='open'` em vez de
`SELECT` seguido de `UPDATE` (R-009): é atômico por construção, e não depende do argumento
acima para estar correto.

**Fora de escopo**: dois processos sobre o mesmo arquivo. A spec fixa um processo como o
cenário de uso (Assumptions).
