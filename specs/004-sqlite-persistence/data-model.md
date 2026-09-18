# Data Model: Persistência real de operações

**Feature**: `004-sqlite-persistence` | **Fase**: 1 | **Data**: 2026-09-18

Cobre três camadas e o mapeamento entre elas: os tipos de domínio (zod, fonte única),
o esquema físico (SQLite) e a conversão na borda. O DDL completo e os índices estão em
[contracts/database-schema.md](./contracts/database-schema.md); aqui está o *porquê* de
cada campo.

---

## 1. Tipos de domínio — `src/domain/schemas.ts`

### Alterados

```ts
export const serviceTierSchema = z.enum(["tier-1", "tier-2", "tier-3"]);   // NOVO

export const serviceSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  tier: serviceTierSchema,                                                 // NOVO (FR-015)
});

export const incidentSchema = z.object({
  /* ... campos atuais ... */
  resolvedAt: z.date().nullable(),        // já existia
  summary: z.string().nullable(),         // NOVO (FR-016)
});
```

### Novo

```ts
export const runbookSchema = z.object({
  serviceId: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),   // ordem é significativa (FR-017)
});
```

**Decisões de modelagem**:

- **`tier` é enum, não número.** `tier: 1 | 2 | 3` seria mais curto, mas a Regra 6 do
  Princípio IV exige conjunto fechado como enum na interface que o modelo enxerga, e um
  inteiro convida a comparações de ordem (`tier < 2`) que ninguém definiu. Ver R-017 para a
  suposição ainda aberta sobre os valores.
- **`summary` é `nullable`, não `optional`.** `null` significa "não há resumo", um estado
  explícito; `undefined` significaria "o campo pode não ter vindo", que é ruído de
  serialização. É a mesma escolha que `resolvedAt` já faz.
