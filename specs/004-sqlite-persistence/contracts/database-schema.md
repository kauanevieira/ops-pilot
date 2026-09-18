# Contract: Esquema do banco e seed

**Feature**: `004-sqlite-persistence` | Satisfaz FR-001 a FR-008, FR-014 a FR-027

O DDL é **texto literal**. Nenhuma parte dele é gerada, interpolada ou montada em tempo de
execução (Princípio II; R-007).

---

## DDL

Aplicado por `db.exec(SCHEMA_SQL)` no construtor do `SqliteOpsStore`. Todo statement usa
`IF NOT EXISTS`: abrir um banco já estruturado não altera nada e não falha (FR-005).

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  tier  TEXT NOT NULL CHECK (tier IN ('tier-1','tier-2','tier-3'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  summary    TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status     TEXT NOT NULL CHECK (status IN ('firing','resolved')),
  fired_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  service_id  TEXT NOT NULL REFERENCES services(id),
  severity    TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status      TEXT NOT NULL CHECK (status IN ('open','resolved')),
  opened_at   TEXT NOT NULL,
  resolved_at TEXT,
  summary     TEXT
);

CREATE TABLE IF NOT EXISTS runbooks (
  service_id TEXT PRIMARY KEY REFERENCES services(id),
  title      TEXT NOT NULL,
  steps      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(status);
```

### Obrigações do DDL

| # | Obrigação | Requisito |
|---|---|---|
| D1 | Idempotente: aplicar N vezes ≡ aplicar 1 vez | FR-005 |
| D2 | Aplicado na abertura, sem passo manual de migração | FR-004 |
| D3 | `CHECK` em todo campo de conjunto fechado | FR-018 |
| D4 | Chave estrangeira declarada e **aplicada** | FR-019 |
| D5 | `NOT NULL` em toda data obrigatória — rede contra a falha silenciosa do `Date` (R-003) | FR-020 |
| D6 | Nenhuma parte do DDL construída dinamicamente | FR-021 |

### Sincronia entre `CHECK` e enums zod

Os conjuntos aceitos aparecem em dois lugares: no `CHECK` acima e nos enums de
`src/domain/schemas.ts`. **Um teste compara os dois** e falha se divergirem:

```text
para cada (coluna, enum):
  extrair os valores do CHECK a partir de sqlite_master
  comparar, como conjunto, com <enum>.options
```

É essa comparação que torna aceitável ter o DDL literal em vez de gerado (R-007). Sem ela,
acrescentar uma severidade ao enum passaria no `typecheck`, passaria nos testes, e falharia
em produção na primeira gravação.

---

## Abertura do banco — `openDatabase()`

```ts
openDatabase(path?: string): DatabaseSync
```

1. Resolve o caminho: argumento → `OPSPILOT_DB` → `./data/opspilot.db`, validado com
   `z.string().min(1)` (R-011). `OPSPILOT_DB=""` falha com mensagem, não vira caminho vazio.
2. Se o caminho **não** é `':memory:'`: `mkdirSync(dirname(path), { recursive: true })`
   (FR-006).
3. Abre `new DatabaseSync(path)` e executa `PRAGMA foreign_keys = ON` (R-008 — já é o
   default do `DatabaseSync`, declarado explicitamente para não depender dele).
4. Falha na abertura propaga com o **caminho e a causa** na mensagem (FR-008).

---

## Seed — `seedDatabase(db, state)`

**Assinatura**: recebe um `WorldState` já validado, não um caminho de arquivo. É o que
permite testá-lo com um cenário mínimo inventado no próprio teste, em vez de depender do
`seed.json` real (R-005).

**Origem dos dados**: `baselineState()`, que lê e valida `src/store/seed.json` — a fonte
única do cenário "Mercadinho" para o store in-memory e para o banco (R-005).

**Cenário base** (FR-024, FR-025): 5 serviços, 6 alertas (3 `firing`, 3 `resolved`),
3 runbooks — `checkout`, `payments`, `auth`.

### Estratégia: upsert, dentro de uma transação

```sql
INSERT INTO services (id, name, tier) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier;
```

Mesma forma para `alerts` e `runbooks`. Tudo envolvido em `BEGIN`/`COMMIT` (R-010): o seed
escreve 14 linhas, e falhar no meio deixaria o cenário base incompleto dentro de um `data/`
gitignorado que ninguém inspeciona.

### Obrigações do seed

| # | Obrigação | Requisito |
|---|---|---|
| S1 | Idempotente: N execuções ⇒ mesmo estado, sem duplicatas | FR-026 |
| S2 | **Nunca** toca a tabela `incidents` | FR-027 |
| S3 | Reaplica mudanças do `seed.json` a um banco já semeado (upsert, não `OR IGNORE`) | FR-026 |
| S4 | Atômico: ou o cenário inteiro entra, ou nada entra | — (R-010) |
| S5 | Statements preparados, parâmetros ligados | FR-021 |

**Por que upsert e não `INSERT OR IGNORE`**: `OR IGNORE` não duplica, mas também não
reaplica — um `seed.json` corrigido nunca chegaria a um banco já semeado, e arquivo e banco
divergiriam em silêncio (R-006, verificado: `changes: 0` sobre chave existente).

**Ressalva registrada**: reafirmar alertas é seguro **porque nenhuma ferramenta atual
escreve neles**. Se alguma ferramenta passar a alterar status de alerta, esta decisão
descarta esse trabalho a cada seed e precisa ser revista.

---

## Consultas

Todas preparadas **uma vez no construtor** e reutilizadas. A lista é fechada — não há
caminho no código que produza SQL em tempo de execução (FR-021, FR-022, SC-005).

| Statement | SQL | Usado por |
|---|---|---|
| `selectAlertsAll` | `SELECT * FROM alerts ORDER BY fired_at` | `listAlerts()` |
| `selectAlertsByStatus` | `SELECT * FROM alerts WHERE status = ? ORDER BY fired_at` | `listAlerts(status)` |
| `selectService` | `SELECT * FROM services WHERE id = ?` | `findService` |
| `insertIncident` | `INSERT INTO incidents (...) VALUES (?,?,?,?,?,?,?,?)` | `openIncident` |
| `selectIncident` | `SELECT * FROM incidents WHERE id = ?` | `getIncident`, desambiguação |
| `selectIncidentsAll` | `SELECT * FROM incidents ORDER BY opened_at` | `listIncidents()` |
| `selectIncidentsByStatus` | `SELECT * FROM incidents WHERE status = ? ORDER BY opened_at` | `listIncidents(status)` |
| `updateIncidentResolved` | `UPDATE incidents SET status='resolved', resolved_at=? WHERE id=? AND status='open'` | `resolveIncident` |
| `selectRunbook` | `SELECT * FROM runbooks WHERE service_id = ?` | `findRunbook` |

**Dois statements para o filtro, não um `WHERE` condicional** (R-013): "montar o `WHERE` só
quando tem filtro" é a forma mais comum de SQL concatenado entrar num projeto, e a função
que aceita isso uma vez vira o lugar onde o próximo filtro entra por interpolação.

**`ORDER BY` explícito em toda listagem**: sem ele a ordem é a que o SQLite quiser devolver,
e um teste que hoje passa por acaso quebra quando um índice muda. As datas em ISO-8601
ordenam lexicograficamente, então `ORDER BY fired_at` é ordem cronológica de fato — o que o
cenário C3 do bench assume ao pedir "o alerta mais antigo".

---

## Casos de borda cobertos por teste

| Caso | Comportamento esperado |
|---|---|
| Pasta de `OPSPILOT_DB` inexistente | Criada; abertura funciona (FR-006) |
| `OPSPILOT_DB=""` | Falha na validação, com mensagem (R-011) |
| Banco já estruturado | DDL não altera nada (FR-005) |
| Seed × N | Mesmo estado; incidentes preservados (FR-026, FR-027) |
| `tier`/`severity`/`status` fora do conjunto | `ERR_SQLITE_ERROR: CHECK constraint failed` (FR-018, SC-004) |
| `service_id` inexistente gravado direto | `FOREIGN KEY constraint failed` (FR-019) |
| Data gravada e relida | `getTime()` idêntico; nenhuma coluna `NULL` (R-003, FR-020) |
| Texto com aspas/acentos em título ou passo | Gravado e lido idêntico; estrutura da consulta intacta (FR-022) |
| `steps` com JSON inválido no banco | Erro de validação zod na leitura, não objeto meio-formado (FR-023) |
