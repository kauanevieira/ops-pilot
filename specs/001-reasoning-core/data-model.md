# Phase 1 Data Model: Núcleo de Raciocínio do OpsPilot

**Feature**: `001-reasoning-core` | **Date**: 2026-09-17

Todas as entidades são validadas por esquemas zod declarados em `src/domain/schemas.ts`.
O estado vive em memória nesta feature (R-008); os tipos abaixo são a forma canônica que
uma futura camada Sequelize terá de reproduzir.

---

## Enumerações

| Enum | Valores | Usado por |
|------|---------|-----------|
| `Severity` | `critical` \| `high` \| `medium` \| `low` | Alert, Incident |
| `AlertStatus` | `firing` \| `resolved` | Alert |
| `IncidentStatus` | `open` \| `resolved` | Incident |
| `TraceEventType` | `thought` \| `action` \| `observation` \| `plan` \| `critique` \| `answer` | TraceEvent |

---

## Service

Unidade operacional monitorada.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `string` | Obrigatório, único, slug (`^[a-z0-9-]+$`) |
| `name` | `string` | Obrigatório, não vazio |

**Relacionamentos**: referenciado por `Alert.serviceId` e `Incident.serviceId`.

**Regras**: o conjunto de serviços é fixo pela carga inicial nesta feature; não há
operação de criação de serviço exposta como ferramenta.

---

## Alert

Sinal emitido sobre um serviço.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `string` | Obrigatório, único |
| `serviceId` | `string` | Obrigatório, MUST referenciar um `Service` existente |
| `summary` | `string` | Obrigatório, não vazio |
| `severity` | `Severity` | Obrigatório |
| `status` | `AlertStatus` | Obrigatório |
| `firedAt` | `Date` | Obrigatório |

**Transições de estado**: nenhuma nesta feature — alertas são somente leitura para as
ferramentas (FR-011 expõe apenas listagem). A linha de base os cria já nos dois estados.

---

## Incident

Registro de trabalho aberto em resposta a uma situação.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | `string` | Obrigatório, único, gerado na abertura |
| `title` | `string` | Obrigatório, não vazio |
| `serviceId` | `string` | Obrigatório, MUST referenciar um `Service` existente |
| `severity` | `Severity` | Obrigatório |
| `status` | `IncidentStatus` | Obrigatório |
| `openedAt` | `Date` | Obrigatório |
| `resolvedAt` | `Date \| null` | `null` enquanto `status === "open"`; preenchido na resolução |

**Transições de estado**:

```text
(inexistente) --open_incident--> open --resolve_incident--> resolved
                                  ^                            |
                                  |                            |
                                  +-- resolve_incident ---------+
                                      sobre incidente já resolvido
                                      => IncidentAlreadyResolvedError
```

**Invariantes**:
- `status === "resolved"` ⟺ `resolvedAt !== null`
- `resolvedAt >= openedAt` quando presente
- Abrir incidente para serviço inexistente ⇒ `ServiceNotFoundError`
- Resolver incidente inexistente ⇒ `IncidentNotFoundError`

---

## TraceEvent

Passo individual do raciocínio. União discriminada por `type`.

| Variante | Campos adicionais |
|----------|-------------------|
| `thought` | `content: string` |
| `action` | `tool: string`, `args: Record<string, unknown>` |
| `observation` | `content: string`, `tool?: string`, `isError?: boolean` |
| `plan` | `steps: string[]`, `revision: number` (0 = plano inicial) |
| `critique` | `content: string` |
| `answer` | `content: string` |

**Regras**:
- Um rastro é uma sequência **ordenada**; a ordem é a ordem de ocorrência.
- Todo evento `action` MUST carregar `tool` e `args` (FR-003).
- Eventos `plan` só aparecem em estratégias com planejamento.
- Um rastro pode terminar sem evento `answer` quando a execução parou por limite.

---

## RunMetrics

| Campo | Tipo | Regras |
|-------|------|--------|
| `llmCalls` | `number` | Inteiro ≥ 0, contagem de chamadas ao modelo |
| `latencyMs` | `number` | ≥ 0, duração total da execução |

---

## StrategyResult

Agregado devolvido por toda estratégia.

| Campo | Tipo | Regras |
|-------|------|--------|
| `answer` | `string` | Resposta final; string vazia quando parou por limite sem concluir |
| `trace` | `TraceEvent[]` | Sequência ordenada, possivelmente parcial |
| `metrics` | `RunMetrics` | Sempre presente (FR-004, SC-002) |
| `stoppedReason` | `"completed" \| "max-iterations" \| "max-steps"` | Sinaliza encerramento por limite (FR-005, FR-028) |

---

## Linha de base (seed)

Estado exigido por FR-020, produzido de forma idempotente (FR-021).

**5 serviços**: `checkout`, `payments`, `auth`, `search`, `notifications`

**6 alertas** — 3 `firing`, 3 `resolved`, severidades variadas:

| id | serviceId | severity | status |
|----|-----------|----------|--------|
| `alert-1` | `checkout` | `critical` | `firing` |
| `alert-2` | `payments` | `high` | `firing` |
| `alert-3` | `auth` | `medium` | `firing` |
| `alert-4` | `search` | `low` | `resolved` |
| `alert-5` | `notifications` | `medium` | `resolved` |
| `alert-6` | `checkout` | `high` | `resolved` |

**0 incidentes**: a linha de base começa sem incidentes, para que a abertura via
ferramenta seja observável nos testes e na arena.

**Idempotência**: a carga substitui integralmente o estado por esse conjunto fixo, com
identificadores e timestamps determinísticos — rodar duas vezes produz estado idêntico
(FR-021, SC-007).

---

## Repositório

Interface de acesso ao estado (FR-017). Implementação in-memory nesta feature.

```text
AlertRepository
  listAlerts(status?: AlertStatus): Alert[]
  findService(id: string): Service | undefined

IncidentRepository
  openIncident(input: { title, serviceId, severity }): Incident
  resolveIncident(id: string): Incident
  getIncident(id: string): Incident | undefined
```

**Regra de pureza** (FR-018): as transições são implementadas como funções puras
`(state, command) => newState` em `src/store/state.ts`; a implementação in-memory é uma
casca fina que guarda o estado corrente e delega a essas funções. É o que torna os
testes de store determinísticos sem qualquer dublê.