- **`runbook` não tem `id` próprio.** A relação com serviço é 1-para-1 (FR-017: "associado
  a exatamente um serviço"), então `serviceId` **é** a chave. Um id sintético seria um
  segundo identificador para a mesma coisa.
- **`steps` é array de texto, não tabela filha.** A ordem vem do array e é preservada por
  construção; ver a decisão de armazenamento em §3.

### Erro de domínio novo — `src/domain/errors.ts`

```ts
export class RunbookNotFoundError extends DomainError {
  constructor(serviceId: string) { super(`Runbook not found for service: ${serviceId}`); }
}
```

Existe para atender FR-029a: serviço **existe mas não tem runbook** é diferente de serviço
inexistente (`ServiceNotFoundError`, que já existe). São dois recados distintos para quem
está de plantão — "esse serviço não tem procedimento escrito" versus "esse serviço não
existe, confira o nome" — e o modelo age diferente em cada caso.

---

## 2. `WorldState` — `src/store/types.ts`

```ts
export interface WorldState {
  readonly services: readonly Service[];
  readonly alerts: readonly Alert[];
  readonly incidents: readonly Incident[];
  readonly runbooks: readonly Runbook[];   // NOVO
}
```

Necessário para que `consultar_runbook` funcione igual nas duas implementações do
repositório (R-014): o bench e a arena seguem no store in-memory, e uma ferramenta que só
funcionasse sobre SQLite tornaria o bench incapaz de exercitá-la.

---

## 3. Esquema físico — SQLite

Quatro tabelas. Nomes de coluna em `snake_case` (convenção SQL); a tradução para o
`camelCase` do domínio é responsabilidade do store, num único ponto por tabela.

| Tabela | Chave primária | Referências | `CHECK` |
|---|---|---|---|
| `services` | `id` (slug) | — | `tier` |
| `alerts` | `id` | `service_id → services(id)` | `severity`, `status` |
| `incidents` | `id` | `service_id → services(id)` | `severity`, `status` |
| `runbooks` | `service_id` | `service_id → services(id)` | — |

### Colunas por tabela

**`services`** — `id TEXT PK`, `name TEXT NOT NULL`, `tier TEXT NOT NULL CHECK`.

**`alerts`** — `id TEXT PK`, `service_id TEXT NOT NULL REFERENCES`, `summary TEXT NOT NULL`,
`severity TEXT NOT NULL CHECK`, `status TEXT NOT NULL CHECK`, `fired_at TEXT NOT NULL`.

**`incidents`** — `id TEXT PK`, `title TEXT NOT NULL`, `service_id TEXT NOT NULL REFERENCES`,
`severity TEXT NOT NULL CHECK`, `status TEXT NOT NULL CHECK`, `opened_at TEXT NOT NULL`,
`resolved_at TEXT` (anulável), `summary TEXT` (anulável).

**`runbooks`** — `service_id TEXT PK REFERENCES`, `title TEXT NOT NULL`,
`steps TEXT NOT NULL` (JSON).

### Decisões de armazenamento

- **`steps` como JSON numa coluna de texto.** A alternativa — tabela `runbook_steps` com
  `position` — é a modelagem relacional canônica e está errada para este caso: os passos
  nunca são consultados individualmente, nunca são filtrados, nunca são contados; são
  sempre lidos inteiros junto com o runbook. Uma tabela filha adicionaria um `JOIN`, um
  `ORDER BY position` e uma classe inteira de bug (posições duplicadas, buracos na
  sequência) para servir zero consulta real. O array é validado por `runbookSchema` na
  leitura (FR-023), então JSON malformado vira erro de validação, não dado silenciosamente
  errado.
- **Datas como `TEXT` ISO-8601 UTC.** Ver R-003 — é a decisão mais importante do esquema.
  Ordenável lexicograficamente, legível na inspeção manual, sem ambiguidade de fuso, e a
  mesma representação que o `seed.json` já usa.
- **`NOT NULL` em toda data obrigatória.** Não é decoração: como `Date` ligado a um
  parâmetro grava `NULL` sem lançar (R-003, verificado), o `NOT NULL` é o que transforma um
  esquecimento de conversão em exceção imediata em vez de horário perdido.
- **Sem `created_at`/`updated_at` de auditoria.** Nenhum requisito os pede. `opened_at` e
  `resolved_at` são dados de domínio, não metadados de linha.

### Índices

Além dos implícitos das chaves primárias:

```sql
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_alerts_status   ON alerts(status);
```

Ambas as colunas são o filtro de `list_incidents` e `list_alerts`. Com dezenas de linhas o
ganho é nulo hoje — entram porque são as duas consultas mais frequentes do sistema e o
custo é uma linha de DDL. Nenhum outro índice: `service_id` não é filtro de nenhuma
consulta (o runbook é buscado pela própria PK), e índice sem consulta é só escrita mais
lenta.

---

## 4. Mapeamento domínio ↔ linha

Um único ponto de conversão por entidade, dentro de `SqliteOpsStore`.

| Domínio | Coluna | Escrita | Leitura |
|---|---|---|---|
| `Service.tier` | `tier` | direto | `serviceSchema` valida |
| `Alert.firedAt` | `fired_at` | `date.toISOString()` | `z.coerce.date()` |
| `Incident.openedAt` | `opened_at` | `date.toISOString()` | `z.coerce.date()` |
| `Incident.resolvedAt` | `resolved_at` | `date?.toISOString() ?? null` | `z.coerce.date().nullable()` |
| `Incident.summary` | `summary` | direto (`null` quando ausente) | direto |
| `Runbook.steps` | `steps` | `JSON.stringify(steps)` | `JSON.parse` + `runbookSchema` |

**Regra invariante**: nenhum `Date` e nenhum `boolean` é passado a um parâmetro ligado.
`Date` grava `NULL` em silêncio; `boolean` lança `ERR_INVALID_ARG_TYPE` (ambos verificados,
R-003). Não há campo booleano no domínio hoje — se algum entrar, a conversão para `0`/`1`
é obrigatória.

**Validação na leitura** (FR-023): toda linha lida passa pelo esquema zod correspondente
antes de virar um objeto de domínio. O banco pode ter sido editado à mão, vir de uma versão
anterior do esquema, ou conter um JSON de `steps` truncado — a validação é o que garante
que as ferramentas nunca recebem um objeto que só parece um `Incident`.

---

## 5. Estados e transições

**Incidente** — a única entidade com ciclo de vida:

```text
(inexistente) --open_incident--> aberto --resolve_incident--> resolvido
                                   |                              |
                                   |                              +-- resolve de novo
                                   |                                  ⇒ IncidentAlreadyResolvedError
                                   +-- serviço inexistente na abertura
                                       ⇒ ServiceNotFoundError (nada é gravado)
```

`resolved` é terminal: não há reabertura, e o `resolved_at` original nunca é sobrescrito —
garantido pelo `WHERE status = 'open'` do `UPDATE` (R-009), não por uma checagem prévia.

**Alerta**: `firing`/`resolved` vêm do seed e nenhuma ferramenta os altera nesta feature.

**Serviço e runbook**: cenário, não estado. Só o seed escreve; o agente só lê.

---

## 6. Configuração

| Variável | Obrigatória | Padrão | Validação |
|---|---|---|---|
| `OPSPILOT_DB` | não | `./data/opspilot.db` | `z.string().min(1)` (R-011) |

`':memory:'` é reconhecido como valor especial: não tem diretório a criar, e cada abertura
é um banco novo e vazio, que é o que os testes querem. A comparação é explícita contra a
string, não uma heurística sobre o formato do caminho.

---

## 7. Rastreabilidade

| Requisito | Onde é atendido neste modelo |
|---|---|
| FR-014 | Quatro tabelas, §3 |
| FR-015 | `serviceSchema.tier` + coluna `tier`, §1/§3 |
| FR-016 | `incidentSchema.summary` + `resolved_at`/`summary` anuláveis, §1/§3 |
| FR-017 | `runbookSchema` com `serviceId` como PK e `steps` ordenado, §1/§3 |
| FR-018 | `CHECK` em `tier`, `severity`, ambos os `status`, §3 |
| FR-019 | `REFERENCES services(id)` nas três tabelas dependentes, §3 |
| FR-020 | ISO-8601 UTC em `TEXT`, §3/§4 |
| FR-023 | Validação zod em toda leitura, §4 |
| FR-029a | `RunbookNotFoundError` distinto de `ServiceNotFoundError`, §1 |
